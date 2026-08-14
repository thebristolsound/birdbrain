import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// The failure modes this file is about — a copy that cannot be written, a
// rename that fails half-way through the swap, a rollback that fails too —
// are all filesystem faults that no arrangement of real files can provoke
// deterministically on every platform. So the three calls restoreSnapshotFile
// makes are wrapped: by default they pass straight through, and a test opts
// one path into failing by naming the file it acts on.
const fsHooks = vi.hoisted(() => ({
  failOn: null as null | ((op: 'copyFileSync' | 'renameSync' | 'rmSync', target: string) => boolean)
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    copyFileSync: (src: string, dest: string) => {
      if (fsHooks.failOn?.('copyFileSync', dest)) throw new Error('injected copyFileSync failure')
      return actual.copyFileSync(src, dest)
    },
    renameSync: (from: string, to: string) => {
      if (fsHooks.failOn?.('renameSync', from)) throw new Error('injected renameSync failure')
      return actual.renameSync(from, to)
    },
    rmSync: (target: string, options?: Parameters<typeof actual.rmSync>[1]) => {
      if (fsHooks.failOn?.('rmSync', target)) throw new Error('injected rmSync failure')
      return actual.rmSync(target, options)
    }
  }
})

import {
  RestoreRollbackError,
  restoreSnapshotFile,
  snapshotDirFor
} from '@main/services/db/dbSnapshots'

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

describe('snapshot restore failure paths', () => {
  let dir: string
  let dbPath: string
  let aside: string
  let staged: string
  let snapshotName: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-restore-fail-'))
    dbPath = join(dir, 'birdbrain.db')
    aside = `${dbPath}.pre-restore`
    staged = `${dbPath}.partial`
    writeDb(dbPath, 'live', 27)

    snapshotName = 'pre-migration-v24-to-v27-2026-01-01T00-00-00-000Z.db'
    mkdirSync(snapshotDirFor(dbPath), { recursive: true })
    writeDb(join(snapshotDirFor(dbPath), snapshotName), 'snapshot', 24)
  })

  afterEach(() => {
    fsHooks.failOn = null
    rmSync(dir, { recursive: true, force: true })
  })

  it('leaves nothing staged when the snapshot cannot be copied', () => {
    fsHooks.failOn = (op, target) => op === 'copyFileSync' && target === staged

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected copyFileSync failure')

    // Nothing was touched: the copy is the first write, and its own staging
    // file is cleaned up rather than left as a full-size orphan.
    expect(markerOf(dbPath)).toBe('live')
    expect(existsSync(staged)).toBe(false)
    expect(existsSync(aside)).toBe(false)
  })

  it('rolls back without spending the previous pre-restore generation', () => {
    // The operator has restored before, so `.pre-restore` already holds the
    // database that restore replaced — for them, the only copy of that state.
    writeDb(aside, 'older', 27)
    fsHooks.failOn = (op, target) => op === 'renameSync' && target === staged

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected renameSync failure')

    // The live database is back, and the earlier generation survived a restore
    // that never committed. Deleting it up front would have spent it for a
    // restore that changed nothing.
    expect(markerOf(dbPath)).toBe('live')
    expect(markerOf(aside)).toBe('older')
    expect(existsSync(staged)).toBe(false)
    expect(readdirSync(dir).filter((f) => f.endsWith('.superseded'))).toEqual([])
  })

  it('names the file holding the data when the rollback cannot put the database back', () => {
    // The swap fails and so does the move back, which is the state the caller
    // must not re-open into: there is no file where the database belongs.
    fsHooks.failOn = (op, target) => op === 'renameSync' && (target === staged || target === aside)

    let thrown: unknown
    try {
      restoreSnapshotFile(dbPath, snapshotName)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(RestoreRollbackError)
    const { message } = thrown as Error
    expect(message).toContain('birdbrain.db.pre-restore')
    // By name only — the message reaches the renderer, and the directory it
    // sits in is the operator's profile path.
    expect(message).not.toContain(dir)
    expect((thrown as Error).cause).toBeInstanceOf(Error)

    expect(existsSync(dbPath)).toBe(false)
    expect(markerOf(aside)).toBe('live')
  })

  it('drops the superseded generation only once the restore has committed', () => {
    writeDb(aside, 'older', 27)

    restoreSnapshotFile(dbPath, snapshotName)

    expect(markerOf(dbPath)).toBe('snapshot')
    // One generation: the database this restore replaced, not the one before it.
    expect(markerOf(aside)).toBe('live')
    expect(readdirSync(dir).filter((f) => f.endsWith('.superseded'))).toEqual([])
  })

  it('still reports success when the superseded generation cannot be deleted', () => {
    writeDb(aside, 'older', 27)
    // Only the deletion that follows a committed restore: the same suffix is
    // swept before the move, when the file does not exist yet.
    fsHooks.failOn = (op, target) =>
      op === 'rmSync' && target.endsWith('.superseded') && existsSync(target)

    // Disk, not data: the restore the operator asked for has already happened,
    // so failing to tidy up behind it must not be reported as a failed restore.
    expect(() => restoreSnapshotFile(dbPath, snapshotName)).not.toThrow()

    expect(markerOf(dbPath)).toBe('snapshot')
    expect(markerOf(aside)).toBe('live')
    expect(markerOf(`${aside}.superseded`)).toBe('older')
  })
})
