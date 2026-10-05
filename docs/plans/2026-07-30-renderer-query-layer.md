# Renderer Query Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `window.birdbrain` call site in the renderer lives under `src/renderer/lib/api/`, enforced by ESLint.

**Architecture:** `queries.ts` (623 lines at base) splits into per-domain modules under `lib/api/`, mirroring the IPC domain map, with a central `keys.ts`. Wrappers come in three shapes chosen by texture: `queryOptions` factories for cacheable reads, `useMutation` hooks plus exported mutation-options factories for writes with rendered state, and plain typed async functions for one-shot commands. A final PR adds the lint rule and deletes the transitional barrel.

**Tech Stack:** React 19, @tanstack/react-query v5 (`queryOptions` pattern already in use), Zustand, TanStack Router, ESLint 9 flat config, Vitest (jsdom project), @testing-library/react 16.3.2.

**Spec:** `docs/specs/2026-07-30-renderer-query-layer-design.md` — authoritative. Read it before starting.

**Base commit:** `82096ba`. Every line number in this plan was derived there. PR #261
(diagnostics) landed after the spec's first draft and moved a lot of renderer code,
so **re-grep at the start of each task** rather than trusting a line reference:

```bash
grep -rnE "\.birdbrain\b|\[['\"]birdbrain['\"]\]|\{[^}]*\bbirdbrain\b[^}]*\}[[:space:]]*=" \
  src/renderer --include='*.ts' --include='*.tsx' | grep -vE "^src/renderer/lib/"
```

Expected at base: 87 sites across 44 files. Baseline test suite at base: 1403 passed,
5 skipped, 106 files.

## Global Constraints

- **Code style:** no semicolons, single quotes, no trailing commas, 100 char print width, 2-space indent. TypeScript strict. Prefer destructuring. No `any` without an eslint-disable and a reason.
- **Lazy bridge access (correctness requirement).** Every wrapper reads `window.birdbrain` *inside the function body*. Never `const { db } = window.birdbrain` at module scope — that binds the real bridge at module load, before a test installs its stub, and breaks the whole suite.
- **Mechanical means mechanical.** Migration steps move call sites and nothing else. Behavior changes are separate, explicitly-labelled commits.
- **Commit format** `<type>(<scope>): <subject>` — types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`. Never add `Co-authored-by`.
- **Staging:** stage files explicitly. Never `git add .` or `git add -A`.
- **Verify before claiming green:** run `pnpm test` and `pnpm lint` per task. Report actual output.
- Semantic theme tokens in components (`bg-canvas`, `text-text-primary`), not raw Tailwind colors.

## Task → PR mapping

| Task | PR | Deliverable |
| --- | --- | --- |
| 1 | 1 | Scaffold `lib/api`, split `queries.ts`, barrel |
| 2 | 2 | `fakeBridge.ts` + retrofit 8 tests (test-only) |
| 3 | 3 | `db.ts` + 3 components + invalidation fix |
| 4 | 4 | `system.ts` + settings/session sites (free staleness fixes) |
| 5 | 4 | `ai.ts` + AnalysisTab restructure |
| 6 | 4 | `export.ts`, `recapture.ts`, `diagnostics.ts`, selectors, strays |
| 7 | 5 | `events.ts` + `updates.ts` |
| 8 | 6 | ESLint rule, codemod imports, delete barrel |

---

### Task 1: Scaffold `lib/api` — split `queries.ts` by domain

Pure move. Zero behavior change. The existing suite is the oracle: if any test changes behavior, you moved something wrong.

**Files:**
- Create: `src/renderer/lib/api/keys.ts`, `cases.ts`, `session.ts`, `captures.ts`, `tags.ts`, `selectors.ts`, `notes.ts`, `extractedData.ts`, `annotations.ts`, `archive.ts`, `settings.ts` (all under `src/renderer/lib/api/`)
- Modify: `src/renderer/lib/queries.ts` → re-export barrel only
- Test: existing suite (move-only, no new tests)

**Interfaces:**
- Produces: `queryKeys` from `lib/api/keys.ts` (identical shape to today's `queries.ts:19-62`). Every current export of `queries.ts` re-exported unchanged from the barrel, so all 45 importing files keep working untouched.

- [ ] **Step 1:** Move `queryKeys` verbatim from `queries.ts:19-62` into `src/renderer/lib/api/keys.ts`. Add the export and the `as const` exactly as today.

- [ ] **Step 2:** Move each `// --- Domain ---` section into its module. Section boundaries in the current file:

Section boundaries at base `82096ba` (`queries.ts` is 623 lines). Re-derive with
`grep -n "^// --- " src/renderer/lib/queries.ts` before starting — this file is
touched often.

| Lines | Section | Destination |
| --- | --- | --- |
| 64-76 | Cases | `cases.ts` |
| 77-149 | Session | `session.ts` |
| 150-244 | Captures | `captures.ts` |
| 245-324 | Tags | `tags.ts` |
| 325-384 | Selectors | `selectors.ts` |
| 385-437 | Notes | `notes.ts` |
| 438-497 | Extracted Data | `extractedData.ts` |
| 498-536 | Annotations | `annotations.ts` |
| 537-576 | Wayback | `archive.ts` |
| 577-623 | Settings, Identity, App version, OpenRouter Models | `settings.ts` |

Each module imports `queryKeys` from `./keys` and its types from `@shared/ipc` / `@shared/types` — copy only the type imports each module actually uses, from the list at `queries.ts:1-17`.

- [ ] **Step 3:** Replace `queries.ts` contents entirely with re-exports:

```typescript
export * from './api/keys'
export * from './api/cases'
export * from './api/session'
export * from './api/captures'
export * from './api/tags'
export * from './api/selectors'
export * from './api/notes'
export * from './api/extractedData'
export * from './api/annotations'
export * from './api/archive'
export * from './api/settings'
```

- [ ] **Step 4:** Run the full gate.

Run: `pnpm lint && pnpm test && pnpm build`
Expected: all green, zero test changes. If a test needed editing, you changed behavior — revert and redo the move.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/api src/renderer/lib/queries.ts
git commit -m "refactor(renderer): split queries.ts into per-domain lib/api modules"
```

---

### Task 2: Fake bridge test util + retrofit the eight hand-rolling tests

Test-only. **No `src/` changes in this task.**

**Files:**
- Create: `tests/renderer/fakeBridge.ts`
- Modify: `tests/components/CapturesGettingStarted.test.tsx`, `CaseSubhead.test.tsx`, `ExportDialog.test.tsx`, `ImportCaseDialog.test.tsx`, `OnboardingWizardOverlay.test.tsx`, `useCaptureTagEditor.test.tsx`, `useVerifyMutation.test.tsx`, `WaybackTab.test.tsx`

**Interfaces:**
- Produces: `fakeBridge(overrides?): BirdbrainAPI` — installs a stub at `window.birdbrain` and returns it. Unstubbed namespace methods reject with a named error. Event methods default to a no-op returning an unsubscribe.

- [ ] **Step 1: Write the util.** The bridge type is `BirdbrainAPI`, declared in `src/renderer/env.d.ts:235-236`. Namespace and event names come from `src/preload/index.ts` (namespaces from the object literal, events from the `subscribe(...)` entries) — re-read it; PR #261 added `onLogEntry` at line 220.

```typescript
// tests/renderer/fakeBridge.ts
import { vi } from 'vitest'

type Birdbrain = Window['birdbrain']
type Overrides = Record<string, unknown>

const NAMESPACES = [
  'cases', 'captures', 'recapture', 'tags', 'selectors', 'notes', 'archive',
  'annotations', 'extension', 'session', 'settings', 'export', 'shell', 'app',
  'diagnostics', 'updates', 'db', 'ai', 'extractedData'
] as const

const EVENTS = [
  'onExportProgress', 'onArchiveProgress', 'onNewCapture', 'onSessionStateChanged',
  'onExtensionConnection', 'onCaptureActivity', 'onSelectorRematched',
  'onDeepLinkNavigate', 'onUpdateStatus', 'onLogEntry'
] as const

const TOP_LEVEL = ['search', 'testPipeline', 'testHttp'] as const

export function fakeBridge(overrides: Overrides = {}): Birdbrain {
  const bridge: Record<string, unknown> = {}

  for (const ns of NAMESPACES) {
    const stubbed = (overrides[ns] ?? {}) as Record<string, unknown>
    bridge[ns] = new Proxy(stubbed, {
      get(target, method: string) {
        if (method in target) return target[method]
        return vi.fn(async () => {
          throw new Error(`fakeBridge: ${ns}.${method} called but not stubbed`)
        })
      }
    })
  }

  for (const evt of EVENTS) {
    bridge[evt] = overrides[evt] ?? vi.fn(() => () => {})
  }

  for (const fn of TOP_LEVEL) {
    bridge[fn] =
      overrides[fn] ??
      vi.fn(async () => {
        throw new Error(`fakeBridge: ${fn} called but not stubbed`)
      })
  }

  ;(window as unknown as { birdbrain: Birdbrain }).birdbrain = bridge as Birdbrain
  return bridge as Birdbrain
}
```

Two things that matter here. The Proxy `get` **returns** the stub function rather than invoking it — invoking it would throw at property-access time. And it assigns `window.birdbrain` rather than replacing `globalThis.window`: in the jsdom project `window` is a getter and reassigning it fails.

- [ ] **Step 2: Retrofit the simplest test first to validate the util.** `tests/components/CapturesGettingStarted.test.tsx` uses one bridge method (`extension.openFolder`). Replace its hand-rolled assignment with:

```typescript
import { fakeBridge } from '../renderer/fakeBridge'

const openFolder = vi.fn(async () => undefined)
beforeEach(() => {
  fakeBridge({ extension: { openFolder } })
})
```

- [ ] **Step 3: Run it.**

Run: `pnpm test -- tests/components/CapturesGettingStarted.test.tsx`
Expected: PASS. If it fails with `fakeBridge: X.y called but not stubbed`, the test depended on a method its hand-rolled stub silently returned `undefined` for — add that method to the overrides. That gap-surfacing is the point of the util.

- [ ] **Step 4: Retrofit the remaining seven.** Same pattern. Per-file override sets:

| Test file | Overrides needed |
| --- | --- |
| `CaseSubhead.test.tsx` | whatever it currently assigns — read the existing `birdbrain =` block and translate key-for-key |
| `ExportDialog.test.tsx` | `export: { preflight, generateReport }`, `shell: { showItemInFolder, openPath }`, `onExportProgress` |
| `ImportCaseDialog.test.tsx` | `cases: {...}`, `onArchiveProgress` |
| `OnboardingWizardOverlay.test.tsx` | `settings: { update }` |
| `useCaptureTagEditor.test.tsx` | `tags: {...}` |
| `useVerifyMutation.test.tsx` | `captures: { verify }` |
| `WaybackTab.test.tsx` | `archive`/`captures` methods it currently stubs |

For each: read the existing `(window as ...).birdbrain = {...}` assignment, pass exactly those methods as overrides, delete the cast. Keep every `vi.fn()` and its mock implementation unchanged — only the installation mechanism changes.

- [ ] **Step 5: Run the whole suite.**

Run: `pnpm test && pnpm lint`
Expected: green. Assertions must be unchanged from before — if you edited an assertion, you changed a test's meaning rather than its plumbing.

- [ ] **Step 6: Commit**

```bash
git add tests/renderer/fakeBridge.ts tests/components
git commit -m "test(renderer): add fake bridge util and retrofit hand-rolled stubs"
```

---

### Task 3: `db` domain — 13 sites, then the invalidation fix

Two commits. The first is mechanical, the second changes behavior.

**Files:**
- Create: `src/renderer/lib/api/db.ts`, `tests/renderer/api/db.test.ts`
- Modify: `src/renderer/lib/api/keys.ts`, `src/renderer/components/settings/db/DbStats.tsx`, `DbTables.tsx`, `DbUtilities.tsx`

**Interfaces:**
- Consumes: `queryKeys` (Task 1), `fakeBridge` (Task 2).
- Produces:
  - `dbStatsQueryOptions` — `queryOptions` for `DbStats`.
  - `dbTableRowsQueryOptions(params: DbTableRowsParams)` — `queryOptions` for `DbTables`. `DbTableRowsParams` is `{ table, offset, limit }`.
  - `dbAdminMutationOptions(queryClient: QueryClient)` — plain factory returning mutation-options objects for all 13 operations, testable without mounting.
  - `useDbAdminMutations()` — hook wrapping the factory; returns `{ vacuum, rebuildFts, purgeArchived, findOrphans, cleanOrphans, backup, restore, exportTable, createRow, updateRow, deleteRow }`, each a `UseMutationResult`.

Exact bridge signatures (from `src/renderer/env.d.ts:192-206`):

```typescript
stats(): Promise<DbStats>
tableRows(params: DbTableRowsParams): Promise<DbTableRowsResult>
createRow(params: DbCreateRowParams): Promise<Record<string, unknown>>
updateRow(params: DbUpdateRowParams): Promise<boolean>
deleteRow(params: DbRowIdentifier): Promise<boolean>
vacuum(): Promise<{ freedBytes: number }>
rebuildFts(): Promise<{ rowsIndexed: number; textsHealed: number }>
purgeArchived(): Promise<{ casesDeleted: number; capturesDeleted: number }>
findOrphans(): Promise<OrphanReport>
cleanOrphans(report: OrphanReport): Promise<{ dbRecordsRemoved: number; filesRemoved: number }>
backup(): Promise<{ path: string } | null>
restore(): Promise<{ restored: boolean }>
exportTable(params: DbExportTableParams): Promise<{ path: string } | null>
```

- [ ] **Step 1: Add the keys.** In `src/renderer/lib/api/keys.ts`, inside the `queryKeys` object:

```typescript
  dbStats: ['db', 'stats'] as const,
  dbTableRows: (table: string, offset: number, limit: number) =>
    ['db', 'tableRows', table, offset, limit] as const,
```

`DbTableRowsParams` is `{ table: string; offset: number; limit: number }` (`src/shared/ipc.ts:367-371`) — offset/limit, not a page number. The key mirrors it so paging through the browser produces distinct cache entries.

- [ ] **Step 2: Write the failing test.** This is the behavior that matters — `restore` replaces the whole database, so every cached query is stale.

```typescript
// tests/renderer/api/db.test.ts
import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fakeBridge } from '../fakeBridge'
import { dbAdminMutationOptions } from '@renderer/lib/api/db'
import { queryKeys } from '@renderer/lib/api/keys'

describe('dbAdminMutationOptions', () => {
  it('restore invalidates every query', async () => {
    fakeBridge({ db: { restore: vi.fn(async () => ({ restored: true })) } })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).restore
    const data = await opts.mutationFn()
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).toHaveBeenCalledWith()
  })

  it('vacuum invalidates only dbStats', async () => {
    fakeBridge({ db: { vacuum: vi.fn(async () => ({ freedBytes: 1024 })) } })
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const opts = dbAdminMutationOptions(qc).vacuum
    const data = await opts.mutationFn()
    opts.onSuccess?.(data, undefined as never, undefined, undefined as never)

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.dbStats })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run it to confirm it fails.**

Run: `pnpm test -- tests/renderer/api/db.test.ts`
Expected: FAIL — cannot resolve `@renderer/lib/api/db`.

- [ ] **Step 4: Implement `src/renderer/lib/api/db.ts`.**

```typescript
import { useMutation, useQueryClient, queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type {
  DbTableRowsParams,
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  OrphanReport
} from '@shared/ipc'
import { queryKeys } from './keys'

export const dbStatsQueryOptions = queryOptions({
  queryKey: queryKeys.dbStats,
  queryFn: () => window.birdbrain.db.stats()
})

export const dbTableRowsQueryOptions = (params: DbTableRowsParams) =>
  queryOptions({
    queryKey: queryKeys.dbTableRows(params.table, params.offset, params.limit),
    queryFn: () => window.birdbrain.db.tableRows(params)
  })

// restore/purgeArchived/cleanOrphans mutate rows across every table, so a
// targeted invalidation would leave unrelated caches serving deleted rows.
export function dbAdminMutationOptions(queryClient: QueryClient) {
  const invalidateAll = () => {
    queryClient.invalidateQueries()
  }
  const invalidateStats = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dbStats })
  }
  const invalidateStatsAndRows = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dbStats })
    queryClient.invalidateQueries({ queryKey: ['db', 'tableRows'] })
  }

  return {
    vacuum: { mutationFn: () => window.birdbrain.db.vacuum(), onSuccess: invalidateStats },
    rebuildFts: { mutationFn: () => window.birdbrain.db.rebuildFts(), onSuccess: invalidateStats },
    backup: { mutationFn: () => window.birdbrain.db.backup(), onSuccess: invalidateStats },
    exportTable: {
      mutationFn: (params: DbExportTableParams) => window.birdbrain.db.exportTable(params),
      onSuccess: invalidateStats
    },
    findOrphans: { mutationFn: () => window.birdbrain.db.findOrphans() },
    purgeArchived: {
      mutationFn: () => window.birdbrain.db.purgeArchived(),
      onSuccess: invalidateAll
    },
    cleanOrphans: {
      mutationFn: (report: OrphanReport) => window.birdbrain.db.cleanOrphans(report),
      onSuccess: invalidateAll
    },
    restore: { mutationFn: () => window.birdbrain.db.restore(), onSuccess: invalidateAll },
    createRow: {
      mutationFn: (params: DbCreateRowParams) => window.birdbrain.db.createRow(params),
      onSuccess: invalidateStatsAndRows
    },
    updateRow: {
      mutationFn: (params: DbUpdateRowParams) => window.birdbrain.db.updateRow(params),
      onSuccess: invalidateStatsAndRows
    },
    deleteRow: {
      mutationFn: (params: DbRowIdentifier) => window.birdbrain.db.deleteRow(params),
      onSuccess: invalidateStatsAndRows
    }
  }
}

export function useDbAdminMutations() {
  const queryClient = useQueryClient()
  const opts = dbAdminMutationOptions(queryClient)
  return {
    vacuum: useMutation(opts.vacuum),
    rebuildFts: useMutation(opts.rebuildFts),
    backup: useMutation(opts.backup),
    exportTable: useMutation(opts.exportTable),
    findOrphans: useMutation(opts.findOrphans),
    purgeArchived: useMutation(opts.purgeArchived),
    cleanOrphans: useMutation(opts.cleanOrphans),
    restore: useMutation(opts.restore),
    createRow: useMutation(opts.createRow),
    updateRow: useMutation(opts.updateRow),
    deleteRow: useMutation(opts.deleteRow)
  }
}
```

`findOrphans` has no `onSuccess` — it is a read-only report and invalidating on it would fight the `cleanOrphans` flow that consumes its result.

- [ ] **Step 5: Run the test.**

Run: `pnpm test -- tests/renderer/api/db.test.ts`
Expected: PASS.

- [ ] **Step 6: Migrate `DbStats.tsx`** — the whole hand-rolled fetch (lines 14-33) becomes a query. Replace the three `useState` declarations and `fetchStats`/`useEffect` with:

```typescript
import { useQuery } from '@tanstack/react-query'
import { dbStatsQueryOptions } from '@renderer/lib/api/db'

export function DbStats() {
  const { data: stats, isFetching, error, refetch } = useQuery(dbStatsQueryOptions)
```

Then: the error branch renders `error instanceof Error ? error.message : 'Failed to load stats'`; the Refresh button's `onClick` becomes `() => refetch()` and `disabled={isFetching}`; the spinner condition becomes `isFetching`. Drop the now-unused `useState`/`useEffect` imports. Leave all markup and `formatBytes` untouched.

- [ ] **Step 7: Migrate `DbUtilities.tsx`** — 8 sites at lines 54, 72, 92, 110, 134, 153, 175, 197. Each handler follows one shape; here is `handleVacuum` (currently lines 51-67) converted:

```typescript
const { vacuum } = useDbAdminMutations()

async function handleVacuum() {
  setLoading('vacuum')
  try {
    const result = await vacuum.mutateAsync()
    setResult('vacuum', {
      message: `Vacuum complete. Freed ${formatBytes(result.freedBytes)}.`,
      type: 'success'
    })
  } catch (err) {
    setResult('vacuum', {
      message: err instanceof Error ? err.message : 'Vacuum failed',
      type: 'error'
    })
  } finally {
    setLoading(null)
  }
}
```

Only the call expression changes — `window.birdbrain.db.X(...)` becomes `X.mutateAsync(...)`. Keep every `setLoading`, `setResult`, message string, and confirmation dialog exactly as-is. Apply to `rebuildFts` (72), `purgeArchived` (92), `findOrphans` (110), `cleanOrphans` (134), `backup` (153), `restore` (175), `exportTable` (197).

- [ ] **Step 8: Migrate `DbTables.tsx`** — 4 sites. Line 47 (`tableRows`) becomes `useQuery(dbTableRowsQueryOptions(params))`, passing the `{ table, offset, limit }` object the component already builds for the bridge call. Lines 81/97/108 (`createRow`/`updateRow`/`deleteRow`) become `createRow.mutateAsync(...)` etc. from `useDbAdminMutations()`. Keep the existing pagination state, edit dialogs, and error rendering.

- [ ] **Step 9: Verify the mechanical migration.**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: green.

- [ ] **Step 10: Commit the mechanical move**

```bash
git add src/renderer/lib/api/db.ts src/renderer/lib/api/keys.ts tests/renderer/api/db.test.ts src/renderer/components/settings/db
git commit -m "refactor(renderer): move db admin call sites behind lib/api/db"
```

- [ ] **Step 11: Manual smoke — this is the behavior change, so verify it by hand.**

Run: `pnpm dev`, open Settings → Database.
1. Note the row counts in Database Statistics.
2. Run Vacuum. Statistics refresh on their own — no manual Refresh click.
3. Run Purge Archived. Every visible count updates, including the table browser.

Before this change, none of those refreshed. If they still don't, the `onSuccess` wiring is wrong.

- [ ] **Step 12: Commit the behavior fix**

The invalidation is already in `db.ts` from Step 4, so this commit exists to document the behavior change separately in history. If Steps 4-10 were committed together, split them with `git rebase -i` so the invalidation lines land here, or note in the PR body that Step 10's commit carries both. Prefer the split.

```bash
git commit -m "fix(renderer): invalidate caches after destructive db admin operations"
```

---

### Task 4: `system.ts` + settings/session call sites

The staleness fixes fall out of routing calls through mutations that already exist. No new invalidation logic.

**Files:**
- Create: `src/renderer/lib/api/system.ts`, `tests/renderer/api/settings.test.ts`
- Modify: `src/renderer/hooks/useTheme.ts`, `src/renderer/hooks/useSessionRestore.ts`, `src/renderer/components/settings/AppearanceConfig.tsx`, `StorageConfig.tsx`, `AIConfig.tsx`, `src/renderer/components/layout/OnboardingWizard.tsx`, `src/renderer/components/dashboard/cases/CaseWorkspace.tsx`, `DataExplorer.tsx`, `src/renderer/components/captures/AnalysisTab.tsx`, `WaybackTab.tsx`, `CaptureDownloadMenu.tsx`, `ProvenanceBadge.tsx`, `useVerifyMutation.ts`, `src/renderer/components/notes/NoteCard.tsx`, `src/renderer/components/export/ExportComplete.tsx`, `ExportMenu.tsx`, `src/renderer/components/extension/InstallExtensionStepper.tsx`, `CapturesGettingStarted.tsx`, `src/renderer/components/dashboard/ExtensionBanner.tsx`, `src/renderer/components/settings/DiagnosticsPanel.tsx`, `src/renderer/routes/cases/$caseId/captures.tsx`, `src/renderer/hooks/useCaptureThumbnail.ts`
- Modify: `src/renderer/lib/api/settings.ts` (extract options factory), `captures.ts` (add verify)

**Interfaces:**
- Produces:
  - `system.ts`: `openCaptureExternal(captureId: string): Promise<void>`, `downloadCapture(captureId: string): Promise<void>`, `downloadCapturePdf(captureId: string): Promise<void>`, `downloadCaptureScreenshot(captureId: string): Promise<void>`, `revealInFolder(path: string): Promise<void>`, `openPath(path: string): Promise<void>`, `openExtensionFolder(): Promise<void>`, `chooseStoragePath(): Promise<string | null>`, `testOpenRouterKey(apiKey: string): Promise<boolean>` — each a one-line delegation to the bridge. Confirm each return type against `src/renderer/env.d.ts` before writing it; do not guess.
  - `settings.ts`: `settingsUpdateMutationOptions(queryClient: QueryClient)` extracted from the existing `useSettingsMutations`, which becomes a one-liner over it. Behavior identical.
  - `captures.ts`: `useVerifyCapture()` mutation, folding in `components/captures/useVerifyMutation.ts` — read that file and preserve its invalidation exactly.

- [ ] **Step 1: Write the failing test** — the bypass is the bug, so assert the write-through the bypassing sites were skipping.

```typescript
// tests/renderer/api/settings.test.ts
import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fakeBridge } from '../fakeBridge'
import { settingsUpdateMutationOptions } from '@renderer/lib/api/settings'
import { queryKeys } from '@renderer/lib/api/keys'

describe('settingsUpdateMutationOptions', () => {
  it('writes the response into the settings cache', async () => {
    const updated = { theme: 'dark', reduceMotion: false }
    fakeBridge({ settings: { update: vi.fn(async () => updated) } })
    const qc = new QueryClient()

    const opts = settingsUpdateMutationOptions(qc)
    const data = await opts.mutationFn({ theme: 'dark' })
    opts.onSuccess?.(data, { theme: 'dark' }, undefined, undefined as never)

    expect(qc.getQueryData(queryKeys.settings)).toEqual(updated)
  })
})
```

- [ ] **Step 2: Run to confirm it fails.**

Run: `pnpm test -- tests/renderer/api/settings.test.ts`
Expected: FAIL — `settingsUpdateMutationOptions` is not exported yet.

- [ ] **Step 3: Extract the factory** in `src/renderer/lib/api/settings.ts`. The current `useSettingsMutations` body (moved from `queries.ts:557-572`) already does the right thing; lift it:

```typescript
export function settingsUpdateMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (partial: Partial<BirdbrainSettings>) => window.birdbrain.settings.update(partial),
    onSuccess: (data: BirdbrainSettings, partial: Partial<BirdbrainSettings>) => {
      queryClient.setQueryData(queryKeys.settings, data)
      if ('openRouterApiKey' in partial) {
        queryClient.invalidateQueries({ queryKey: queryKeys.openRouterModels })
      }
    }
  }
}

export function useSettingsMutations() {
  const queryClient = useQueryClient()
  return { update: useMutation(settingsUpdateMutationOptions(queryClient)) }
}
```

- [ ] **Step 4: Run the test.**

Run: `pnpm test -- tests/renderer/api/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/renderer/lib/api/system.ts`.** Every function is a one-line delegation. Pattern:

```typescript
export function openCaptureExternal(captureId: string): Promise<void> {
  return window.birdbrain.captures.openExternal(captureId)
}

export function revealInFolder(path: string): Promise<void> {
  return window.birdbrain.shell.showItemInFolder(path)
}
```

Write the remaining seven the same way. No caching, no error handling, no logging — callers already handle failures.

- [ ] **Step 6: Migrate the settings write sites.** Each becomes `useSettingsMutations().update.mutate(...)`. This is where staleness is fixed.

| Site | Current | Replace with |
| --- | --- | --- |
| `useTheme.ts:33` | `window.birdbrain.settings.update({ theme: next })` | `update.mutate({ theme: next })` |
| `AppearanceConfig.tsx:28` | `...update({ reduceMotion: next })` | `update.mutate({ reduceMotion: next })` |
| `OnboardingWizard.tsx:41` | `await ...update({ hasCompletedOnboarding: true })` | `await update.mutateAsync({ hasCompletedOnboarding: true })` |
| `CaseWorkspace.tsx:32` | `...update({ lastActiveCaseId: caseId })` | `update.mutate({ lastActiveCaseId: caseId })` |
| `CaseWorkspace.tsx:60` | `...update({ lastActiveSection: section })` | `update.mutate({ lastActiveSection: section })` |

`useTheme.ts` keeps its localStorage fast-path and the no-transitions dance untouched — only line 33 changes.

- [ ] **Step 7: Migrate the settings read sites.** `AnalysisTab.tsx:36` and `useSessionRestore.ts:72` become `queryClient.fetchQuery(settingsQueryOptions)`. Both currently `await` a one-shot read inside an effect; `fetchQuery` preserves that shape while populating the cache.

- [ ] **Step 8: Migrate `CaseWorkspace.tsx:28`** — the session bypass:

```typescript
const { activateCase } = useSessionMutations()

useEffect(() => {
  if (caseId) {
    activateCase.mutate(caseId)
    update.mutate({ lastActiveCaseId: caseId })
  }
}, [caseId])
```

The existing `.catch(err => console.error(...))` is no longer needed — the mutation captures the error. Preserve the surrounding comment.

- [ ] **Step 9: Migrate the one-shot command sites** to `system.ts` imports. Replace the bridge expression with the helper; nothing else in these files changes.

| Sites | Helper |
| --- | --- |
| `AnalysisTab.tsx:323`, `WaybackTab.tsx:26`, `DataExplorer.tsx:62`, `NoteCard.tsx:111`, `AIConfig.tsx:141`, `captures.tsx:87` | `openCaptureExternal` |
| `CaptureDownloadMenu.tsx:102` | `downloadCapture` |
| `CaptureDownloadMenu.tsx:57` | `downloadCapturePdf` |
| `CaptureDownloadMenu.tsx:123` | `downloadCaptureScreenshot` |
| `ExportComplete.tsx:27`, `ExportMenu.tsx:170` | `revealInFolder` |
| `ExportComplete.tsx:36`, `DiagnosticsPanel.tsx:224` | `openPath` |
| `InstallExtensionStepper.tsx:35`, `CapturesGettingStarted.tsx:43`, `ExtensionBanner.tsx:12` | `openExtensionFolder` |
| `StorageConfig.tsx:14` | `chooseStoragePath` |
| `AIConfig.tsx:28` | `testOpenRouterKey` |

- [ ] **Step 10: Fold `useVerifyMutation.ts` into `captures.ts`.** Read `src/renderer/components/captures/useVerifyMutation.ts` first and copy its mutation config verbatim into a `useVerifyCapture()` export. Update `ProvenanceBadge.tsx:63` and any other importer, then delete the old file. `useCaptureThumbnail.ts:18` switches to the existing `captureThumbnailQueryOptions`.

- [ ] **Step 11: Verify.**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: green.

- [ ] **Step 12: Manual smoke — confirms the staleness fix.**

Run: `pnpm dev`.
1. Toggle the theme, then open Settings → Appearance. The theme control reflects the current theme.
2. Toggle Reduce Motion, navigate away and back. It persists and displays correctly.

Before this change the Settings view read a stale cache and could show the previous value.

- [ ] **Step 13: Commit** — two commits, mechanical first.

```bash
git add src/renderer/lib/api/system.ts src/renderer/lib/api/settings.ts src/renderer/lib/api/captures.ts tests/renderer/api/settings.test.ts
git commit -m "feat(renderer): add system command helpers and settings mutation factory"

git add src/renderer/hooks src/renderer/components src/renderer/routes
git commit -m "fix(renderer): route settings and session writes through their mutations"
```

---

### Task 5: `ai.ts` + AnalysisTab

Mechanical move, then the restructure as a second commit.

**Files:**
- Create: `src/renderer/lib/api/ai.ts`
- Modify: `src/renderer/lib/api/keys.ts`, `src/renderer/components/captures/AnalysisTab.tsx`

**Interfaces:**
- Produces: `analysisQueryOptions(captureId: string)`, `useAnalysisMutations()` returning `{ analyze, saveAnalysis }`.

Bridge signatures (`src/renderer/env.d.ts:187-191`):

```typescript
analyze(params: AnalyzeCaptureParams): Promise<{ content: string; tokenUsage: TokenUsage }>
saveAnalysis(analysis: CaptureAnalysis): Promise<void>
getAnalysis(captureId: string): Promise<CaptureAnalysis | null>
```

- [ ] **Step 1: Add the key** to `keys.ts`:

```typescript
  analysis: (captureId: string) => ['analysis', captureId] as const,
```

- [ ] **Step 2: Implement `src/renderer/lib/api/ai.ts`.**

```typescript
import { useMutation, useQueryClient, queryOptions } from '@tanstack/react-query'
import type { AnalyzeCaptureParams, CaptureAnalysis } from '@shared/ipc'
import { queryKeys } from './keys'

export const analysisQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.analysis(captureId),
    queryFn: () => window.birdbrain.ai.getAnalysis(captureId)
  })

export function useAnalysisMutations() {
  const queryClient = useQueryClient()

  const analyze = useMutation({
    mutationFn: (params: AnalyzeCaptureParams) => window.birdbrain.ai.analyze(params)
  })

  const saveAnalysis = useMutation({
    mutationFn: (analysis: CaptureAnalysis) => window.birdbrain.ai.saveAnalysis(analysis),
    onSuccess: (_void, analysis) => {
      queryClient.setQueryData(queryKeys.analysis(analysis.captureId), analysis)
    }
  })

  return { analyze, saveAnalysis }
}
```

- [ ] **Step 3: Migrate `AnalysisTab.tsx` mechanically.** Lines 47 (`getAnalysis`), 80 (`analyze`), 112 (`saveAnalysis`) switch to the wrappers. Leave the nine `useState` flags in place for this commit — mechanical only.

- [ ] **Step 4: Verify and commit the move.**

Run: `pnpm test && pnpm lint`

```bash
git add src/renderer/lib/api/ai.ts src/renderer/lib/api/keys.ts src/renderer/components/captures/AnalysisTab.tsx
git commit -m "refactor(renderer): move AnalysisTab bridge calls behind lib/api/ai"
```

- [ ] **Step 5: Restructure — the behavior change.** Read the whole of `AnalysisTab.tsx` first. Then:
- Replace the load flags with `useQuery(analysisQueryOptions(captureId))` — `isLoading`/`error`/`data` come from the query.
- Replace the analyze/save flags with the mutations' `isPending`/`error`.
- Move uuid and `createdAt` minting out of the component and into the `saveAnalysis` mutationFn's caller-facing shape: the component passes analysis content, the id/timestamp are generated in one place.
- Delete raw query-key literals in favour of `queryKeys.analysis(captureId)`.

Preserve every rendered string and the tab's visual states exactly.

- [ ] **Step 6: Manual smoke.**

Run: `pnpm dev`, open a capture → Analysis tab. Run an analysis; confirm the pending state renders, the result appears, and reopening the tab shows the saved analysis without a refetch flash.

- [ ] **Step 7: Commit the restructure**

```bash
git add src/renderer/components/captures/AnalysisTab.tsx src/renderer/lib/api/ai.ts
git commit -m "refactor(renderer): replace AnalysisTab hand-rolled flags with query state"
```

---

### Task 6: `export.ts`, `recapture.ts`, `diagnostics.ts`, selectors, strays

All mechanical.

**Files:**
- Create: `src/renderer/lib/api/export.ts`, `recapture.ts`, `diagnostics.ts`
- Modify: `src/renderer/lib/api/keys.ts`, `cases.ts`, `selectors.ts`, `captures.ts`, `src/renderer/components/export/ExportDialog.tsx`, `src/renderer/components/status/CaptureHealth.tsx`, `src/renderer/components/settings/DiagnosticsPanel.tsx`, `src/renderer/components/selectors/CreateSelectorCard.tsx`, `SelectorTable.tsx`, `SelectorTableRow.tsx`, `SelectorsOverview.tsx`, `src/renderer/components/dashboard/cases/NewCaseWizard.tsx`, `src/renderer/components/dashboard/Dashboard.tsx`, `src/renderer/hooks/useSelectorFilters.ts`

**Interfaces:**
- Produces: `useGenerateReport()`, `recaptureQueueStatusQueryOptions`, `useCaptureHealthChecks()` returning `{ testPipeline, testHttp }`, `diagnosticsQueryOptions`.

- [ ] **Step 1: Add keys** to `keys.ts`:

```typescript
  recaptureQueue: ['recapture', 'queueStatus'] as const,
  diagnostics: ['diagnostics'] as const,
```

- [ ] **Step 2: Implement `diagnostics.ts`** — the namespace is six methods (`src/renderer/env.d.ts:183-190`), not one:

```typescript
diagnostics: {
  get(): Promise<DiagnosticsSnapshot>
  log(payload: RendererLogPayload): Promise<string>
  recentEntries(limit: number): Promise<LogEntry[]>
  revealLog(): Promise<void>
  lastSession(): Promise<SessionRecord | null>
  createReport(input: BugReportInput): Promise<BugReportResult | null>
}
```

```typescript
import { useMutation, queryOptions } from '@tanstack/react-query'
import type { BugReportInput, RendererLogPayload } from '@shared/ipc'
import { queryKeys } from './keys'

export const diagnosticsQueryOptions = queryOptions({
  queryKey: queryKeys.diagnostics,
  queryFn: () => window.birdbrain.diagnostics.get()
})

export const recentLogEntriesQueryOptions = (limit: number) =>
  queryOptions({
    queryKey: queryKeys.recentLogEntries(limit),
    queryFn: () => window.birdbrain.diagnostics.recentEntries(limit)
  })

export const lastSessionQueryOptions = queryOptions({
  queryKey: queryKeys.lastSession,
  queryFn: () => window.birdbrain.diagnostics.lastSession()
})

export function logFromRenderer(payload: RendererLogPayload): Promise<string> {
  return window.birdbrain.diagnostics.log(payload)
}

export function revealLog(): Promise<void> {
  return window.birdbrain.diagnostics.revealLog()
}

export function useCreateBugReport() {
  return useMutation({
    mutationFn: (input: BugReportInput) => window.birdbrain.diagnostics.createReport(input)
  })
}
```

Add the two new keys to `keys.ts` alongside `diagnostics`:

```typescript
  recentLogEntries: (limit: number) => ['diagnostics', 'recentEntries', limit] as const,
  lastSession: ['diagnostics', 'lastSession'] as const,
```

**Do not touch `src/renderer/lib/queryClient.ts`, `mainLogBridge.ts`, or `notify.ts`.** They call the bridge as lib-layer infrastructure and are exempt by design — `queryClient.ts` importing from `lib/api` would also risk a circular import. Confirm each type name against `src/shared/ipc.ts` before writing it.

- [ ] **Step 3: Implement `recapture.ts`** — `recaptureQueueStatusQueryOptions` over `window.birdbrain.recapture.queueStatus()`, plus `useCaptureHealthChecks()` wrapping the two top-level bridge functions as mutations (they return `{ success, durationMs, error? }` per `env.d.ts:222-223`):

```typescript
export function useCaptureHealthChecks() {
  return {
    testPipeline: useMutation({ mutationFn: () => window.birdbrain.testPipeline() }),
    testHttp: useMutation({ mutationFn: () => window.birdbrain.testHttp() })
  }
}
```

- [ ] **Step 4: Implement `export.ts`** — `useGenerateReport()` over `window.birdbrain.export.generateReport(...)`. Read `ExportDialog.tsx:37,73` first to get the exact params object it passes, and mirror that type.

- [ ] **Step 5: Migrate the call sites.**

| Site | Destination |
| --- | --- |
| `ExportDialog.tsx:37,73` | `useGenerateReport()` from `export.ts` |
| `CaptureHealth.tsx:76` | `recaptureQueueStatusQueryOptions` |
| `CaptureHealth.tsx:85,98` | `useCaptureHealthChecks()` |
| `DiagnosticsPanel.tsx:103` | `diagnosticsQueryOptions` — it is already an inline `queryOptions`; move it into the module and import |
| `CrashRecoveryPrompt.tsx:14` | `lastSessionQueryOptions` |
| `LogTab.tsx:39` | `recentLogEntriesQueryOptions` |
| `LogTab.tsx:88` | `revealLog` |
| `LogTab.tsx:30` | deferred to Task 7 (`onLogEntry` subscription) |
| `ReportProblemDialog.tsx:52` | `useCreateBugReport()` |
| `ErrorBoundary.tsx:36` | `logFromRenderer` |
| `Dashboard.tsx:61` | add `inspectArchive` to `cases.ts`, call it from there |
| `CreateSelectorCard.tsx:54`, `SelectorTable.tsx:62,67`, `SelectorTableRow.tsx:48`, `SelectorsOverview.tsx:49`, `NewCaseWizard.tsx:73`, `useSelectorFilters.ts:15` | existing `useSelectorsMutations` / query options in `selectors.ts`; add any missing member there |

- [ ] **Step 6: Migrate the selector preview reads — mechanical wrap only.** `CreateSelectorCard.tsx:79,85` and `SelectorTableRow.tsx:49,55` call `captures.list` and `captures.getContent` inside the preview loop. Replace with `queryClient.fetchQuery(capturesQueryOptions(caseId))` and `queryClient.fetchQuery(captureContentQueryOptions(captureId, type))`.

**Do not restructure the preview loop.** Its batching and sequencing stay exactly as written — the deepening is a separate candidate (Foreground Match Preview) and is out of scope.

- [ ] **Step 7: Verify.**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/lib/api src/renderer/components src/renderer/hooks
git commit -m "refactor(renderer): move export, recapture, diagnostics and selector call sites behind lib/api"
```

---

### Task 7: `events.ts` — both subscription shapes

**Files:**
- Create: `src/renderer/lib/api/events.ts`, `src/renderer/lib/api/updates.ts`, `tests/renderer/api/events.test.ts`
- Modify: `src/renderer/hooks/useServerStatus.ts`, `src/renderer/hooks/useUpdateStatus.ts`, `src/renderer/components/dashboard/cases/ImportCaseDialog.tsx`, `src/renderer/components/export/ExportMenu.tsx`, `src/renderer/components/export/ExportDialog.tsx`

**Interfaces:**
- Consumes: `queryKeys`, `useAppStore` from `@renderer/stores/appStore`, `queryClient` from `@renderer/lib/queryClient`, `router` from `@renderer/router`.
- Produces:
  - `subscribeToMainEvents(): () => void` — the seven global subscriptions, returning a combined unsubscribe.
  - `subscribeToArchiveProgress(handler: (event: ArchiveProgressEvent) => void): () => void`
  - `subscribeToExportProgress(handler: (event: ExportProgressEvent) => void): () => void`
  - `subscribeToLogEntries(handler: (entry: LogEntry) => void): () => void` — the tenth channel, added by PR #261. `LogTab.tsx:30` consumes it. `lib/mainLogBridge.ts:68` also subscribes and stays as-is (lib layer, exempt).
  - `updates.ts`: `updateStatusQueryOptions`, `useUpdateMutations()` returning `{ check, download, install }`.

- [ ] **Step 1: Write the failing test** — the invalidation table is the behavior worth locking down.

```typescript
// tests/renderer/api/events.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import { queryClient } from '@renderer/lib/queryClient'
import { queryKeys } from '@renderer/lib/api/keys'

describe('subscribeToMainEvents', () => {
  let handlers: Record<string, (payload: never) => void>

  beforeEach(() => {
    handlers = {}
    const capture = (name: string) => (h: (payload: never) => void) => {
      handlers[name] = h
      return () => {}
    }
    fakeBridge({
      onSelectorRematched: capture('rematch'),
      onNewCapture: capture('newCapture'),
      onExtensionConnection: capture('extension'),
      onSessionStateChanged: capture('session'),
      onCaptureActivity: capture('activity'),
      onDeepLinkNavigate: capture('deepLink'),
      onUpdateStatus: capture('updateStatus')
    })
  })

  it('invalidates the three selector key families on rematch', async () => {
    const { subscribeToMainEvents } = await import('@renderer/lib/api/events')
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const unsub = subscribeToMainEvents()

    handlers.rematch({ caseId: 'case1' } as never)

    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.selectorMatchCounts('case1') })
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.selectorCoverage('case1') })
    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.selectorMatchingCapturesAll('case1')
    })
    unsub()
  })

  it('prepends a new capture into the cached list', async () => {
    const { subscribeToMainEvents } = await import('@renderer/lib/api/events')
    const existing = { id: 'old', caseId: 'case1' }
    queryClient.setQueryData(queryKeys.captures('case1'), [existing])
    const unsub = subscribeToMainEvents()

    const fresh = { id: 'new', caseId: 'case1' }
    handlers.newCapture(fresh as never)

    expect(queryClient.getQueryData(queryKeys.captures('case1'))).toEqual([fresh, existing])
    unsub()
  })
})
```

- [ ] **Step 2: Run to confirm it fails.**

Run: `pnpm test -- tests/renderer/api/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `events.ts`.** Move `useServerStatus.ts:9-62` verbatim into `subscribeToMainEvents`, keeping **both comments** — they record invariants (partial-rematch invalidation at lines 42-43, navigate-only-if-not-on-case at 17-18, deep-link routing at 49). Add the `onUpdateStatus` subscription lifted from `useUpdateStatus.ts:25`. Then append the two progress wrappers:

```typescript
export function subscribeToArchiveProgress(
  handler: (event: ArchiveProgressEvent) => void
): () => void {
  return window.birdbrain.onArchiveProgress(handler)
}

export function subscribeToExportProgress(
  handler: (event: ExportProgressEvent) => void
): () => void {
  return window.birdbrain.onExportProgress(handler)
}
```

These stay per-instance because their handlers filter by `caseId` into component-local state. Do **not** fold them into `subscribeToMainEvents`.

- [ ] **Step 4: Shrink `useServerStatus.ts`** to:

```typescript
import { useEffect } from 'react'
import { subscribeToMainEvents } from '@renderer/lib/api/events'

export function useServerStatus() {
  useEffect(() => subscribeToMainEvents(), [])
}
```

- [ ] **Step 5: Implement `updates.ts` and shrink `useUpdateStatus.ts`.** Read `useUpdateStatus.ts` fully first — it has four bridge calls (lines 15, 40, 53, 61) plus the subscription. `getStatus` becomes `updateStatusQueryOptions`; `check`/`download`/`install` become `useUpdateMutations()`. The hook keeps its local UI state and consumes the wrappers.

- [ ] **Step 6: Migrate the three progress subscribers.** Each swaps `window.birdbrain.onArchiveProgress(...)` for `subscribeToArchiveProgress(...)` (or the export equivalent), keeping the surrounding `useEffect`, its dependency array, and the handler body byte-for-byte.

**`ImportCaseDialog.tsx:30` carries an invariant in its comment** — the subscription must be established on mount, not gated on the import starting, or a progress event fired immediately after `mutateAsync` is missed. Keep the comment and the mount-time `useEffect`.

- [ ] **Step 7: Verify.**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: green.

- [ ] **Step 8: Manual smoke — the live paths.**

Run: `pnpm dev`.
1. Connect the extension. The connection indicator flips.
2. Capture a page. It appears in the capture list without a manual refresh (the write-through path).
3. Export a case. The progress bar advances and completion renders.
4. Import an archive. Its progress bar advances.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/lib/api/events.ts src/renderer/lib/api/updates.ts tests/renderer/api/events.test.ts src/renderer/hooks src/renderer/components
git commit -m "feat(renderer): move main-process subscriptions behind lib/api/events"
```

---

### Task 8: Enforcement — lint rule, import codemod, delete the barrel

**Files:**
- Modify: `eslint.config.js`, the 45 files importing `@renderer/lib/queries`
- Delete: `src/renderer/lib/queries.ts`
- Test: `pnpm lint` is the test

- [ ] **Step 1: Sweep for stragglers.**

Run:
```bash
grep -rnE "\.birdbrain\b|\[['\"]birdbrain['\"]\]|\{[^}]*\bbirdbrain\b[^}]*\}[[:space:]]*=" \
  src/renderer --include='*.ts' --include='*.tsx' | grep -vE "^src/renderer/lib/"
```
Expected: no output. Any hit is a missed site — wrap it in the appropriate `lib/api` module. Never add an eslint-disable.

- [ ] **Step 2: Codemod the imports.** List the importers:

```bash
grep -rl "@renderer/lib/queries" src/renderer
```

Rewrite each to the specific domain module (`@renderer/lib/api/keys`, `@renderer/lib/api/captures`, …). A file importing several domains gets several import statements.

- [ ] **Step 3: Delete the barrel.**

```bash
git rm src/renderer/lib/queries.ts
```

- [ ] **Step 4: Add the lint rule** to `eslint.config.js`, as a new config object appended inside the existing `tseslint.config(...)` call (after the `src/main/**` block that ends at line 65):

```javascript
  {
    // Bridge access is restricted to the api wrappers in lib/api/
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/lib/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='birdbrain']",
          message: 'Access window.birdbrain only via src/renderer/lib/api/ wrappers'
        },
        {
          selector: "MemberExpression[property.value='birdbrain']",
          message: 'Access window.birdbrain only via src/renderer/lib/api/ wrappers'
        },
        {
          selector: "ObjectPattern > Property[key.name='birdbrain']",
          message: 'Do not destructure birdbrain; call a src/renderer/lib/api/ wrapper'
        }
      ]
    }
  }
```

Three selectors, not one: bracket access exposes `property.value` rather than `property.name`, and destructuring is neither. Matching on the property rather than `object.name === 'window'` also catches aliases.

- [ ] **Step 5: Verify the rule actually bites.** Temporarily add `const s = window.birdbrain.db.stats()` to a renderer component, run `pnpm lint`, confirm it errors, then remove it. A rule that passes because it matches nothing is worse than no rule.

- [ ] **Step 6: Full gate.**

Run: `pnpm lint && pnpm test && pnpm build && pnpm test:e2e`
Expected: green. E2E matters here — the import rewrite touches 45 files.

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js src/renderer
git commit -m "chore(renderer): enforce the lib/api bridge seam via ESLint and drop the barrel"
```

---

## Self-review notes

**Spec coverage.** Module map → Tasks 1, 3-7 (every module has a task; `session.ts` in Task 1, `diagnostics.ts` in Task 6). Wrapper-shape-by-texture → the three shapes appear in Tasks 3 (query + mutation factory), 4 (plain command), 6. Lazy bridge access → Global Constraints, and every code block reads `window.birdbrain` inside a function body. Behavior fixes as separate commits → Task 3 Steps 10/12, Task 4 Step 13, Task 5 Steps 4/7. Two subscription shapes → Task 7 Steps 3/6. Fake bridge + retrofit all eight → Task 2. Six-PR sequence → the Task → PR table. Bypass inventory → Tasks 3-7 cover all 77 sites; Task 8 Step 1 is the backstop sweep.

**Deliberate uncertainty.** Three places where the plan says "read the file first" rather than inventing an interface: `useVerifyMutation.ts`'s exact invalidation (Task 4 Step 10), `ExportDialog`'s `generateReport` params (Task 6 Step 4), and `useUpdateStatus.ts`'s local state (Task 7 Step 5). Each is a case where guessing a signature would be worse than a one-line read. Return types in `system.ts` must likewise be confirmed against `src/renderer/env.d.ts`.

**Known risk.** Task 3's mechanical and behavior commits are hard to separate cleanly, because the invalidation lives in `db.ts` from the moment it is written. Step 12 says to prefer splitting with `git rebase -i`; if that proves awkward, note the combination in the PR body rather than silently shipping a mixed commit.
