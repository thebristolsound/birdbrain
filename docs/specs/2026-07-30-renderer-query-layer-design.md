# Renderer Query Layer — route all data access through `lib/api`

**Issue:** [#229](https://github.com/thebristolsound/birdbrain/issues/229)
**Status:** design approved 2026-07-30
**Supersedes:** `docs/plans/2026-07-11-renderer-bridge-seam.md` (untracked working notes)

## Problem

The renderer has two competing data-access idioms. The query layer — `queryOptions`
factories plus mutation hooks that own cache invalidation — is the nominal
convention, but **77 call sites across 37 files** reach for `window.birdbrain`
directly. Raw reads bypass the cache; raw writes skip invalidation; and anyone
adding a feature has a coin-flip precedent for which pattern to copy.

Three concrete consequences visible today:

- `useSettingsMutations().update` writes the response through to the settings
  cache, but five call sites bypass it entirely — so the cache goes stale on
  every theme toggle, motion toggle, onboarding completion, and case switch.
- `useSessionMutations().activateCase` has the same write-through, and
  `CaseWorkspace.tsx:28` bypasses it the same way.
- Destructive DB admin operations (`restore`, `purgeArchived`, `cleanOrphans`)
  invalidate nothing, because they never went through a mutation hook.

## Goal

`window.birdbrain` appears nowhere outside `src/renderer/lib/api/`, enforced by
ESLint. Components and feature hooks consume typed wrappers.

## Architecture

`queries.ts` is 595 lines — already the largest file in `lib/` — and absorbing
the 77 bypassed sites would push it past 900. It splits into per-domain modules
under `lib/api/`, mirroring the IPC domain map. The barrel is deleted in the
final PR so there is exactly one obvious import path per domain.

```
src/renderer/lib/api/
  keys.ts          queryKeys factory (moved verbatim from queries.ts:19-60)

  cases.ts  captures.ts  tags.ts  selectors.ts  notes.ts       ← moved out of
  extractedData.ts  annotations.ts  archive.ts  settings.ts       queries.ts
  session.ts

  db.ts  ai.ts  export.ts  recapture.ts  updates.ts            ← new; these
  diagnostics.ts  system.ts  events.ts                            domains are
                                                                  bypassed today
```

- `system.ts` — one-shot commands with no cache identity: `openCaptureExternal`,
  `downloadCapture`, `downloadPdf`, `downloadScreenshot`, `revealInFolder`,
  `openPath`, `openExtensionFolder`, `chooseStoragePath`.
- `diagnostics.ts` — `diagnosticsQueryOptions` for `DiagnosticsPanel.tsx:94`.
  (`DiagnosticsPanel.tsx:224` is a `shell.openPath` call and belongs to
  `system.ts`.)
- `events.ts` — owns **all nine** `onX` subscriptions. See below: they split into
  two shapes, and only one of them carries the invalidation table.

### Two kinds of subscription

The nine `onX` channels are not interchangeable, and the seam must expose both
shapes or the component-local sites cannot migrate:

**Global invalidation subscriptions** — app-level, fire-and-forget, drive cache
invalidation and routing. `onExtensionConnection`, `onSessionStateChanged`,
`onCaptureActivity`, `onNewCapture`, `onSelectorRematched`,
`onDeepLinkNavigate` (all in `useServerStatus.ts`) and `onUpdateStatus` (in
`useUpdateStatus.ts`). These move verbatim into a single
`subscribeToMainEvents()` that owns the event→invalidation table.

**Component-local progress subscriptions** — parameterized, filter by `caseId`,
and write to a component's own `useState`. `onArchiveProgress`
(`ImportCaseDialog.tsx:30`, `ExportMenu.tsx:48`) and `onExportProgress`
(`ExportDialog.tsx:51`). These must **not** be folded into
`subscribeToMainEvents()` — they are per-instance and have no cache identity.
`events.ts` instead exports thin typed wrappers —
`subscribeToArchiveProgress(handler)`, `subscribeToExportProgress(handler)` —
that each component calls from its own `useEffect`, returning the unsubscribe
unchanged.

Preserve `ImportCaseDialog`'s always-on subscription invariant (documented in a
comment at the call site): the subscription must be established on mount, not
gated on the import starting, or a progress event fired immediately after
`mutateAsync` is missed.

### Wrapper shape by texture

Three shapes, chosen by what the call site renders. Not everything becomes a
query — the rule is about *where* bridge access lives, not about forcing
one-shot commands into a cache.

| Texture | Shape | Example |
| --- | --- | --- |
| Cacheable read | `queryOptions` factory | `dbStatsQueryOptions` |
| Write with rendered pending/error state | `useMutation` hook **plus** an exported mutation-options factory taking a `QueryClient` | `useDbAdminMutations()` |
| Fire-and-forget command | plain typed async function, 1:1 with the bridge | `revealInFolder(path)` |

The options-factory split exists so invalidation behavior is testable without
mounting React. The hook becomes a one-liner over the factory.

### Hard constraint: lazy bridge access

Every wrapper must read `window.birdbrain` **inside the function body**:

```typescript
// correct — resolves at call time
export const dbStatsQueryOptions = queryOptions({
  queryKey: queryKeys.dbStats,
  queryFn: () => window.birdbrain.db.stats()
})

// WRONG — binds the real bridge at module load, before any test installs a stub
const { db } = window.birdbrain
```

Module-scope destructuring would break every bridge-stubbing test in the suite.
This is a correctness requirement, not a style preference.

## Behavior changes

Migration commits are **pure moves**. Behavior changes land as their own commits
so a reviewer can tell which diff is mechanical and either can be reverted alone.

Fixed for free by the move — no new logic, just routing through already-correct
existing mutations:

- Settings cache staleness: `useTheme.ts:33`, `AppearanceConfig.tsx:28`,
  `OnboardingWizard.tsx:41`, `CaseWorkspace.tsx:32,60` → `useSettingsMutations().update`.
- Session cache staleness: `CaseWorkspace.tsx:28` → `useSessionMutations().activateCase`.

Genuinely new logic, separate commits:

- **DB invalidation.** `restore` / `purgeArchived` / `cleanOrphans` invalidate all
  queries (`queryClient.invalidateQueries()`); `vacuum` / `backup` / `exportTable`
  invalidate `dbStats`; `createRow` / `updateRow` / `deleteRow` invalidate
  `dbStats` + `dbTableRows`.
- **AnalysisTab restructure.** Nine hand-rolled loading/error flags collapse into
  the analyze/save mutations; raw query-key literals move to `keys.ts`; uuid and
  `createdAt` minting moves into the `mutationFn`.

Explicitly **mechanical only** — `CreateSelectorCard.tsx:79,85` and
`SelectorTableRow.tsx:48,49,55` preview orchestration gets a
`queryClient.fetchQuery` wrap and nothing more. Restructuring that loop is a
separate candidate (Foreground Match Preview) and is out of scope here.

## Testing

`tests/renderer/fakeBridge.ts` installs a typed stub on `globalThis.window` whose
Proxy **throws on unstubbed methods**, so a test that forgets a stub fails loudly
instead of hitting `undefined`. All eight tests that currently hand-roll a partial
bridge object retrofit to it, in a test-only commit with no `src/` changes:

`CapturesGettingStarted`, `CaseSubhead`, `ExportDialog`, `ImportCaseDialog`,
`OnboardingWizardOverlay`, `useCaptureTagEditor`, `useVerifyMutation`, `WaybackTab`.

Throw-on-unstubbed will surface latent gaps in those partial stubs; closing them
is part of the retrofit commit.

New behavior tests target the options factories directly, no mount required:

- `db.restore` invalidation blast radius (`invalidateQueries()` with no filter).
- Settings and session write-through: `mutationFn` result lands in the cache.
- The events invalidation table — `onSelectorRematched` hits the three selector
  key families; `onNewCapture` prepends to the captures list and invalidates
  `captureCounts`.

Infrastructure is already in place: `@testing-library/react` 16.3.2, `jsdom`, and
a `jsdom` vitest project matching `tests/renderer/**/*.test.ts`.

## PR series

Six PRs. Each is independently shippable and single-purpose.

1. **Scaffold.** Split `queries.ts` into per-domain modules, extract `keys.ts`,
   leave `queries.ts` as a re-export barrel. Pure move; the existing suite is the
   oracle.
2. **Test util.** `fakeBridge.ts` + retrofit the eight tests. Test-only, zero
   `src/` changes.
3. **`db` domain.** 13 sites in `DbStats` / `DbTables` / `DbUtilities` — the
   biggest cluster. Mechanical commit, then the invalidation commit.
4. **Remaining domains.** `settings`, `system`, `ai`, `export`, `recapture`,
   `selectors`, `diagnostics` + all remaining call sites. Mechanical commits,
   then the AnalysisTab commit.
5. **`events.ts`.** Both subscription shapes. `subscribeToMainEvents()` takes the
   seven global invalidation subscriptions verbatim; `useServerStatus` and
   `useUpdateStatus` shrink to mount-only hooks. The two progress wrappers land
   here too, and `ImportCaseDialog`, `ExportMenu`, and `ExportDialog` switch to
   them. Preserve the existing comments — they carry invariants
   (partial-rematch invalidation, navigate-only-if-not-on-case, and
   `ImportCaseDialog`'s always-on subscription).
6. **Enforcement.** ESLint `no-restricted-syntax` for `src/renderer/**`, ignoring
   `src/renderer/lib/api/**`. Rewrite imports to domain modules and delete the
   barrel.

   Three selectors, not one — dot access alone leaves two holes open:

   ```javascript
   // window.birdbrain / globalThis.window.birdbrain / w.birdbrain
   "MemberExpression[property.name='birdbrain']",
   // window['birdbrain'] — bracket access has property.value, not property.name
   "MemberExpression[property.value='birdbrain']",
   // const { birdbrain } = window
   "ObjectPattern > Property[key.name='birdbrain']"
   ```

   Matching on `property` alone rather than `object.name='window'` is deliberate:
   it catches aliased objects too, and `birdbrain` is not used as a property name
   anywhere else in the repo, so false positives aren't a concern.

The lint rule lands last deliberately: it cannot pass until the final straggler
is wrapped. Any hit during PR 6 gets wrapped, never disabled.

Note the destructuring selector overlaps the lazy-access constraint but does not
subsume it: that constraint forbids *module-scope* capture for testability, while
this selector forbids destructuring at any scope.

## Bypass inventory

Re-grep before each PR — line numbers drift. This is a **heuristic for tracking
progress, not a completeness check**; see the limits below.

```bash
grep -rnE "window\.birdbrain|window\[['\"]birdbrain['\"]\]|\{[^}]*\bbirdbrain\b[^}]*\}[[:space:]]*=" \
  src/renderer --include='*.ts' --include='*.tsx' | grep -vE "^src/renderer/lib/(api/|queries\.ts)"
```

Note the exclusion filter is **anchored to the path** (`^src/renderer/lib/…`). An
unanchored `grep -v "lib/api/"` matches on line *content*, so a real violation
with that string in a trailing comment is silently dropped:

```
const s = window.birdbrain.db.stats() // TODO move to lib/api/db.ts
```

Known limits of the line-oriented check: it cannot see a destructuring that spans
lines, and it matches text rather than syntax, so a `birdbrain` mention inside a
string or comment counts as a hit. Multiline *member* access is fine — the
`window.birdbrain` fragment still lands on one line, which is how
`ExportDialog.tsx:37` and `CaseWorkspace.tsx:28` are caught today.

As of 2026-07-30 only dot access exists — bracket access, destructuring, and
aliased objects all return zero — so the count is trustworthy right now.

**`pnpm lint` is the authoritative check once PR 6 lands**, because it shares the
selectors and works on the AST. Until then no such rule exists to reuse, which is
why the interim check is a grep rather than a bespoke AST script: the blind spots
above are bounded (they require a *new* violation written in a form nothing in the
tree currently uses), and PR 6 closes them permanently.

77 sites across 37 files. Grouped below by **bridge namespace**, with the
destination module marked — the two axes differ, because `system.ts`
deliberately cuts across namespaces to collect one-shot commands. Migrate to the
destination, not to the namesake module.

- **db** → `db.ts`: `DbStats.tsx:22`; `DbTables.tsx:47,81,97,108`;
  `DbUtilities.tsx:54,72,92,110,134,153,175,197`
- **settings** → `settings.ts`: `AnalysisTab.tsx:36`, `useSessionRestore.ts:72`
  (get); `CaseWorkspace.tsx:32,60`, `OnboardingWizard.tsx:41`, `useTheme.ts:33`,
  `AppearanceConfig.tsx:28` (update); `AIConfig.tsx:28` (testOpenRouter).
  **→ `system.ts`:** `StorageConfig.tsx:14` (chooseStoragePath — a dialog
  command, not a settings write)
- **captures one-shots** → `system.ts`: openExternal — `AnalysisTab.tsx:323`,
  `WaybackTab.tsx:26`, `DataExplorer.tsx:62`, `NoteCard.tsx:111`,
  `AIConfig.tsx:141`, `captures.tsx:87`; download —
  `CaptureDownloadMenu.tsx:57,102,123`.
  **→ `captures.ts`:** verify — `useVerifyMutation.ts:10`,
  `ProvenanceBadge.tsx:63`; thumbnail — `useCaptureThumbnail.ts:18`
- **shell / extension** → `system.ts` (all): `ExportComplete.tsx:27,36`,
  `ExportMenu.tsx:170`, `DiagnosticsPanel.tsx:224` (shell.openPath),
  `InstallExtensionStepper.tsx:35`, `CapturesGettingStarted.tsx:43`,
  `ExtensionBanner.tsx:12`
- **selectors** → `selectors.ts`: `CreateSelectorCard.tsx:54`,
  `SelectorTable.tsx:62,67`, `SelectorTableRow.tsx:48`,
  `SelectorsOverview.tsx:49`, `NewCaseWizard.tsx:73`, `useSelectorFilters.ts:15`.
  **→ `captures.ts`** (via `fetchQuery`, mechanical wrap only):
  `CreateSelectorCard.tsx:79,85`, `SelectorTableRow.tsx:49,55`
- **ai** → `ai.ts`: `AnalysisTab.tsx:47,80,112`
- **export** → `export.ts`: `ExportDialog.tsx:37,73`
- **updates** → `updates.ts`: `useUpdateStatus.ts:15,40,53,61`
- **events, global** → `events.ts` (`subscribeToMainEvents`):
  `useServerStatus.ts:10,14,30,34,41,50`; `useUpdateStatus.ts:25`
- **events, component-local progress** → `events.ts` (per-instance wrappers):
  `ImportCaseDialog.tsx:30`, `ExportMenu.tsx:48` (onArchiveProgress);
  `ExportDialog.tsx:51` (onExportProgress)
- **diagnostics** → `diagnostics.ts`: `DiagnosticsPanel.tsx:94`
- **session** → `session.ts` (existing `sessionQueryOptions` /
  `useSessionMutations`, moved from `queries.ts:81-112`): `CaseWorkspace.tsx:28`
- **strays:** `Dashboard.tsx:61` (cases.inspectArchive) → `cases.ts`;
  `CaptureHealth.tsx:76,85,98` (recapture.queueStatus, testPipeline, testHttp)
  → `recapture.ts`

## Corrections to the 2026-07-11 plan

- `ArchiveTab.tsx` is now `WaybackTab.tsx`.
- The duplicate `components/layout/export/ExportDialog.tsx` is gone; there is one
  `ExportDialog`.
- #257 (session HTTP→IPC) has merged, so `CaseWorkspace.tsx` and
  `useSessionRestore.ts` are **in** scope rather than deferred.
- The plan hedged on whether `@testing-library/react` was available. It is.
- The plan diagnosed a settings *write-through* bug and proposed a failing test
  asserting `update` populates the cache. That test would pass today —
  `queries.ts:557` already calls `setQueryData`. The real defect is the five
  bypassing call sites, so the test must instead assert that call sites go
  through the mutation.
- The plan's `fakeBridge` sketch has a bug it flagged itself: the Proxy `get`
  must *return* the stub function, not invoke it.
- The plan missed `CaptureDownloadMenu.tsx` (3 sites) and
  `DiagnosticsPanel.tsx` (2 sites) entirely.
- Six PRs rather than four, because the test retrofit is new scope and splitting
  it keeps each PR single-purpose.

## Decisions

| # | Decision |
| --- | --- |
| 1 | Hard rule: no `window.birdbrain` outside `lib/api/`, ESLint-enforced |
| 2 | Per-domain modules + a central `keys.ts`; barrel deleted at the end |
| 3 | Wrapper shape chosen by texture (query / mutation+factory / plain command) |
| 4 | All settings writes converge on `useSettingsMutations().update` |
| 5 | Events live behind the seam in one module |
| 6 | Lint enforcement lands with the final PR |
| 7 | Behavior fixes land as separate commits within the same PR, never mixed into a move |
| 8 | Retrofit all eight existing bridge-stubbing tests to the fake bridge |
| 9 | Wrappers read the bridge lazily inside the function body |

## Out of scope

- Optimistic updates and invalidation-strategy redesign.
- Cache-key redesign.
- Preload / IPC contract shape changes.
- The Foreground Match Preview deepening of the selector preview loop.

## Issue #229 needs updating

This design breaks two things the issue states: its "call sites move, behavior
stays" clause, and its nine-commit list organized by component directory. The
issue should be updated to point at this spec before implementation starts.
