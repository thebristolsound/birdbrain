# Database restore path: one module behind both restore buttons

Plan for maintainer review, 2026-10-02, at `main` 802ef13d, revised after an adversarial review the
same day. No code changes yet. Every file reference below was read at that commit; the scratch
probes ran under Electron as Node (`ELECTRON_RUN_AS_NODE=1`) against the repository's own `better-sqlite3`, on Linux only.

## Problem

**Restore from File** (`db:restore`) copies whatever file the operator picks straight over
`birdbrain.db`, with no check that the file is a database. Picking the wrong file can destroy the
Operator's case database. **Restore Snapshot** (`db:restoreSnapshot`) already guards against the
same outcome, but its guard lives in the handler and in `dbSnapshots.ts`, so the file restore never
received it. The two paths share no module. The persona cleanup that follows both restores was added
to each one by hand, in commit 5489e43f.

## Evidence

Confirmed:

- `src/main/ipcHandlers.ts:1255-1274`: `db:restore` runs `closeDatabase()`, then
  `copyFileSync(filePaths[0], dbPath)`, `initDatabase(dbPath)` and
  `clearOrphanedPartitions(userDataPath)`. It has no source check, no scratch copy, no rename,
  and no intact check.
- `src/main/ipcHandlers.ts:1281-1360`: `db:restoreSnapshot` resolves the name before closing
  (`:1288`), restores through `dbSnapshots.restoreSnapshotFile`, applies the `isIntactDatabase`
  gate on failure (`:1312`), reopens, runs the same persona cleanup (`:1345`), and maps failures to
  `IpcFailure` codes `NOT_FOUND`, `DB_RESTORE_FAILED`, and `DB_REOPEN_FAILED`.
- `src/main/services/db/dbSnapshots.ts:453-461` documents the hazard: `copyFileSync` truncates
  first, and SQLite opens a zero-length file as a new empty database. Lines `434-499` implement
  the guarded copy: allowlist, `assertReadable`, scratch copy beside the database, `fsync`,
  sidecar removal, and an atomic rename.

Probed against the `db:restore` sequence (close, `copyFileSync`, then open with the settings at
`core.ts:41-44`):

| Picked file | Result today |
| --- | --- |
| Zero-length file | Opens as schema v0 with no tables. `initDatabase` skips the pre-migration snapshot because the schema is empty (`core.ts:26`), migrates a fresh empty schema, and the handler reports `restored: true`. The previous database is gone. |
| Not a SQLite file | The live file now holds the picked bytes; reopen throws `SQLITE_NOTADB`. The session has no database, and the next launch fails into the generic "could not start" dialog (`src/main/index.ts:410`, `:639`). |
| A copy whose `-wal` still holds committed rows | Only the main file is copied. Every row held in the WAL is lost; in the probe, the restored file had no tables, so it migrated as empty. |
| A file at a newer schema (v99) | Opens with no migration and no refusal (`core.ts:18-20` treats "ahead" as current). The app runs schema-37 code against it. |
| The live `birdbrain.db` itself | Survives: the same-file check in Node's `copyFileSync` (from `libuv`) makes the copy a no-op. Not verified on Windows or macOS. |

An empty restored database also feeds the open persona defect (#1628): with no `personas` rows,
`clearOrphanedPartitions` treats every persona folder as orphaned and clears every sign-in.

Leads that were wrong or need correcting:

- **Issue #428** is about the rollback machinery: a restore that deleted the only database
  while a previous restore had left it under a `.superseded` name. The "fresh empty database"
  outcome is its scenario B, which the code comments cite.
- **"With rollback"** contradicts a recorded decision. Commit 70c80f75 removed the
  `.pre-restore`/`.superseded` rollback after five review rounds each found a silent-data-loss
  path inside it (#428). The `restoreSnapshotFile` docstring (`dbSnapshots.ts:401-432`), the
  confirm dialog (`DbUtilities.tsx:427-435`), and `website/content/docs/tester-guide.mdx:178-187`
  all promise that no copy is kept. This plan keeps that design: nothing touches `birdbrain.db` until a
  single rename, so a failure before the rename leaves nothing to roll back.

## Reproduce the hazard

This test must fail before slice 1 lands, so it goes in `tests/main/ipcHandlers.test.ts`, whose `db`
block already mocks `showOpenDialog` and exposes `userDataPath`, `dbPath`, and `invoke`. The
module-level tests in slice 1 go in `tests/main/services/dbRestore.test.ts`.

```ts
it('refuses a zero-length file and keeps the live database', async () => {
  const kept = expectOk<{ id: string }>(await invoke(IPC_CHANNELS.CASES_CREATE, { name: 'Kept' }))
  const empty = join(userDataPath, 'empty.db')
  writeFileSync(empty, '')
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [empty] })

  const res = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.DB_RESTORE)

  expect(res.ok).toBe(false)
  expect(res.code).toBe('DB_RESTORE_REJECTED')
  expect(expectOk(await invoke(IPC_CHANNELS.CASES_GET, kept.id))).toBeDefined()
})
```

Today this test fails at `expect(res.ok).toBe(false)`: the handler reports success, and `CASES_GET`
returns `undefined`. A second case writes non-SQLite bytes and asserts that the first 16 bytes of
`dbPath` are still `SQLite format 3\0`. I ran the probe script, not this test; the implementer
confirms it fails before writing the fix.

The WAL-source fixture: open a source database, set `journal_mode = WAL` and
`wal_autocheckpoint = 0`, insert rows, then copy both the main file and its `-wal` while that
connection is still open, and close it afterwards. The copy's rows exist only in its `-wal`.

## Design

### Interface

```ts
// src/main/services/db/dbRestore.ts
export type RestoreSource = { kind: 'snapshot'; fileName: string } | { kind: 'file'; path: string }

export type RestoreRejection =
  | 'not_found' // unknown snapshot name, or the file is missing
  | 'not_a_database' // not SQLite, user_version < 1, or no `cases` table
  | 'newer_schema' // user_version > LATEST_SCHEMA_VERSION
  | 'same_file' // the live database, or the scratch file itself
  | 'in_progress' // another restore is running
  | 'source_busy' // the source stayed locked past the retry bound
  | 'copy_failed' // the scratch copy could not be written
  | 'migration_failed' // the scratch copy could not be brought to the current schema

export type RestoreOutcome =
  | { status: 'restored'; fromVersion: number }
  | { status: 'rejected'; reason: RestoreRejection } // database never closed, nothing replaced
  | { status: 'replace_failed'; databaseIntact: boolean }
  | { status: 'reopen_failed' }

export interface RestoreHooks {
  beforeClose: () => void // production: stop the Capture Session
  afterReopen: () => Promise<void> // production: persona cleanup, then clear a vanished Active Case
}

export async function restoreDatabase(
  source: RestoreSource,
  deps: { dbPath: string } & RestoreHooks
): Promise<RestoreOutcome>
```

### Sequence and invariants

The live database stays open through phase A, which does all the slow and fallible work. Phase B
is the only part that runs closed.

**Phase A: prepare, with the live database open.**

1. Take a module-level in-flight flag; a second call returns `rejected: in_progress`. The two
   restore channels share one scratch name, and `backup()` yields between steps, so without the
   flag two restores interleave.
2. Resolve the source. Compare it with `dbPath` and with the scratch path by `statSync(..., {
   bigint: true })` `dev` and `ino` fields, not by path string, so case-folded Windows paths and
   symlinks resolve to `same_file`. A source equal to the scratch path must be rejected before
   anything clears the scratch, because `clearRestorePartial` (`dbSnapshots.ts:393-397`) would
   delete it.
3. Open the source read-only with a `busy_timeout`, and `backup()` it into the scratch file
   beside `dbPath`. `backup()` copies 100 pages per `setImmediate` step
   (`node_modules/better-sqlite3/lib/methods/backup.js`, `runBackup`) and treats `SQLITE_BUSY` as
   progress (`src/objects/backup.cpp`, `JS_transfer`), so a progress handler throws after a
   bounded number of steps with no change in remaining pages, giving `source_busy`. Remove only
   the source sidecars this read created, as `assertReadable` does.
4. Run every check on the scratch copy, not the source, so what is checked is what gets
   installed. Open it read-write and require `user_version` from 1 to `LATEST_SCHEMA_VERSION`
   and a `cases` table (a snapshot additionally needs `user_version === fromVersion`).
5. If the scratch copy is older, migrate it there: a detached `migrateFile(path)` exported from
   `core.ts` that takes the usual pre-migration snapshot, runs `runMigrations`, and never sets
   the module-level handle. A failure here is `rejected: migration_failed` with the live database
   untouched; today the same file replaces the live database and fails on reopen.
6. `wal_checkpoint(TRUNCATE)`, close, assert no `-wal`/`-shm` sits beside the scratch, then
   `fsync` it. (`backup()` opens and closes its own destination handle, so the module never holds
   it; this explicit open is what folds any WAL back in.)

**Phase B: swap, with the database closed.**

7. `beforeClose()`, then `closeDatabase()`.
8. Remove the live `-wal`/`-shm`, then `rename(scratch, dbPath)`, retried a bounded number of times
   on `EPERM`, `EBUSY`, and `EACCES`, which antivirus and indexers raise on Windows.
9. On any failure in step 8, check `isIntactDatabase(dbPath)`. If intact, reopen it and return
   `replace_failed` with `databaseIntact: true`. If not, return `databaseIntact: false` without
   migrating it. After phase A this needs corruption that predates the restore.
10. `initDatabase(dbPath)`; the file is already current, so no migration runs and the remaining
    failure modes are I/O. Failure returns `reopen_failed`.
11. `afterReopen()`, then release the flag.

Expected outcomes are returned, never thrown, and carry no filesystem path; the cause is logged.
The handler is the adapter from outcome to `IpcFailure`.

### What the renderer shows

The IPC contract stays `{ restored: boolean }` (`src/shared/ipc.ts:939-944`), with failures sent as
`IpcFailure`. Both callers in `src/renderer/components/settings/db/DbUtilities.tsx` (`:187-207`
and `:209-229`) show `err.message`, so the copy lives in main:

| Outcome | Code | Message |
| --- | --- | --- |
| `restored` | none | Unchanged: the "restart for full effect" success text. |
| `rejected` | `DB_RESTORE_REJECTED` (`NOT_FOUND` for an unknown snapshot, as today) | Names the reason and ends "Nothing was changed." |
| `replace_failed`, intact | `DB_RESTORE_FAILED` | Existing text at `ipcHandlers.ts:1354`. |
| `replace_failed`, not intact | `DB_RESTORE_FAILED` | New: do not restart; restore a backup or snapshot now. |
| `reopen_failed` | `DB_REOPEN_FAILED` | Existing text (`:1337-1340`). |

The not-intact message changes because the current advice, "Restart Birdbrain" (`:1319-1322`),
is unsafe: startup has no intact check (`index.ts:410`), and a zero-length file opens there as a
fresh schema (`core.ts:26`). Both restore handlers work with no open database, so restoring
immediately is the safe step. The root-cause fix is open question 3.

In `src/renderer/lib/api/db.ts:100-106`, switch the `restore` mutation from `onSuccess` to
`onSettled`, as `restoreSnapshot` already does (`:107-118`).

### Depth, seam, and locality

Today every caller must know the close/reopen ordering (`dbSnapshots.ts:431-432`), so the module
is shallow. Afterwards the interface is one function and one union, and the ordering, scratch name,
lock, and intact gate are implementation: that is the depth gain, and one file to fix is the
locality gain. The leverage is that a third source, such as a Case Archive database, gets every
guard without new code.

The seam is the hooks object. Each hook has two adapters: the production jobs and a recording fake
in tests. `afterReopen` now does two production jobs, persona cleanup and the Active Case check,
composed in the handler. The second mirrors `CASES_DELETE` (`ipcHandlers.ts:202-219`): call
`sessionService.deactivateCase()` when `caseRepo.getCase(activeCaseId)` returns nothing.
`beforeClose` calls `sessionService.stop()`, as `/api/session/stop` does (`captureServer.ts:297-300`),
so no automatic capture is admitted between close and reopen.

### Where it lives

Put it in `src/main/services/db/dbRestore.ts`, not under `src/packages/`:

- `src/main/services/db/**` is on the **blocking** tier of the evidence path list
  (`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md:246`). `src/packages/**` is on
  neither list, so moving restore there would take it off the backstop unless that spec changes.
- It wraps `core.ts`'s process-wide connection; the only package, `evidence-package-layout`, is a
  pure library importing only `@shared`.
- dependency-cruiser's `no-circular` rule holds while the direction stays one-way: `dbRestore`
  imports `core` and `dbSnapshots`, and neither imports `dbRestore`.

`dbSnapshots.ts` then shrinks to creating, listing, pruning, and resolving snapshots.

## Safety snapshot before restore

Neither path takes one today. `initDatabase` snapshots the *restored* file when it is older
(`core.ts:16-29`), never the database being replaced.

Recommendation: yes, as a separate final slice after a maintainer ruling. In phase A, `db.backup()`
the live database into `db-snapshots/` as `before-restore-v37-<stamp>.db`. That needs a deliberate
change to `SNAPSHOT_FILE_RE` (`dbSnapshots.ts:52`), which matches only `pre-migration-` names, and a
name that avoids the `.pre-restore` wording 70c80f75 deleted. It reuses the writer's
partial-rename-readback machinery and adds no swap state. It does change public copy (two dialogs,
`tester-guide.mdx`, `download.mdx:105-106`) and competes with the three-slot retention
(`dbSnapshots.ts:160-241`).

## Slices

Each slice is one PR, green on `pnpm preflight` alone. Every slice touches the blocking-tier
`src/main/services/db/**`, so each takes the `evidence-affecting` label and human review.
`ipcHandlers.ts` is advisory-tier (spec `:310`).

- [ ] **Slice 1: fix the file restore.** Add `dbRestore.ts` with `restoreDatabase` for
  `{ kind: 'file' }`, `migrateFile` in `core.ts`, and the hooks. Make `db:restore` a dialog plus one
  call plus the outcome mapping, and switch the `restore` mutation to `onSettled`. Add the
  reproduction tests to `ipcHandlers.test.ts`, and the non-SQLite, newer-schema, WAL-source,
  same-file, in-progress, and `EPERM`-rename cases to `dbRestore.test.ts`. In
  `tester-guide.mdx:184-187`, note that a restore refused before anything was replaced leaves the
  database as it was.
- [ ] **Slice 2: move the snapshot restore.** Add `{ kind: 'snapshot' }` and shrink
  `db:restoreSnapshot` to one call. This changes behavior, and the PR says so: a truncated snapshot
  is now `rejected` before close instead of `DB_RESTORE_FAILED` after it
  (`ipcHandlers.test.ts:2227`, `:2254`), and the v26 fixture at `:2289` becomes
  `rejected: migration_failed` with the live database intact instead of `DB_REOPEN_FAILED`.
- [ ] **Slice 3: narrow `dbSnapshots`.** Remove the `restoreSnapshotFile` and `clearRestorePartial`
  restore code, and move the restore tests that `dbSnapshots.test.ts` still holds.
- [ ] **Slice 4 (after ruling): safety snapshot before restore.** Includes the dialog and docs copy.

## Tests

- `tests/main/services/dbSnapshotsRestore.test.ts` (9 tests) mocks `node:fs` (`:30`). That still
  injects faults into `rmSync`, `renameSync`, and `fsyncSync`, but not into `backup()`, which writes
  through SQLite. The tests at `:185` (copy cannot be written) and `:199` (copy dies part-way) are
  replaced: occupy the scratch path with a directory so `backup()` fails, and stop the copy
  through the stalled-progress bound. Both assert that the live file is byte-identical afterwards.
  The other seven port with their properties unchanged.
- `tests/main/services/dbSnapshots.test.ts:348-437` (5 restore tests) move in slice 3.
- `tests/main/ipcHandlers.test.ts:2161-2322` (7 restore tests) shrink to cancel, one happy path per
  source, one test per outcome-to-code mapping, the `../birdbrain.db` rejection, and the hook
  wiring. The truncated-database and migration scenarios move to `dbRestore.test.ts`.

## Filing

The hazard meets the filing rule in `CLAUDE.md`: user-visible, and evidence-affecting because it
destroys the case database. No open issue covers it (#1628 is a different bug). Not filed, per
this task's instructions; if wanted, file it before slice 1 so that PR closes it.

## Risks

- **Captures already in flight.** `beforeClose` stops new automatic admissions, but a capture
  admitted earlier can append to a Case's Manifest and then fail its database write, or land in a
  restored database that lacks the Case. Draining in-flight captures needs a hook in
  `captureLifecycle.ts` and is out of scope.
- **Other writers between close and reopen.** The capture server's manual routes and the timestamp
  worker keep running, and any `getDb()` call in phase B throws. Phase B is now milliseconds
  instead of the whole copy, which narrows but does not close the window.
- **Startup-only hooks.** `runExhibitBackfill` (`index.ts:466`), the timestamp mirror rebuild
  (`timestampWorker.ts:235`), and the sync persona sweep run only at launch. The "restart for full
  effect" text stays.

## Open questions for the maintainer

1. Should **Restore from File** refuse a database at a newer schema than this build? I recommend
   refusing. Startup tolerates a newer file (`core.ts:18-20`), but that comment covers a
   downgrade of the app, not a deliberate restore, so it sets no precedent here.
2. Should a restore take a safety snapshot of the database it replaces (slice 4)? This reverses
   the published "no copy kept" wording.
3. Should startup refuse a database that fails `isIntactDatabase` instead of migrating it? This
   is the root cause behind the not-intact message, and it touches the blocking-tier `index.ts`.

## Review disposition

1. Accepted. `runBackup` steps 100 pages per `setImmediate`; the plan now names the close point
   and keeps the database open through phase A.
2. Accepted. Reproduced by reading `ipcHandlers.test.ts:2289` and `index.ts:410`/`:639`; the
   scratch copy is migrated before the rename.
3. Accepted. `backup.cpp` closes its own destination handle, so the earlier "close cleanly" step was
   wrong; all checks now run on the scratch copy.
4. Accepted. Slice 2 declares the behavior change and the tests name the replacement fault
   injection.
5. Accepted. `JS_transfer` returns `SQLITE_BUSY` as progress; the plan adds the flag and the
   stall bound.
6. Accepted. `ci.yml` runs only `ubuntu-latest`; the plan adds a bounded retry and an `EPERM` test.
7. Accepted in part. Kept the intact gate, which costs one probe, but replaced the "Restart" advice;
   the startup check is open question 3.
8. Accepted for open question 2 (block 1 at `migrations.ts:6-16` creates `cases`, and no later block
   drops it) and open question 4 (`CASES_DELETE` precedent). Rejected for open question 1:
   `core.ts:18-20` describes a downgrade, which is evidence for keeping the question, not an answer.
   `afterReopen` keeps its name and composes both jobs in the handler.
9. Accepted in part. `beforeClose` stops the session; draining in-flight captures is listed as a
   risk because it reaches into `captureLifecycle.ts`.
10. Accepted. `dev`/`ino` comparison, plus an explicit scratch-path rejection.
11. Accepted. Renamed to `before-restore-` with a deliberate pattern change.
12. Accepted. The failing test stays in `ipcHandlers.test.ts` because `dbRestore.ts` does not exist
    yet; the WAL fixture recipe is written out.
13. Accepted. Slice 1 adds the exception to the tester guide.
14. Accepted. The mirror rebuild call is at `timestampWorker.ts:235`.
