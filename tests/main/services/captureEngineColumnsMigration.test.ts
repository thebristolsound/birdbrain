import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture, insertCapture } from '@main/services/db/captureRepo'
import {
  ENGINE_BOUND_TLS,
  ENGINE_HASHES,
  ENGINE_INVENTORY,
  ENGINE_SCROLL_TO_LOAD
} from '../../helpers/captureEnginePackage'

// Migration 43: the capture engine's schema-6 capture entry fields mirrored on the captures
// row (docs/plans/2026-10-10-capture-engine-first-slice.md, D9 and step 2).
const ENGINE_COLUMNS = [
  'transaction_record_hash',
  'pdf_hash',
  'inventory',
  'scroll_to_load',
  'bound_tls',
  'bound_tls_absent'
]

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }

describe('migration v43 (capture engine mirror columns)', () => {
  let root: string
  let dbPath: string
  let caseId: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-migration-43-'))
    dbPath = join(root, 'birdbrain.db')
    await initDatabase(dbPath)
    caseId = createCase({ name: 'Capture engine columns' }).id
  })

  afterEach(() => {
    closeDatabase()
    rmSync(root, { recursive: true, force: true })
  })

  function engineColumns(): ColumnInfo[] {
    const info = getDb().pragma('table_info(captures)') as ColumnInfo[]
    return info.filter(({ name }) => ENGINE_COLUMNS.includes(name))
  }

  function capture(id: string): void {
    insertCapture({
      id,
      caseId,
      url: `https://example.com/${id}`,
      title: id,
      hash: 'a'.repeat(64),
      timestamp: '2026-10-26T00:00:00.000Z',
      format: 'mhtml',
      method: 'background'
    })
  }

  function setColumns(id: string, values: Record<string, string | Buffer | null>): void {
    for (const [column, value] of Object.entries(values)) {
      getDb().prepare(`UPDATE captures SET ${column} = ? WHERE id = ?`).run(value, id)
    }
  }

  it('adds six nullable TEXT columns with no default and no path column', () => {
    expect(engineColumns()).toEqual(
      ENGINE_COLUMNS.map((name) => ({
        cid: expect.any(Number),
        name,
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0
      }))
    )
    const names = (getDb().pragma('table_info(captures)') as ColumnInfo[]).map(({ name }) => name)
    expect(names.filter((name) => name.endsWith('_path'))).toEqual([
      'html_path',
      'screenshot_path',
      'mhtml_path'
    ])
  })

  it('upgrades v42 with every existing row reading the new columns as null', async () => {
    capture('kept')
    for (const column of ENGINE_COLUMNS) getDb().exec(`ALTER TABLE captures DROP COLUMN ${column}`)
    getDb().pragma('user_version = 42')
    const before = getDb().prepare('SELECT * FROM captures').get() as Record<string, unknown>
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(engineColumns().map(({ name }) => name)).toEqual(ENGINE_COLUMNS)
    expect(getDb().prepare('SELECT * FROM captures').get()).toEqual({
      ...before,
      ...Object.fromEntries(ENGINE_COLUMNS.map((column) => [column, null]))
    })
    const read = getCapture('kept')
    expect(read).toBeDefined()
    expect([
      read?.transactionRecordHash,
      read?.pdfHash,
      read?.inventory,
      read?.scrollToLoad,
      read?.boundTls,
      read?.boundTlsAbsent
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })

  it('reruns over a database that already has the columns and keeps their values', async () => {
    capture('rerun')
    setColumns('rerun', { pdf_hash: ENGINE_HASHES.pdf })
    getDb().pragma('user_version = 42')
    closeDatabase()
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(engineColumns()).toHaveLength(ENGINE_COLUMNS.length)
    expect(getCapture('rerun')?.pdfHash).toBe(ENGINE_HASHES.pdf)
  })

  it('reads each column back onto the Capture as the entry field it mirrors', () => {
    capture('with-tls')
    capture('from-cache')
    setColumns('with-tls', {
      transaction_record_hash: ENGINE_HASHES.transactionRecord,
      pdf_hash: ENGINE_HASHES.pdf,
      inventory: JSON.stringify(ENGINE_INVENTORY),
      scroll_to_load: JSON.stringify(ENGINE_SCROLL_TO_LOAD),
      bound_tls: JSON.stringify(ENGINE_BOUND_TLS)
    })
    setColumns('from-cache', { bound_tls_absent: 'from-cache' })

    expect(getCapture('with-tls')).toMatchObject({
      transactionRecordHash: ENGINE_HASHES.transactionRecord,
      pdfHash: ENGINE_HASHES.pdf,
      inventory: ENGINE_INVENTORY,
      scrollToLoad: ENGINE_SCROLL_TO_LOAD,
      boundTls: ENGINE_BOUND_TLS
    })
    expect(getCapture('with-tls')?.boundTlsAbsent).toBeUndefined()
    const fromCache = getCapture('from-cache')
    expect(fromCache?.boundTlsAbsent).toBe('from-cache')
    expect(fromCache?.boundTls).toBeUndefined()
  })

  it('reads a hand-edited value that fails its own field check back as undefined', () => {
    capture('not-json')
    capture('wrong-shape')
    capture('blob')
    setColumns('not-json', {
      transaction_record_hash: 'xyz',
      pdf_hash: 'not-a-hash',
      inventory: '{not json',
      scroll_to_load: '',
      bound_tls: '{',
      bound_tls_absent: 'unknown-reason'
    })
    setColumns('wrong-shape', {
      transaction_record_hash: 'A'.repeat(64),
      pdf_hash: ENGINE_HASHES.pdf.slice(1),
      inventory: JSON.stringify({ ...ENGINE_INVENTORY, mhtml: { present: true } }),
      scroll_to_load: JSON.stringify({ ...ENGINE_SCROLL_TO_LOAD, requested: false }),
      bound_tls: JSON.stringify({ ...ENGINE_BOUND_TLS, unexpected: true }),
      bound_tls_absent: 'FROM-CACHE'
    })
    // A BLOB comes back from SQLite as a Buffer, never a string.
    setColumns('blob', {
      transaction_record_hash: Buffer.from(ENGINE_HASHES.transactionRecord),
      pdf_hash: Buffer.from(ENGINE_HASHES.pdf),
      inventory: Buffer.from(JSON.stringify(ENGINE_INVENTORY)),
      bound_tls_absent: Buffer.from('from-cache')
    })
    for (const id of ['not-json', 'wrong-shape', 'blob']) {
      const read = getCapture(id)
      expect(read).toBeDefined()
      expect([
        read?.transactionRecordHash,
        read?.pdfHash,
        read?.inventory,
        read?.scrollToLoad,
        read?.boundTls,
        read?.boundTlsAbsent
      ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
    }
  })

  it('applies no rule across columns, so the row can hold what the signed entry refuses', () => {
    capture('contradicting')
    // The entry schema refuses each pairing: `pdfHash` without `inventory`, and `boundTls`
    // beside `boundTlsAbsent`.
    setColumns('contradicting', {
      pdf_hash: ENGINE_HASHES.pdf,
      bound_tls: JSON.stringify(ENGINE_BOUND_TLS),
      bound_tls_absent: 'from-cache'
    })
    expect(getCapture('contradicting')).toMatchObject({
      pdfHash: ENGINE_HASHES.pdf,
      boundTls: ENGINE_BOUND_TLS,
      boundTlsAbsent: 'from-cache'
    })
    expect(getCapture('contradicting')?.inventory).toBeUndefined()
  })
})
