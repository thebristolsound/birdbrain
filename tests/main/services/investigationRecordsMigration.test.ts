import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import {
  closeDatabase,
  getDb,
  ID_PROBE_TABLES,
  initDatabase,
  LATEST_SCHEMA_VERSION
} from '@main/services/db/core'
import { createCase, deleteCase } from '@main/services/db/caseRepo'
import { deleteCapture, insertCapture } from '@main/services/db/captureRepo'
import { createNote, deleteNote, updateNote } from '@main/services/db/noteRepo'
import { createSelector } from '@main/services/db/selectorRepo'
import { insertExtractedData } from '@main/services/db/extractedDataRepo'
import { ALLOWED_TABLES, updateRow } from '@main/services/db/dbAdmin'
import { CASE_ARCHIVE_SCHEMA_VERSION, collectCaseData } from '@main/services/caseArchive'
import { initStorage } from '@main/services/storage'

// Migration 40: the investigation records and the Case revision (ADR-0042;
// docs/plans/2026-10-10-case-investigation-engine.md, E1 to E3 and E8).
//
//   1. SHAPE. The sixteen tables match the plan's DDL, kept as a fixture.
//   2. UPGRADE. A populated v39 database gains a revision row per Case and keeps
//      every row it had; a copy marked v39 again runs the block with no change.
//   3. TRIGGERS. One write to an input table advances its Case's counter by one
//      and logs one row of the plan's kind and target, whoever writes it.
//   4. EDGES. Case delete, the per-author indexes and the eligibility view.

type Row = Record<string, unknown>

const NOW = '2026-10-16T00:00:00.000Z'
const HASH = 'a'.repeat(64)
const ATTRIBUTION = { operator_id: 'op-1', operator_name: 'Operator' }
const REMOTE = 'installation-remote-0001'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX32 = /^[0-9a-f]{32}$/

const NEW_TABLES = [
  'subjects',
  'joints',
  'joint_spans',
  'subject_spans',
  'joint_decisions',
  'span_decisions',
  'source_class_marks',
  'copy_marks',
  'withheld_flags',
  'own_identifiers',
  'investigation_runs',
  'investigation_run_basis',
  'investigation_run_candidates',
  'investigation_run_proposals',
  'case_revisions',
  'case_change_log'
]
const SYNCED_TABLES = NEW_TABLES.slice(0, 10)
const INPUT_TABLES = [
  'notes',
  'extracted_data',
  'selectors',
  'exhibits',
  'exhibit_search_builds'
].concat(SYNCED_TABLES)

function insert(table: string, row: Row): void {
  const columns = Object.keys(row)
  getDb()
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES (${columns.map((column) => `@${column}`).join(', ')})`
    )
    .run(row)
}

function count(table: string, where = '1', ...params: unknown[]): number {
  return (
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
      .get(...params) as { n: number }
  ).n
}

function revision(caseId: string): { generation: string; counter: number } {
  return getDb()
    .prepare('SELECT generation, counter FROM case_revisions WHERE case_id = ?')
    .get(caseId) as { generation: string; counter: number }
}

function logAfter(
  caseId: string,
  counter: number
): Array<{ counter: number; kind: string; target_id: string | null }> {
  return getDb()
    .prepare(
      `SELECT counter, kind, target_id FROM case_change_log
        WHERE case_id = ? AND counter > ? ORDER BY counter`
    )
    .all(caseId, counter) as Array<{ counter: number; kind: string; target_id: string | null }>
}

// The counter and the log move together: the counter is the number of rows the
// Case's log holds, and their counters run from 1 with no gap.
function expectLogInStep(caseId: string): void {
  const { counter } = revision(caseId)
  const counters = logAfter(caseId, 0).map((row) => row.counter)
  expect(counters).toEqual(Array.from({ length: counter }, (_, i) => i + 1))
}

// Row builders, with the columns the DDL requires.
const rows = {
  subject: (id: string, caseId: string, extra: Row = {}): Row => ({
    id,
    case_id: caseId,
    name: 'Rowan Pike',
    kind: 'person',
    created_at: NOW,
    ...ATTRIBUTION,
    ...extra
  }),
  joint: (id: string, caseId: string, subjectId: string, extra: Row = {}): Row => ({
    id,
    case_id: caseId,
    claim: 'used the address',
    claim_hash: 'claim-hash',
    subject_a_id: subjectId,
    producer_kind: 'rule',
    producer: 'shared-identifier',
    producer_version: '1',
    identity_hash: `identity-${id}`,
    created_by_run_id: 'run-1',
    created_at: NOW,
    ...extra
  }),
  jointSpan: (id: string, caseId: string, jointId: string, extra: Row = {}): Row => ({
    id,
    case_id: caseId,
    joint_id: jointId,
    exhibit_id: 'exhibit-cited',
    content_hash: HASH,
    representation: 'text',
    field: 'text.passage',
    locator: '{}',
    value: 'the passage',
    span_key: `key-${id}`,
    reading: 'supports',
    created_by_run_id: 'run-1',
    created_at: NOW,
    ...extra
  }),
  subjectSpan: (id: string, caseId: string, subjectId: string): Row => ({
    id,
    case_id: caseId,
    subject_id: subjectId,
    exhibit_id: 'exhibit-cited',
    content_hash: HASH,
    representation: 'text',
    field: 'text.name',
    locator: '{}',
    value: 'Rowan Pike',
    span_key: `key-${id}`,
    created_by_run_id: 'run-1',
    created_at: NOW
  }),
  jointDecision: (id: string, caseId: string, jointId: string): Row => ({
    id,
    case_id: caseId,
    joint_id: jointId,
    decision: 'accept',
    decided_at: NOW,
    ...ATTRIBUTION
  }),
  spanDecision: (id: string, caseId: string, span: Row, extra: Row = {}): Row => ({
    id,
    case_id: caseId,
    ...span,
    action: 'dismiss',
    decided_at: NOW,
    ...ATTRIBUTION,
    ...extra
  }),
  sourceClass: (id: string, caseId: string): Row => ({
    id,
    case_id: caseId,
    exhibit_id: 'exhibit-marked',
    value: 'original',
    acted_at: NOW,
    ...ATTRIBUTION
  }),
  copyMark: (id: string, caseId: string): Row => ({
    id,
    case_id: caseId,
    copy_exhibit_id: 'exhibit-copy',
    original_exhibit_id: 'exhibit-original',
    marked: 1,
    acted_at: NOW,
    ...ATTRIBUTION
  }),
  withheld: (id: string, caseId: string, exhibitId: string, extra: Row = {}): Row => ({
    id,
    case_id: caseId,
    exhibit_id: exhibitId,
    action: 'set',
    acted_at: NOW,
    ...ATTRIBUTION,
    ...extra
  }),
  ownIdentifier: (id: string, caseId: string): Row => ({
    id,
    case_id: caseId,
    kind: 'mail',
    value: 'calloway@harrow.example.net',
    marked: 1,
    acted_at: NOW,
    ...ATTRIBUTION
  }),
  exhibit: (id: string, caseId: string, exhibitNumber: number): Row => ({
    id,
    case_id: caseId,
    kind: 'document',
    origin: 'upload',
    exhibit_number: exhibitNumber,
    name: `${id}.pdf`,
    content_hash: HASH,
    committed_at: NOW
  }),
  build: (exhibitId: string, caseId: string): Row => ({
    exhibit_id: exhibitId,
    case_id: caseId,
    content_hash: HASH,
    extractor: 'fields/1',
    built_at: NOW,
    outcome: 'built'
  }),
  run: (id: string, caseId: string, extra: Row = {}): Row => ({
    id,
    case_id: caseId,
    started_from: 'inquiry',
    status: 'stored',
    start_generation: 'g',
    start_counter: 0,
    layers: '["base"]',
    versions: '{}',
    params: '{}',
    started_at: NOW,
    ...ATTRIBUTION,
    ...extra
  })
}

function capture(caseId: string, id: string): void {
  insertCapture({
    id,
    caseId,
    url: `https://harrow.example.net/${id}`,
    title: id,
    hash: HASH,
    timestamp: NOW,
    format: 'mhtml',
    mhtmlPath: `${caseId}/${id}.mhtml`
  })
}

describe('migration v40 (investigation records and the Case revision)', () => {
  afterEach(() => closeDatabase())

  describe('on a fresh database', () => {
    beforeEach(async () => {
      await initDatabase(':memory:')
    })

    it('creates the tables, keys and indexes the plan specifies', () => {
      const reference = new Database(':memory:')
      try {
        reference.exec('CREATE TABLE cases (id TEXT PRIMARY KEY);')
        reference.exec('CREATE TABLE exhibits (id TEXT PRIMARY KEY, case_id TEXT);')
        reference.exec(
          readFileSync(join(__dirname, '../../fixtures/db/investigation-records-e1.sql'), 'utf-8')
        )
        const shape = (db: Database.Database, table: string) => ({
          columns: db.pragma(`table_info(${table})`),
          keys: db.pragma(`foreign_key_list(${table})`),
          indexes: (db.pragma(`index_list(${table})`) as Array<{ name: string }>)
            .map((index) => ({ ...index, columns: db.pragma(`index_xinfo(${index.name})`) }))
            .sort((a, b) => a.name.localeCompare(b.name))
        })
        for (const table of NEW_TABLES) {
          expect(shape(getDb(), table), table).toEqual(shape(reference, table))
        }
      } finally {
        reference.close()
      }
      expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
      expect(
        getDb()
          .prepare("SELECT name FROM sqlite_master WHERE type = 'view'")
          .all()
          .map((row) => (row as { name: string }).name)
      ).toContain('analysis_eligible_exhibits')
    })

    it('puts an insert, an update and a delete trigger on every input table', () => {
      const triggers = new Map(
        (
          getDb()
            .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'")
            .all() as Array<{ name: string; tbl_name: string; sql: string }>
        ).map((row) => [row.name, row])
      )
      expect(triggers.get('cases_revision_ai')?.tbl_name).toBe('cases')
      // No other table moves the revision: Tags, favourites and Case edits leave it alone.
      const revisionTables = [...triggers.values()]
        .filter(({ name }) => name.includes('_revision_'))
        .map(({ tbl_name }) => tbl_name)
      expect(new Set(revisionTables)).toEqual(new Set(['cases', ...INPUT_TABLES]))
      expect(triggers.get('cases_revision_au')).toBeUndefined()
      for (const table of INPUT_TABLES) {
        for (const event of ['ai', 'au', 'ad']) {
          expect(triggers.get(`${table}_revision_${event}`)?.tbl_name, table).toBe(table)
        }
        const update = triggers.get(`${table}_revision_au`)!.sql
        if (SYNCED_TABLES.includes(table)) {
          const listed = /UPDATE OF ([\s\S]*?) ON /
            .exec(update)![1]
            .split(',')
            .map((c) => c.trim())
          const columns = (getDb().pragma(`table_info(${table})`) as Array<{ name: string }>)
            .map(({ name }) => name)
            .filter((name) => name !== 'version' && name !== 'row_signature')
          expect(listed, table).toEqual(columns)
        } else {
          expect(update, table).not.toContain('UPDATE OF')
        }
      }
    })

    it('writes a new Case its first generation from the trigger, with counter 0', () => {
      const a = createCase({ name: 'A' }).id
      const b = createCase({ name: 'B' }).id
      expect(revision(a)).toEqual({ generation: expect.stringMatching(HEX32), counter: 0 })
      expect(revision(b).generation).toMatch(HEX32)
      expect(revision(a).generation).not.toBe(revision(b).generation)
      expect(count('case_change_log')).toBe(0)
    })

    // Case Archive version 10 (#1909) carries the records; the revision and its
    // change log stay behind.
    it('keeps the records off the editable tables, and the revision out of archives', () => {
      expect([...ALLOWED_TABLES]).toEqual([
        'cases',
        'captures',
        'tags',
        'exhibit_tags',
        'selectors',
        'selector_matches',
        'capture_favorites',
        'notes'
      ])
      expect([...ID_PROBE_TABLES]).toEqual([
        'captures',
        'exhibits',
        'staging_files',
        'notes',
        'selectors',
        'extracted_data',
        'capture_archive_refs',
        'annotation_pins',
        ...SYNCED_TABLES,
        'investigation_runs'
      ])
      expect(CASE_ARCHIVE_SCHEMA_VERSION).toBe(13)
      const caseId = createCase({ name: 'Archived' }).id
      insert('subjects', rows.subject('s-1', caseId))
      const keys = Object.keys(collectCaseData(caseId)).map((key) =>
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      )
      for (const table of NEW_TABLES) {
        const travels = table !== 'case_revisions' && table !== 'case_change_log'
        expect(keys.includes(table), table).toBe(travels)
      }
    })
  })

  describe('on a database migrated from v39', () => {
    let tempDir: string
    let dbPath: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'bb-migration-40-'))
      dbPath = join(tempDir, 'investigation.db')
    })

    afterEach(() => {
      closeDatabase()
      rmSync(tempDir, { recursive: true, force: true })
    })

    // Drops everything v40 created and marks the file v39: the shape a v39 build
    // left it in, rows and all.
    function windBackToV39(): void {
      const raw = new Database(dbPath)
      try {
        raw.pragma('foreign_keys = OFF')
        raw.exec('DROP VIEW analysis_eligible_exhibits')
        for (const table of NEW_TABLES) raw.exec(`DROP TABLE ${table}`)
        raw.exec('DROP TRIGGER cases_revision_ai')
        for (const table of INPUT_TABLES.slice(0, 5)) {
          for (const event of ['ai', 'au', 'ad'])
            raw.exec(`DROP TRIGGER ${table}_revision_${event}`)
        }
        raw.pragma('user_version = 39')
      } finally {
        raw.close()
      }
    }

    const KEPT = [
      'cases',
      'captures',
      'exhibits',
      'capture_texts',
      'extracted_data',
      'notes',
      'selectors',
      'exhibit_search_builds'
    ]
    const snapshot = (db: Database.Database): Record<string, Row[]> =>
      Object.fromEntries(
        KEPT.map((table) => [
          table,
          db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Row[]
        ])
      )

    async function populated(): Promise<string[]> {
      await initDatabase(dbPath)
      const cases = [createCase({ name: 'One' }).id, createCase({ name: 'Two' }).id]
      capture(cases[0], 'cap-1')
      capture(cases[0], 'cap-2')
      insertExtractedData('cap-1', cases[0], 'https://harrow.example.net/cap-1', [
        { category: 'contact', subcategory: 'email', value: 'calloway@harrow.example.net' }
      ])
      createNote({ caseId: cases[0], title: 'N', body: 'text' })
      createSelector({ caseId: cases[1], pattern: 'Harrow' })
      insert('exhibit_search_builds', rows.build('cap-1', cases[0]))
      return cases
    }

    it('gives every Case a revision and changes no row it had', async () => {
      const cases = await populated()
      closeDatabase()
      windBackToV39()
      const raw = new Database(dbPath, { readonly: true })
      const before = snapshot(raw)
      raw.close()

      await initDatabase(dbPath)

      expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
      expect(snapshot(getDb())).toEqual(before)
      const generations = cases.map((caseId) => revision(caseId))
      for (const { generation, counter } of generations) {
        expect(generation).toMatch(UUID)
        expect(counter).toBe(0)
      }
      expect(new Set(generations.map((g) => g.generation)).size).toBe(cases.length)
      expect(count('case_revisions')).toBe(cases.length)
      for (const table of NEW_TABLES.filter((t) => t !== 'case_revisions')) {
        expect(count(table), table).toBe(0)
      }
      expect(getDb().pragma('foreign_key_check')).toEqual([])
    })

    it('runs again over its own objects and changes nothing', async () => {
      const cases = await populated()
      const before = Object.fromEntries(cases.map((caseId) => [caseId, revision(caseId)]))
      const log = count('case_change_log')
      closeDatabase()
      const raw = new Database(dbPath)
      raw.pragma('user_version = 39')
      raw.close()

      await initDatabase(dbPath)

      expect(getDb().pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
      for (const caseId of cases) expect(revision(caseId)).toEqual(before[caseId])
      expect(count('case_revisions')).toBe(cases.length)
      expect(count('case_change_log')).toBe(log)
    })
  })

  describe('the revision triggers', () => {
    let caseId: string

    beforeEach(async () => {
      await initDatabase(':memory:')
      caseId = createCase({ name: 'Inputs' }).id
      capture(caseId, 'cap-1')
    })

    interface InputCase {
      table: string
      key: string
      parents?: (caseId: string) => void
      row: (caseId: string) => Row
      set: Row
      kind: string
      target: (row: Row) => unknown
    }

    const subjectParent = (c: string) => insert('subjects', rows.subject('subject-parent', c))
    const jointParent = (c: string) => {
      subjectParent(c)
      insert('joints', rows.joint('joint-parent', c, 'subject-parent'))
    }

    const cases: InputCase[] = [
      {
        table: 'notes',
        key: 'id',
        row: (c) => ({
          id: 'note-1',
          case_id: c,
          title: 'T',
          body: 'B',
          created_at: NOW,
          updated_at: NOW
        }),
        set: { title: 'T2' },
        kind: 'note',
        target: (row) => row.id
      },
      {
        table: 'extracted_data',
        key: 'id',
        row: (c) => ({
          id: 'datum-1',
          capture_id: 'cap-1',
          case_id: c,
          category: 'contact',
          subcategory: 'email',
          value: 'calloway@harrow.example.net',
          source_url: 'https://harrow.example.net/',
          created_at: NOW
        }),
        set: { value: 'pike@harrow.example.net' },
        kind: 'extracted-datum',
        target: (row) => row.capture_id
      },
      {
        table: 'selectors',
        key: 'id',
        row: (c) => ({ id: 'selector-1', case_id: c, pattern: 'Harrow', created_at: NOW }),
        set: { label: 'Harrow' },
        kind: 'selector',
        target: (row) => row.id
      },
      {
        table: 'exhibits',
        key: 'id',
        row: (c) => rows.exhibit('exhibit-1', c, 9),
        set: { name: 'renamed.pdf' },
        kind: 'exhibit',
        target: (row) => row.id
      },
      {
        table: 'exhibit_search_builds',
        key: 'exhibit_id',
        row: (c) => rows.build('cap-1', c),
        set: { outcome: 'partial' },
        kind: 'search-build',
        target: (row) => row.exhibit_id
      },
      {
        table: 'subjects',
        key: 'id',
        row: (c) => rows.subject('subject-1', c),
        set: { name: 'R. Pike' },
        kind: 'subject',
        target: (row) => row.id
      },
      {
        table: 'joints',
        key: 'id',
        parents: subjectParent,
        row: (c) => rows.joint('joint-1', c, 'subject-parent'),
        set: { claim: 'wrote from the address' },
        kind: 'joint',
        target: (row) => row.id
      },
      {
        table: 'joint_spans',
        key: 'id',
        parents: jointParent,
        row: (c) => rows.jointSpan('joint-span-1', c, 'joint-parent'),
        set: { reading: 'unclear' },
        kind: 'span',
        target: (row) => row.id
      },
      {
        table: 'subject_spans',
        key: 'id',
        parents: subjectParent,
        row: (c) => rows.subjectSpan('subject-span-1', c, 'subject-parent'),
        set: { value: 'R. Pike' },
        kind: 'span',
        target: (row) => row.id
      },
      {
        table: 'joint_decisions',
        key: 'id',
        parents: jointParent,
        row: (c) => rows.jointDecision('joint-decision-1', c, 'joint-parent'),
        set: { reason: 'the header shows it' },
        kind: 'decision',
        target: (row) => row.joint_id
      },
      {
        table: 'span_decisions',
        key: 'id',
        parents: (c) => {
          jointParent(c)
          insert('joint_spans', rows.jointSpan('joint-span-parent', c, 'joint-parent'))
        },
        row: (c) => rows.spanDecision('span-decision-1', c, { joint_span_id: 'joint-span-parent' }),
        set: { reason: 'not the same person' },
        kind: 'decision',
        target: (row) => row.joint_span_id
      },
      {
        table: 'source_class_marks',
        key: 'id',
        row: (c) => rows.sourceClass('source-class-1', c),
        set: { reason: 'first publication' },
        kind: 'source-class',
        target: (row) => row.exhibit_id
      },
      {
        table: 'copy_marks',
        key: 'id',
        row: (c) => rows.copyMark('copy-mark-1', c),
        set: { reason: 'same text' },
        kind: 'copy-mark',
        target: (row) => row.copy_exhibit_id
      },
      {
        table: 'withheld_flags',
        key: 'id',
        row: (c) => rows.withheld('withheld-1', c, 'exhibit-withheld'),
        set: { acted_at: '2026-10-17T00:00:00.000Z' },
        kind: 'withheld',
        target: (row) => row.exhibit_id
      },
      {
        table: 'own_identifiers',
        key: 'id',
        row: (c) => rows.ownIdentifier('own-identifier-1', c),
        set: { platform: 'mail' },
        kind: 'own-identifier',
        target: (row) => row.id
      }
    ]

    it.each(cases)(
      'advances the counter by one per $table insert, update and delete',
      ({ table, key, parents, row: build, set, kind, target }) => {
        parents?.(caseId)
        const row = build(caseId)
        const expected = { kind, target_id: target(row) }

        let mark = revision(caseId).counter
        insert(table, row)
        expect(logAfter(caseId, mark)).toEqual([{ counter: mark + 1, ...expected }])

        mark = revision(caseId).counter
        const [column] = Object.keys(set)
        getDb()
          .prepare(`UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`)
          .run(set[column], row[key])
        expect(logAfter(caseId, mark)).toEqual([{ counter: mark + 1, ...expected }])

        mark = revision(caseId).counter
        getDb().prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(row[key])
        expect(logAfter(caseId, mark)).toEqual([{ counter: mark + 1, ...expected }])
        expectLogInStep(caseId)
      }
    )

    it.each(cases.filter(({ table }) => SYNCED_TABLES.includes(table)))(
      'moves nothing when $table is only re-versioned and re-signed',
      ({ table, key, parents, row: build }) => {
        parents?.(caseId)
        const row = build(caseId)
        insert(table, row)
        const mark = revision(caseId).counter
        getDb()
          .prepare(`UPDATE ${table} SET version = 7, row_signature = 'signed' WHERE ${key} = ?`)
          .run(row[key])
        expect(revision(caseId).counter).toBe(mark)
        expect(logAfter(caseId, mark)).toEqual([])
      }
    )

    it('logs keeping a Subject by hand as a decision', () => {
      insert('subjects', rows.subject('subject-1', caseId))
      const mark = revision(caseId).counter
      getDb().prepare('UPDATE subjects SET kept_at = ? WHERE id = ?').run(NOW, 'subject-1')
      expect(logAfter(caseId, mark)).toEqual([
        { counter: mark + 1, kind: 'decision', target_id: 'subject-1' }
      ])
    })

    it('logs the three rows of a same-name choice as decisions on the chosen span', () => {
      insert('subjects', rows.subject('subject-1', caseId))
      insert('subject_spans', rows.subjectSpan('same-name-span', caseId, 'subject-1'))
      const mark = revision(caseId).counter
      getDb().transaction(() => {
        insert(
          'span_decisions',
          rows.spanDecision(
            'choice',
            caseId,
            { subject_span_id: 'same-name-span' },
            { action: 'choose', chosen_subject_id: 'subject-1' }
          )
        )
        insert(
          'joints',
          rows.joint('joint-1', caseId, 'subject-1', {
            from_span_decision_id: 'choice',
            created_by_run_id: null
          })
        )
        insert(
          'joint_spans',
          rows.jointSpan('cited-span', caseId, 'joint-1', { created_by_run_id: null })
        )
      })()
      expect(logAfter(caseId, mark)).toEqual(
        [1, 2, 3].map((n) => ({
          counter: mark + n,
          kind: 'decision',
          target_id: 'same-name-span'
        }))
      )
    })

    it('advances both Cases when Settings > Database moves a Note or a Selector', () => {
      const other = createCase({ name: 'Other' }).id
      const note = createNote({ caseId, title: 'N', body: 'text' })
      const selector = createSelector({ caseId, pattern: 'Harrow' })
      for (const [table, id, kind] of [
        ['notes', note.id, 'note'],
        ['selectors', selector.id, 'selector']
      ]) {
        const marks = [revision(caseId).counter, revision(other).counter]
        expect(updateRow(table, { id }, { case_id: other })).toBe(true)
        expect(logAfter(caseId, marks[0])).toEqual([{ counter: marks[0] + 1, kind, target_id: id }])
        expect(logAfter(other, marks[1])).toEqual([{ counter: marks[1] + 1, kind, target_id: id }])

        const mark = revision(other).counter
        expect(updateRow(table, { id }, { case_id: other })).toBe(true)
        expect(logAfter(other, mark)).toEqual([{ counter: mark + 1, kind, target_id: id }])
      }
      expectLogInStep(caseId)
      expectLogInStep(other)
    })

    // Every local Note write is followed by `signLocalRow`'s UPDATE of
    // `version`, `deleted_at` and `row_signature` (noteRepo.ts), which the Notes
    // update trigger counts as a second write.
    it.each([
      ['a Case that is not shared', false],
      ['a Shared Case', true]
    ])('counts a Note created, edited and deleted in %s as 2, 2 and 1', (_, shared) => {
      // A Shared Case's version allocation reads the sync state under the storage root.
      const root = mkdtempSync(join(tmpdir(), 'bb-migration-40-notes-'))
      initStorage(root)
      if (shared) {
        getDb().prepare('UPDATE cases SET shared_at = ? WHERE id = ?').run(NOW, caseId)
      }
      const mark = revision(caseId).counter
      const note = createNote({ caseId, title: 'N', body: 'text' })
      expect(revision(caseId).counter - mark).toBe(2)

      updateNote({ id: note.id, title: 'N2' })
      expect(revision(caseId).counter - mark).toBe(4)

      expect(deleteNote(note.id)).toBe(true)
      expect(revision(caseId).counter - mark).toBe(5)
      expect(count('notes', 'id = ?', note.id)).toBe(shared ? 1 : 0)
      expect(logAfter(caseId, mark)).toEqual(
        [1, 2, 3, 4, 5].map((n) => ({ counter: mark + n, kind: 'note', target_id: note.id }))
      )
      expectLogInStep(caseId)
      rmSync(root, { recursive: true, force: true })
    })

    it('moves nothing for an insert the unique index skips', () => {
      const datum = { category: 'contact', subcategory: 'email', value: 'pike@harrow.example.net' }
      insertExtractedData('cap-1', caseId, 'https://harrow.example.net/', [datum])
      const mark = revision(caseId).counter
      insertExtractedData('cap-1', caseId, 'https://harrow.example.net/', [datum])
      expect(revision(caseId).counter).toBe(mark)
      expect(count('extracted_data', 'capture_id = ?', 'cap-1')).toBe(1)
    })

    it('logs nothing, and fails nothing, for a Case with no revision row', () => {
      getDb().prepare('DELETE FROM case_revisions WHERE case_id = ?').run(caseId)
      const logged = count('case_change_log', 'case_id = ?', caseId)
      createNote({ caseId, title: 'N', body: 'text' })
      expect(count('notes', 'case_id = ?', caseId)).toBe(1)
      expect(count('case_change_log', 'case_id = ?', caseId)).toBe(logged)
    })

    it("logs each row a Capture delete removes or changes, the Note's cleared link included", () => {
      insert('exhibit_search_builds', rows.build('cap-1', caseId))
      insertExtractedData('cap-1', caseId, 'https://harrow.example.net/', [
        { category: 'contact', subcategory: 'email', value: 'calloway@harrow.example.net' },
        { category: 'contact', subcategory: 'email', value: 'pike@harrow.example.net' }
      ])
      const note = createNote({ caseId, captureId: 'cap-1', title: 'N', body: 'text' })
      const mark = revision(caseId).counter

      expect(deleteCapture('cap-1')).toBe(true)

      expect(revision(caseId).counter - mark).toBe(5)
      const logged = logAfter(caseId, mark).map(({ kind, target_id }) => `${kind} ${target_id}`)
      expect(logged.sort()).toEqual(
        [
          'exhibit cap-1',
          'search-build cap-1',
          'extracted-datum cap-1',
          'extracted-datum cap-1',
          `note ${note.id}`
        ].sort()
      )
      expectLogInStep(caseId)
    })
  })

  describe('Case delete', () => {
    beforeEach(async () => {
      await initDatabase(':memory:')
    })

    function populate(caseId: string, tag: string): void {
      capture(caseId, `cap-${tag}`)
      insert('exhibit_search_builds', rows.build(`cap-${tag}`, caseId))
      insertExtractedData(`cap-${tag}`, caseId, 'https://harrow.example.net/', [
        { category: 'contact', subcategory: 'email', value: 'calloway@harrow.example.net' }
      ])
      createNote({ caseId, captureId: `cap-${tag}`, title: 'N', body: 'text' })
      createSelector({ caseId, pattern: 'Harrow' })
      insert('subjects', rows.subject(`subject-${tag}`, caseId))
      insert('joints', rows.joint(`joint-${tag}`, caseId, `subject-${tag}`))
      insert('joint_spans', rows.jointSpan(`joint-span-${tag}`, caseId, `joint-${tag}`))
      insert('subject_spans', rows.subjectSpan(`subject-span-${tag}`, caseId, `subject-${tag}`))
      insert('joint_decisions', rows.jointDecision(`joint-decision-${tag}`, caseId, `joint-${tag}`))
      insert(
        'span_decisions',
        rows.spanDecision(`span-decision-${tag}`, caseId, { joint_span_id: `joint-span-${tag}` })
      )
      insert('source_class_marks', rows.sourceClass(`source-class-${tag}`, caseId))
      insert('copy_marks', rows.copyMark(`copy-mark-${tag}`, caseId))
      insert('withheld_flags', rows.withheld(`withheld-${tag}`, caseId, `cap-${tag}`))
      insert('own_identifiers', rows.ownIdentifier(`own-identifier-${tag}`, caseId))
      insert('investigation_runs', rows.run(`run-${tag}`, caseId))
      insert('investigation_run_basis', { run_id: `run-${tag}`, kind: 'note', ref_id: 'n' })
      insert('investigation_run_candidates', {
        run_id: `run-${tag}`,
        ord: 0,
        rule: 'shared-identifier',
        exhibit_id: `cap-${tag}`,
        content_hash: HASH,
        field: 'header.from',
        locator: '{}'
      })
      insert('investigation_run_proposals', {
        run_id: `run-${tag}`,
        joint_id: `joint-${tag}`,
        proposal_hash: 'p',
        created: 1
      })
    }

    it('removes every row the Case had and leaves another Case as it was', () => {
      const doomed = createCase({ name: 'Doomed' }).id
      const kept = createCase({ name: 'Kept' }).id
      populate(doomed, 'doomed')
      populate(kept, 'kept')
      for (const table of NEW_TABLES.filter((t) => !t.startsWith('investigation_run_'))) {
        expect(count(table, 'case_id = ?', doomed), table).toBeGreaterThan(0)
      }
      const keptBefore = Object.fromEntries(NEW_TABLES.map((table) => [table, count(table)]))
      const keptRevision = revision(kept)

      expect(deleteCase(doomed)).toBe(true)

      for (const table of [...NEW_TABLES, ...INPUT_TABLES.slice(0, 5)]) {
        if (table.startsWith('investigation_run_')) {
          expect(count(table, 'run_id = ?', 'run-doomed'), table).toBe(0)
        } else {
          expect(count(table, 'case_id = ?', doomed), table).toBe(0)
        }
      }
      for (const table of NEW_TABLES) {
        const keptRows = table.startsWith('investigation_run_')
          ? count(table, 'run_id = ?', 'run-kept')
          : count(table, 'case_id = ?', kept)
        expect(keptRows, table).toBe(keptBefore[table] / 2)
      }
      expect(revision(kept)).toEqual(keptRevision)
      expect(getDb().pragma('foreign_key_check')).toEqual([])
    })
  })

  describe('per-author keys and eligibility', () => {
    let caseId: string

    beforeEach(async () => {
      await initDatabase(':memory:')
      caseId = createCase({ name: 'Keys' }).id
    })

    it('accepts one document Subject and one Joint per author, and refuses a second', () => {
      const document = { bound_exhibit_id: 'exhibit-1' }
      insert('subjects', rows.subject('local', caseId, document))
      insert(
        'subjects',
        rows.subject('remote', caseId, { ...document, author_installation_id: REMOTE })
      )
      expect(() => insert('subjects', rows.subject('local-again', caseId, document))).toThrow(
        /UNIQUE/
      )
      expect(() =>
        insert(
          'subjects',
          rows.subject('remote-again', caseId, { ...document, author_installation_id: REMOTE })
        )
      ).toThrow(/UNIQUE/)

      const identity = { identity_hash: 'one-claim' }
      insert('joints', rows.joint('j-local', caseId, 'local', identity))
      insert(
        'joints',
        rows.joint('j-remote', caseId, 'local', { ...identity, author_installation_id: REMOTE })
      )
      expect(() =>
        insert('joints', rows.joint('j-local-again', caseId, 'local', identity))
      ).toThrow(/UNIQUE/)
      expect(() =>
        insert(
          'joints',
          rows.joint('j-remote-again', caseId, 'local', {
            ...identity,
            author_installation_id: REMOTE
          })
        )
      ).toThrow(/UNIQUE/)
    })

    it('reads an Exhibit as eligible unless a live withheld head is set', () => {
      for (const [n, id] of ['unflagged', 'cleared', 'withheld'].entries()) {
        insert('exhibits', rows.exhibit(id, caseId, n + 1))
      }
      insert('withheld_flags', rows.withheld('set-then-cleared', caseId, 'cleared'))
      insert(
        'withheld_flags',
        rows.withheld('clear', caseId, 'cleared', {
          action: 'clear',
          replaces: JSON.stringify(['set-then-cleared'])
        })
      )
      insert('withheld_flags', rows.withheld('set', caseId, 'withheld'))

      const eligible = getDb()
        .prepare('SELECT id FROM analysis_eligible_exhibits WHERE case_id = ? ORDER BY id')
        .all(caseId)
        .map((row) => (row as { id: string }).id)
      expect(eligible).toEqual(['cleared', 'unflagged'])
    })
  })
})
