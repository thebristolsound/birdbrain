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
import { dirname, join } from 'node:path'
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

// The staging name a snapshot is written to before it takes its final,
// listable name. Deliberately not `.db`-terminated, so SNAPSHOT_FILE_RE cannot
// match it and a file interrupted mid-write is never offered for restore.
const PARTIAL_SUFFIX = '.partial'

// A SQLite database on disk is the file plus whatever WAL sidecars sit beside
// it. They belong to the file they were written for and to no other.
const DB_SIDECAR_SUFFIXES = ['-wal', '-shm'] as const

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
 * Replace the live database file with a snapshot. Destructive and not
 * reversible: the database at `dbPath` is overwritten, and no copy of it is
 * kept anywhere. The retained snapshots are the safety net, and Settings →
 * Database → Utilities → Backup Database is how an operator keeps the current
 * state before restoring over it. The confirm dialog and the tester guide both
 * say so in as many words.
 *
 * Earlier rounds of #413 kept the replaced database under a `.pre-restore`
 * name with a rollback that tried to undo a part-done swap. Five review rounds
 * found five distinct silent-data-loss paths in that machinery, each in a
 * state the previous round's fix created; it was never in the ticket, and a
 * reversibility promise that is wrong about *which* generation it kept is
 * worse than no promise. Hence two writes and no state to get wrong.
 *
 * The caller owns the connection lifecycle: the database MUST already be
 * closed, and must be re-opened afterwards.
 */
export function restoreSnapshotFile(dbPath: string, fileName: string): void {
  // The enumerated listing is the allowlist — `resolveSnapshot` only matches
  // files it found in the snapshot directory, so an arbitrary path from the
  // renderer never reaches `copyFileSync`.
  const snapshot = resolveSnapshot(dbPath, fileName)
  if (!snapshot) throw new Error(`Snapshot "${fileName}" was not found`)

  // Before anything is written. A snapshot that is not a database would
  // otherwise overwrite a working one and leave the app with neither.
  assertReadable(snapshot.path, snapshot.fromVersion)

  // The sidecars go first, and not because they are tidy: a -wal left beside
  // the restored file belongs to the database that was just replaced, and
  // SQLite would replay it over the snapshot on the next open. Deleting them
  // before the copy also puts the only step that can fail without touching the
  // database first — a sidecar that cannot be removed stops the restore with
  // the live database still intact and readable.
  for (const suffix of DB_SIDECAR_SUFFIXES) rmSync(`${dbPath}${suffix}`, { force: true })
  copyFileSync(snapshot.path, dbPath)
}
