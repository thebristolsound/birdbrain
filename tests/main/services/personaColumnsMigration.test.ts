import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture, insertCapture } from '@main/services/db/captureRepo'

// Migration 45: the Persona a Capture was taken under, mirrored on the captures row (ADR-0030).
const PERSONA_COLUMNS = ['persona_id', 'persona_label']

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }

describe('migration v45 (Persona columns on captures)', () => {
  let root: string
  let dbPath: string
  let caseId: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-migration-45-'))
    dbPath = join(root, 'birdbrain.db')
    await initDatabase(dbPath)
    caseId = createCase({ name: 'Persona columns' }).id
  })

  afterEach(() => {
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  })

  function personaColumns(): ColumnInfo[] {
    const info = getDb().pragma('table_info(captures)') as ColumnInfo[]
    return info.filter(({ name }) => PERSONA_COLUMNS.includes(name))
  }

  function capture(id: string, persona: { personaId?: string; personaLabel?: string } = {}): void {
    insertCapture({
      id,
      caseId,
      url: `https://example.com/${id}`,
      title: id,
      hash: 'a'.repeat(64),
      timestamp: '2026-11-03T00:00:00.000Z',
      format: 'mhtml',
      method: 'background',
      ...persona
    })
  }

  it('adds two nullable TEXT columns with no default', () => {
    expect(personaColumns()).toEqual(
      PERSONA_COLUMNS.map((name) => ({
        cid: expect.any(Number),
        name,
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0
      }))
    )
  })

  it('upgrades v44 with every existing row reading the new columns as null', async () => {
    capture('kept')
    for (const column of PERSONA_COLUMNS) {
      getDb().exec(`ALTER TABLE captures DROP COLUMN ${column}`)
    }
    getDb().pragma('user_version = 44')
    const before = getDb().prepare('SELECT * FROM captures').get() as Record<string, unknown>
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(personaColumns().map(({ name }) => name)).toEqual(PERSONA_COLUMNS)
    expect(getDb().prepare('SELECT * FROM captures').get()).toEqual({
      ...before,
      persona_id: null,
      persona_label: null
    })
    const { personaId, personaLabel } = getCapture('kept')!
    expect([personaId, personaLabel]).toEqual([undefined, undefined])
  })

  it('reruns over a database that already has the columns and keeps their values', async () => {
    const persona = { personaId: 'persona-1', personaLabel: 'Research account' }
    capture('rerun', persona)
    getDb().pragma('user_version = 44')
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(personaColumns()).toHaveLength(PERSONA_COLUMNS.length)
    expect(getCapture('rerun')).toMatchObject(persona)
  })

  it('declares no foreign key on persona_id', () => {
    const keys = getDb().pragma('foreign_key_list(captures)') as Array<{ from: string }>
    expect(keys.map(({ from }) => from)).not.toContain('persona_id')
  })
})
