import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'

// The snapshot restore's sidecar checks, which no real file provokes on every
// platform: by default these pass straight through, and a test opts a path in.
const fsHooks = vi.hoisted(() => ({
  exists: null as null | ((path: string) => boolean | undefined),
  rmFails: null as null | ((path: string) => boolean)
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (path: string) => fsHooks.exists?.(path) ?? actual.existsSync(path),
    rmSync: (target: string, options?: Parameters<typeof actual.rmSync>[1]) => {
      if (fsHooks.rmFails?.(target)) throw new Error('injected rmSync failure')
      return actual.rmSync(target, options)
    }
  }
})

import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase, getCase } from '@main/services/db/caseRepo'
import { createNote } from '@main/services/db/noteRepo'
import { restoreDatabase } from '@main/services/db/dbRestore'
import { restoreSnapshotFile, snapshotDirFor } from '@main/services/db/dbSnapshots'
import { readCaseRevision, type CaseRevision } from '@main/services/caseRevision'

// Both restores replace the database instead of editing it, so each gives every
// Case a new generation on the copy it installs (ADR-0042; engine plan E4). The
// counter and the change log come across as the copy held them.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let dir: string
let dbPath: string
let cases: string[]
const store = { caseDir: (id: string) => join(dir, 'captures', id) }

function revisions(): CaseRevision[] {
  return cases.map((caseId) => readCaseRevision(caseId, store)!)
}

function logRows(): unknown[] {
  return getDb().prepare('SELECT * FROM case_change_log ORDER BY case_id, counter').all()
}

// A run stored against the state the copy holds: ADR-0042 reads it as out of
// date once its stored generation differs from the Case's.
function storedRunGeneration(): { stored: string; current: string } {
  return getDb()
    .prepare(
      `SELECT r.stored_generation AS stored, v.generation AS current
         FROM investigation_runs r JOIN case_revisions v ON v.case_id = r.case_id`
    )
    .get() as { stored: string; current: string }
}

// A file holding this database as it is now.
async function copyTo(path: string): Promise<string> {
  await getDb().backup(path)
  return path
}

function expectReplaced(before: CaseRevision[], beforeLog: unknown[]): void {
  const after = revisions()
  after.forEach((revision, n) => {
    expect(revision.generation).toMatch(UUID)
    expect(revision.generation).not.toBe(before[n].generation)
    expect(revision).toEqual({ ...before[n], generation: revision.generation })
    expect(revision).not.toEqual(before[n])
  })
  expect(logRows()).toEqual(beforeLog)
  const run = storedRunGeneration()
  expect(run.stored).not.toBe(run.current)
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bb-revision-restore-'))
  dbPath = join(dir, 'birdbrain.db')
  await initDatabase(dbPath)
  cases = [createCase({ name: 'One' }).id, createCase({ name: 'Two' }).id]
  createNote({ caseId: cases[0], title: 'N', body: 'text' })
  const { generation } = readCaseRevision(cases[0], store)!
  getDb()
    .prepare(
      `INSERT INTO investigation_runs (id, case_id, started_from, status, start_generation,
         start_counter, stored_generation, stored_counter, layers, versions, params, started_at,
         operator_id, operator_name)
       VALUES ('run-1', ?, 'inquiry', 'stored', ?, 2, ?, 2, '["base"]', '{}', '{}', ?, 'op-1', 'Op')`
    )
    .run(cases[0], generation, generation, '2026-10-16T00:00:00.000Z')
})

afterEach(() => {
  fsHooks.exists = null
  fsHooks.rmFails = null
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('Restore from File', () => {
  it.each([
    ['at the current schema', false],
    ['marked one version back, so it migrates first', true]
  ])('gives every Case in a copy %s a new generation', async (_, older) => {
    const backup = await copyTo(join(dir, 'backup.db'))
    if (older) {
      const conn = new Database(backup)
      conn.pragma(`user_version = ${LATEST_SCHEMA_VERSION - 1}`)
      conn.close()
    }
    const before = revisions()
    const beforeLog = logRows()

    expect(await restoreDatabase({ kind: 'file', path: backup }, { dbPath })).toEqual({
      status: 'restored'
    })

    expectReplaced(before, beforeLog)
  })
})

describe('snapshot restore', () => {
  function snapshotName(fromVersion: number): string {
    return `pre-migration-v${fromVersion}-to-v${fromVersion + 1}-2026-10-16T00-00-00-000Z.db`
  }

  function partialOf(path: string): string {
    return `${path}.restore.partial`
  }

  // Close, restore and re-open, as the db:restoreSnapshot handler does.
  async function restore(name: string): Promise<void> {
    closeDatabase()
    restoreSnapshotFile(dbPath, name)
    for (const path of [dbPath, partialOf(dbPath)]) {
      for (const suffix of ['-wal', '-shm']) expect(existsSync(`${path}${suffix}`)).toBe(false)
    }
    await initDatabase(dbPath)
  }

  it('gives every Case in the snapshot a new generation and leaves the snapshot as it was', async () => {
    const name = snapshotName(LATEST_SCHEMA_VERSION)
    mkdirSync(snapshotDirFor(dbPath), { recursive: true })
    const snapshot = await copyTo(join(snapshotDirFor(dbPath), name))
    const bytes = readFileSync(snapshot)
    const before = revisions()
    const beforeLog = logRows()

    await restore(name)

    expectReplaced(before, beforeLog)
    expect(readFileSync(snapshot).equals(bytes)).toBe(true)
  })

  it('migrates a snapshot from before migration 40 to fresh generations', async () => {
    const name = snapshotName(39)
    mkdirSync(snapshotDirFor(dbPath), { recursive: true })
    const snapshot = await copyTo(join(snapshotDirFor(dbPath), name))
    const conn = new Database(snapshot)
    conn.exec('DROP VIEW analysis_eligible_exhibits')
    for (const table of ['investigation_runs', 'case_revisions', 'case_change_log']) {
      conn.exec(`DROP TABLE ${table}`)
    }
    conn.pragma('user_version = 39')
    conn.close()
    const before = revisions()

    await restore(name)

    revisions().forEach((revision, n) => {
      expect(revision.generation).toMatch(UUID)
      expect(revision.generation).not.toBe(before[n].generation)
    })
  })

  it('stops, leaving the live database as it was, when the staged copy keeps a sidecar', async () => {
    const name = snapshotName(LATEST_SCHEMA_VERSION)
    mkdirSync(snapshotDirFor(dbPath), { recursive: true })
    await copyTo(join(snapshotDirFor(dbPath), name))
    const live = createCase({ name: 'Only in the live database' }).id
    // The second look at the staged copy's -wal, the one after its close.
    let looks = 0
    fsHooks.exists = (path) =>
      path === `${partialOf(dbPath)}-wal` && ++looks === 2 ? true : undefined
    closeDatabase()

    expect(() => restoreSnapshotFile(dbPath, name)).toThrow(/sidecar/)

    expect(looks).toBe(2)
    expect(existsSync(partialOf(dbPath))).toBe(false)
    await initDatabase(dbPath)
    expect(getCase(live)).toBeDefined()
  })

  it('stops before opening the staged copy when a sidecar from an earlier restore stays', async () => {
    const name = snapshotName(LATEST_SCHEMA_VERSION)
    mkdirSync(snapshotDirFor(dbPath), { recursive: true })
    await copyTo(join(snapshotDirFor(dbPath), name))
    const live = createCase({ name: 'Only in the live database' }).id
    const stale = `${partialOf(dbPath)}-wal`
    writeFileSync(stale, 'left by an earlier restore')
    fsHooks.rmFails = (path) => path === stale
    closeDatabase()

    expect(() => restoreSnapshotFile(dbPath, name)).toThrow(/sidecar/)

    expect(readFileSync(stale, 'utf-8')).toBe('left by an earlier restore')
    fsHooks.rmFails = null
    await initDatabase(dbPath)
    expect(getCase(live)).toBeDefined()
  })
})
