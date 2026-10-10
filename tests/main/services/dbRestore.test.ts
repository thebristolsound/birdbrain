import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'

// The rename is the one step that touches the live database, and its failures
// (antivirus holding the file on Windows, a rename that leaves the target
// damaged) cannot be provoked with real files on Linux. So it is wrapped:
// by default it passes straight through, and a test opts in by supplying a
// fault for the target it acts on.
const fsHooks = vi.hoisted(() => ({
  renameFault: null as null | ((to: string) => Error | null),
  renameCalls: 0,
  statFault: null as null | ((path: string) => Error | null)
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      fsHooks.renameCalls++
      const fault = fsHooks.renameFault?.(to)
      if (fault) throw fault
      return actual.renameSync(from, to)
    },
    // A permission error on the picked file, which a root test runner cannot
    // provoke with modes.
    statSync: ((path: string, options?: { bigint?: boolean }) => {
      const fault = fsHooks.statFault?.(path)
      if (fault) throw fault
      return actual.statSync(path, options)
    }) as typeof actual.statSync
  }
})

// Likewise the re-open and the scratch migration, for the outcomes no real file
// produces once it has passed the checks.
const coreHooks = vi.hoisted(() => ({
  failInit: false,
  afterMigrate: null as null | ((path: string) => void)
}))

vi.mock('@main/services/db/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/db/core')>()
  return {
    ...actual,
    initDatabase: async (path: string) => {
      if (coreHooks.failInit) {
        coreHooks.failInit = false
        throw new Error('injected initDatabase failure')
      }
      return actual.initDatabase(path)
    },
    migrateFile: async (path: string) => {
      await actual.migrateFile(path)
      coreHooks.afterMigrate?.(path)
    }
  }
})

import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase, getCase } from '@main/services/db/caseRepo'
import { listStoredSnapshots, snapshotDirFor } from '@main/services/db/dbSnapshots'
import { restoreDatabase, scratchPathFor } from '@main/services/db/dbRestore'
import { logger } from '@main/services/logger'

let dir: string
let dbPath: string

function errno(code: string): Error {
  return Object.assign(new Error(`injected ${code}`), { code })
}

// A copy of the live database as it is now: a real Birdbrain schema.
async function backupTo(name: string): Promise<string> {
  const path = join(dir, name)
  await getDb().backup(path)
  return path
}

function setUserVersion(path: string, version: number): void {
  const conn = new Database(path)
  try {
    conn.pragma(`user_version = ${version}`)
  } finally {
    conn.close()
  }
}

// Anything at `birdbrain.db.<something>` is a second copy of the database:
// the staging folder, or something renamed aside. `-wal`/`-shm` belong to the
// open connection and are not counted.
function dottedSiblings(): string[] {
  return readdirSync(dir).filter((f) => f.startsWith('birdbrain.db.'))
}

// Three snapshots of the operator's own database, already in the live folder:
// a full retention set, so one more snapshot there would evict the oldest.
const SEEDED_SNAPSHOTS = [
  'pre-migration-v30-to-v37-2026-03-01T00-00-00-000Z.db',
  'pre-migration-v30-to-v37-2026-02-01T00-00-00-000Z.db',
  'pre-migration-v30-to-v37-2026-01-01T00-00-00-000Z.db'
]

function seedSnapshots(): void {
  const snapshots = snapshotDirFor(dbPath)
  mkdirSync(snapshots, { recursive: true })
  for (const name of SEEDED_SNAPSHOTS) writeFileSync(join(snapshots, name), 'a snapshot')
}

function snapshotNames(): string[] {
  return listStoredSnapshots(dbPath).map(({ fileName }) => fileName)
}

async function olderBackup(): Promise<string> {
  const older = await backupTo('older.db')
  setUserVersion(older, LATEST_SCHEMA_VERSION - 1)
  return older
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bb-file-restore-'))
  dbPath = join(dir, 'birdbrain.db')
  await initDatabase(dbPath)
})

afterEach(() => {
  fsHooks.renameFault = null
  fsHooks.renameCalls = 0
  fsHooks.statFault = null
  coreHooks.failInit = false
  coreHooks.afterMigrate = null
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('restoreDatabase from a file', () => {
  it('replaces the live database with the chosen backup and re-opens it', async () => {
    const before = createCase({ name: 'Before the backup' })
    const backup = await backupTo('backup.db')
    const after = createCase({ name: 'After the backup' })

    const outcome = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

    expect(outcome).toEqual({ status: 'restored' })
    expect(getCase(before.id)).toMatchObject({ name: 'Before the backup' })
    expect(getCase(after.id)).toBeUndefined()
    expect(dottedSiblings()).toEqual([])
    // The chosen file itself is left where it was.
    expect(existsSync(backup)).toBe(true)
  })

  it("brings across rows that exist only in the chosen copy's -wal", async () => {
    const source = await backupTo('source.db')
    const writer = new Database(source)
    let walOnly: string
    try {
      writer.pragma('journal_mode = WAL')
      writer.pragma('wal_autocheckpoint = 0')
      walOnly = 'case-in-the-wal'
      writer
        .prepare(
          `INSERT INTO cases (id, name, description, created_at, updated_at)
           VALUES (?, 'Only in the WAL', '', '2026-10-09T00:00:00Z', '2026-10-09T00:00:00Z')`
        )
        .run(walOnly)
      // Copied while the writer is still open, so the rows have not been
      // checkpointed into the main file.
      copyFileSync(source, join(dir, 'copy.db'))
      copyFileSync(`${source}-wal`, join(dir, 'copy.db-wal'))
    } finally {
      writer.close()
    }
    const copy = join(dir, 'copy.db')

    const outcome = await restoreDatabase({ kind: 'file', path: copy }, { dbPath })

    expect(outcome).toEqual({ status: 'restored' })
    expect(getCase(walOnly)).toMatchObject({ name: 'Only in the WAL' })
    // The read of the copy created its -shm and removed it again; the -wal
    // was there before and is left alone.
    expect(existsSync(`${copy}-shm`)).toBe(false)
    expect(existsSync(`${copy}-wal`)).toBe(true)
  })

  it('migrates an older backup before installing it, snapshotting it first', async () => {
    const kept = createCase({ name: 'In the older backup' })
    const older = await backupTo('older.db')
    setUserVersion(older, LATEST_SCHEMA_VERSION - 1)

    const outcome = await restoreDatabase({ kind: 'file', path: older }, { dbPath })

    expect(outcome).toEqual({ status: 'restored' })
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(getCase(kept.id)).toMatchObject({ name: 'In the older backup' })
    expect(listStoredSnapshots(dbPath)).toEqual([
      expect.objectContaining({
        fromVersion: LATEST_SCHEMA_VERSION - 1,
        toVersion: LATEST_SCHEMA_VERSION
      })
    ])
    expect(dottedSiblings()).toEqual([])
  })

  it('refuses a copy whose migration fails, keeping the live database open', async () => {
    const kept = createCase({ name: 'Kept' })
    seedSnapshots()
    // Reports schema v26, so the v27 block runs against it, and it has no
    // notes table for that block to alter.
    const broken = join(dir, 'broken.db')
    const conn = new Database(broken)
    try {
      conn.exec('CREATE TABLE cases (id TEXT PRIMARY KEY)')
      conn.pragma('user_version = 26')
    } finally {
      conn.close()
    }

    const outcome = await restoreDatabase({ kind: 'file', path: broken }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'migration_failed' })
    expect(getCase(kept.id)).toMatchObject({ name: 'Kept' })
    expect(dottedSiblings()).toEqual([])
    // The snapshot taken of the refused copy before its migration is not
    // listed for restore, and no snapshot of the operator's was pruned for it.
    expect(snapshotNames()).toEqual(SEEDED_SNAPSHOTS)
  })

  it("adds the restored file's snapshot to the live list, keeping the usual number", async () => {
    seedSnapshots()
    const older = await olderBackup()

    const outcome = await restoreDatabase({ kind: 'file', path: older }, { dbPath })

    expect(outcome).toEqual({ status: 'restored' })
    const [newest, ...rest] = listStoredSnapshots(dbPath)
    expect(newest).toMatchObject({ fromVersion: LATEST_SCHEMA_VERSION - 1 })
    expect(rest.map(({ fileName }) => fileName)).toEqual(SEEDED_SNAPSHOTS.slice(0, 2))
    expect(dottedSiblings()).toEqual([])
  })

  it('keeps the restore when its snapshot cannot be moved into the live list', async () => {
    const warn = vi.spyOn(logger, 'warn')
    const older = await olderBackup()
    fsHooks.renameFault = (to) => (to.startsWith(snapshotDirFor(dbPath)) ? errno('EIO') : null)

    const outcome = await restoreDatabase({ kind: 'file', path: older }, { dbPath })

    expect(outcome).toEqual({ status: 'restored' })
    expectOpen()
    expect(snapshotNames()).toEqual([])
    expect(warn.mock.calls.map(([, code]) => code)).toEqual(['db.restore_snapshot_move_failed'])
    expect(dottedSiblings()).toEqual([])
  })

  it('keeps the restore when pruning the live list fails', async () => {
    const warn = vi.spyOn(logger, 'warn')
    seedSnapshots()
    // The snapshot retention evicts, made a folder so removing it throws.
    const oldest = join(snapshotDirFor(dbPath), SEEDED_SNAPSHOTS[2])
    rmSync(oldest)
    mkdirSync(oldest)

    const outcome = await restoreDatabase({ kind: 'file', path: await olderBackup() }, { dbPath })

    expect(outcome).toEqual({ status: 'restored' })
    expectOpen()
    expect(warn.mock.calls.map(([, code]) => code)).toEqual(['db.snapshot_prune_failed'])
  })

  it('reports a picked file it cannot read as not copied, not as missing', async () => {
    const backup = await backupTo('backup.db')
    fsHooks.statFault = (path) => (path === backup ? errno('EACCES') : null)

    const outcome = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'copy_failed' })
  })

  it('logs the cause of a refusal, naming the reason when there is no error behind it', async () => {
    const warn = vi.spyOn(logger, 'warn')
    const notDb = join(dir, 'notes.db')
    writeFileSync(notDb, 'Meeting notes, not a database.\n'.repeat(200))
    const newer = await backupTo('newer.db')
    setUserVersion(newer, LATEST_SCHEMA_VERSION + 1)

    expect(await restoreDatabase({ kind: 'file', path: notDb }, { dbPath })).toEqual({
      status: 'rejected',
      reason: 'not_a_database'
    })
    expect(await restoreDatabase({ kind: 'file', path: newer }, { dbPath })).toEqual({
      status: 'rejected',
      reason: 'newer_schema'
    })

    expect(
      warn.mock.calls.map(([, code, , err]) => [code, (err as { code?: string }).code])
    ).toEqual([
      ['db.restore_rejected', 'SQLITE_NOTADB'],
      ['db.restore_rejected', 'RESTORE_NEWER_SCHEMA']
    ])
  })

  it('refuses a truncated database as not a database', async () => {
    const kept = createCase({ name: 'Kept' })
    const truncated = await backupTo('truncated.db')
    truncateSync(truncated, Math.floor(statSync(truncated).size / 2))

    const outcome = await restoreDatabase({ kind: 'file', path: truncated }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'not_a_database' })
    expect(getCase(kept.id)).toMatchObject({ name: 'Kept' })
    expect(dottedSiblings()).toEqual([])
  })

  it('refuses a database whose schema page is corrupt, which only the check on the copy reads', async () => {
    const corrupt = await backupTo('corrupt.db')
    // Byte 100 is the page type of the schema table's root page. The header
    // before it stays valid, so the copy goes through page by page.
    const fd = openSync(corrupt, 'r+')
    try {
      writeSync(fd, Buffer.from([0xff]), 0, 1, 100)
    } finally {
      closeSync(fd)
    }

    const outcome = await restoreDatabase({ kind: 'file', path: corrupt }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'not_a_database' })
    expect(dottedSiblings()).toEqual([])
  })

  it('refuses the live database reached through a symlink', async () => {
    const kept = createCase({ name: 'Kept' })
    const link = join(dir, 'link.db')
    symlinkSync(dbPath, link)

    const outcome = await restoreDatabase({ kind: 'file', path: link }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'same_file' })
    expect(getCase(kept.id)).toMatchObject({ name: 'Kept' })
  })

  it('refuses a directory as not a database', async () => {
    const folder = join(dir, 'folder.db')
    mkdirSync(folder)

    const outcome = await restoreDatabase({ kind: 'file', path: folder }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'not_a_database' })
  })

  it('refuses the scratch file itself without deleting it', async () => {
    const scratch = scratchPathFor(dbPath)
    mkdirSync(dirname(scratch))
    copyFileSync(await backupTo('backup.db'), scratch)

    const outcome = await restoreDatabase({ kind: 'file', path: scratch }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'same_file' })
    expect(existsSync(scratch)).toBe(true)
  })

  it('refuses a file in the staging folder reached through a symlink', async () => {
    const staged = join(dirname(scratchPathFor(dbPath)), 'db-snapshots', 'staged.db')
    mkdirSync(dirname(staged), { recursive: true })
    copyFileSync(await backupTo('backup.db'), staged)
    const link = join(dir, 'link.db')
    symlinkSync(staged, link)

    const outcome = await restoreDatabase({ kind: 'file', path: link }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'same_file' })
    expect(existsSync(staged)).toBe(true)
  })

  it('refuses a second restore while one is running, and accepts one afterwards', async () => {
    const backup = await backupTo('backup.db')

    const first = restoreDatabase({ kind: 'file', path: backup }, { dbPath })
    const second = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

    expect(second).toEqual({ status: 'rejected', reason: 'in_progress' })
    expect(await first).toEqual({ status: 'restored' })
    expect(await restoreDatabase({ kind: 'file', path: backup }, { dbPath })).toEqual({
      status: 'restored'
    })
  })

  it('refuses a chosen file another program holds locked', async () => {
    const backup = await backupTo('locked.db')
    const holder = new Database(backup)
    // A rollback journal: in WAL mode a writer does not block readers.
    holder.pragma('journal_mode = DELETE')
    try {
      holder.exec('BEGIN EXCLUSIVE')
      holder.prepare(`UPDATE cases SET name = name`).run()

      const outcome = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

      expect(outcome).toEqual({ status: 'rejected', reason: 'source_busy' })
    } finally {
      holder.exec('ROLLBACK')
      holder.close()
    }
    expect(dottedSiblings()).toEqual([])
  })

  it('stops a copy whose source is locked part-way through, rather than waiting on it', async () => {
    const backup = await backupTo('locked-later.db')
    const holder = new Database(backup)
    holder.pragma('journal_mode = DELETE')
    // Takes the lock after the copy's first step, which is the point where
    // `backup()` stops failing and starts retrying.
    const original = Database.prototype.backup
    vi.spyOn(Database.prototype, 'backup').mockImplementation(function (
      this: Database.Database,
      file: string,
      options?: Database.BackupOptions
    ) {
      let locked = false
      return original.call(this, file, {
        progress: (info) => {
          if (!locked) {
            locked = true
            holder.exec('BEGIN EXCLUSIVE')
            holder.prepare(`UPDATE cases SET name = name`).run()
          }
          return options?.progress(info) ?? 100
        }
      })
    })
    try {
      const outcome = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

      expect(outcome).toEqual({ status: 'rejected', reason: 'source_busy' })
    } finally {
      holder.exec('ROLLBACK')
      holder.close()
    }
    expect(dottedSiblings()).toEqual([])
  })

  it('refuses when the scratch copy cannot be written', async () => {
    const kept = createCase({ name: 'Kept' })
    const backup = await backupTo('backup.db')
    vi.spyOn(Database.prototype, 'backup').mockRejectedValue(errno('ENOSPC'))

    const outcome = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'copy_failed' })
    expect(getCase(kept.id)).toMatchObject({ name: 'Kept' })
  })

  it('refuses a migrated copy that still has a WAL sidecar beside it', async () => {
    const backup = await backupTo('backup.db')
    coreHooks.afterMigrate = (path) => writeFileSync(`${path}-wal`, 'pages the rename would drop')

    const outcome = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

    expect(outcome).toEqual({ status: 'rejected', reason: 'copy_failed' })
    expect(dottedSiblings()).toEqual([])
  })

  it('refuses when another connection starts reading while the copy is prepared', async () => {
    const backup = await backupTo('backup.db')
    // Not waited on: the app's five-second busy timeout would only delay the refusal.
    getDb().pragma('busy_timeout = 0')
    const reader = new Database(dbPath, { readonly: true })
    try {
      const pending = restoreDatabase({ kind: 'file', path: backup }, { dbPath })
      // The restore is now copying, with the live database open: a write lands
      // in its WAL and a reader holds that WAL in place.
      const kept = createCase({ name: 'Written during the copy' })
      reader.exec('BEGIN')
      reader.prepare('SELECT COUNT(*) FROM cases').get()

      expect(await pending).toEqual({ status: 'rejected', reason: 'in_use' })
      expect(getCase(kept.id)).toMatchObject({ name: 'Written during the copy' })
    } finally {
      reader.exec('COMMIT')
      reader.close()
    }
    expect(dottedSiblings()).toEqual([])
  })

  it('retries a rename refused with EPERM and installs the copy once it goes through', async () => {
    const backup = await backupTo('backup.db')
    const after = createCase({ name: 'After the backup' })
    let refusals = 2
    fsHooks.renameFault = (to) => (to === dbPath && refusals-- > 0 ? errno('EPERM') : null)

    const outcome = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

    expect(outcome).toEqual({ status: 'restored' })
    expect(fsHooks.renameCalls).toBe(3)
    expect(getCase(after.id)).toBeUndefined()
  })

  it('keeps the previous database open and readable when the rename keeps failing', async () => {
    const kept = createCase({ name: 'Kept' })
    const backup = await backupTo('backup.db')
    fsHooks.renameFault = (to) => (to === dbPath ? errno('EPERM') : null)

    const pending = restoreDatabase({ kind: 'file', path: backup }, { dbPath })
    // Written while the copy is prepared, so it is still in the live WAL when
    // the restore deletes the sidecars ahead of the rename.
    const during = createCase({ name: 'Written during the copy' })
    const outcome = await pending

    expect(outcome).toEqual({ status: 'replace_failed', databaseIntact: true })
    expect(fsHooks.renameCalls).toBe(5)
    expect(getCase(kept.id)).toMatchObject({ name: 'Kept' })
    expect(getCase(during.id)).toMatchObject({ name: 'Written during the copy' })
    expect(dottedSiblings()).toEqual([])
  })

  it('leaves a damaged database unopened, and a restore can follow without a restart', async () => {
    const backup = await backupTo('backup.db')
    // A rename that fails having left the target unreadable. Not retried: the
    // code is not one antivirus raises.
    fsHooks.renameFault = (to) => {
      if (to !== dbPath) return null
      truncateSync(dbPath, 0)
      return errno('EIO')
    }

    const outcome = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

    expect(outcome).toEqual({ status: 'replace_failed', databaseIntact: false })
    expect(fsHooks.renameCalls).toBe(1)
    // Not migrated forward into a fresh, empty schema.
    expect(statSync(dbPath).size).toBe(0)
    expect(() => getDb()).toThrow('Database not initialized')
    expect(dottedSiblings()).toEqual([])

    // What the failure message tells the operator to do instead of restarting.
    fsHooks.renameFault = null
    expect(await restoreDatabase({ kind: 'file', path: backup }, { dbPath })).toEqual({
      status: 'restored'
    })
    expectOpen()
  })

  it('reports a failed re-open after the copy was installed', async () => {
    const backup = await backupTo('backup.db')
    coreHooks.failInit = true

    const outcome = await restoreDatabase({ kind: 'file', path: backup }, { dbPath })

    expect(outcome).toEqual({ status: 'reopen_failed' })
    expect(() => getDb()).toThrow('Database not initialized')
  })
})

function expectOpen(): void {
  expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
}
