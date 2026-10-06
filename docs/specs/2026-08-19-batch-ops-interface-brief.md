# Batch capture operations — interface brief

Date: 2026-08-19
Tracks: [#394](https://github.com/thebristolsound/birdbrain/issues/394) (spec
[#382](https://github.com/thebristolsound/birdbrain/issues/382), stage 4). Consumer:
[#396](https://github.com/thebristolsound/birdbrain/issues/396) (multiselect + floating action bar).

Produced by a design-it-twice pass (four independent interface designs: surface-minimal, generic
batch engine, manifest savepoint primitive, renderer-first) followed by a grilling session with
the maintainer on 2026-08-19. Three of the four designs converged on the shape below; the physics
of the manifest force it. This document is the contract #394 implements. It is an interface
brief, not an implementation plan.

## Decisions

| #   | Decision                                   | Chosen                                                                                                   |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Stale / cross-case ids in a delete batch   | `not_found` tolerated as a `rejected` outcome; any `wrong_case` id fails the whole call before any write |
| 2   | Tag / favorite batch failure mode          | One DB transaction, all-or-nothing, result `{ affected }`; same stale/cross-case rule as 1               |
| 3   | Rolled-back entry detail                   | `stage: 'artifacts' \| 'db'` on `rolled_back`                                                            |
| 4   | `reason` on batch delete                   | Not exposed now                                                                                          |
| 5   | Proof field on the delete result           | `manifest: { baseIndex, committedEntries }` included                                                     |
| 6   | Legacy `html` captures (no manifest entry) | Distinct status `deleted_unmanifested`                                                                   |
| 7   | Concurrent deletes on one case             | Per-case serialisation inside the lifecycle; `delete` and `deleteMany` share the chain                   |
| 8   | Crash artefact surfaced in Diagnostics     | Follow-up issue, not #394                                                                                |
| 9   | Where the contract lives                   | This file + comment on #394                                                                              |
| 10  | Renderer mutation hooks                    | In #394 (api layer, not UI)                                                                              |

Rejected shapes, for the record: a generic `captures:batch` op union with pluggable ops
(over-generalises the evidence path; cancel/progress not needed for 2–50 items), and a
`ManifestSavepoint` primitive in `manifest.ts` (depth is always 1; not worth refactoring reviewed
evidence code — the existing `withDeletionEntry` per capture already yields prefix-commit).

## Semantics that everything below encodes

The manifest is an append-only hash chain; rollback is truncation to a byte anchor. Files are
unlinked before the DB row is deleted, per capture. Once capture _k_'s files are gone its entry
cannot be rolled back honestly. Therefore a batch delete is **prefix-commit**: entries 1..k-1
committed, entry _k_ rolled back, k+1..N never attempted. The result type states exactly that.
The design has no batch-level entry, no batch atomicity claim, and no new Manifest Entry type.

## Shared types (`src/shared/ipc.ts`)

```ts
export interface CaptureBatchPayload {
  caseId: string      // same-case guard; every id must belong to this case
  captureIds: string[]
}

export type BatchDeleteOutcome =
  | { captureId: string; status: 'deleted' }               // deletion entry committed, files + row gone
  | { captureId: string; status: 'deleted_unmanifested' }  // legacy html capture: files + row gone, no entry (as delete() today)
  | { captureId: string; status: 'rolled_back'; stage: 'artifacts' | 'db'; error: string }
      // entry appended then truncated. artifacts: unlink threw, files + row intact.
      // db: files gone, row delete failed, row remains (retry proceeds through the same path).
  | { captureId: string; status: 'not_attempted' }         // after the first rolled_back; untouched
  | { captureId: string; status: 'rejected'; reason: 'not_found' | 'duplicate' }
      // failed snapshot validation; nothing written for it. wrong_case is not an outcome — see below.

export interface BatchDeleteResult {
  outcomes: BatchDeleteOutcome[]   // exactly one per requested id, input order
  deletedIds: string[]             // deleted ∪ deleted_unmanifested
  failedIds: string[]              // rolled_back ∪ not_attempted — the retry payload; rejected ids excluded
  haltedAt?: string                // captureId of the rolled_back entry; absent when none
  manifest: {
    baseIndex: number              // chain length before the batch
    committedEntries: number       // === count(status === 'deleted'); what is proven (ADR-0004)
  }
}

export interface BatchCountResult { affected: number }

// Channels
CAPTURES_DELETE_MANY:        'captures:deleteMany'
CAPTURES_SET_FAVORITE_MANY:  'captures:setFavoriteMany'
TAGS_ADD_TO_CAPTURES:        'tags:addToCaptures'
RECAPTURE_ENQUEUE_CAPTURES:  'recapture:enqueueCaptures'

// IpcChannelMap
'captures:deleteMany':       { args: [p: CaptureBatchPayload]; result: BatchDeleteResult }
'captures:setFavoriteMany':  { args: [p: CaptureBatchPayload & { favorite: boolean }]; result: BatchCountResult }
'tags:addToCaptures':        { args: [p: CaptureBatchPayload & { tagId: string }]; result: BatchCountResult }
'recapture:enqueueCaptures': { args: [p: CaptureBatchPayload]; result: EnqueueResult }   // existing type
```

**Throws (as `IpcFailure`, nothing written):** any id whose row exists in a different case
(`BATCH_CROSS_CASE`, with the offending ids); malformed payload; pre-loop faults (manifest
unreadable, DB down). Per-capture failures never throw — they are outcomes.

## Main process

```ts
// src/main/services/captureLifecycle.ts
export interface CaptureLifecycle {
  // ingest, delete, verify, reprocessCase — unchanged
  deleteMany: (caseId: string, captureIds: string[]) => Promise<BatchDeleteResult>
}
// CaptureLifecycleDeps unchanged: `store` is already injectable, which is the crash-test seam.
```

`deleteMany`:

1. Dedupe (later duplicates → `rejected{duplicate}`); load the snapshot in one query
   (`captureRepo.getCapturesByIds`); missing → `rejected{not_found}`; any row with
   `caseId !== p.caseId` → throw `BATCH_CROSS_CASE` before any write.
2. Take the per-case serialisation slot (in-memory `Map<caseId, Promise<void>>` in
   `createCaptureLifecycle`; `delete` takes the same slot). Callers wait; no busy error.
3. Record `baseIndex` from the manifest head.
4. For each snapshot capture in order: the existing `delete()` body — hoisted to a private
   `deleteOne(capture)` that both `delete` and `deleteMany` call — under the existing
   `withDeletionEntry(caseDir, ctx, () => { store.deleteArtifacts(); captureRepo.deleteCapture() })`.
   `stage` is derived from which call threw. Legacy `html` → `deleted_unmanifested`.
5. First `rolled_back` stops the loop; the rest are stamped `not_attempted` with no I/O.
6. Return; `committedEntries` is the count of `deleted`, and the crash test asserts it against
   `verifyManifestChain(caseDir)` and the on-disk chain length.

```ts
// src/main/services/db/captureRepo.ts
export function getCapturesByIds(ids: string[]): Capture[] // one query
export function setFavoriteMany(captureIds: string[], favorite: boolean): number // idempotent SET, one txn
// src/main/services/db/tagRepo.ts
export function addTagToCaptures(captureIds: string[], tagId: string): number // INSERT OR IGNORE, one txn
```

Metadata handlers (`ipcHandlers.ts`): validate same-case with `getCapturesByIds` (wrong_case →
throw; not_found → dropped, `affected` tells the truth), then `withTransaction(() => repo.fn(...))`.
No manifest, no lifecycle involvement — worth stating so nobody adds one.

Recapture handler: `getCapturesByIds` → filter to `p.caseId` → map to
`RecaptureJob { url, caseId, supersedesCaptureId: capture.id }` → existing
`recaptureService.enqueue(jobs)`. No new service surface; the queue, its events, and provenance are
reused as-is.

## Renderer (`src/renderer/lib/api/`)

Hooks ship in #394; #396 builds the action bar against them.

```ts
// captures.ts — extend useCapturesMutations(caseId)
removeMany: useMutation<BatchDeleteResult, unknown, string[]> // invalidate captures(caseId), captureCounts, captureFavorites(caseId) when deletedIds.length > 0
setFavoriteMany: useMutation<BatchCountResult, unknown, { captureIds; favorite }>
// tags.ts
addToCaptures: useMutation<BatchCountResult, unknown, { captureIds; tagId }> // invalidate tagsForCapture(id) per id + tag counts
// recapture.ts
enqueueCaptures: useMutation<EnqueueResult, unknown, string[]> // invalidate recaptureQueue
```

Action-bar contract: `Deleted ${deletedIds.length} of ${captureIds.length}`; when
`failedIds.length > 0`, offer retry as `removeMany.mutate(failedIds)`. `rejected` ids are shown, not
retried.

## Testing at the service seam

- Inject a `CaptureStore` whose `deleteArtifacts` throws on the k-th id → assert `outcomes`
  (`deleted` ×k-1, `rolled_back{stage:'artifacts'}`, `not_attempted` ×rest), `committedEntries === k-1`,
  `verifyManifestChain` valid, rows k..N present, files k..N present.
- Spy `captureRepo.deleteCapture` returning false on k → same, with `stage:'db'` and row k present,
  files k gone.
- Cross-case id anywhere → throws, chain length unchanged, no rows touched.
- Two overlapping `deleteMany` on one case → serialised; chain valid; each id appears in exactly
  one result as `deleted`, the other as `rejected{not_found}`.
- Crash mid-item (append landed, `fn` never ran): the on-disk artefact is a valid trailing
  `deletion` entry with a live row. #394 asserts that state; surfacing it is the follow-up below.

## What is proven (ADR-0004)

"Entries `baseIndex .. baseIndex + committedEntries - 1` are ordinary deletion entries, one per
capture in `deletedIds` (minus `deleted_unmanifested`), each with files and row gone. Entry
`haltedAt`, if any, is not in the chain. `not_attempted` ids were never touched." Nothing claims
the batch was atomic; the manifest holds the claim, not the data, so no automatic repair is
possible or attempted.

## Follow-ups filed

- Diagnostics / verify finding for the crash artefact (`unreconciled-deletion`: trailing valid
  deletion entry whose capture row is still live). Filed as #622.
