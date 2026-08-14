import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// A restore is two writes — delete the live database's sidecars, then copy the
// snapshot over it — and the ordering between them is the whole of its failure
// behaviour. A sidecar that cannot be deleted is the one filesystem fault that
// has to leave the live database intact, and no arrangement of real files
// provokes it deterministically on every platform. So the two calls the
// restore makes are wrapped: by default they pass straight through, and a test
// opts one path into failing by naming the file it acts on.
const fsHooks = vi.hoisted(() => ({
  failOn: null as null | ((op: 'copyFileSync' | 'rmSync', target: string) => boolean)
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    copyFileSync: (src: string, dest: string) => {
      if (fsHooks.failOn?.('copyFileSync', dest)) throw new Error('injected copyFileSync failure')
      return actual.copyFileSync(src, dest)
    },
    rmSync: (target: string, options?: Parameters<typeof actual.rmSync>[1]) => {
      if (fsHooks.failOn?.('rmSync', target)) throw new Error('injected rmSync failure')
      return actual.rmSync(target, options)
    }
  }
})

import { restoreSnapshotFile, snapshotDirFor } from '@main/services/db/dbSnapshots'

// A one-table database carrying a single marker row, so which file ended up
// where is readable rather than inferred from sizes or timestamps.
function writeDb(path: string, marker: string, userVersion: number): void {
  const db = new Database(path)
  try {
    db.exec(`CREATE TABLE marker (name TEXT)`)
    db.prepare(`INSERT INTO marker VALUES (?)`).run(marker)
    db.pragma(`user_version = ${userVersion}`)
  } finally {
    db.close()
  }
}

function markerOf(path: string): string {
  const db = new Database(path, { readonly: true })
  try {
    return (db.prepare(`SELECT name FROM marker`).get() as { name: string }).name
  } finally {
    db.close()
  }
}

describe('snapshot restore', () => {
  let dir: string
  let dbPath: string
  let snapshotName: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-restore-'))
    dbPath = join(dir, 'birdbrain.db')
    writeDb(dbPath, 'live', 27)

    snapshotName = 'pre-migration-v24-to-v27-2026-01-01T00-00-00-000Z.db'
    mkdirSync(snapshotDirFor(dbPath), { recursive: true })
    writeDb(join(snapshotDirFor(dbPath), snapshotName), 'snapshot', 24)
  })

  afterEach(() => {
    fsHooks.failOn = null
    rmSync(dir, { recursive: true, force: true })
  })

  it('overwrites the live database and keeps no copy of it', () => {
    restoreSnapshotFile(dbPath, snapshotName)

    expect(markerOf(dbPath)).toBe('snapshot')
    // The restore is irreversible, and this is what that means on disk: the
    // database it replaced is gone, not renamed aside under some other name.
    // The retained snapshots are the safety net, so nothing beside the
    // database survives the call.
    expect(readdirSync(dir).sort()).toEqual(['birdbrain.db', 'db-snapshots'])
  })

  it('removes the replaced database sidecars rather than leaving them to be replayed', () => {
    // What a crash leaves behind. The -wal holds pages of the database being
    // replaced, and SQLite would replay them over the restored file on the
    // next open — evidence from the wrong database, silently.
    writeFileSync(`${dbPath}-wal`, 'wal')
    writeFileSync(`${dbPath}-shm`, 'shm')

    restoreSnapshotFile(dbPath, snapshotName)

    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
    expect(markerOf(dbPath)).toBe('snapshot')
  })

  it('leaves the live database alone when a sidecar cannot be removed', () => {
    // The sidecars are deleted before the copy for exactly this reason: the
    // step that can fail without touching the database goes first, so the
    // operator is left with a working database and a failed restore rather
    // than a restored one carrying the previous database's WAL.
    writeFileSync(`${dbPath}-wal`, 'wal')
    fsHooks.failOn = (op, target) => op === 'rmSync' && target === `${dbPath}-wal`

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected rmSync failure')

    expect(markerOf(dbPath)).toBe('live')
    expect(existsSync(`${dbPath}-wal`)).toBe(true)
  })

  it('reports a copy that cannot be written rather than reporting success', () => {
    fsHooks.failOn = (op, target) => op === 'copyFileSync' && target === dbPath

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected copyFileSync failure')

    // Nothing was written at all here, but the guarantee this pins is narrower
    // than "the database survives": a copy that fails part-way leaves a
    // truncated file, which is why the restore is confirm-gated as
    // irreversible and the snapshot stays in the list to be restored again.
    expect(existsSync(join(snapshotDirFor(dbPath), snapshotName))).toBe(true)
  })
})
