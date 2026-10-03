import Database from 'better-sqlite3'
import { runMigrations } from '@main/services/db/migrations'
import { createPreMigrationSnapshot } from '@main/services/db/dbSnapshots'

let db: Database.Database | null = null
export const LATEST_SCHEMA_VERSION = 37

/**
 * Snapshot the database if — and only if — migrations are about to change it.
 *
 * Async because better-sqlite3's `db.backup()` is; that is what makes
 * `initDatabase` async in turn. Any throw here reaches the caller and stops
 * `runMigrations` from being reached at all, which is the fail-closed half of
 * #413: an unrecoverable upgrade must not start.
 */
async function snapshotBeforeMigrations(conn: Database.Database, dbPath: string): Promise<void> {
  const version = conn.pragma('user_version', { simple: true }) as number
  // Already current (or ahead, on a downgrade): no migration will run, so
  // there is nothing to snapshot.
  if (version >= LATEST_SCHEMA_VERSION) return
  // An in-memory database has no file to copy and nothing that outlives the
  // process to restore.
  if (dbPath === ':memory:') return
  // A first launch creates the file and runs every migration block against an
  // empty schema. Snapshotting that costs a retention slot to preserve nothing.
  if (version === 0 && isEmptySchema(conn)) return

  await createPreMigrationSnapshot(conn, dbPath, version, LATEST_SCHEMA_VERSION)
}

function isEmptySchema(conn: Database.Database): boolean {
  const row = conn
    .prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    .get() as { count: number }
  return row.count === 0
}

export async function initDatabase(dbPath: string): Promise<Database.Database> {
  const conn = new Database(dbPath)
  conn.pragma('journal_mode = WAL')
  conn.pragma('foreign_keys = ON')
  conn.pragma('busy_timeout = 5000')
  try {
    await snapshotBeforeMigrations(conn, dbPath)
    runMigrations(conn)
  } catch (err) {
    // The module-level handle stays unset on failure, so `getDb()` throws
    // "Database not initialized" rather than handing out a connection to a
    // database this process refused to migrate.
    conn.close()
    throw err
  }
  db = conn
  return db
}

// The MCP server's connection (ADR-0038). SQLite itself refuses every write on
// it, and it is never migrated: a schema version this build does not know is
// refused, because reading it through this build's repos would misread it.
export function openDatabaseReadOnly(dbPath: string): Database.Database {
  const conn = new Database(dbPath, { readonly: true, fileMustExist: true })
  conn.pragma('busy_timeout = 5000')
  const version = conn.pragma('user_version', { simple: true }) as number
  if (version !== LATEST_SCHEMA_VERSION) {
    conn.close()
    throw new Error(
      `Database schema version is ${version}; this build reads only version ` +
        `${LATEST_SCHEMA_VERSION}. Open the database in a matching Birdbrain first.`
    )
  }
  db = conn
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    // Cleared, not just closed. A handle left behind after a close is handed
    // out by getDb() as a live connection and fails deep inside a statement;
    // it also makes "no database is open" indistinguishable from "one is",
    // which is what the fail-closed path in initDatabase depends on.
    db = null
  }
}

export function withTransaction<T>(fn: () => T): T {
  return getDb().transaction(fn)()
}

// Context threaded through the per-repo archive-import bulk ops. Repos never
// touch the filesystem: the staged-sidecar read arrives as `getText`.
export interface ImportCtx {
  newCaseId: string
  mapId: (id: string) => string
  mapTag: (id: string) => string
  getText: (oldId: string, newId: string) => string
}

// The tables whose rows carry a stable `id` that the archive import may need to
// remap on collision. Single source of truth: `hasRowWithId` validates against
// it (the `table` name is interpolated into SQL, so membership is checked first
// — no arbitrary identifier reaches the statement), and caseArchive derives its
// remap loop and row map from the same list, so the two cannot drift.
export const ID_PROBE_TABLES = [
  'captures',
  // A Capture's Exhibit id IS its capture id, so the two probes share one
  // remap; a non-Capture Exhibit and a pooled file have ids of their own.
  'exhibits',
  'staging_files',
  'notes',
  'selectors',
  'extracted_data',
  'capture_archive_refs',
  'annotation_pins'
] as const

// Id-existence probe for the archive import's collision remap.
export function hasRowWithId(table: string, id: string): boolean {
  if (!(ID_PROBE_TABLES as readonly string[]).includes(table)) {
    throw new Error(`hasRowWithId: table "${table}" is not permitted`)
  }
  return getDb().prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined
}
