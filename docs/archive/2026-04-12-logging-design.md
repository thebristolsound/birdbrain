# Logging & Error Surfacing Design

**Date:** 2026-04-12
**Status:** Approved
**Scope:** Beta — verbose logging, capture failure notification, persistent log file, expanded diagnostics panel

---

## Problem

Birdbrain has no persistent log and surfaces errors only to the developer console (Electron devtools / terminal). Users never see:

- Capture failures (full or partial — e.g. screenshot dropped due to size)
- Main process errors (DB errors, storage errors, IPC failures, OpenRouter errors)
- App lifecycle events (server startup, settings load failures)

The `CaptureHealth` popover in the top bar already shows in-session capture activity, but it resets on restart, has no disk persistence, and covers only the capture pipeline.

---

## Goals

1. Write a structured log to disk that survives restarts and can be attached to bug reports
2. Proactively notify users of failures via toast + badge (not silent)
3. Surface app-level errors (not just capture pipeline) in a log panel visible to the user
4. Beta-appropriate verbosity: `info`, `warn`, and `error` all written to disk and shown in the UI

---

## Approach: Centralized `LogService` + JSON-lines

Single log service in the main process that writes JSON-lines to disk and emits entries to the renderer over IPC. Renderer subscribes, stores entries, fires toasts for errors/warnings, and shows them in an expanded CaptureHealth panel.

---

## Section 1: `LogService`

**File:** `src/main/services/logger.ts`

Singleton with three public methods:

```typescript
logger.error(source: string, message: string, context?: Record<string, unknown>): void
logger.warn(source: string, message: string, context?: Record<string, unknown>): void
logger.info(source: string, message: string, context?: Record<string, unknown>): void
logger.setMainWindow(win: BrowserWindow): void
```

Each call:
1. Constructs a `LogEntry` with `{ level, source, message, context, timestamp }`
2. Appends the entry as a JSON line to `userData/birdbrain.log`
3. Pushes the entry to the renderer via `IPC_CHANNELS.LOG_ENTRY` (if window is available)

**File rotation:** When `birdbrain.log` exceeds 2MB on write, rename it to `birdbrain.log.1` (overwriting any previous backup) and start fresh. Total on-disk footprint: ~4MB max.

**Log file location:** `app.getPath('userData')/birdbrain.log`

**Beta verbosity:** All three levels are written and pushed to the renderer. A future production flag can suppress `info`.

---

## Section 2: Shared Types & IPC

**`LogEntry` type** added to `src/shared/types.ts`:

```typescript
export interface LogEntry {
  level: 'error' | 'warn' | 'info'
  message: string
  source: string
  timestamp: string
  context?: Record<string, unknown>
}
```

**New IPC channel** added to `IPC_CHANNELS` in `src/shared/ipc.ts`:

```typescript
LOG_ENTRY: 'event:logEntry'
```

Main → renderer only. No invoke handler needed.

**Preload bridge** gets one new subscription method (mirroring `onCaptureActivity`):

```typescript
onLogEntry: (callback: (entry: LogEntry) => void) => () => void
```

**Second new IPC channel** for the Reveal button:

```typescript
LOG_FILE_REVEAL: 'log:revealFile'
```

Invoke handler in `ipcHandlers.ts` calls `shell.showItemInFolder(logFilePath)`.

**Capture failures:** `captureServer.ts` already calls `emitCaptureEvent({ type: 'failed' })`. A `logger.error('captureServer', ...)` call is added alongside it so the failure also appears in the persistent log. Screenshot drops (currently `console.warn` + `screenshotWarning` on the stored event) get a `logger.warn('captureServer', ...)` call as well.

---

## Section 3: Renderer

### Store (`appStore.ts`)

Add to state:

```typescript
logEntries: LogEntry[]
addLogEntry: (entry: LogEntry) => void
clearLogEntries: () => void
```

`logEntries` is capped at 200 in-memory. `addLogEntry` prepends and trims (newest-first, same pattern as `captureEvents`).

### Toast notifications

Add `sonner` package. Mount `<Toaster />` in the root layout (`__root.tsx`).

`addLogEntry` fires:
- `toast.error(message)` for `level === 'error'`
- `toast.warning(message)` for `level === 'warn'`

No toast for `info` — informational entries are log-panel-only.

### `useServerStatus` hook

Subscribe to `onLogEntry` alongside the existing `onCaptureActivity` subscription, calling `addLogEntry` on each received entry.

### `CaptureHealth` panel expansion

The existing popover gets two tabs: **Activity** (current capture events view, unchanged) and **Log** (new).

**Log tab:**
- Level filter chips: `Error` / `Warn` / `Info` (multi-select, all active by default)
- Each row: level icon (color-coded), source badge, message text, timestamp
- Max height 300px, scrollable
- Empty state: "No log entries"

**Footer addition:** A "Reveal log file" button calls a new IPC handler (`shell.showItemInFolder`) to open the log file location in Finder/Explorer. Useful for attaching to bug reports.

The top-bar button badge (red on capture failures) is unchanged — toasts handle proactive notification for general log errors.

---

## Section 4: Wire-up

Replace all `console.*` calls in the main process with `logger.*`:

| File | Calls | Source tag |
|---|---|---|
| `src/main/services/captureServer.ts` | 3 error, 1 warn, 1 log→info | `'captureServer'` |
| `src/main/ipcHandlers.ts` | 1 error | `'ipc'` |
| `src/main/services/storage.ts` | 1 error | `'storage'` |
| `src/main/services/settings.ts` | 1 warn | `'settings'` |
| `src/main/index.ts` | 1 warn | `'app'` |
| `src/main/services/ai/openrouter.ts` | 2 log→info, 2 warn, 2 error | `'openrouter'` |

`logger.setMainWindow(win)` called from `src/main/index.ts` immediately after `setMainWindow` is called for the capture server.

---

## New / Modified Files

| File | Change |
|---|---|
| `src/main/services/logger.ts` | **New** — LogService singleton |
| `src/shared/types.ts` | Add `LogEntry` interface |
| `src/shared/ipc.ts` | Add `LOG_ENTRY` channel |
| `src/preload/index.ts` | Add `onLogEntry` bridge method |
| `src/renderer/env.d.ts` | Add `onLogEntry` to `window.birdbrain` type |
| `src/renderer/stores/appStore.ts` | Add `logEntries`, `addLogEntry`, `clearLogEntries` |
| `src/renderer/hooks/useServerStatus.ts` | Subscribe to `onLogEntry` |
| `src/renderer/components/status/CaptureHealth.tsx` | Add Log tab, level filters, Reveal button |
| `src/main/index.ts` | Call `logger.setMainWindow`, replace 1 console call |
| `src/main/ipcHandlers.ts` | Replace 1 console call, add `LOG_FILE_REVEAL` handler |
| `src/main/services/captureServer.ts` | Replace 5 console calls, add logger alongside capture events |
| `src/main/services/storage.ts` | Replace 1 console call |
| `src/main/services/settings.ts` | Replace 1 console call |
| `src/main/services/ai/openrouter.ts` | Replace 6 console calls |
| `src/shared/ipc.ts` | Add `LOG_FILE_REVEAL` channel |
| `package.json` | Add `sonner` |

---

## Out of Scope

- Renderer-side errors (React errors, query failures) — these are a separate concern
- Log search / export from the panel
- Log level configuration in Settings UI
- Remote error reporting / Sentry
