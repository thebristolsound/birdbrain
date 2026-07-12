import Database from 'better-sqlite3'
import { runMigrations } from '@main/services/db/migrations'

let db: Database.Database
export const LATEST_SCHEMA_VERSION = 25

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
