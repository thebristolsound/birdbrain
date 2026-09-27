# Imported capture paths: plan

Finding 1 of #1592, which widens #1521. Investigated at `origin/main` 78528514.

## What is wrong

`importCaseArchive` writes each capture's files to `<newCaseId>/<mappedId>.<ext>`
(`src/main/services/caseArchive.ts:568`), but `importCaptureRows` copies the source row's
`mhtml_path`, `html_path` and `screenshot_path` unchanged (`src/main/services/db/captureRepo.ts:492`).
The row keeps naming the source case and the source capture id.

Exhibit and staging rows already avoid this. `importExhibitRows` and `importStagingFileRows` pass
their `path` through `rerootPath` (`src/main/services/db/exhibitRepo.ts:297`). Captures were never
given the same treatment.

These readers use the stale column:

| Reader | Effect |
|---|---|
| `CAPTURES_GET_MHTML_URL`, `src/main/ipcHandlers.ts:878` | Page tab loads forever (1a) |
| `verifyCapture`, `src/main/services/captureLifecycle.ts:406` | Re-verify says `missing` (1b), or on the same install hashes the source case's file and passes |
| `backfillExhibitsForCaptures`, `exhibitRepo.ts:221` | A pre-schema-6 archive (the demo case) gets Exhibit rows with the stale path (#1521) |
| missing-file scan, `src/main/services/db/dbAdmin.ts:497` | Reports the capture's files as missing |
| `exhibitPackageDirectory`, `src/main/services/export.ts:599` | Reads the column to pick the derived-files directory |

Export reads page bytes by `caseId` and `id` (`export.ts:1250`), and the legacy HTML handler does
the same (`ipcHandlers.ts:886`), so both already ignore the column.

The demo case arrives through the same `importCaseArchive` (`src/main/services/demoCase.ts:126`).
A fix at import corrects new seeds, but not profiles that already have the demo case.

## Steps

1. **Re-root on import.** In `importCaptureRows`, pass `mhtml_path`, `html_path` and
   `screenshot_path` through `rerootPath(path, ctx.newCaseId, oldId, newId)`, the way the sibling
   importers do. `backfillExhibitsForCaptures` runs afterwards and reads the corrected row, so the
   demo case's Exhibit paths come out right without further changes. Also check whether
   `notes.screenshot_path` copies a path the same way (`noteRepo.ts:285`).
2. **Repair existing rows.** Scaffold a migration with `pnpm db:migration:new
   reroot-imported-capture-paths`. For every capture whose path column does not begin with its
   own `case_id`, rewrite the column to `case_id || '/' || id || '.<ext>'`. Then set
   `exhibits.path` for `kind = 'capture'` rows from the repaired capture row, but only where that
   Exhibit path also fails to begin with its `case_id`. Native rows, including Windows rows with
   `\` separators, begin with their `case_id` and are not touched.
3. **Tests.**
   - `caseArchiveRoundTrip.test.ts`: export a case, then re-import it on the same install so ids
     are remapped. Assert that `mhtmlPath` begins with the new case and the new id, and that
     `verifyCapture` hashes the new case's file. Then delete the source case and assert that
     verify still returns `verified`.
   - `demoCase.test.ts`: after seeding, every capture and Exhibit path resolves to a file on disk.
   - Migration test: a stale row is rewritten, and a native row with either separator is left
     alone.

The files are `captureRepo.ts`, `migrations.ts`, `core.ts` and the three test files, possibly
plus `noteRepo.ts`.

## Out of scope

These findings stay on #1592 as separate work:

- 1a: the Page tab's missing-file branch. Once step 1 lands, the demo case no longer triggers
  it, but a genuinely missing file still would.
- 2: the Overview's "Tampered" label.
- 3a and 3b: the export checker failures. 3b concerns the chain naming the original id and
  overlaps #1472.
- `rerootPath` splits on `/` only. A Windows-exported archive would carry `\` paths. This is an
  existing limit that the exhibit and staging importers share.

## Open decisions for the maintainer

1. **How to repair existing installs.** Option (a), the recommendation, is the migration in step
   2: one source of truth, and the column stays meaningful for the missing-file scan and in
   future archives. Option (b) is to make the viewer and verify derive the path from `caseId` and
   `id`, as export already does. That needs no migration and makes cross-case reads impossible
   by construction. It changes more readers and leaves the column stale in the database.
2. **Stale verification results.** Demo captures that someone already re-verified store
   `last_verified_status = 'missing'`. Either the migration clears it to unverified on the rows
   it rewrites (recommended, because our bug produced the result), or it stays until the next
   re-verify.

## Gate

Approval is required under ADR-0016. The change touches `src/main/services/db/**`, which is
blocking tier, and it adds a schema migration. The PR is `evidence-affecting` and needs human
review.
