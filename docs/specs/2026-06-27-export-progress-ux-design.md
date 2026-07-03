# Export Progress UX — Design

**Date:** 2026-06-27
**Status:** Approved design (pre-implementation)
**Area:** Case export (`ExportDialog`, export IPC, `export.ts`)

## Problem

The case Export dialog "stays open and stuck on the loading state." Root causes:

1. **Fake, disconnected progress.** `ExportDialog` drives a time-based animation
   (`useTheater`) with hard-coded stages ("Preparing report…", "Packaging
   captures…", "Writing file…") that has no relationship to the real work. On a
   large case (verify every capture, load/burn screenshots, zip), the real
   export outlasts the animation, which then parks on its last stage and spins
   indefinitely.
2. **Dormant real-progress infrastructure.** `generateReport()` already accepts
   `onProgress(step, percent)` and emits genuine stages, and an
   `EXPORT_PROGRESS: 'event:exportProgress'` channel is defined — but the IPC
   handler never passes `onProgress`, the preload never subscribes, and the
   dialog uses the fake theater instead. The wiring is half-built and unused.
3. **Cancel reports success.** Cancelling the OS save dialog makes
   `generateReport` return early; the promise resolves; the dialog shows
   "Export complete!" even though nothing was written.
4. **No completion affordances.** On real completion the dialog shows only a
   small "Export complete!" line — no saved path, no way to reveal/open the file.

## Goals

- Replace fake progress with **real, event-driven** progress reflecting actual
  export work, including per-item granularity through the two heavy stages.
- A proper **completion screen**: saved path + Reveal in folder + Open file.
- **Distinguish cancel from success**; no false "complete".
- A clear, friendly **error state** with retry.

## Non-goals

- **Cancelling a running export** (mid-run abort). Deferred — needs an
  `AbortSignal` threaded through `generateReport` internals; separate change.
- No change to export *contents* (the evidence package, report.html, manifest).

## Approach

Event-driven real progress with an explicit dialog phase state machine. Reuse
the existing IPC conventions (`handle` wrapper, top-level `on*` listeners
returning an unsubscribe). Keep a single `export:generate` IPC call.

## Design

### 1. Shared types & channels — `src/shared/ipc.ts`

```ts
export interface ExportProgressEvent {
  caseId: string
  step: string
  percent: number // 0–100
}

export interface ExportResult {
  canceled: boolean
  filePath?: string
}
```

New channels (alongside the already-defined `EXPORT_PROGRESS`):

```ts
SHELL_SHOW_ITEM_IN_FOLDER: 'shell:showItemInFolder',
SHELL_OPEN_PATH: 'shell:openPath',
```

### 2. Main — `src/main/ipcHandlers.ts`

`EXPORT_GENERATE` handler:

- Use the `event` argument (currently ignored as `_`).
- On save-dialog cancel: `return { canceled: true }` (no longer `return` / `void`).
- Otherwise pass an `onProgress` that forwards to the renderer, then return the path:

```ts
handle(IPC_CHANNELS.EXPORT_GENERATE, async (event, caseId: string, options: ExportOptions) => {
  const isZip = options.format === 'zip'
  const { canceled, filePath } = await dialog.showSaveDialog({ /* unchanged */ })
  if (canceled || !filePath) return { canceled: true }
  await generateReport(
    caseId,
    { ...options, outputPath: filePath },
    captureLifecycle,
    (step, percent) =>
      event.sender.send(IPC_CHANNELS.EXPORT_PROGRESS, { caseId, step, percent } satisfies ExportProgressEvent)
  )
  return { canceled: false, filePath }
})
```

New shell handlers (path is the file the main process itself just returned from
the save dialog):

```ts
handle(IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER, async (_, path: string) => {
  shell.showItemInFolder(path)
})
handle(IPC_CHANNELS.SHELL_OPEN_PATH, async (_, path: string) => {
  return await shell.openPath(path) // returns '' on success, error string otherwise
})
```

`shell` is already imported in this file.

### 3. Main — `src/main/services/export.ts` (granular progress)

The existing coarse milestones (10 → 50 → 60 → 80 → 90 → 100) jump across the two
loops where a large case actually spends its time. Emit per-item sub-progress
**within those two loops**, interpolating percent inside each stage's band so the
bar advances continuously and the label names the current item.

- **Verify integrity loop** (band ~10–50%): the loop currently lives in
  `verifyCaptures`, which has no access to `onProgress`. Thread an optional
  per-item callback through (or inline the loop in `generateReport`) so it can
  emit e.g. `Verifying capture {i} of {n}` with
  `percent = 10 + Math.round((i / n) * 40)`.
- **Screenshot loop** (band ~60–80%): emit `Loading screenshot {i} of {n}` with
  `percent = 60 + Math.round((i / n) * 20)`.

Existing single-shot milestones (Loading captures 10, Generating report 80,
Packaging evidence 90, Complete 100) are retained. The `onProgress` signature
stays `(step: string, percent: number) => void`.

Implementation note: pass `onProgress` into `verifyCaptures` as an optional
parameter, or move its loop body inline into `generateReport`. Prefer threading
the callback to keep `verifyCaptures` reusable; it remains optional so existing
callers/tests are unaffected.

### 4. Preload — `src/preload/index.ts` + `src/renderer/env.d.ts`

- `export.generateReport` return type → `Promise<ExportResult>`
  (`unwrapIpc<ExportResult>`).
- New top-level listener following the existing `on*` convention:

```ts
onExportProgress: (callback: (event: ExportProgressEvent) => void) => {
  const handler = (_: unknown, ev: ExportProgressEvent) => callback(ev)
  ipcRenderer.on(IPC_CHANNELS.EXPORT_PROGRESS, handler)
  return () => ipcRenderer.removeListener(IPC_CHANNELS.EXPORT_PROGRESS, handler)
}
```

- New `shell` domain:

```ts
shell: {
  showItemInFolder: (path: string): Promise<void> =>
    unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER, path)),
  openPath: (path: string): Promise<string> =>
    unwrapIpc<string>(ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_PATH, path))
}
```

Mirror all three in `env.d.ts` (`export.generateReport` signature,
`onExportProgress`, `shell`).

### 5. Renderer — `ExportDialog.tsx` + two new components

`ExportDialog` becomes the orchestrator with a phase state machine:

```ts
type Phase = 'form' | 'exporting' | 'complete' | 'error'
```

- Drop `useTheater`. While `phase === 'exporting'`, subscribe to
  `onExportProgress` (cleanup on unmount / phase change) and store the latest
  `{ step, percent }`. Before the first event (native save picker open), show an
  initial "Preparing export…" indeterminate state (percent 0 + shimmer).
- `handleExport`: set `phase = 'exporting'`; `await generateReport`; then:
  - `result.canceled` → `phase = 'form'` (no success, no celebration).
  - success → store `result.filePath`, `phase = 'complete'` (keep the existing
    `useCompletionCelebration`).
  - throw → store message, `phase = 'error'`.
- **`ExportProgress.tsx`** (new, presentational): determinate bar at real
  `percent` with a smooth CSS width transition, a subtle shimmer on the filled
  portion (so long stages don't look frozen), the live `step` label, and the
  percent. Props: `{ step: string; percent: number }`.
- **`ExportComplete.tsx`** (new, presentational): ✓ + "Export complete", the
  saved path (monospace, truncated with full path in `title`), and buttons
  **Reveal in folder** (`shell.showItemInFolder`), **Open file**
  (`shell.openPath`), **Done** (close). Props:
  `{ filePath: string; onClose: () => void }`.
- **Error**: a small inline card in `ExportDialog` with the message and **Try
  again** (re-runs `handleExport`) alongside **Close**.
- The include/investigator form and the preflight warning stay inline in
  `ExportDialog` (tightly coupled to local form state).

`useTheater` itself is not modified or removed — only this consumer stops using
it.

### 6. Progress-bar honesty

The bar width is always the real `percent`. The shimmer is a "still working"
affordance, not synthetic progress, so the bar never reports work that has not
happened. With §3's per-item callbacks the percent advances smoothly within the
two heavy stages; the shimmer covers the remaining single-shot gaps.

## Testing

- **`ExportDialog`**: phase transitions — `form → exporting → complete`,
  `canceled → form` (asserts no "complete"/celebration), `error → error`;
  renders the live `step`/`percent` from a simulated `onExportProgress`;
  completion buttons invoke `shell.showItemInFolder` / `shell.openPath` with the
  returned path.
- **`export.ts`**: `generateReport` calls `onProgress` with the expected ordered
  steps, including the new per-item verify/screenshot callbacks and monotonic
  non-decreasing percent ending at 100.
- **Handler**: `EXPORT_GENERATE` returns `{ canceled: true }` on save-dialog
  cancel and `{ canceled: false, filePath }` on success; forwards progress via
  `event.sender.send`.

## Files touched

- `src/shared/ipc.ts` — types + channels
- `src/main/ipcHandlers.ts` — export handler + 2 shell handlers
- `src/main/services/export.ts` — per-item progress in the two loops
- `src/preload/index.ts` — return type, `onExportProgress`, `shell` domain
- `src/renderer/env.d.ts` — mirror preload types
- `src/renderer/components/export/ExportDialog.tsx` — phase state machine
- `src/renderer/components/export/ExportProgress.tsx` — new
- `src/renderer/components/export/ExportComplete.tsx` — new
- Tests: `tests/` (dialog, export service, handler)
