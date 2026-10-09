# Recoverable capture delete

**Status:** proposed 2026-10-09, waiting for maintainer approval
**Date:** 2026-10-09
**Issue:** #1786

## Problem

`deleteOne` in `src/main/services/captureLifecycle.ts` removes a capture's files with
`store.deleteArtifacts`, which calls `unlinkSync` once per artifact, `mhtml` first. When a later
unlink throws, the files already removed stay removed, the manifest seam truncates the deletion
entry, and the outcome reads `rolled_back`. The capture row stays live with its original MHTML
gone, and the Unreconciled deletions scan has no entry to report. Issue #1786 holds the
reproduction.

The cause is that an unlink cannot be undone. The fix makes file removal reversible until the
row delete commits.

## Approach: stage, commit, purge

Inside the existing `withDeletionEntry` callback, replace the single unlink pass with three steps.

1. **Stage.** Rename each artifact that exists, and the thumbnail, into
   `<caseDir>/.pending-delete/<captureId>/`, keeping each file name. A rename inside one case
   directory stays on one filesystem, so each move is atomic. If a rename throws, rename the
   files already moved back to their original paths, then throw the original error. The row, the files, and the
   manifest are then all as they were before, which is what `rolled_back` claims.
2. **Commit.** Delete the row. If that fails, restore the staged files the same way and let the
   seam roll the entry back.
3. **Purge.** Remove the staging directory with `rmSync(..., { recursive: true, force: true })`.
   A purge failure is logged and does not change the outcome: the row is gone, the entry is
   committed, and the leftover files are swept later (see Recovery).

If restoring a staged file fails, the outcome cannot honestly be `rolled_back`, because a file is
not at its original path. `deleteOne` throws, the same way it already throws when the manifest
rollback itself fails. The file is still on disk in the staging directory, and recovery restores
it.

The legacy `html` branch, which writes no manifest entry, uses the same stage, commit, and purge
steps.

## Recovery

A crash can stop the process between any two steps. A new `recoverPendingDeletes(caseId)` in
`captureLifecycle.ts` runs once per case before the first delete in that case, and once at
startup over every case:

| State found | Meaning | Action |
|---|---|---|
| Staging directory present, capture row live | Crash after stage, before commit | Rename the files back. A trailing deletion entry, if present, is the existing #622 finding and the existing re-delete remedy applies. |
| Staging directory present, row gone | Crash after commit, before purge | Purge the directory. |

Recovery never deletes a file whose capture row is live.

## Why this staging location

- `readChainFileSnapshots` in `manifest.ts` reads only names that `parseChainPath` accepts, so a
  subdirectory is ignored.
- The orphan scan in `src/main/services/db/dbAdmin.ts` skips every directory outside
  `CASE_SUBDIRECTORIES`, so it neither reports nor deletes staged files. The directory is
  deliberately left out of the Package Layout: it is transient bookkeeping, not part of a case.
- `getCaseStorageSize` counts staged files while they exist, which is accurate.
- Export and the case archive read artifacts by path per capture, so they do not see the
  directory.

## Out of scope

- The ingest and duplicate cleanup paths that also call `deleteArtifacts`
  (`captureLifecycle.ts` around lines 376 and 1135 to 1273) remove files of a capture that never
  committed. They keep the existing helper, which removes what it can.
- Crash durability of ingest and atomic export publication. The architecture review on
  2026-10-09 noted both. Neither reproduces as silent loss, so neither is filed.

## Steps

1. Add `stageArtifacts`, `restoreStaged` and `purgeStaged` to the capture store in
   `src/main/services/captureStore.ts`, with unit tests in
   `tests/main/services/captureStore.test.ts` for each, including a rename that fails partway.
2. Switch both branches of `deleteOne` to stage, commit, and purge, and correct the comment that
   claims an unlink failure leaves the files intact.
3. Add `recoverPendingDeletes` and call it before the first delete per case and at startup.
4. Add lifecycle tests in `tests/main/services/captureLifecycle.test.ts`. Each one fails the
   second artifact after the first has moved, for `delete` and `deleteMany`, and asserts that
   the row is live, all files are at their original paths, and the manifest has no deletion
   entry. Add one test for a failed row delete and one for each recovery state.
5. Run `pnpm preflight` and the evidence gate for the three blocking-tier files.

## Approval criteria tripped

This plan waits for approval under ADR-0016 because it touches blocking-tier evidence files
(`captureLifecycle.ts`, `captureStore.ts`, listed in
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`).
