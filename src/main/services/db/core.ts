import Database from 'better-sqlite3'
import { runMigrations } from '@main/services/db/migrations'

let db: Database.Database
export const LATEST_SCHEMA_VERSION = 26

export function initDatabase(dbPath: string): Database.Database {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  runMigrations(db)
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
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
  'notes',
  'selectors',
  'capture_analyses',
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
