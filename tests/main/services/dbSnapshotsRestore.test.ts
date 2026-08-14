import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
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

  it('puts the database back even when a sidecar cannot be', () => {
    // A crash leaves -wal/-shm beside the database, and the -shm is the
    // memory-mapped one — the likeliest of the three to be held open by an
    // indexer or scanner. Here the swap fails and so does the rollback's own
    // -shm rename.
    writeDb(aside, 'older', 27)
    writeFileSync(`${dbPath}-wal`, 'wal')
    writeFileSync(`${dbPath}-shm`, 'shm')
    fsHooks.failOn = (op, target) =>
      op === 'renameSync' && (target === staged || target === `${aside}-shm`)

    // An ordinary restore failure, not the rollback failure: a lock on the
    // file that matters least must not decide whether the database comes back.
    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected renameSync failure')

    // Read before anything opens a database: opening one creates -wal/-shm
    // beside it, which would mask where the rollback left them.
    // The -shm is stranded, which costs nothing — SQLite rebuilds it from the
    // WAL on the next open — while the two that matter are back.
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
    expect(existsSync(`${aside}-shm`)).toBe(true)
    expect(readFileSync(`${dbPath}-wal`, 'utf8')).toBe('wal')
    expect(existsSync(staged)).toBe(false)
    expect(readdirSync(dir).filter((f) => f.endsWith('.superseded'))).toEqual([])

    expect(markerOf(dbPath)).toBe('live')
    // The earlier generation came back too: it is undone separately, so the
    // sidecar that could not be moved does not cost the operator that copy.
    expect(markerOf(aside)).toBe('older')
  })

  it('keeps the earlier generation when there is no live database to replace', () => {
    // The state a failed rollback leaves behind: no file where the database
    // belongs, the operator's database beside it as `.pre-restore`. Restore is
    // the button that just failed, so clicking it again is the likely next
    // move — and this restore replaces nothing, so it has no new generation to
    // put in that file's place. Dropping it here would leave the operator with
    // only the snapshot.
    rmSync(dbPath, { force: true })
    writeDb(aside, 'live', 27)

    restoreSnapshotFile(dbPath, snapshotName)

    expect(markerOf(dbPath)).toBe('snapshot')
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

  it('does not put the earlier generation back over a database it could not move back', () => {
    // The two undos meeting: the operator has restored before, so `.pre-restore`
    // holds an earlier generation, and this restore's rollback cannot get the
    // live database out of `.pre-restore` again. Renaming the earlier
    // generation onto that name would destroy the live database the error is
    // about to send the operator to.
    writeDb(aside, 'older', 27)
    let asideMoves = 0
    fsHooks.failOn = (op, target) => {
      if (op !== 'renameSync') return false
      if (target === staged) return true
      // The first move out of that name is the supersede; the second is the
      // rollback trying to take the live database back, which is the one that
      // fails and leaves it there.
      if (target === aside) return ++asideMoves > 1
      return false
    }

    let thrown: unknown
    try {
      restoreSnapshotFile(dbPath, snapshotName)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(RestoreRollbackError)
    expect((thrown as Error).message).toContain('birdbrain.db.pre-restore')
    expect(existsSync(dbPath)).toBe(false)
    // The name the operator is told to rename back holds their live database,
    // and the earlier generation waits under `.superseded` rather than taking
    // that name. The next restore sweeps it: one generation, the newer one.
    expect(markerOf(aside)).toBe('live')
    expect(markerOf(`${aside}.superseded`)).toBe('older')
  })

  it('leaves an earlier generation sidecar aside rather than beside the wrong database', () => {
    // The rollback returns the database and its WAL but not the -shm, so the
    // `.pre-restore` name is free for the earlier generation while
    // `.pre-restore-shm` is not. Only the file that is in the way stays put.
    writeDb(aside, 'older', 27)
    writeFileSync(`${dbPath}-shm`, 'live-shm')
    writeFileSync(`${aside}-shm`, 'older-shm')
    let asideShmMoves = 0
    fsHooks.failOn = (op, target) => {
      if (op !== 'renameSync') return false
      if (target === staged) return true
      // The first move out of that name is the supersede; the second is the
      // rollback putting the live -shm back, which is the one that fails.
      if (target === `${aside}-shm`) return ++asideShmMoves > 1
      return false
    }

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected renameSync failure')

    expect(existsSync(`${dbPath}-shm`)).toBe(false)
    expect(readFileSync(`${aside}-shm`, 'utf8')).toBe('live-shm')
    // SQLite rebuilds an -shm from the WAL, so the earlier generation's copy is
    // worth nothing and is not worth overwriting the live one to place.
    expect(readFileSync(`${aside}-shm.superseded`, 'utf8')).toBe('older-shm')
    expect(existsSync(staged)).toBe(false)
    expect(markerOf(dbPath)).toBe('live')
    expect(markerOf(aside)).toBe('older')
  })

  it('does not report a rollback failure when there was no database anywhere to lose', () => {
    // Nothing at `dbPath` and nothing beside it: the restore failed, but there
    // is no copy of anything to send the operator to, and the caller re-opening
    // into a fresh database is the right outcome rather than the dangerous one.
    rmSync(dbPath, { force: true })
    fsHooks.failOn = (op, target) => op === 'renameSync' && target === staged

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected renameSync failure')

    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(aside)).toBe(false)
    expect(existsSync(staged)).toBe(false)
  })

  it('reports a rollback failure when a retry fails and the database is still aside', () => {
    // The second click after a failed rollback, failing in turn. This restore
    // moved no database aside — the earlier failure did — so there is still no
    // file where the database belongs and the caller still must not re-open.
    rmSync(dbPath, { force: true })
    writeDb(aside, 'live', 27)
    fsHooks.failOn = (op, target) => op === 'renameSync' && target === staged

    let thrown: unknown
    try {
      restoreSnapshotFile(dbPath, snapshotName)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(RestoreRollbackError)
    expect((thrown as Error).message).toContain('birdbrain.db.pre-restore')
    expect(existsSync(dbPath)).toBe(false)
    expect(markerOf(aside)).toBe('live')
    expect(readdirSync(dir).filter((f) => f.endsWith('.superseded'))).toEqual([])
  })

  it('reports a rollback failure when the copy fails and the database is still aside', () => {
    // Same state, failing at the first write instead of the swap: which step
    // failed does not change what the caller may do next.
    rmSync(dbPath, { force: true })
    writeDb(aside, 'live', 27)
    fsHooks.failOn = (op, target) => op === 'copyFileSync' && target === staged

    let thrown: unknown
    try {
      restoreSnapshotFile(dbPath, snapshotName)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(RestoreRollbackError)
    expect((thrown as Error).cause).toBeInstanceOf(Error)
    expect(existsSync(staged)).toBe(false)
    expect(markerOf(aside)).toBe('live')
  })

  it('touches nothing when the earlier generation cannot be moved out of the way', () => {
    // The supersede is the first move of the swap, so its failure is the
    // cheapest one: the live database has not been touched yet.
    writeDb(aside, 'older', 27)
    fsHooks.failOn = (op, target) => op === 'renameSync' && target === aside

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected renameSync failure')

    expect(markerOf(dbPath)).toBe('live')
    expect(markerOf(aside)).toBe('older')
    expect(existsSync(staged)).toBe(false)
    expect(readdirSync(dir).filter((f) => f.endsWith('.superseded'))).toEqual([])
  })

  it('reports the failure that started the rollback when the earlier generation is stuck', () => {
    // The undo that fails is the earlier generation's, not the database's. The
    // database is back where it belongs, so this is an ordinary failed restore
    // — the earlier generation waits under `.superseded` and the operator is
    // told what actually went wrong, not what went wrong undoing it.
    writeDb(aside, 'older', 27)
    fsHooks.failOn = (op, target) =>
      op === 'renameSync' && (target === staged || target === `${aside}.superseded`)

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected renameSync failure')

    expect(markerOf(dbPath)).toBe('live')
    expect(existsSync(aside)).toBe(false)
    expect(markerOf(`${aside}.superseded`)).toBe('older')
    expect(existsSync(staged)).toBe(false)
  })

  it('names the superseded file when that is where the only database ended up', () => {
    // A retry after a failed rollback, whose own rollback cannot put the
    // database back under `.pre-restore` either. It is still on disk, under a
    // name nothing in the app mentions — and the next restore sweeps that name,
    // so an operator who is not told about it loses the database to a click.
    rmSync(dbPath, { force: true })
    writeDb(aside, 'live', 27)
    fsHooks.failOn = (op, target) =>
      op === 'renameSync' && (target === staged || target === `${aside}.superseded`)

    let thrown: unknown
    try {
      restoreSnapshotFile(dbPath, snapshotName)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(RestoreRollbackError)
    expect((thrown as Error).message).toContain('birdbrain.db.pre-restore.superseded')
    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(aside)).toBe(false)
    expect(markerOf(`${aside}.superseded`)).toBe('live')
  })

  it('still puts the database back when the staging file cannot be cleaned up', () => {
    // The staging copy is the last thing the rollback does and the least of
    // them: failing to delete it costs disk, so it must not stop the database
    // going back or change what is reported.
    fsHooks.failOn = (op, target) => target === staged && (op === 'renameSync' || op === 'rmSync')

    expect(() => restoreSnapshotFile(dbPath, snapshotName)).toThrow('injected renameSync failure')

    expect(markerOf(dbPath)).toBe('live')
    expect(existsSync(aside)).toBe(false)
    expect(existsSync(staged)).toBe(true)
  })
})
