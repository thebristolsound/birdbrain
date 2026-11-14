import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertQueuedJobs, listJobs } from '@main/services/db/backgroundJobRepo'

// Migration 47: the background job queue's table (docs/specs/2026-11-09-batch-capture-throughput-
// design.md, "Migration"). It adds one table and two indexes and alters nothing that exists.

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }

const COLUMNS: Array<[name: string, type: string, notnull: number, dflt: unknown, pk: number]> = [
  ['id', 'TEXT', 0, null, 1],
  ['batch_id', 'TEXT', 1, null, 0],
  ['case_id', 'TEXT', 1, null, 0],
  ['url', 'TEXT', 1, null, 0],
  ['supersedes_capture_id', 'TEXT', 0, null, 0],
  ['linked_from_capture_id', 'TEXT', 0, null, 0],
  ['link_href', 'TEXT', 0, null, 0],
  ['state', 'TEXT', 1, null, 0],
  ['phase', 'TEXT', 0, null, 0],
  ['attempts', 'INTEGER', 1, '0', 0],
  ['queued_at', 'TEXT', 1, null, 0],
  ['resumed_at', 'TEXT', 0, null, 0],
  ['started_at', 'TEXT', 0, null, 0],
  ['finished_at', 'TEXT', 0, null, 0],
  ['capture_id', 'TEXT', 0, null, 0],
  ['failure_kind', 'TEXT', 0, null, 0],
  ['error', 'TEXT', 0, null, 0],
  ['warning', 'TEXT', 0, null, 0]
]

// Every schema object but the new table's, as SQLite stores its definition.
function otherObjects(): Array<{ type: string; name: string; sql: string | null }> {
  return getDb()
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
        WHERE tbl_name != 'background_jobs' ORDER BY type, name`
    )
    .all() as Array<{ type: string; name: string; sql: string | null }>
}

describe('migration v47 (background_jobs)', () => {
  let root: string
  let dbPath: string
  let caseId: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-migration-47-'))
    dbPath = join(root, 'birdbrain.db')
    await initDatabase(dbPath)
    caseId = createCase({ name: 'Background jobs' }).id
  })

  afterEach(() => {
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  })

  const queue = (id: string) =>
    insertQueuedJobs([
      {
        id,
        batchId: 'batch',
        caseId,
        url: 'https://example.com/',
        queuedAt: '2026-11-09T00:00:00.000Z'
      }
    ])

  it('creates the table with the columns, key and checks the design gives', () => {
    const columns = getDb().pragma('table_info(background_jobs)') as ColumnInfo[]
    expect(
      columns.map(({ name, type, notnull, dflt_value, pk }) => [
        name,
        type,
        notnull,
        dflt_value,
        pk
      ])
    ).toEqual(COLUMNS)
    const keys = getDb().pragma('foreign_key_list(background_jobs)') as Array<{
      table: string
      from: string
      to: string
      on_delete: string
    }>
    expect(keys.map(({ table, from, to, on_delete }) => [table, from, to, on_delete])).toEqual([
      ['cases', 'case_id', 'id', 'CASCADE']
    ])
  })

  it('creates the state and Batch indexes', () => {
    const indexColumns = (name: string) =>
      (getDb().pragma(`index_info(${name})`) as Array<{ name: string }>).map((c) => c.name)
    expect(indexColumns('idx_background_jobs_state')).toEqual(['state', 'queued_at'])
    expect(indexColumns('idx_background_jobs_batch')).toEqual(['batch_id'])
  })

  it('opens every connection with foreign keys on, so a Case delete takes its jobs', () => {
    expect(getDb().pragma('foreign_keys', { simple: true })).toBe(1)
    queue('job')
    getDb().prepare('DELETE FROM cases WHERE id = ?').run(caseId)
    expect(listJobs({ batchId: 'batch' })).toEqual([])
  })

  // A database a build without this table has opened: version 46, which the selector match
  // provenance migration set, and no `background_jobs`.
  it('upgrades v46 by adding the table and leaving every existing object as it was', async () => {
    getDb().exec('DROP TABLE background_jobs')
    getDb().pragma('user_version = 46')
    const before = otherObjects()
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(otherObjects()).toEqual(before)
    expect(getDb().prepare('SELECT * FROM background_jobs').all()).toEqual([])
    expect(getDb().pragma('foreign_key_check')).toEqual([])
  })

  it('reruns on a copy marked one version back, twice, and keeps its rows', async () => {
    queue('kept')
    const before = otherObjects()
    for (let run = 0; run < 2; run++) {
      getDb().pragma('user_version = 46')
      closeDatabase()
      await initDatabase(dbPath)
      expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    }
    expect(listJobs({ caseId }).map(({ jobId }) => jobId)).toEqual(['kept'])
    expect(otherObjects()).toEqual(before)
  })
})
