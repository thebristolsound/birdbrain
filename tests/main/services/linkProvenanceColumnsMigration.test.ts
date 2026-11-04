import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture, insertCapture } from '@main/services/db/captureRepo'
import type { LinkProvenance } from '@shared/types'

// Migration 44: a link Capture's source mirrored on the captures row (ADR-0040).
const LINK_COLUMNS = ['linked_from_capture_id', 'linked_from_content_hash', 'link_href']

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }

describe('migration v44 (link Capture provenance columns)', () => {
  let root: string
  let dbPath: string
  let caseId: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-migration-44-'))
    dbPath = join(root, 'birdbrain.db')
    await initDatabase(dbPath)
    caseId = createCase({ name: 'Link provenance columns' }).id
  })

  afterEach(() => {
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  })

  function linkColumns(): ColumnInfo[] {
    const info = getDb().pragma('table_info(captures)') as ColumnInfo[]
    return info.filter(({ name }) => LINK_COLUMNS.includes(name))
  }

  function capture(id: string, link: Partial<LinkProvenance> = {}): void {
    insertCapture({
      id,
      caseId,
      url: `https://example.com/${id}`,
      title: id,
      hash: 'a'.repeat(64),
      timestamp: '2026-10-26T00:00:00.000Z',
      format: 'mhtml',
      method: 'background',
      ...link
    })
  }

  it('adds three nullable TEXT columns with no default', () => {
    expect(linkColumns()).toEqual(
      LINK_COLUMNS.map((name) => ({
        cid: expect.any(Number),
        name,
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0
      }))
    )
  })

  it('upgrades v43 with every existing row reading the new columns as null', async () => {
    capture('kept')
    for (const column of LINK_COLUMNS) getDb().exec(`ALTER TABLE captures DROP COLUMN ${column}`)
    getDb().pragma('user_version = 43')
    const before = getDb().prepare('SELECT * FROM captures').get() as Record<string, unknown>
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(linkColumns().map(({ name }) => name)).toEqual(LINK_COLUMNS)
    expect(getDb().prepare('SELECT * FROM captures').get()).toEqual({
      ...before,
      ...Object.fromEntries(LINK_COLUMNS.map((column) => [column, null]))
    })
    const { linkedFromCaptureId, linkedFromContentHash, linkHref } = getCapture('kept')!
    expect([linkedFromCaptureId, linkedFromContentHash, linkHref]).toEqual([
      undefined,
      undefined,
      undefined
    ])
  })

  it('reruns over a database that already has the columns and keeps their values', async () => {
    const link: LinkProvenance = {
      linkedFromCaptureId: 'source',
      linkedFromContentHash: 'b'.repeat(64),
      linkHref: 'http://example.com/page'
    }
    capture('rerun', link)
    getDb().pragma('user_version = 43')
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(linkColumns()).toHaveLength(LINK_COLUMNS.length)
    expect(getCapture('rerun')).toMatchObject(link)
  })
})
