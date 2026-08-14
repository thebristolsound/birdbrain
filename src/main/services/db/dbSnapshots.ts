import Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { logger } from '@main/services/logger'
import type { DbSnapshot } from '@shared/ipc'

// Pre-migration snapshots (#413, decided in #286): a failed migration has to be
// recoverable, not merely detectable. The copy is taken with better-sqlite3's
// native `db.backup()` — SQLite's own online backup API — rather than
// `wal_checkpoint + copyFileSync`, so it is a consistent point-in-time image of
// the live connection's committed state, WAL included.

// A sibling directory of the database file, not the userData root: a tester
// (and the #291 upgrade-path check) can point at one folder, and the root does
// not accumulate loose .db files that look like the live database.
export const SNAPSHOT_DIR_NAME = 'db-snapshots'

// Small fixed retention. Enough to survive a run of bad upgrades, bounded so a
// large case database cannot quietly multiply itself on a tester's disk.
export const SNAPSHOT_RETENTION = 3

// Where the live database is moved aside to during a restore. One generation
// only, overwritten by the next restore: it is a support-recoverable artifact,
// not a second undo history.
const PRE_RESTORE_SUFFIX = '.pre-restore'

// The staging name a snapshot is written to before it takes its final,
// listable name. Deliberately not `.db`-terminated, so SNAPSHOT_FILE_RE cannot
// match it and a file interrupted mid-write is never offered for restore.
const PARTIAL_SUFFIX = '.partial'

// Where the previous `.pre-restore` generation waits while a restore runs. It
// is deleted once a new generation has taken that name, and renamed back if the
// restore rolls back far enough to leave the name free. Where it does not — the
// rollback could not get the live database out of `.pre-restore` — the earlier
// generation stays here rather than being renamed over the live one, and the
// next restore sweeps it.
const SUPERSEDED_SUFFIX = '.superseded'

// A SQLite database is the file plus whatever WAL sidecars exist beside it.
// Every move in this module walks all three, in this order: the database
// first, so a move that only gets part-way has moved the file itself.
const DB_FILE_SUFFIXES = ['', '-wal', '-shm'] as const

type DbFileSuffix = (typeof DB_FILE_SUFFIXES)[number]

// Undoing those moves walks a different order, and deliberately not the
// reverse of the one above:
//
// - the -wal goes back before the database, because a database put back
//   without the WAL it had loses whatever the WAL had not yet checkpointed and
//   reports nothing, while a database left aside is caught by the
//   RestoreRollbackError below and named to the operator;
// - the -shm goes back last, because it is the memory-mapped one and so the
//   likeliest of the three to be held open — and the only one that is
//   disposable, since SQLite rebuilds it from the WAL. Restoring it first (as
//   a plain LIFO undo does) lets a lock on the file that matters least stop
//   the database itself from coming back at all.
const ROLLBACK_SUFFIXES = ['-wal', '', '-shm'] as const

// `<from>` is the schema the snapshot holds and `<to>` the one the app was
// about to write, so the name alone says which upgrade it belongs to. The
// stamp is an ISO instant with `:` and `.` swapped for `-` (both are illegal or
// hostile in filenames on Windows), which keeps it fixed-width and therefore
// sortable as a plain string.
const SNAPSHOT_FILE_RE = /^pre-migration-v(\d+)-to-v(\d+)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.db$/

/**
 * Thrown when the pre-migration snapshot could not be taken. Distinct from a
 * generic Error so startup can tell the operator the migration was *skipped*
 * and their data is untouched, rather than showing the generic crash dialog.
 */
export class PreMigrationSnapshotError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PreMigrationSnapshotError'
  }
}

/**
 * Thrown when a restore failed and left no file where the database belongs,
 * while a database sits beside it — either because this restore moved it there
 * and the rollback could not move it back, or because an earlier failed restore
 * did and this one had no database of its own to replace.
 *
 * Distinct from a generic restore failure because the caller must not re-open
 * the database on this path: opening a missing file creates an empty one and
 * migrates it, and an empty case list reads as "the evidence is gone" rather
 * than as a failed restore. The message names the file that holds the data,
 * which is `.pre-restore` unless the rollback could not get it back to that
 * name either, in which case it is `.pre-restore.superseded`.
 *
 * What it does not say: that the named file is the state the operator had
 * before this restore. It is the newest generation still on disk under those
 * two names, which is that state whenever the rollback was the only thing that
 * failed.
 */
export class RestoreRollbackError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RestoreRollbackError'
  }
}

export function snapshotDirFor(dbPath: string): string {
  return join(dirname(dbPath), SNAPSHOT_DIR_NAME)
}

function stampFor(date: Date): string {
  return date.toISOString().replace(/:/g, '-').replace(/\./g, '-')
}

function isoFromStamp(stamp: string): string {
  return stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
}

function snapshotFileName(fromVersion: number, toVersion: number, date: Date): string {
  return `pre-migration-v${fromVersion}-to-v${toVersion}-${stampFor(date)}.db`
}

/**
 * A snapshot as the main process sees it: the renderer-facing shape plus where
 * the file actually is. `path` stops at this module's callers — `listSnapshots`
 * is what crosses IPC, and it does not carry it.
 */
export interface StoredSnapshot extends DbSnapshot {
  path: string
}

function describe(dir: string, fileName: string): StoredSnapshot | null {
  const match = SNAPSHOT_FILE_RE.exec(fileName)
  if (!match) return null
  const [, fromVersion, toVersion, stamp] = match
  const path = join(dir, fileName)
  let sizeBytes: number
  try {
    sizeBytes = statSync(path).size
  } catch {
    // Raced with a delete, or unreadable — either way it is not restorable.
    return null
  }
  return {
    fileName,
    path,
    fromVersion: Number(fromVersion),
    toVersion: Number(toVersion),
    createdAt: isoFromStamp(stamp),
    sizeBytes
  }
}

/**
 * Every snapshot in the database's snapshot directory, newest first, with its
 * location on disk. Main-process only — see `listSnapshots` for the IPC shape.
 *
 * Files that do not match the naming pattern are ignored rather than listed:
 * this is the only thing standing between an arbitrary filename and the
 * restore path, so the listing doubles as the allowlist `resolveSnapshot`
 * validates against.
 */
export function listStoredSnapshots(dbPath: string): StoredSnapshot[] {
  const dir = snapshotDirFor(dbPath)
  if (!existsSync(dir)) return []
  const snapshots: StoredSnapshot[] = []
  for (const fileName of readdirSync(dir)) {
    const snapshot = describe(dir, fileName)
    if (snapshot) snapshots.push(snapshot)
  }
  // Sort on the timestamp, not the whole filename: the version segment leads
  // the name and `v9` sorts after `v10` as text.
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * The snapshot listing as the renderer sees it: metadata and the filename that
 * `db:restoreSnapshot` takes, and nothing else.
 *
 * The fields are copied out one by one rather than spread-minus-`path`, so a
 * later main-process-only field on `StoredSnapshot` cannot reach the renderer
 * by default. The renderer has no use for an absolute path, and handing one
 * over discloses the profile location to whatever is running in that window.
 */
export function listSnapshots(dbPath: string): DbSnapshot[] {
  return listStoredSnapshots(dbPath).map(
    ({ fileName, fromVersion, toVersion, createdAt, sizeBytes }) => ({
      fileName,
      fromVersion,
      toVersion,
      createdAt,
      sizeBytes
    })
  )
}

export function resolveSnapshot(dbPath: string, fileName: string): StoredSnapshot | null {
  return listStoredSnapshots(dbPath).find((snapshot) => snapshot.fileName === fileName) ?? null
}

/**
 * Delete snapshots beyond the retention limit, and any staging file left by an
 * interrupted snapshot. Returns how many files were removed.
 *
 * Not a plain newest-`keep` cut. Each migration block commits its own
 * `user_version` bump, so an upgrade that dies part-way leaves the database at
 * an intermediate version, and the next launch snapshots *that*. Under a
 * chronological cut, three such launches evict the only copy of the
 * pre-upgrade state and leave three copies of the half-migrated one — the
 * crash-looping upgrade erodes its own recovery. So the slots are dealt round
 * robin across the distinct `fromVersion` groups (newest group first, newest
 * member first within a group): every schema version present keeps a copy
 * before any version keeps a second, and the total is still `keep`. Note the
 * order: with more distinct versions than `keep`, the oldest groups get
 * nothing, so this bounds the directory rather than guaranteeing a copy of
 * every version ever snapshotted.
 */
export function pruneSnapshots(dbPath: string, keep: number = SNAPSHOT_RETENTION): number {
  const snapshots = listStoredSnapshots(dbPath)
  const kept = selectRetained(snapshots, Math.max(0, keep))
  let removed = 0
  for (const snapshot of snapshots) {
    if (kept.has(snapshot.path)) continue
    rmSync(snapshot.path, { force: true })
    removed++
  }
  return removed + sweepPartials(dbPath)
}

/**
 * Delete staging files left behind by an interrupted snapshot.
 *
 * Retention only bounds what `listStoredSnapshots` can see, and a `.partial`
 * is deliberately unmatchable by SNAPSHOT_FILE_RE. So the crash, power loss or
 * ENOSPC mid-`db.backup()` that PARTIAL_SUFFIX exists for leaves a full-size
 * copy of the database under a unique name that nothing ever counts or
 * removes. Only the caller's own writes reach this directory, and pruning runs
 * after the current snapshot has been renamed into place, so nothing swept
 * here is still being written.
 */
function sweepPartials(dbPath: string): number {
  const dir = snapshotDirFor(dbPath)
  if (!existsSync(dir)) return 0
  let removed = 0
  for (const fileName of readdirSync(dir)) {
    // -wal/-shm are what an interrupted read-back probe leaves beside the
    // staging file; they belong to it, not to anything listable.
    const base = fileName.replace(/(-wal|-shm)$/, '')
    if (!base.endsWith(PARTIAL_SUFFIX)) continue
    if (!SNAPSHOT_FILE_RE.test(base.slice(0, -PARTIAL_SUFFIX.length))) continue
    rmSync(join(dir, fileName), { force: true })
    removed++
  }
  return removed
}

function selectRetained(snapshots: StoredSnapshot[], keep: number): Set<string> {
  const groups: StoredSnapshot[][] = []
  const byVersion = new Map<number, StoredSnapshot[]>()
  for (const snapshot of snapshots) {
    let group = byVersion.get(snapshot.fromVersion)
    if (!group) {
      group = []
      byVersion.set(snapshot.fromVersion, group)
      groups.push(group)
    }
    group.push(snapshot)
  }

  const kept = new Set<string>()
  for (let round = 0; kept.size < keep; round++) {
    let dealt = false
    for (const group of groups) {
      if (round >= group.length) continue
      kept.add(group[round].path)
      dealt = true
      if (kept.size >= keep) break
    }
    if (!dealt) break
  }
  return kept
}

// The snapshot is only worth taking if it can be opened and reports the schema
// it was copied from. Deliberately not `integrity_check`: that is a full scan
// of every page, and paying it on the startup path would scale with case size.
//
// What it does prove: SQLite reads the header and the schema on open, so a
// file truncated by a crash, a full disk or a bad write fails here rather than
// being treated as a database (verified against 0.5x, 0.9x and 0.99x
// truncations of a real database, all of which throw SQLITE_CORRUPT on open).
// What it does not prove: page-level integrity deeper in the file.
function assertReadable(path: string, fromVersion: number): void {
  // Opening a WAL-mode file read-only creates -wal/-shm beside it and leaves
  // them behind on close. Only the ones this probe brings into existence are
  // removed again, so verifying a snapshot never deletes state it did not
  // create. Not the same as leaving the directory clean: a crash between the
  // open and the close leaves the probe's own -wal/-shm behind, and beside a
  // final-named snapshot those match neither SNAPSHOT_FILE_RE nor
  // `sweepPartials`, so nothing removes them.
  const ours = ['-wal', '-shm'].filter((suffix) => !existsSync(`${path}${suffix}`))
  const probe = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const version = probe.pragma('user_version', { simple: true }) as number
    if (version !== fromVersion) {
      throw new Error(`snapshot reports schema v${version}, expected v${fromVersion}`)
    }
  } finally {
    probe.close()
    for (const suffix of ours) rmSync(`${path}${suffix}`, { force: true })
  }
}

/**
 * Snapshot `db` to the snapshot directory before migrations run.
 *
 * Throws `PreMigrationSnapshotError` if the snapshot cannot be taken or cannot
 * be read back — the caller must treat that as fatal and leave the database
 * unmigrated (#413 fail-closed).
 */
export async function createPreMigrationSnapshot(
  db: Database.Database,
  dbPath: string,
  fromVersion: number,
  toVersion: number
): Promise<DbSnapshot> {
  const dir = snapshotDirFor(dbPath)
  const fileName = snapshotFileName(fromVersion, toVersion, new Date())
  const target = join(dir, fileName)
  // Written under a name the listing cannot match, then renamed once it has
  // been read back. Deleting a bad file in the `catch` only covers throws we
  // are alive to see; a crash, power loss or ENOSPC mid-backup would otherwise
  // leave a truncated file already carrying a restorable name. Same directory,
  // so the rename is a same-filesystem move and therefore atomic.
  const partial = `${target}${PARTIAL_SUFFIX}`

  try {
    mkdirSync(dir, { recursive: true })
    await db.backup(partial)
    assertReadable(partial, fromVersion)
    renameSync(partial, target)
  } catch (err) {
    // Its own failure must not replace the error that actually stopped the
    // snapshot — `force` only swallows ENOENT, and the interesting failures
    // here (unwritable or non-directory snapshot path) are neither.
    try {
      rmSync(partial, { force: true })
      rmSync(target, { force: true })
    } catch {
      // Nothing to add: the throw below carries the real cause.
    }
    throw new PreMigrationSnapshotError(
      `Could not snapshot the database before migrating from schema v${fromVersion} to v${toVersion}`,
      { cause: err }
    )
  }

  const snapshot = describe(dir, fileName)
  if (!snapshot) {
    throw new PreMigrationSnapshotError(`Snapshot ${fileName} disappeared after it was written`)
  }

  // Pruning is housekeeping, not part of the recoverability promise — the
  // snapshot this migration depends on already exists, so a failure here must
  // not block the upgrade. It is logged because the alternative is a snapshot
  // directory that silently grows.
  try {
    pruneSnapshots(dbPath)
  } catch (err) {
    logger.warn('db', 'db.snapshot_prune_failed', undefined, err)
  }

  logger.info('db', 'db.snapshot_created', { bytes: snapshot.sizeBytes })
  return snapshot
}

/**
 * Replace the live database file with a snapshot.
 *
 * The caller owns the connection lifecycle: the database MUST already be
 * closed, and must be re-opened afterwards.
 *
 * Ordered so that the destructive step is the last one and the state it
 * destroys is kept:
 *
 * 1. the snapshot is opened and checked before anything is touched, because a
 *    snapshot that is not a database would otherwise overwrite a working one
 *    and leave the app with neither;
 * 2. the copy lands on a staging name in the target directory and is renamed
 *    into place, so `dbPath` is never a half-written file;
 * 3. the database being replaced is moved aside, not deleted, together with
 *    its -wal/-shm — a restore is a misclick away and this is evidence;
 * 4. the `.pre-restore` generation this one replaces is moved aside as well,
 *    and dropped only once the restore has committed *and* has moved a live
 *    database in to take its place — so neither a restore that rolls back nor
 *    one run with no database at `dbPath` spends the operator's earlier copy.
 *
 * The limit of (4): `.pre-restore` holds one generation, and where both this
 * restore and its own rollback fail, the generation kept there is the newer of
 * the two — the database this restore moved aside. The earlier one is left
 * under `.superseded` and the next restore deletes it. It is not renamed back
 * over a `.pre-restore` the rollback could not empty, because the file under
 * that name is the live database.
 *
 * Throws `RestoreRollbackError` — and nothing else — when the call leaves no
 * file at `dbPath` and a database beside it under `.pre-restore` or
 * `.pre-restore.superseded`, whichever step failed. The caller must not re-open
 * on that path; see the class comment.
 */
export function restoreSnapshotFile(dbPath: string, fileName: string): void {
  const aside = `${dbPath}${PRE_RESTORE_SUFFIX}`
  try {
    swapSnapshotIntoPlace(dbPath, aside, fileName)
  } catch (err) {
    // Which step failed does not change what the caller may do next; one thing
    // does. If there is no file where the database belongs and there is one
    // beside it — put there by this restore, by its rollback, or by an earlier
    // failed one — re-opening would create an empty database and migrate it,
    // and the operator would be looking at an empty case list with their data
    // still on disk under another name. Say which name, by name only: the
    // message reaches the renderer, and an absolute path would disclose the
    // profile location with it.
    //
    // Newest first. `.superseded` is only where the database ends up when the
    // rollback could not bring it back to `.pre-restore` either, but a name the
    // operator is never shown is the same as no database at all.
    const holding = [aside, `${aside}${SUPERSEDED_SUFFIX}`].find(existsSync)
    if (!existsSync(dbPath) && holding) {
      throw new RestoreRollbackError(
        `The restore failed and there is no database where Birdbrain keeps it. The database ` +
          `is beside it as "${basename(holding)}" — rename it back before restarting Birdbrain.`,
        { cause: err }
      )
    }
    throw err
  }
}

// The swap itself. Split from the exported function above so that every way
// out of it — a snapshot that will not open, a copy that cannot be written, a
// rename that fails, a rollback that fails after it — passes the same test for
// whether a database is left where the caller expects one.
function swapSnapshotIntoPlace(dbPath: string, aside: string, fileName: string): void {
  const snapshot = resolveSnapshot(dbPath, fileName)
  if (!snapshot) throw new Error(`Snapshot "${fileName}" was not found`)
  assertReadable(snapshot.path, snapshot.fromVersion)

  const staged = `${dbPath}${PARTIAL_SUFFIX}`
  try {
    copyFileSync(snapshot.path, staged)
  } catch (err) {
    rmSync(staged, { force: true })
    throw err
  }

  const superseded: DbFileSuffix[] = []
  const moved: DbFileSuffix[] = []
  try {
    // One generation only, but the previous one is moved rather than deleted:
    // deleting it here would spend it even on a restore that fails and rolls
    // back cleanly. Leftovers from a restore that died between the move and
    // the drop go first, or two generations would interleave.
    for (const suffix of DB_FILE_SUFFIXES) {
      const from = `${aside}${suffix}`
      rmSync(`${from}${SUPERSEDED_SUFFIX}`, { force: true })
      if (!existsSync(from)) continue
      renameSync(from, `${from}${SUPERSEDED_SUFFIX}`)
      superseded.push(suffix)
    }

    // A clean close removes -wal/-shm, but a crash leaves them behind, and a
    // stale WAL replayed on top of the restored file is data from the database
    // that was just replaced. They move with it rather than being deleted:
    // separated from their database they are unreadable.
    for (const suffix of DB_FILE_SUFFIXES) {
      const from = `${dbPath}${suffix}`
      if (!existsSync(from)) continue
      renameSync(from, `${aside}${suffix}`)
      moved.push(suffix)
    }
    renameSync(staged, dbPath)
  } catch (err) {
    // Put the live database back. Without this, a failure between the move and
    // the rename leaves no file at `dbPath` at all, and the re-open would
    // create an empty database and migrate it — an empty case list reads as
    // "the evidence is gone" rather than as a failed restore.
    //
    // Three separate attempts, not one: the two undos are independent, and a
    // sidecar that cannot be moved must not also cost the operator the earlier
    // generation that the second one is putting back. Each is swallowed on
    // purpose — the throw below carries the failure that started this, and
    // that is the one the operator needs to see.
    try {
      for (const suffix of ROLLBACK_SUFFIXES) {
        if (moved.includes(suffix)) renameSync(`${aside}${suffix}`, `${dbPath}${suffix}`)
      }
    } catch {
      // See above.
    }

    // Independent, but not unconditional: the earlier generation only goes back
    // to `.pre-restore` while nothing is under that name. If the undo above
    // could not take the database back out of it, that file *is* the live
    // database — the one the caller is about to be told to rename back — and
    // renaming onto it unlinks it. Guarded per file for the same reason the
    // commit below is, and gated on the database file as well: the -shm is the
    // last one the undo tries, so its failure is the only one that leaves a
    // free `.pre-restore` beside an occupied `.pre-restore-shm`, and pairing an
    // earlier generation's database with a live -shm costs nothing because
    // SQLite rebuilds it.
    if (!existsSync(aside)) {
      try {
        for (const suffix of ROLLBACK_SUFFIXES) {
          const to = `${aside}${suffix}`
          if (!superseded.includes(suffix) || existsSync(to)) continue
          renameSync(`${to}${SUPERSEDED_SUFFIX}`, to)
        }
      } catch {
        // See above.
      }
    }
    try {
      rmSync(staged, { force: true })
    } catch {
      // See above.
    }
    throw err
  }

  // Committed. Only now is the generation this restore replaced let go — one
  // generation, as the Settings copy and the tester guide both say.
  //
  // "Replaced" is load-bearing: `moved` carries '' exactly when a live
  // database was moved into `.pre-restore` a moment ago. Without one — the
  // state a failed rollback leaves behind, and Restore is the button that just
  // failed — this restore put no new generation in that file's place, and
  // dropping the old one would leave the operator with nothing but the
  // snapshot while the restore reported success. It goes back instead, unless
  // a sidecar of this database has already claimed the name — only a sidecar
  // can, since the database file itself is only under that name when this
  // restore put it there. The one that cannot go back stays under
  // `.superseded` until the next restore sweeps it: disk, not data, because
  // the database it belongs to is back under `.pre-restore`.
  //
  // A failure here costs disk, not data, so it is logged rather than thrown:
  // the restore the operator asked for has already succeeded.
  const replacedLiveDatabase = moved.includes('')
  try {
    for (const suffix of superseded) {
      const held = `${aside}${suffix}${SUPERSEDED_SUFFIX}`
      if (replacedLiveDatabase) rmSync(held, { force: true })
      else if (!existsSync(`${aside}${suffix}`)) renameSync(held, `${aside}${suffix}`)
    }
  } catch (err) {
    logger.warn('db', 'db.snapshot_prune_failed', undefined, err)
  }
}
