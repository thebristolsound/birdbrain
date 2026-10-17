import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase, deleteCase } from '@main/services/db/caseRepo'
import { deleteCapture, insertCapture } from '@main/services/db/captureRepo'
import { createNote } from '@main/services/db/noteRepo'

// Migration 38: the Case search field records (docs/plans/2026-10-09-case-retrieval-
// first-slice.md, D1 and D2), a cache outside the Manifest that goes with its Exhibit.
describe('migration v38 (Case search fields)', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-migration-38-'))
    dbPath = join(tempDir, 'search-fields.db')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function capture(caseId: string, id: string): void {
    insertCapture({
      id,
      caseId,
      url: `https://example.com/${id}`,
      title: id,
      hash: 'a'.repeat(64),
      timestamp: '2026-01-01T00:00:00.000Z',
      format: 'mhtml',
      mhtmlPath: `${caseId}/${id}.mhtml`
    })
  }

  function build(caseId: string, exhibitId: string, norms: string[]): void {
    const d = getDb()
    d.prepare(
      `INSERT INTO exhibit_search_builds
         (exhibit_id, case_id, content_hash, extractor, built_at, outcome)
       VALUES (?, ?, ?, 'fields/1', '2026-10-12T00:00:00.000Z', 'built')`
    ).run(exhibitId, caseId, 'a'.repeat(64))
    const insert = d.prepare(
      `INSERT INTO exhibit_search_fields
         (exhibit_id, case_id, field, value, norm, source, part, start_offset, end_offset)
       VALUES (?, ?, 'link.href', ?, ?, 'html-part', 0, 10, ?)`
    )
    for (const norm of norms) insert.run(exhibitId, caseId, norm, norm, 10 + norm.length)
  }

  function matches(query: string): number[] {
    return (
      getDb()
        .prepare(
          `SELECT rowid FROM exhibit_search_fields_fts
            WHERE exhibit_search_fields_fts MATCH ? ORDER BY rowid`
        )
        .all(query) as Array<{ rowid: number }>
    ).map((row) => row.rowid)
  }

  function counts(): { builds: number; fields: number } {
    const d = getDb()
    const count = (table: string): number =>
      (d.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    return { builds: count('exhibit_search_builds'), fields: count('exhibit_search_fields') }
  }

  // FTS5 raises an error from 'integrity-check' when an external-content index no
  // longer agrees with its content table.
  function expectIndexInStep(): void {
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO exhibit_search_fields_fts(exhibit_search_fields_fts) VALUES ('integrity-check')"
        )
        .run()
    ).not.toThrow()
  }

  it('creates both tables and the trigram index on a fresh database', async () => {
    await initDatabase(dbPath)
    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    const names = (
      getDb()
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE '%exhibit_search%' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'exhibit_search_builds',
        'exhibit_search_fields',
        'exhibit_search_fields_fts',
        'exhibit_search_fields_ai',
        'exhibit_search_fields_ad',
        'exhibit_search_fields_au',
        'idx_exhibit_search_fields_lookup'
      ])
    )
  })

  it('creates the two tables, their keys and the trigram index as D1 and D2 define them', async () => {
    await initDatabase(dbPath)
    const d = getDb()
    const columns = (table: string) =>
      (
        d.pragma(`table_info(${table})`) as Array<{
          name: string
          type: string
          notnull: number
          pk: number
        }>
      ).map(({ name, type, notnull, pk }) => [name, type, notnull, pk])
    expect(columns('exhibit_search_builds')).toEqual([
      ['exhibit_id', 'TEXT', 0, 1],
      ['case_id', 'TEXT', 1, 0],
      ['content_hash', 'TEXT', 1, 0],
      ['text_hash', 'TEXT', 0, 0],
      ['extractor', 'TEXT', 1, 0],
      ['built_at', 'TEXT', 1, 0],
      ['outcome', 'TEXT', 1, 0],
      ['skipped_json', 'TEXT', 0, 0]
    ])
    expect(columns('exhibit_search_fields')).toEqual([
      ['id', 'INTEGER', 0, 1],
      ['exhibit_id', 'TEXT', 1, 0],
      ['case_id', 'TEXT', 1, 0],
      ['field', 'TEXT', 1, 0],
      ['value', 'TEXT', 1, 0],
      ['norm', 'TEXT', 1, 0],
      ['source', 'TEXT', 1, 0],
      ['part', 'INTEGER', 0, 0],
      ['start_offset', 'INTEGER', 1, 0],
      ['end_offset', 'INTEGER', 1, 0]
    ])
    const keys = (table: string) =>
      (
        d.pragma(`foreign_key_list(${table})`) as Array<{
          table: string
          from: string
          to: string
          on_delete: string
        }>
      )
        .map((key) => [key.from, key.table, key.to, key.on_delete])
        .sort()
    expect(keys('exhibit_search_builds')).toEqual([
      ['case_id', 'cases', 'id', 'CASCADE'],
      ['exhibit_id', 'exhibits', 'id', 'CASCADE']
    ])
    expect(keys('exhibit_search_fields')).toEqual([
      ['exhibit_id', 'exhibit_search_builds', 'exhibit_id', 'CASCADE']
    ])
    const indexed = (
      d.pragma('index_info(idx_exhibit_search_fields_lookup)') as Array<{
        name: string
      }>
    ).map((column) => column.name)
    expect(indexed).toEqual(['case_id', 'field', 'norm'])
    const { sql } = d
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'exhibit_search_fields_fts'")
      .get() as { sql: string }
    expect(sql).toMatch(/USING fts5\(\s*norm,/)
    expect(sql).toMatch(/content=['"]?exhibit_search_fields['"]?,/)
    expect(sql).toMatch(/content_rowid=['"]?id['"]?/)
    expect(sql).toMatch(/tokenize='trigram'/)
  })

  it('upgrades a populated version 37 database and changes no existing row', async () => {
    await initDatabase(dbPath)
    const caseId = createCase({ name: 'Upgrade' }).id
    for (const id of ['c1', 'c2']) {
      insertCapture({
        id,
        caseId,
        url: `https://example.com/${id}`,
        title: id,
        hash: 'a'.repeat(64),
        timestamp: '2026-01-01T00:00:00.000Z',
        format: 'mhtml',
        mhtmlPath: `${caseId}/${id}.mhtml`,
        textContent: `Text of ${id}`
      })
    }
    const datum = getDb().prepare(
      `INSERT INTO extracted_data (id, capture_id, case_id, category, subcategory, value, source_url, created_at)
       VALUES (?, ?, ?, 'email', 'email', ?, ?, '2026-01-01T00:00:00.000Z')`
    )
    datum.run('d1', 'c1', caseId, 'lena@quillmere.example.net', 'https://example.com/c1')
    datum.run('d2', 'c2', caseId, 'ossie@quillmere.example.net', 'https://example.com/c2')
    createNote({ caseId, title: 'Note', body: 'body' })
    const tables = ['captures', 'exhibits', 'capture_texts', 'extracted_data']
    const rows = (table: string) => getDb().prepare(`SELECT * FROM ${table} ORDER BY 1`).all()
    const before = Object.fromEntries(tables.map((table) => [table, rows(table)]))
    for (const table of tables) expect(before[table]).toHaveLength(2)
    closeDatabase()
    const raw = new Database(dbPath)
    raw.exec(`
      DROP TABLE exhibit_search_fields_fts;
      DROP TABLE exhibit_search_fields;
      DROP TABLE exhibit_search_builds;
    `)
    raw.pragma('user_version = 37')
    raw.close()

    await initDatabase(dbPath)

    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(counts()).toEqual({ builds: 0, fields: 0 })
    expect(
      (
        getDb().prepare('SELECT COUNT(*) AS n FROM exhibit_search_fields_fts').get() as {
          n: number
        }
      ).n
    ).toBe(0)
    for (const table of tables) expect(rows(table)).toEqual(before[table])
    expect(getDb().pragma('foreign_key_check')).toEqual([])
  })

  it('adds the tables to a version 37 database and moves nothing else', async () => {
    await initDatabase(dbPath)
    const caseId = createCase({ name: 'Upgrade' }).id
    capture(caseId, 'c1')
    closeDatabase()
    const raw = new Database(dbPath)
    raw.exec(`
      DROP TABLE exhibit_search_fields_fts;
      DROP TABLE exhibit_search_fields;
      DROP TABLE exhibit_search_builds;
    `)
    raw.pragma('user_version = 37')
    raw.close()

    await initDatabase(dbPath)

    expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(counts()).toEqual({ builds: 0, fields: 0 })
    expect(getDb().prepare('SELECT id FROM exhibits').all()).toEqual([{ id: 'c1' }])
  })

  it('matches a domain inside a longer URL, in any capitalization', async () => {
    await initDatabase(dbPath)
    const caseId = createCase({ name: 'Search' }).id
    capture(caseId, 'c1')
    build(caseId, 'c1', [
      'https://northgate-ledger.example.com/pay?ref=7',
      'https://other.example.org/'
    ])

    expect(matches('"northgate-ledger.example.com"')).toHaveLength(1)
    expect(matches('"NORTHGATE-LEDGER.EXAMPLE"')).toHaveLength(1)
    expect(matches('"example"')).toHaveLength(2)
    expectIndexInStep()
  })

  it('follows an edited search form, and forgets a deleted field', async () => {
    await initDatabase(dbPath)
    const caseId = createCase({ name: 'Search' }).id
    capture(caseId, 'c1')
    build(caseId, 'c1', ['https://mail.example.com/inbox'])
    const [id] = matches('"example.com"')

    getDb()
      .prepare('UPDATE exhibit_search_fields SET norm = ? WHERE id = ?')
      .run('https://post.example.net/inbox', id)
    expect(matches('"example.com"')).toEqual([])
    expect(matches('"example.net"')).toEqual([id])
    expectIndexInStep()

    getDb().prepare('DELETE FROM exhibit_search_fields WHERE id = ?').run(id)
    expect(matches('"example.net"')).toEqual([])
    expectIndexInStep()
  })

  it('goes with its Exhibit when the Capture is deleted', async () => {
    await initDatabase(dbPath)
    const caseId = createCase({ name: 'Delete capture' }).id
    capture(caseId, 'gone')
    capture(caseId, 'kept')
    build(caseId, 'gone', ['https://gone.example.org/'])
    build(caseId, 'kept', ['https://kept.example.org/'])

    expect(deleteCapture('gone')).toBe(true)

    expect(counts()).toEqual({ builds: 1, fields: 1 })
    expect(matches('"gone.example"')).toEqual([])
    expect(matches('"kept.example"')).toHaveLength(1)
    expectIndexInStep()
  })

  it('goes with its Case when the Case is deleted', async () => {
    await initDatabase(dbPath)
    const gone = createCase({ name: 'Gone' }).id
    const kept = createCase({ name: 'Kept' }).id
    capture(gone, 'g1')
    capture(kept, 'k1')
    build(gone, 'g1', ['https://gone.example.org/', 'https://gone.example.org/2'])
    build(kept, 'k1', ['https://kept.example.org/'])

    expect(deleteCase(gone)).toBe(true)

    expect(counts()).toEqual({ builds: 1, fields: 1 })
    expect(matches('"gone.example"')).toEqual([])
    expectIndexInStep()
  })

  it('refuses a build row for an Exhibit that does not exist', async () => {
    await initDatabase(dbPath)
    const caseId = createCase({ name: 'Orphan' }).id
    expect(() => build(caseId, 'no-such-exhibit', [])).toThrow(/FOREIGN KEY/)
  })
})
