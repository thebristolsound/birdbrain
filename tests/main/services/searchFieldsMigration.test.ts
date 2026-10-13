import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase, deleteCase } from '@main/services/db/caseRepo'
import { deleteCapture, insertCapture } from '@main/services/db/captureRepo'

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
