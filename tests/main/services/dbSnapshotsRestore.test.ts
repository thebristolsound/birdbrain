import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// A restore is three writes — stage the snapshot beside the live database,
// delete that database's sidecars, then rename the staged copy over it — and
// the ordering between them is the whole of its failure behaviour. The faults
// that matter (a copy that dies part-way, a sidecar that cannot be deleted, a
// rename that fails) are not provokable deterministically with real files on
// every platform. So the calls the restore makes are wrapped: by default they
// pass straight through, and a test opts one path into failing by naming the
// file it acts on. `onFailedCopy` models the destination a real interrupted
// copy leaves behind, since `copyFileSync` truncates before it writes.
const fsHooks = vi.hoisted(() => ({
  failOn: null as
    null | ((op: 'copyFileSync' | 'renameSync' | 'rmSync', target: string) => boolean),
  onFailedCopy: null as null | ((dest: string) => void)
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    copyFileSync: (src: string, dest: string) => {
      if (fsHooks.failOn?.('copyFileSync', dest)) {
        fsHooks.onFailedCopy?.(dest)
        throw new Error('injected copyFileSync failure')
      }
      return actual.copyFileSync(src, dest)
    },
    renameSync: (from: string, to: string) => {
      if (fsHooks.failOn?.('renameSync', to)) throw new Error('injected renameSync failure')
      return actual.renameSync(from, to)
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
    fsHooks.onFailedCopy = null
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
    // The sidecars are deleted before the rename for exactly this reason: every
    // step that can fail happens while the database is still whole, so the
    // operator is left with a working database and a failed restore rather
    // than a restored one carrying the previous database's WAL.
    writeFileSync(`${dbPath}-wal`, 'wal')
    fsHooks.failOn = (op, target) => op === 'rmSync' && target === `${dbPath}-wal`

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected rmSync failure')

    expect(markerOf(dbPath)).toBe('live')
    expect(existsSync(`${dbPath}-wal`)).toBe(true)
    // And the staging copy taken before this step is cleaned up rather than
    // left beside the database as a second copy of it. Filtered rather than
    // listed whole: reading the marker above opens the database, and a
    // WAL-mode open leaves a -shm behind that has nothing to do with this.
    expect(readdirSync(dir).filter((f) => f.endsWith('.partial'))).toEqual([])
  })

  it('reports a copy that cannot be written rather than reporting success', () => {
    fsHooks.failOn = (op, target) => op === 'copyFileSync' && target.startsWith(dbPath)

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected copyFileSync failure')

    // The copy is staged beside the database and renamed over it, so a copy
    // that cannot be written never reaches the database at all.
    expect(markerOf(dbPath)).toBe('live')
    expect(existsSync(join(snapshotDirFor(dbPath), snapshotName))).toBe(true)
    // And it left nothing behind: no staging file beside the database, which
    // would otherwise be a second full-size copy nothing ever removes.
    expect(readdirSync(dir).sort()).toEqual(['birdbrain.db', 'db-snapshots'])
  })

  it('leaves the previous database whole when the copy dies part-way through', () => {
    // The #428 shape, and the reason the copy is staged: `copyFileSync`
    // truncates its destination before the first page lands, so a copy that
    // dies part-way leaves a zero-length file — which SQLite opens as a brand
    // new empty database rather than refusing. Written straight onto the
    // database that is exactly the empty-database outcome; written to a
    // staging file it is a discarded remnant.
    fsHooks.failOn = (op, target) => op === 'copyFileSync' && target.startsWith(dbPath)
    fsHooks.onFailedCopy = (dest) => writeFileSync(dest, '')

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected copyFileSync failure')

    expect(statSync(dbPath).size).toBeGreaterThan(0)
    expect(markerOf(dbPath)).toBe('live')
    expect(readdirSync(dir).sort()).toEqual(['birdbrain.db', 'db-snapshots'])
  })

  it('leaves the previous database in place when the staged copy cannot be renamed over it', () => {
    fsHooks.failOn = (op, target) => op === 'renameSync' && target === dbPath

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected renameSync failure')

    // The rename is the only step that replaces the database, and it either
    // happens or it does not: there is no half-renamed file.
    expect(markerOf(dbPath)).toBe('live')
    expect(existsSync(join(snapshotDirFor(dbPath), snapshotName))).toBe(true)
    expect(readdirSync(dir).sort()).toEqual(['birdbrain.db', 'db-snapshots'])
  })
})
