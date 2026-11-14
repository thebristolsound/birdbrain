import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { createSelector } from '@main/services/db/selectorRepo'

// Migration 46: when a Persisted Match was found and what found it (#1069).
const PROVENANCE_COLUMNS = ['matched_at', 'match_origin']

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }

describe('migration v46 (selector match provenance)', () => {
  let root: string
  let dbPath: string
  let selectorId: string
  let captureId: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-migration-46-'))
    dbPath = join(root, 'birdbrain.db')
    await initDatabase(dbPath)
    const caseId = createCase({ name: 'Match provenance' }).id
    selectorId = createSelector({ caseId, pattern: 'alpha' }).id
    captureId = insertCapture({
      caseId,
      url: 'https://example.com/a',
      title: 'A',
      hash: 'a'.repeat(64),
      timestamp: '2026-11-09T00:00:00.000Z'
    }).id
  })

  afterEach(() => {
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  })

  function provenanceColumns(): ColumnInfo[] {
    const info = getDb().pragma('table_info(selector_matches)') as ColumnInfo[]
    return info.filter(({ name }) => PROVENANCE_COLUMNS.includes(name))
  }

  it('adds two nullable TEXT columns with no default', () => {
    expect(provenanceColumns()).toEqual(
      PROVENANCE_COLUMNS.map((name) => ({
        cid: expect.any(Number),
        name,
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0
      }))
    )
  })

  it('upgrades v45 with every existing row reading the new columns as null', async () => {
    for (const column of PROVENANCE_COLUMNS) {
      getDb().exec(`ALTER TABLE selector_matches DROP COLUMN ${column}`)
    }
    getDb()
      .prepare('INSERT INTO selector_matches (selector_id, capture_id) VALUES (?, ?)')
      .run(selectorId, captureId)
    getDb().pragma('user_version = 45')
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(provenanceColumns().map(({ name }) => name)).toEqual(PROVENANCE_COLUMNS)
    expect(getDb().prepare('SELECT * FROM selector_matches').all()).toEqual([
      { selector_id: selectorId, capture_id: captureId, matched_at: null, match_origin: null }
    ])
  })

  it('reruns over a database that already has the columns and keeps their values', async () => {
    getDb()
      .prepare(
        `INSERT INTO selector_matches (selector_id, capture_id, matched_at, match_origin)
         VALUES (?, ?, ?, ?)`
      )
      .run(selectorId, captureId, '2026-11-09T01:02:03.000Z', 'rescan')
    getDb().pragma('user_version = 45')
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(provenanceColumns()).toHaveLength(PROVENANCE_COLUMNS.length)
    expect(getDb().prepare('SELECT matched_at, match_origin FROM selector_matches').get()).toEqual({
      matched_at: '2026-11-09T01:02:03.000Z',
      match_origin: 'rescan'
    })
  })
})
