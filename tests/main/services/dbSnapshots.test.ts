import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initDatabase, closeDatabase, getDb, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import {
  createPreMigrationSnapshot,
  listSnapshots,
  listStoredSnapshots,
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
// fixture, so every migration block from 25 onwards runs against it. Tables
// carry only what those blocks need: `selectors` is here because v29 alters
// it, not because anything below reads it, and `tags`/`capture_tags` plus the
// four later `captures` columns are here because v34 rebuilds and reads them.
// Every one of those exists in a real v24 database (v11, v23).
function seedLegacyDb(dbPath: string): void {
  const raw = new Database(dbPath)
  raw.exec(`
    CREATE TABLE cases (id TEXT PRIMARY KEY, name TEXT, description TEXT, type TEXT,
      created_at TEXT, updated_at TEXT, archived INTEGER DEFAULT 0);
    CREATE TABLE captures (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      url TEXT, title TEXT, html_path TEXT, screenshot_path TEXT, hash TEXT, timestamp TEXT,
      headers TEXT, created_at TEXT, mhtml_path TEXT, size_bytes INTEGER, manifest_index INTEGER,
      method TEXT NOT NULL DEFAULT 'extension');
    CREATE TABLE notes (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, capture_id TEXT,
      title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', source_url TEXT,
      screenshot_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE selectors (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, pattern TEXT NOT NULL,
      is_regex INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, label TEXT, created_at TEXT NOT NULL);
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT);
    CREATE TABLE annotations (capture_id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL,
      shapes_json TEXT NOT NULL, image_width INTEGER NOT NULL, image_height INTEGER NOT NULL,
      updated_at TEXT NOT NULL, updated_by TEXT);
    CREATE TABLE capture_tags (capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (capture_id, tag_id));
    CREATE VIRTUAL TABLE captures_fts USING fts5(title, url, content);
  `)
  raw
    .prepare(`INSERT INTO cases VALUES ('case1','C','','custom','2026-01-01','2026-01-01',0)`)
    .run()
  raw
    .prepare(
      `INSERT INTO captures (id, case_id, url, title, hash, timestamp, created_at)
       VALUES ('cap1','case1','https://a.example','Alpha','deadbeef','2026-01-01','2026-01-01')`
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
    // The path is main-process only: it is on the stored shape and not on the
    // one the renderer is handed.
    expect(snapshots[0]).not.toHaveProperty('path')
    expect(listStoredSnapshots(dbPath)[0].path).toBe(
      join(dir, SNAPSHOT_DIR_NAME, snapshots[0].fileName)
    )
    // And nothing else is left in the directory — no staging file, no sidecars.
    expect(readdirSync(snapshotDirFor(dbPath))).toEqual([snapshots[0].fileName])
  })

  it('leaves a snapshot that still holds the pre-migration schema and rows', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)

    const [snapshot] = listStoredSnapshots(dbPath)
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

  it('keeps a copy of every schema version it has snapshotted, not just the newest files', async () => {
    seedLegacyDb(dbPath)
    const conn = new Database(dbPath)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // The #286 crash-loop: the upgrade dies after committing part of itself,
      // so every launch after the first snapshots the half-migrated v26 file.
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)))
      await createPreMigrationSnapshot(conn, dbPath, 24, LATEST_SCHEMA_VERSION)
      conn.pragma('user_version = 26')
      for (let i = 0; i < SNAPSHOT_RETENTION; i++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 2 + i)))
        await createPreMigrationSnapshot(conn, dbPath, 26, LATEST_SCHEMA_VERSION)
      }
    } finally {
      conn.close()
      vi.useRealTimers()
    }

    const snapshots = listSnapshots(dbPath)
    expect(snapshots).toHaveLength(SNAPSHOT_RETENTION)
    // The v24 file is the only copy of the state before the upgrade started —
    // a purely chronological cut would have evicted it for a third v26 copy.
    expect(snapshots.map((s) => s.fromVersion).sort((a, b) => a - b)).toEqual([24, 26, 26])
    expect(snapshots.find((s) => s.fromVersion === 24)?.createdAt.slice(0, 10)).toBe('2026-01-01')
  })

  it('sweeps staging files an interrupted snapshot left behind', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)
    const snapshotDir = snapshotDirFor(dbPath)
    // What a crash or a power loss mid-backup leaves: a full-size copy of the
    // database under a name the listing is built not to match, plus whatever
    // sidecars the read-back probe had opened. Nothing counts them against
    // retention, so without a sweep they accumulate one per failed launch.
    const orphan = 'pre-migration-v24-to-v27-2026-01-01T00-00-00-000Z.db.partial'
    writeFileSync(join(snapshotDir, orphan), 'half a database')
    writeFileSync(join(snapshotDir, `${orphan}-wal`), 'half a wal')
    writeFileSync(join(snapshotDir, 'notes.partial'), 'not ours')

    const removed = pruneSnapshots(dbPath)

    expect(removed).toBe(2)
    expect(existsSync(join(snapshotDir, orphan))).toBe(false)
    expect(existsSync(join(snapshotDir, `${orphan}-wal`))).toBe(false)
    // Only files the snapshot writer could have produced. Anything else in
    // that directory is not this module's to delete.
    expect(existsSync(join(snapshotDir, 'notes.partial'))).toBe(true)
  })

  it('ignores a listed entry that cannot be read', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)
    // A snapshot name that resolves to nothing — the readdir/stat race, and
    // what a half-copied profile directory leaves behind. Listing it would put
    // an unrestorable entry in front of the operator.
    symlinkSync(
      join(dir, 'gone.db'),
      join(snapshotDirFor(dbPath), 'pre-migration-v1-to-v2-2026-01-01T00-00-00-000Z.db')
    )

    expect(listSnapshots(dbPath)).toHaveLength(1)
  })

  it('keeps the snapshot it just took when pruning the older ones fails', async () => {
    seedLegacyDb(dbPath)
    const conn = new Database(dbPath)
    const snapshotDir = snapshotDirFor(dbPath)
    mkdirSync(snapshotDir, { recursive: true })
    // A directory wearing a snapshot's name: it lists like a snapshot and is
    // the oldest, so retention picks it first — and deleting it fails.
    mkdirSync(join(snapshotDir, 'pre-migration-v24-to-v27-2026-01-01T00-00-00-000Z.db'))

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (let i = 0; i < SNAPSHOT_RETENTION; i++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 2 + i)))
        await createPreMigrationSnapshot(conn, dbPath, 24, LATEST_SCHEMA_VERSION)
      }
    } finally {
      conn.close()
      vi.useRealTimers()
    }

    // Pruning is housekeeping. The snapshot this migration depends on has
    // already been written and read back, so a failure tidying up behind it
    // must not fail the snapshot — or, through it, block the upgrade. The
    // undeletable entry is still listed, which is what says prune reached it.
    const snapshots = listSnapshots(dbPath)
    expect(snapshots).toHaveLength(SNAPSHOT_RETENTION + 1)
    expect(snapshots.at(-1)?.createdAt.slice(0, 10)).toBe('2026-01-01')
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

  it('re-migrates a restored older snapshot instead of leaving it on the old schema', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)
    const [snapshot] = listSnapshots(dbPath)
    closeDatabase()
    restoreSnapshotFile(dbPath, snapshot.fileName)

    await initDatabase(dbPath)

    // What the Settings copy and the tester guide now say: the records come
    // back, the schema does not. The restored v24 file is upgraded again on the
    // way in — and snapshotted again before that, because it is a real upgrade.
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(listSnapshots(dbPath).map((s) => s.fromVersion)).toEqual([24, 24])
  })

  it('keeps no copy of the database it replaced', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)
    getDb()
      .prepare(
        `INSERT INTO captures (id, case_id, url, title, hash, timestamp, created_at)
         VALUES ('cap2','case1','https://b.example','Beta','feed','2026-02-01','2026-02-01')`
      )
      .run()
    const [snapshot] = listSnapshots(dbPath)
    closeDatabase()

    restoreSnapshotFile(dbPath, snapshot.fileName)

    // The restore is irreversible and the confirm dialog says so. Nothing is
    // left beside the database under another name: earlier rounds of #413 kept
    // one, and the promise that came with it was wrong in five different
    // states. The retained snapshots are the safety net instead.
    expect(readdirSync(dir).sort()).toEqual(['birdbrain.db', 'db-snapshots'])
  })

  it('refuses to restore a snapshot that is not a readable database', async () => {
    seedLegacyDb(dbPath)
    await initDatabase(dbPath)
    const [snapshot] = listStoredSnapshots(dbPath)
    closeDatabase()
    // What a crash, a full disk or a bad sector during the copy leaves behind:
    // a file with a perfectly valid snapshot name that is not a database.
    truncateSync(snapshot.path, 24576)

    expect(() => restoreSnapshotFile(dbPath, snapshot.fileName)).toThrow()

    // The live database is untouched — the check runs before anything is
    // written, which is the only reason an unreadable snapshot is survivable.
    const raw = new Database(dbPath, { readonly: true })
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
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
