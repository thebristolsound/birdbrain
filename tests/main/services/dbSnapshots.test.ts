import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initDatabase, closeDatabase, getDb, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import {
  createPreMigrationSnapshot,
  listSnapshots,
  pruneSnapshots,
  resolveSnapshot,
  restoreSnapshotFile,
  snapshotDirFor,
  PreMigrationSnapshotError,
  SNAPSHOT_DIR_NAME,
  SNAPSHOT_RETENTION
} from '@main/services/db/dbSnapshots'

// A minimal pre-v25 database with real rows in it — the "install with real
// data" of #413's first acceptance criterion. Same shape as the v25 migration
// fixture, so every migration block from 25 onwards runs against it.
function seedLegacyDb(dbPath: string): void {
  const raw = new Database(dbPath)
  raw.exec(`
    CREATE TABLE cases (id TEXT PRIMARY KEY, name TEXT, description TEXT, type TEXT,
      created_at TEXT, updated_at TEXT, archived INTEGER DEFAULT 0);
    CREATE TABLE captures (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      url TEXT, title TEXT, html_path TEXT, screenshot_path TEXT, hash TEXT, timestamp TEXT,
      headers TEXT, created_at TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, capture_id TEXT,
      title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', source_url TEXT,
      screenshot_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE VIRTUAL TABLE captures_fts USING fts5(title, url, content);
  `)
  raw
    .prepare(`INSERT INTO cases VALUES ('case1','C','','custom','2026-01-01','2026-01-01',0)`)
    .run()
  raw
    .prepare(
      `INSERT INTO captures (id, case_id, url, title, hash) VALUES ('cap1','case1','https://a.example','Alpha','deadbeef')`
    )
    .run()
  raw.pragma('user_version = 24')
  raw.close()
}

describe('pre-migration snapshots', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-snapshot-'))
    dbPath = join(dir, 'birdbrain.db')
  })

  afterEach(() => {
    vi.useRealTimers()
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  })

  it('snapshots an existing database before a version bump migrates it', async () => {
    seedLegacyDb(dbPath)

    await initDatabase(dbPath)

    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    const snapshots = listSnapshots(dbPath)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].fromVersion).toBe(24)
    expect(snapshots[0].toVersion).toBe(LATEST_SCHEMA_VERSION)
    expect(snapshots[0].sizeBytes).toBeGreaterThan(0)
    expect(snapshots[0].path).toBe(join(dir, SNAPSHOT_DIR_NAME, snapshots[0].fileName))
  })

  it('leaves a snapshot that still holds the pre-migration schema and rows', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)

    const [snapshot] = listSnapshots(dbPath)
    const restored = new Database(snapshot.path, { readonly: true })
    try {
      // The point of the snapshot: the database as it was, not as the failed
      // migration left it.
      expect(restored.pragma('user_version', { simple: true })).toBe(24)
      expect(restored.prepare(`SELECT title FROM captures WHERE id = 'cap1'`).get()).toEqual({
        title: 'Alpha'
      })
      expect(
        restored
          .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'capture_texts'`
          )
          .get()
      ).toEqual({ count: 0 })
    } finally {
      restored.close()
    }
  })

  it('takes no snapshot when the schema is already current', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)
    closeDatabase()
    const afterFirstRun = listSnapshots(dbPath)

    await initDatabase(dbPath)

    expect(listSnapshots(dbPath)).toEqual(afterFirstRun)
    expect(afterFirstRun).toHaveLength(1)
  })

  it('takes no snapshot on a first launch, where there is no schema to lose', async () => {
    await initDatabase(dbPath)

    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(existsSync(snapshotDirFor(dbPath))).toBe(false)
  })

  it('takes no snapshot for an in-memory database', async () => {
    await initDatabase(':memory:')

    expect(existsSync(join(process.cwd(), SNAPSHOT_DIR_NAME))).toBe(false)
  })

  it('blocks the migration and leaves the database untouched when the snapshot fails', async () => {
    seedLegacyDb(dbPath)
    // A plain file where the snapshot directory belongs: mkdir fails, so no
    // snapshot can be written.
    writeFileSync(snapshotDirFor(dbPath), 'not a directory')

    await expect(initDatabase(dbPath)).rejects.toBeInstanceOf(PreMigrationSnapshotError)

    // Fail closed: the schema is still v24 and the connection is not handed out.
    expect(() => getDb()).toThrow('Database not initialized')
    const raw = new Database(dbPath, { readonly: true })
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(24)
      expect(
        raw
          .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'capture_texts'`
          )
          .get()
      ).toEqual({ count: 0 })
    } finally {
      raw.close()
    }
  })

  it('leaves no half-written snapshot behind when the copy cannot be verified', async () => {
    seedLegacyDb(dbPath)
    const conn = new Database(dbPath)
    try {
      await expect(
        // Claiming the source is v9 when it is v24 makes the read-back check
        // fail after the file has already been written.
        createPreMigrationSnapshot(conn, dbPath, 9, LATEST_SCHEMA_VERSION)
      ).rejects.toBeInstanceOf(PreMigrationSnapshotError)
    } finally {
      conn.close()
    }

    expect(readdirSync(snapshotDirFor(dbPath))).toEqual([])
  })

  it('prunes to the retention limit, keeping the newest snapshots', async () => {
    seedLegacyDb(dbPath)
    const conn = new Database(dbPath)
    // Date only: better-sqlite3's backup steps itself with setImmediate, so a
    // fully faked clock would stall it forever.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (let i = 0; i < SNAPSHOT_RETENTION + 2; i++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1 + i)))
        await createPreMigrationSnapshot(conn, dbPath, 24, LATEST_SCHEMA_VERSION)
      }
    } finally {
      conn.close()
      vi.useRealTimers()
    }

    const snapshots = listSnapshots(dbPath)
    expect(snapshots).toHaveLength(SNAPSHOT_RETENTION)
    // Newest first, and the two oldest days are the ones that went.
    expect(snapshots.map((s) => s.createdAt.slice(0, 10))).toEqual([
      '2026-01-05',
      '2026-01-04',
      '2026-01-03'
    ])
  })

  it('sorts by creation time, not by the version segment of the filename', async () => {
    seedLegacyDb(dbPath)
    const conn = new Database(dbPath)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)))
      conn.pragma('user_version = 10')
      await createPreMigrationSnapshot(conn, dbPath, 10, LATEST_SCHEMA_VERSION)
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 2)))
      conn.pragma('user_version = 9')
      await createPreMigrationSnapshot(conn, dbPath, 9, LATEST_SCHEMA_VERSION)
    } finally {
      conn.close()
      vi.useRealTimers()
    }

    // 'v9' sorts after 'v10' as text, so a filename sort would invert these.
    expect(listSnapshots(dbPath).map((s) => s.fromVersion)).toEqual([9, 10])
  })

  it('ignores files that are not snapshots', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)
    writeFileSync(join(snapshotDirFor(dbPath), 'notes.txt'), 'not a snapshot')

    expect(listSnapshots(dbPath)).toHaveLength(1)
    expect(resolveSnapshot(dbPath, 'notes.txt')).toBeNull()
    expect(resolveSnapshot(dbPath, '../birdbrain.db')).toBeNull()
  })

  it('restores a snapshot over the live database file', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)
    // A row that only exists in the migrated database, so a successful restore
    // is visible as its absence.
    getDb()
      .prepare(
        `INSERT INTO captures (id, case_id, url, title, hash, timestamp, created_at)
         VALUES ('cap2','case1','https://b.example','Beta','feed','2026-02-01','2026-02-01')`
      )
      .run()
    const [snapshot] = listSnapshots(dbPath)
    closeDatabase()

    restoreSnapshotFile(dbPath, snapshot.fileName)

    const raw = new Database(dbPath, { readonly: true })
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(24)
      expect(raw.prepare(`SELECT COUNT(*) AS count FROM captures`).get()).toEqual({ count: 1 })
    } finally {
      raw.close()
    }
  })

  it('refuses to restore a filename that is not a snapshot in the directory', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)
    closeDatabase()

    expect(() => restoreSnapshotFile(dbPath, '../birdbrain.db')).toThrow('was not found')
  })

  it('reports nothing and prunes nothing when no snapshot directory exists', () => {
    expect(listSnapshots(dbPath)).toEqual([])
    expect(pruneSnapshots(dbPath)).toBe(0)
  })
})
