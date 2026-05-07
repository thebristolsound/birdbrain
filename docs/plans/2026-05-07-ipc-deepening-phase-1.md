# IPC deepening — Phase 1 (targeted orchestration extraction)

**Status:** proposed
**Scope:** `src/main/ipcHandlers.ts`, `src/main/services/captureServer.ts`, two new modules (`selectorLifecycle`, `extraction/reprocess`), one new tiny module (`ipcWrap`), and a deepening of the existing `manifest.ts`.
**Out of scope:** the ~70 pass-through handlers (they are honest IPC bindings, not shallow modules); domain facade collapse (defer to Phase 2 re-evaluation); any `caseLifecycle` module — case delete stays a `db.deleteCase` pass-through per [ADR-0001](../adr/0001-case-delete-skips-manifest.md).

## Goals

1. Concentrate orchestration that today leaks into `ipcHandlers.ts` and `captureServer.ts` into named lifecycle modules.
2. **Unify** (not just deduplicate) the four selector-matching call sites onto one orchestration. Today they diverge in three ways — sync vs async, capped vs uncapped, FTS-fallback vs txt-only. The lifecycle picks one canonical strategy and applies it everywhere.
3. Reduce `ipcHandlers.ts` noise via a typed `handle()` wrapper that auto-applies `ipcResult` / `ipcError`.
4. Keep Electron-shell concerns (`dialog`, `shell`, `app.getPath`) in handlers; new lifecycle modules take primitives only.

## Locked design decisions (from grilling)

- **Selector update re-matches.** Today `db.updateSelector` rewrites pattern/`isRegex` but never touches `selector_matches` — silent staleness. The lifecycle's `updateSelector` clears stale matches when the pattern or `isRegex` flag changes, then schedules an async re-match. Other field changes (label, enabled) skip re-matching.
- **All selector matching is async (`setImmediate` chunked).** Unifies onto the Capture Server's existing strategy (cap 500 captures, chunk 50, FTS fallback for MHTML captures with no `.txt`). IPC `SELECTORS_CREATE` and `SELECTORS_BULK_CREATE` change from sync to async — the renderer learns of completion via the new event below. The mutation resolves with the persisted Selector row immediately; matches drift in.
- **`selectors:rematched` IPC event.** New event channel `event:selector:rematched` with payload `{ selectorId, caseId, status: 'done' | 'error' }`. Renderer wires this into React Query: invalidate `selectorMatchCounts`, `getCapturesMatchingSelectors`, `selectorCoverage` for that case on `done`. Streaming progress (`status: 'progress', processed, total`) is left as a non-breaking future addition.
- **Foreground match preview is renderer-local, out of scope for Phase 1.** Per CONTEXT.md, "does this pattern hit the open Capture right now" runs in the renderer against the in-memory text. Not persisted. Not in the lifecycle module. Tracked as Phase-2-or-later renderer work.

## Non-goals

- No changes to the renderer (preload, queries.ts, components).
- No changes to the wire format between extension and Capture Server.
- No new tests for behaviour that already passes — only tests that the extraction unlocks.

## Modules to add

### `src/main/services/selectorLifecycle.ts`

Owns Selector Lifecycle (per CONTEXT.md). The single orchestrator for all selector matching. Used by IPC handlers, the Capture Server's POST `/api/selectors`, and the post-ingest hook in `schedulePostCaptureWork`.

Public surface:

- `createSelector(params: CreateSelectorParams): Selector` — DB insert (sync), then schedule retroactive match. Returns the row immediately.
- `bulkCreateSelectors(params: BulkCreateSelectorsParams): Selector[]` — DB inserts (sync), then schedule one shared retroactive pass that matches all new selectors against the case's texts in a single chunked walk.
- `updateSelector(params: UpdateSelectorParams): Selector | undefined` — DB update (sync). If `pattern` or `isRegex` changed, clear `selector_matches` for that selector and schedule a retroactive re-match. Other field changes (label, enabled) skip the re-match.
- `runActiveSelectorsForCapture(captureId, caseId, textContent): void` — called by the post-ingest hook in `captureServer.schedulePostCaptureWork`. Synchronous (already inside that function's `setImmediate`); applies the case's active selectors to one capture's text via the shared matcher. Replaces the direct `db.matchSelectorsForCapture` call.

Internals (not exported):

- `loadCaptureTexts(caseId, captureIds): Array<{ captureId; text }>` — one place that knows the txt-file → FTS-fallback ordering. Used by retroactive paths.
- `scheduleRetroactiveMatch(selectors: Selector[], caseId): void` — the canonical chunked async loop (cap 500, chunk 50, `setImmediate` between chunks). Emits `selectors:rematched` per selector on completion.
- `matchEngine(textContent, selector): boolean` — wraps the regex/substring decision and `safeRegexTest`. Both `db.matchSelectorsForCapture` and `db.matchSelectorAgainstCaptures` reduce to row-insert helpers; the matching decision lives here.

Imports: `@main/services/database`, `@main/services/storage`, `@main/services/safeRegex`. **No Electron, no Hono.** The module exports a factory `createSelectorLifecycle({ emitRematched })`; the main entry point owns the Electron-side emitter implementation. Tests pass a recording fake.

The DB module's `matchSelectorsForCapture` and `matchSelectorAgainstCaptures` become **internal SQL helpers** consumed only by this module. Their public exports stay (other callers still reference them at first); migration step 3 removes the last external caller, and a follow-up step makes them non-exported.

### Deepen `src/main/services/manifest.ts` (no new module)

The deletion test failed for a hypothetical `captureLifecycle.ts` — one caller (`CAPTURES_DELETE`) is a hypothetical seam, not a real one. The genuinely non-trivial part is the **rollback invariant**: a manifest deletion entry must be either fully committed (paired with a successful DB row delete) or fully reverted. That invariant deserves a seam; the DB and storage cleanup do not.

Add to existing `manifest.ts`:

- `withDeletionEntry(caseDir, ctx, fn): T` — callback-based. Appends a deletion entry, calls `fn()`; if `fn` throws, rolls the manifest back to its prior anchor and rethrows. If `fn` returns, the entry is committed. `ctx` carries `{ captureId, caseId, contentHash, operatorId, operatorName, toolVersion }`.

The `CAPTURES_DELETE` handler keeps its current shape but the manifest dance collapses to one call:

```
withDeletionEntry(caseDir, ctx, () => {
  const deleted = db.deleteCapture(id)
  if (!deleted) throw new ManifestRollback() // rollback path
  storage.deleteCaptureFiles(capture.caseId, id)
})
```

DB delete and storage cleanup stay in the handler — they're trivial and have one caller. The forensic invariant lives in `manifest.ts` where it belongs and gains a unit-testable surface.

(Ingest-side capture lifecycle — currently inside `captureServer.ts` POST `/api/captures` — is **not** in Phase 1. It's candidate #2 from the architecture review.)

### `src/main/services/extraction/reprocess.ts`

Slots into the existing `extraction/` directory alongside `extractionSource.ts`, `iocAdapter.ts`, `sanitizer.ts`, `validators.ts`.

- `reprocessCase(caseId: string): Promise<{ processed: number }>` — owns the async loop, `setImmediate` yield, delete-then-extract, error logging.

Imports: `@main/services/database`, `@main/services/dataExtractor`, `@main/services/extraction/extractionSource`.

### `src/main/ipcWrap.ts`

Typed wrapper. Replaces ~50 try/catch blocks in `ipcHandlers.ts`.

- `handle<T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>): void` — registers `ipcMain.handle`, wraps result in `ipcResult`, catches errors via `ipcError`. Preserves the existing rethrow-on-non-SQLite behaviour.
- Existing `ipcResult`/`ipcError` move into this file as the wrapper's internals.

## Migration steps

Each step is a separate commit; tests pass after each.

1. **[done]** **Add `selectorLifecycle.ts`** with internal `loadCaptureText`, `scheduleRetroactiveMatch`. Public `createSelector`, `bulkCreateSelectors`. Add unit tests (DB + tmp storage dir, no Electron). Don't wire callers yet.
2. **Add the `selectors:rematched` IPC event channel.** Define in `src/shared/ipc.ts`. Add typed listener to preload. Wire React Query invalidation in `src/renderer/lib/queries.ts` (selector match-count and coverage queries for the affected `caseId`). No behavior change yet — handlers still call `db.*` directly.
3. **Wire IPC handlers to lifecycle.** `SELECTORS_CREATE` and `SELECTORS_BULK_CREATE` now call `selectorLifecycle.*`. Mutation contract changes: matches arrive async via the event added in step 2. Update existing IPC tests to assert the event fires; they pass before fully draining when the mutation resolves.
4. **Wire Capture Server to lifecycle.** POST `/api/selectors` now calls `selectorLifecycle.createSelector`. Replace the inline chunked retroactive loop with the lifecycle's. Existing capture-server tests should still pass (the cap/chunk/FTS-fallback behavior was already canonical).
5. **Add `selectorLifecycle.updateSelector`.** Wire `SELECTORS_UPDATE` handler to it. Add tests for the latent-bug-fix: pattern change clears stale matches and triggers async re-match; label-only change does not. This is the only behavior change beyond pure extraction.
6. **Add `runActiveSelectorsForCapture` to lifecycle.** Replace the `db.matchSelectorsForCapture` call inside `captureServer.schedulePostCaptureWork` with the lifecycle method. The matcher decision is now in one place.
7. **Add `manifest.withDeletionEntry`.** Refactor `CAPTURES_DELETE` to use it. Add unit tests for the rollback path (DB failure → manifest reverts to prior anchor). No new module.
8. **Add `extraction/reprocess.reprocessCase`.** Move the async loop out of `EXTRACTED_DATA_REPROCESS` handler.
9. **Add `ipcWrap.handle`.** Migrate handlers in batches by domain (cases, tags, notes, selectors, annotations, db-admin). Each batch a separate commit.
10. **Tighten DB matcher exports.** With no external callers, downgrade `db.matchSelectorsForCapture` and `db.matchSelectorAgainstCaptures` to non-exported internals (or move them into `selectorLifecycle.ts` as private helpers if they're SQL-only).

## Test additions unlocked

- `selectorLifecycle.createSelector` — first time the "match against texts" loop has unit tests (today only reachable via IPC).
- `selectorLifecycle.bulkCreateSelectors` — verify single-pass-over-texts (no N×M re-reads).
- `selectorLifecycle.updateSelector` — pattern change clears stale matches and re-runs; label-only change is a no-op match-wise. Latent-bug regression coverage.
- `selectorLifecycle.runActiveSelectorsForCapture` — verify FTS fallback when txt is missing.
- `selectors:rematched` event — fires once per affected selector after async work completes; carries `{ selectorId, caseId, status }`.
- `manifest.withDeletionEntry` — verify manifest rollback when the wrapped callback throws (today only reachable via IPC, hard to set up).
- `extraction/reprocess.reprocessCase` — verify yield-to-event-loop and per-capture error swallowing.

## Risks

- **IPC contract change for selector creation.** `SELECTORS_CREATE` resolves before matches exist. Any renderer code that immediately reads match counts after `create` will see zero until the event fires. Audit all call sites of `useSelectorsMutations.create()` in step 2 to confirm React Query invalidation via the event closes the gap.
- **Event emission via injected dependency.** `selectorLifecycle` exports a factory `createSelectorLifecycle({ emitRematched })`. The main entry point (`src/main/index.ts`) instantiates the singleton with a real emitter that calls `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(...))`. Tests instantiate with a recording fake. The lifecycle module has zero Electron imports; only `runActiveSelectorsForCapture` runs sync (no emission needed) — emission fires only from `scheduleRetroactiveMatch` on per-selector completion.
- **`ipcWrap.handle` typing** — handlers today receive untyped `(_, params)` tuples; the wrapper needs to preserve typing without making registration painful. Prototype in step 9 batch 1 before doing the rest.
- **`captureServer.ts` integration** — the server today imports from `database.ts`/`storage.ts` directly. Switching to `selectorLifecycle.ts` is fine but worth a careful diff against the existing dedup-and-match flow.
- **Manifest rollback semantics** — extracted carefully; keep the existing test (if any) and add one for the rollback case before refactoring.

## Phase 2 trigger

After Phase 1 lands, re-read `ipcHandlers.ts`. If it still feels noisy, candidates: capture-ingest extraction (review item #2), selector handler consolidation (review item #4 — likely already absorbed by `selectorLifecycle`). Domain-facade collapse (review item, "sweeping" option) only if multiple callers outside IPC also need the orchestration.
