import Database from 'better-sqlite3'
import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync, statSync } from 'node:fs'
import {
  closeDatabase,
  emptyWalBeforeReplace,
  initDatabase,
  LATEST_SCHEMA_VERSION,
  migrateFile
} from '@main/services/db/core'
import { isIntactDatabase } from '@main/services/db/dbSnapshots'
import { logger } from '@main/services/logger'

// Restoring the database from a file the operator picked (#1700). Everything
// slow or fallible happens on a scratch copy beside the live database while
// that database stays open; the live file changes only through one rename of a
// copy that has already been checked and migrated. So a refusal at any point
// before the rename leaves nothing to undo.

export type RestoreSource = { kind: 'file'; path: string }

export type RestoreRejection =
  | 'in_progress' // another restore is running
  | 'in_use' // another connection is mid-read on the live database
  | 'not_found' // the picked file is not there
  | 'same_file' // the picked file is the live database, or the scratch copy
  | 'not_a_database' // not SQLite, user_version below 1, or no `cases` table
  | 'newer_schema' // user_version above LATEST_SCHEMA_VERSION
  | 'source_busy' // another program holds a lock on the picked file
  | 'copy_failed' // the scratch copy could not be written
  | 'migration_failed' // the scratch copy could not be brought to the current schema

export type RestoreOutcome =
  | { status: 'restored' }
  | { status: 'rejected'; reason: RestoreRejection }
  | { status: 'replace_failed'; databaseIntact: boolean }
  | { status: 'reopen_failed' }

// Beside the database so the rename is a same-filesystem move, and distinct
// from the snapshot restore's staging name, which that restore clears on entry.
export const SCRATCH_SUFFIX = '.file-restore.partial'

const DB_SIDECAR_SUFFIXES = ['-wal', '-shm'] as const

// How long a read of the picked file waits on another program's lock.
const SOURCE_BUSY_TIMEOUT_MS = 1000

// `backup()` reports a step that hit SQLITE_BUSY as progress and steps again,
// so a lock taken on the source part-way through would otherwise hold the
// restore, and the in-progress flag with it, for as long as the lock lasts.
const MAX_STALLED_STEPS = 20
// better-sqlite3's own default; a progress callback has to return the rate.
const PAGES_PER_STEP = 100

// A rename refused while another program briefly holds a file fails with one
// of these; it is retried a bounded number of times before the restore gives up.
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 50

let inProgress = false

/**
 * Replace the live database at `dbPath` with a copy of `source`, after
 * checking the copy is a Birdbrain database this build can open.
 *
 * Expected outcomes are returned, never thrown, and carry no filesystem path;
 * the cause of each is logged here. The caller owns everything that follows a
 * successful restore, such as clearing state the restored database no longer
 * knows about.
 */
export async function restoreDatabase(
  source: RestoreSource,
  { dbPath }: { dbPath: string }
): Promise<RestoreOutcome> {
  if (inProgress) return rejected('in_progress')
  inProgress = true
  try {
    return await restore(source.path, dbPath)
  } finally {
    inProgress = false
  }
}

async function restore(sourcePath: string, dbPath: string): Promise<RestoreOutcome> {
  // Checked first and again before the close: see the second call below.
  if (!emptyWalBeforeReplace()) return rejected('in_use')

  const scratch = `${dbPath}${SCRATCH_SUFFIX}`
  let sourceStat: FileIdentity
  try {
    sourceStat = statIdentity(sourcePath)
  } catch (err) {
    return rejected('not_found', err)
  }
  if (!sourceStat.isFile) return rejected('not_a_database')
  // By device and inode, not path string, so another path to the same file,
  // such as a symlink, is caught. The scratch is compared before anything
  // clears it, since clearing it would delete the source.
  if (isSameFile(sourceStat, dbPath) || isSameFile(sourceStat, scratch)) {
    return rejected('same_file')
  }

  clearScratch(scratch)
  const refusal = await prepareScratch(sourcePath, scratch)
  if (refusal) {
    clearScratch(scratch)
    return refusal
  }

  // Again here, with no await between this and the close: the database stayed
  // open while the copy was prepared, and its WAL may have grown since. An
  // empty WAL is what makes deleting the live sidecars below lose nothing.
  if (!emptyWalBeforeReplace()) {
    clearScratch(scratch)
    return rejected('in_use')
  }
  closeDatabase()

  try {
    // A -wal left beside the restored file would be replayed over it.
    for (const suffix of DB_SIDECAR_SUFFIXES) rmSync(`${dbPath}${suffix}`, { force: true })
    await renameWithRetry(scratch, dbPath)
  } catch (err) {
    logger.error('db', 'db.restore_replace_failed', undefined, err)
    clearScratch(scratch)
    // Not migrated or re-opened when it is no longer a database: opening a
    // zero-length file builds a fresh, empty schema over the operator's data.
    if (!isIntactDatabase(dbPath)) return { status: 'replace_failed', databaseIntact: false }
    return (await reopen(dbPath)) ?? { status: 'replace_failed', databaseIntact: true }
  }

  return (await reopen(dbPath)) ?? { status: 'restored' }
}

// Copies the picked file to the scratch path and makes it installable: checked,
// migrated, and flushed. Returns the refusal, or null when the copy is ready.
async function prepareScratch(sourcePath: string, scratch: string): Promise<RestoreOutcome | null> {
  try {
    await copyToScratch(sourcePath, scratch)
  } catch (err) {
    return rejected(classify(err, 'copy_failed'), err)
  }

  // Checked on the copy, not the source, so what is checked is what is installed.
  let version: number
  try {
    version = readCheckedVersion(scratch)
  } catch (err) {
    return rejected(classify(err, 'copy_failed'), err)
  }
  if (version > LATEST_SCHEMA_VERSION) return rejected('newer_schema')
  if (version < 1) return rejected('not_a_database')

  try {
    await migrateFile(scratch)
  } catch (err) {
    return rejected('migration_failed', err)
  }

  try {
    // migrateFile's connection was the last one, so its close folded the WAL
    // back into the file. A sidecar still here holds pages the rename would
    // leave behind.
    if (DB_SIDECAR_SUFFIXES.some((suffix) => existsSync(`${scratch}${suffix}`))) {
      throw new Error('the scratch copy still has a WAL sidecar after its last close')
    }
    const fd = openSync(scratch, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch (err) {
    return rejected('copy_failed', err)
  }
  return null
}

// Through SQLite's backup API rather than a file copy, so committed rows still
// in the source's -wal come across with the main file.
async function copyToScratch(sourcePath: string, scratch: string): Promise<void> {
  // Opening a WAL-mode file read-only creates sidecars beside it; only the ones
  // this read brings into existence are removed again.
  const ours = DB_SIDECAR_SUFFIXES.filter((suffix) => !existsSync(`${sourcePath}${suffix}`))
  let src: Database.Database | null = null
  try {
    src = new Database(sourcePath, { readonly: true, fileMustExist: true })
    src.pragma(`busy_timeout = ${SOURCE_BUSY_TIMEOUT_MS}`)
    // Reads the header now. A locked source otherwise makes `backup()` resolve
    // having copied nothing, and a non-database fails here with SQLITE_NOTADB.
    src.pragma('user_version', { simple: true })
    let remaining = -1
    let stalled = 0
    await src.backup(scratch, {
      progress: ({ remainingPages }) => {
        stalled = remainingPages === remaining ? stalled + 1 : 0
        remaining = remainingPages
        if (stalled >= MAX_STALLED_STEPS) {
          throw Object.assign(new Error('the source stayed locked during the copy'), {
            code: 'SQLITE_BUSY'
          })
        }
        return PAGES_PER_STEP
      }
    })
  } finally {
    try {
      src?.close()
      for (const suffix of ours) rmSync(`${sourcePath}${suffix}`, { force: true })
    } catch {
      // Tidying the source says nothing about the copy.
    }
  }
}

// The schema version of the scratch copy, once it is known to hold a `cases`
// table. A database with no `cases` table is not a Birdbrain database, whatever
// its version says.
function readCheckedVersion(scratch: string): number {
  const conn = new Database(scratch, { fileMustExist: true })
  try {
    const version = conn.pragma('user_version', { simple: true }) as number
    const cases = conn
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cases'")
      .get()
    return cases ? version : 0
  } finally {
    conn.close()
  }
}

function classify(err: unknown, fallback: RestoreRejection): RestoreRejection {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code !== 'string') return fallback
  if (code.startsWith('SQLITE_BUSY')) return 'source_busy'
  if (code === 'SQLITE_NOTADB' || code.startsWith('SQLITE_CORRUPT')) return 'not_a_database'
  return fallback
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code
      if (attempt >= RENAME_ATTEMPTS || !RETRYABLE_RENAME_CODES.has(String(code))) throw err
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS))
    }
  }
}

// Null once the database is open again.
async function reopen(dbPath: string): Promise<RestoreOutcome | null> {
  try {
    await initDatabase(dbPath)
    return null
  } catch (err) {
    logger.error('db', 'db.reopen_failed', undefined, err)
    return { status: 'reopen_failed' }
  }
}

interface FileIdentity {
  dev: bigint
  ino: bigint
  isFile: boolean
}

function statIdentity(path: string): FileIdentity {
  const stat = statSync(path, { bigint: true })
  return { dev: stat.dev, ino: stat.ino, isFile: stat.isFile() }
}

function isSameFile(source: FileIdentity, path: string): boolean {
  try {
    const other = statIdentity(path)
    return other.dev === source.dev && other.ino === source.ino
  } catch {
    return false
  }
}

// Non-throwing: on the way in the copy truncates whatever is there anyway, and
// on the way out its own error must not replace the one being reported.
function clearScratch(scratch: string): void {
  for (const path of [scratch, ...DB_SIDECAR_SUFFIXES.map((suffix) => `${scratch}${suffix}`)]) {
    try {
      rmSync(path, { force: true })
    } catch {
      // A leftover scratch costs disk space; nothing reads or trusts it.
    }
  }
}

function rejected(reason: RestoreRejection, cause?: unknown): RestoreOutcome {
  // The log keeps an error's code and never its message, so a refusal with no
  // underlying error is recorded under a code that names the reason.
  const logged =
    cause ?? Object.assign(new Error(reason), { code: `RESTORE_${reason.toUpperCase()}` })
  logger.warn('db', 'db.restore_rejected', undefined, logged)
  return { status: 'rejected', reason }
}
