import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, updateCase, listCases } from '@main/services/db/caseRepo'
import { insertCapture, getCapture, getCaptureTextContent } from '@main/services/db/captureRepo'
import { AnchorCaseMismatchError } from '@main/services/db/noteRepo'
import { MentionCaseMismatchError } from '@main/services/db/noteReferenceRepo'
import { createNote, getNote } from '@main/services/db/noteRepo'
import { saveAnnotations, upsertPin } from '@main/services/annotations'
import { addTagToCapture, addTagToNote, createTag } from '@main/services/db/tagRepo'
import { insertDerivedFile } from '@main/services/db/derivedFileRepo'
import {
  getDbStats,
  getTableRows,
  getTableColumns,
  ALLOWED_TABLES,
  createRow,
  updateRow,
  deleteRow,
  vacuumDb,
  checkIntegrity,
  rebuildFts,
  purgeArchived,
  findOrphans,
  cleanOrphans,
  exportTableData,
  SharedCaseRowError
} from '@main/services/db/dbAdmin'

describe('dbAdmin', () => {
  beforeEach(async () => {
    await initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
  })

  describe('checkIntegrity', () => {
    it('passes for a populated database without changing its records', () => {
      createCase({ name: 'Integrity fixture' })
      const db = getDb()
      const before = db.prepare('SELECT total_changes() AS count').get()
      const cases = listCases()
      expect(checkIntegrity()).toEqual({ ok: true, issues: [] })
      expect(listCases()).toEqual(cases)
      expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before)
    })

    it('reports a known broken constraint without repairing the row', () => {
      const db = getDb()
      db.exec('CREATE TABLE integrity_fixture (value INTEGER CHECK (value > 0))')
      db.pragma('ignore_check_constraints = ON')
      db.exec('INSERT INTO integrity_fixture VALUES (-1)')
      db.pragma('ignore_check_constraints = OFF')
      expect(checkIntegrity()).toEqual({
        ok: false,
        issues: ['CHECK constraint failed in integrity_fixture']
      })
      expect(db.prepare('SELECT value FROM integrity_fixture').get()).toEqual({ value: -1 })
    })

    it('reports foreign-key violations even when SQLite structural integrity passes', () => {
      const db = getDb()
      db.exec('CREATE TABLE integrity_child (parent TEXT REFERENCES cases(id))')
      db.pragma('foreign_keys = OFF')
      db.exec("INSERT INTO integrity_child VALUES ('missing-case')")
      db.pragma('foreign_keys = ON')
      expect(checkIntegrity()).toEqual({
        ok: false,
        issues: [
          'Foreign key violation in integrity_child, row 1, referencing cases (constraint 0).'
        ]
      })
    })

    // Review finding on #1877: the keys these columns lost were what foreign_key_check read.
    it('reports an annotation layer, pin or tag application on a Capture neither held nor recorded', () => {
      const db = getDb()
      const tag = createTag({ name: 'Orphaned' })
      db.prepare(
        `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width,
           image_height, updated_at) VALUES ('gone', 1, '[]', 1, 1, '2026-01-01T00:00:00.000Z')`
      ).run()
      db.prepare(
        `INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at)
         VALUES ('pin', 'gone', 1, '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
      ).run()
      db.prepare("INSERT INTO exhibit_tags (exhibit_id, tag_id) VALUES ('gone', ?)").run(tag.id)
      const kept = createCase({ name: 'Shared' })
      db.prepare('INSERT INTO deleted_captures (id, case_id) VALUES (?, ?)').run('kept', kept.id)
      db.prepare("INSERT INTO exhibit_tags (exhibit_id, tag_id) VALUES ('kept', ?)").run(tag.id)

      expect(checkIntegrity()).toEqual({
        ok: false,
        issues: [
          'Missing reference in annotations, row 1, referencing captures.',
          'Missing reference in annotation_pins, row 1, referencing captures.',
          'Missing reference in exhibit_tags, row 1, referencing exhibits.'
        ]
      })
    })
  })

  describe('getDbStats', () => {
    it('returns schema version and table row counts', () => {
      createCase({ name: 'Test' })
      const stats = getDbStats(':memory:')
      expect(stats.schemaVersion).toBeGreaterThanOrEqual(9)
      expect(stats.tables.length).toBeGreaterThan(0)
      const casesTable = stats.tables.find((t) => t.name === 'cases')
      expect(casesTable).toBeDefined()
      expect(casesTable!.rowCount).toBe(1)
    })
  })

  describe('getTableColumns', () => {
    it('returns column info for a valid table', () => {
      const cols = getTableColumns('cases')
      expect(cols.length).toBeGreaterThan(0)
      const idCol = cols.find((c) => c.name === 'id')
      expect(idCol).toBeDefined()
      expect(idCol!.pk).toBe(true)
    })

    it('throws for an invalid table name', () => {
      expect(() => getTableColumns('evil_table')).toThrow('not allowed')
    })
  })

  describe('getTableRows', () => {
    it('returns paginated rows', () => {
      createCase({ name: 'A' })
      createCase({ name: 'B' })
      createCase({ name: 'C' })
      const result = getTableRows({ table: 'cases', offset: 0, limit: 2 })
      expect(result.rows).toHaveLength(2)
      expect(result.total).toBe(3)
      expect(result.columns.length).toBeGreaterThan(0)
    })

    it('respects offset', () => {
      createCase({ name: 'A' })
      createCase({ name: 'B' })
      createCase({ name: 'C' })
      const result = getTableRows({ table: 'cases', offset: 2, limit: 10 })
      expect(result.rows).toHaveLength(1)
      expect(result.total).toBe(3)
    })

    it('throws for an invalid table name', () => {
      expect(() => getTableRows({ table: 'nope', offset: 0, limit: 10 })).toThrow('not allowed')
    })

    it('clamps invalid pagination values', () => {
      createCase({ name: 'A' })
      createCase({ name: 'B' })
      createCase({ name: 'C' })
      const result = getTableRows({ table: 'cases', offset: -10, limit: -1 })
      expect(result.rows).toHaveLength(1)
      expect(result.total).toBe(3)
    })
  })

  describe('ALLOWED_TABLES', () => {
    it('includes all expected tables', () => {
      expect(ALLOWED_TABLES).toContain('cases')
      expect(ALLOWED_TABLES).toContain('captures')
      expect(ALLOWED_TABLES).toContain('tags')
      expect(ALLOWED_TABLES).toContain('notes')
    })

    it('excludes derived FTS indexes from admin editing', () => {
      expect(ALLOWED_TABLES).not.toContain('captures_fts')
      expect(ALLOWED_TABLES).not.toContain('notes_fts')
    })
  })

  describe('createRow', () => {
    it('inserts a row and returns it', () => {
      const row = createRow('tags', { id: 'tag-1', name: 'Evidence', color: '#ff0000' })
      expect(row).toMatchObject({ id: 'tag-1', name: 'Evidence', color: '#ff0000' })
    })

    it('throws for FTS tables', () => {
      expect(() => createRow('captures_fts', { title: 'x' })).toThrow('not allowed')
    })

    it('throws for invalid column names', () => {
      expect(() => createRow('tags', { id: 'x', name: 'x', evil: 'yes' })).toThrow('does not exist')
    })
  })

  // notes.anchor_json is parsed on every note read, so a malformed value
  // written through the admin escape hatch does not corrupt one row -- it
  // takes out listNotes, getNote and searchNotes together.
  describe('structured column values', () => {
    const VALID_ANCHOR = JSON.stringify({ kind: 'capture', captureId: 'cap-1' })

    function newCase(): string {
      return createCase({ name: 'Admin', description: '' }).id
    }

    function noteRow(id: string, caseId: string): Record<string, unknown> {
      return {
        id,
        case_id: caseId,
        title: 'T',
        body: '',
        created_at: '2026-07-25T00:00:00Z',
        updated_at: '2026-07-25T00:00:00Z'
      }
    }

    it('rejects an unparseable anchor_json on create', () => {
      expect(() =>
        createRow('notes', { id: 'n-1', case_id: newCase(), anchor_json: '{oops' })
      ).toThrow(/not valid JSON/)
    })

    it('rejects a structurally invalid anchor_json on create', () => {
      expect(() =>
        createRow('notes', {
          id: 'n-2',
          case_id: newCase(),
          anchor_json: JSON.stringify({ kind: 'vibes', captureId: 'c' })
        })
      ).toThrow(/anchor kind/i)
    })

    it('rejects a malformed anchor_json on update', () => {
      const caseId = newCase()
      createRow('notes', { ...noteRow('n-3', caseId), anchor_json: VALID_ANCHOR })

      expect(() => updateRow('notes', { id: 'n-3' }, { anchor_json: 'nonsense' })).toThrow(
        /not valid JSON/
      )
    })

    it('still allows a valid anchor, and allows clearing one to NULL', () => {
      const caseId = newCase()
      expect(() =>
        createRow('notes', { ...noteRow('n-4', caseId), anchor_json: VALID_ANCHOR })
      ).not.toThrow()
      expect(updateRow('notes', { id: 'n-4' }, { anchor_json: null })).toBe(true)
    })

    it('leaves unstructured columns on other tables alone', () => {
      expect(() => createRow('tags', { id: 't-1', name: '{not json' })).not.toThrow()
    })

    // anchor_kind is derived everywhere else so it cannot disagree with the
    // payload. The admin surface must not be the one place that can.
    function anchorRow(id: string): Record<string, unknown> {
      return getTableRows({ table: 'notes', offset: 0, limit: 50 }).rows.find(
        (r) => r.id === id
      ) as Record<string, unknown>
    }

    it('derives anchor_kind from the payload rather than trusting the submitted one', () => {
      const caseId = newCase()
      createRow('notes', {
        ...noteRow('n-5', caseId),
        anchor_json: JSON.stringify({ kind: 'capture', captureId: 'cap-1' }),
        anchor_kind: 'text'
      })

      expect(anchorRow('n-5').anchor_kind).toBe('capture')
    })

    it('clears anchor_kind when the payload is cleared', () => {
      const caseId = newCase()
      createRow('notes', { ...noteRow('n-6', caseId), anchor_json: VALID_ANCHOR })
      expect(anchorRow('n-6').anchor_kind).toBe('capture')

      updateRow('notes', { id: 'n-6' }, { anchor_json: null })

      expect(anchorRow('n-6').anchor_kind).toBeNull()
    })

    it('re-derives anchor_kind when the payload changes kind', () => {
      const caseId = newCase()
      createRow('notes', { ...noteRow('n-7', caseId), anchor_json: VALID_ANCHOR })

      updateRow(
        'notes',
        { id: 'n-7' },
        {
          anchor_json: JSON.stringify({
            kind: 'text',
            captureId: 'cap-1',
            quote: 'q',
            prefix: '',
            suffix: '',
            textOffset: 0
          })
        }
      )

      expect(anchorRow('n-7').anchor_kind).toBe('text')
    })

    it('refuses to set the derived anchor_kind on its own', () => {
      const caseId = newCase()
      createRow('notes', { ...noteRow('n-8', caseId), anchor_json: VALID_ANCHOR })

      expect(() => updateRow('notes', { id: 'n-8' }, { anchor_kind: 'region' })).toThrow(
        /derived from anchor_json/
      )
      expect(anchorRow('n-8').anchor_kind).toBe('capture')
    })

    // #234: Database Admin is a genuine fourth write path for notes.anchor_json
    // (alongside createNote/updateNote/importNoteRows) and easy to forget --
    // it must not be the one place a cross-case anchor slips through.
    describe('case-membership (#234)', () => {
      function captureInCase(caseIdForCapture: string) {
        return insertCapture({
          caseId: caseIdForCapture,
          url: 'https://example.com',
          title: 'Elsewhere',
          hash: 'abc123',
          timestamp: new Date().toISOString()
        })
      }

      it('rejects a cross-case anchor_json on create', () => {
        const caseId = newCase()
        const otherCaseId = newCase()
        const capture = captureInCase(otherCaseId)

        expect(() =>
          createRow('notes', {
            ...noteRow('n-9', caseId),
            anchor_json: JSON.stringify({ kind: 'capture', captureId: capture.id })
          })
        ).toThrow(AnchorCaseMismatchError)
      })

      it('allows a same-case anchor_json on create', () => {
        const caseId = newCase()
        const capture = captureInCase(caseId)

        expect(() =>
          createRow('notes', {
            ...noteRow('n-10', caseId),
            anchor_json: JSON.stringify({ kind: 'capture', captureId: capture.id })
          })
        ).not.toThrow()
      })

      it('rejects a cross-case anchor_json on update, resolving the row’s case from its pk when case_id is not in the payload', () => {
        const caseId = newCase()
        const otherCaseId = newCase()
        const capture = captureInCase(otherCaseId)
        createRow('notes', noteRow('n-11', caseId))

        expect(() =>
          updateRow(
            'notes',
            { id: 'n-11' },
            { anchor_json: JSON.stringify({ kind: 'capture', captureId: capture.id }) }
          )
        ).toThrow(AnchorCaseMismatchError)
      })

      it('allows an anchor targeting a captureId that does not exist at all', () => {
        const caseId = newCase()

        expect(() =>
          createRow('notes', { ...noteRow('n-12', caseId), anchor_json: VALID_ANCHOR })
        ).not.toThrow()
      })

      // A payload that moves case_id without resupplying anchor_json still
      // carries the row's stored anchor with it -- validatedRow only checks
      // when the payload itself writes anchor_json, so this is the path that
      // would otherwise create a cross-case anchor through a write, not just
      // preserve one that predates the rule.
      it('rejects a case_id-only move that would orphan the anchor into another case', () => {
        const caseId = newCase()
        const otherCaseId = newCase()
        const capture = captureInCase(caseId)
        createRow('notes', {
          ...noteRow('n-13', caseId),
          anchor_json: JSON.stringify({ kind: 'capture', captureId: capture.id })
        })

        expect(() => updateRow('notes', { id: 'n-13' }, { case_id: otherCaseId })).toThrow(
          AnchorCaseMismatchError
        )
        // The rejected move must not have partially landed.
        expect(anchorRow('n-13').case_id).toBe(caseId)
      })

      it('allows a case_id-only move for a note with no anchor', () => {
        const caseId = newCase()
        const otherCaseId = newCase()
        createRow('notes', noteRow('n-14', caseId))

        expect(updateRow('notes', { id: 'n-14' }, { case_id: otherCaseId })).toBe(true)
        expect(anchorRow('n-14').case_id).toBe(otherCaseId)
      })

      it('allows a case move whose stored anchor already belongs to the destination case', () => {
        const caseId = newCase()
        const capture = captureInCase(caseId)
        createRow('notes', {
          ...noteRow('n-15', caseId),
          anchor_json: JSON.stringify({ kind: 'capture', captureId: capture.id })
        })

        expect(updateRow('notes', { id: 'n-15' }, { case_id: caseId })).toBe(true)
      })

      // A `pk` that does not uniquely identify a row lets the case/anchor
      // validation above check only the first row `.get(...)` happens to
      // return, while the `UPDATE ... WHERE` it guards writes every matching
      // row -- a note in a case the validation never looked at could receive
      // the same, unvalidated anchor. `{ anchor_kind: 'capture' }` matches
      // both notes below even though only one shares the incoming anchor's
      // case.
      it('rejects a non-unique pk predicate rather than validating one row and writing many', () => {
        const caseA = newCase()
        const caseB = newCase()
        const captureA = captureInCase(caseA)
        const captureB = captureInCase(caseB)
        createRow('notes', {
          ...noteRow('n-20', caseA),
          anchor_json: JSON.stringify({ kind: 'capture', captureId: captureA.id })
        })
        createRow('notes', {
          ...noteRow('n-21', caseB),
          anchor_json: JSON.stringify({ kind: 'capture', captureId: captureB.id })
        })

        expect(() =>
          updateRow(
            'notes',
            { anchor_kind: 'capture' },
            { anchor_json: JSON.stringify({ kind: 'capture', captureId: captureA.id }) }
          )
        ).toThrow(/primary key/)

        // The rejected multi-row write must not have partially landed:
        // n-21 (case B) must not have picked up an anchor into case A.
        expect(anchorRow('n-21').anchor_json).toContain(captureB.id)
      })
    })

    // #389, maintainer ruling 2026-08-20: body_doc is the fourth write path
    // for the references index, so the admin hatch must derive `body` and
    // rewrite the index like every other path. Left unguarded it would be the
    // one place a note's document and its references could drift apart.
    describe('body_doc and the references index (#389)', () => {
      const docWith = (...inline: Record<string, unknown>[]): string =>
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: inline }] })

      const mentionOf = (targetType: string, targetId: string): Record<string, unknown> => ({
        type: 'mention',
        attrs: { targetType, targetId, label: '' }
      })

      function captureInCase(caseIdForCapture: string) {
        return insertCapture({
          caseId: caseIdForCapture,
          url: 'https://example.com',
          title: 'Mentioned',
          hash: 'abc123',
          timestamp: new Date().toISOString()
        })
      }

      function refs(noteId: string): Array<Record<string, unknown>> {
        return getDb()
          .prepare('SELECT * FROM note_references WHERE note_id = ? ORDER BY ord')
          .all(noteId) as Array<Record<string, unknown>>
      }

      it('rejects an unparseable body_doc on create', () => {
        expect(() =>
          createRow('notes', { ...noteRow('b-1', newCase()), body_doc: '{oops' })
        ).toThrow(/not valid JSON/)
      })

      it('rejects a body_doc carrying a malformed Mention', () => {
        expect(() =>
          createRow('notes', {
            ...noteRow('b-2', newCase()),
            body_doc: docWith(mentionOf('bogus', 'x'))
          })
        ).toThrow(/targetType/)
      })

      it('writes the index from the document on create', () => {
        const caseId = newCase()
        createRow('notes', {
          ...noteRow('b-3', caseId),
          body_doc: docWith(mentionOf('tag', 'tag-1'), mentionOf('tag', 'tag-2'))
        })

        expect(refs('b-3')).toEqual([
          { note_id: 'b-3', ord: 0, target_type: 'tag', target_id: 'tag-1' },
          { note_id: 'b-3', ord: 1, target_type: 'tag', target_id: 'tag-2' }
        ])
      })

      it('rewrites the index on update, replacing the previous set', () => {
        const caseId = newCase()
        createRow('notes', {
          ...noteRow('b-4', caseId),
          body_doc: docWith(mentionOf('tag', 't-a'))
        })

        updateRow('notes', { id: 'b-4' }, { body_doc: docWith(mentionOf('tag', 't-b')) })

        expect(refs('b-4')).toEqual([
          { note_id: 'b-4', ord: 0, target_type: 'tag', target_id: 't-b' }
        ])
      })

      it('clears the index when body_doc is cleared to NULL', () => {
        const caseId = newCase()
        createRow('notes', {
          ...noteRow('b-5', caseId),
          body_doc: docWith(mentionOf('tag', 't-a'))
        })

        updateRow('notes', { id: 'b-5' }, { body_doc: null })

        expect(refs('b-5')).toEqual([])
        expect(anchorRow('b-5').body_doc).toBeNull()
      })

      // `body` is derived from the document everywhere else, so the hatch
      // must not be the one place a submitted body can contradict it — that
      // is the pre-existing drift this guard closes.
      it('derives body from the document, overriding a body submitted alongside it', () => {
        const caseId = newCase()
        createRow('notes', {
          ...noteRow('b-6', caseId),
          body: 'a body the document does not contain',
          body_doc: docWith({ type: 'text', text: 'what the document says' })
        })

        expect(anchorRow('b-6').body).toBe('what the document says')
      })

      it('rejects a cross-case Mention on create, writing no row', () => {
        const caseId = newCase()
        const capture = captureInCase(newCase())

        expect(() =>
          createRow('notes', {
            ...noteRow('b-7', caseId),
            body_doc: docWith(mentionOf('capture', capture.id))
          })
        ).toThrow(MentionCaseMismatchError)
        expect(anchorRow('b-7')).toBeUndefined()
        // Both halves of the transaction, not just the row: the index exists
        // to be written with the note, so it must be absent with it too.
        expect(refs('b-7')).toEqual([])
      })

      it('rejects a cross-case Mention on update, leaving the stored index intact', () => {
        const caseId = newCase()
        const local = captureInCase(caseId)
        const foreign = captureInCase(newCase())
        createRow('notes', {
          ...noteRow('b-8', caseId),
          body_doc: docWith(mentionOf('capture', local.id))
        })

        expect(() =>
          updateRow('notes', { id: 'b-8' }, { body_doc: docWith(mentionOf('capture', foreign.id)) })
        ).toThrow(MentionCaseMismatchError)
        expect(refs('b-8')).toEqual([
          { note_id: 'b-8', ord: 0, target_type: 'capture', target_id: local.id }
        ])
      })

      // The same hole the anchor guard closes: a case_id move carries the
      // stored document's mentions into a case they do not belong to.
      it('rejects a case_id-only move that would orphan the document’s Mentions', () => {
        const caseId = newCase()
        const otherCaseId = newCase()
        const capture = captureInCase(caseId)
        createRow('notes', {
          ...noteRow('b-9', caseId),
          body_doc: docWith(mentionOf('capture', capture.id))
        })

        expect(() => updateRow('notes', { id: 'b-9' }, { case_id: otherCaseId })).toThrow(
          MentionCaseMismatchError
        )
        expect(anchorRow('b-9').case_id).toBe(caseId)
      })

      // A row drifted by a hatch write predating this guard (#662) cannot have
      // its Mentions checked, so the move is refused — but the operator
      // touched only case_id, and a bare "does not fit the note schema" would
      // point them at the wrong column.
      it('refuses a case_id-only move for an unparseable stored body_doc, naming it', () => {
        const caseId = newCase()
        const otherCaseId = newCase()
        createRow('notes', noteRow('b-12', caseId))
        getDb().prepare('UPDATE notes SET body_doc = ? WHERE id = ?').run('{not json', 'b-12')

        expect(() => updateRow('notes', { id: 'b-12' }, { case_id: otherCaseId })).toThrow(
          /notes\.body_doc for this row does not parse/
        )
        expect(anchorRow('b-12').case_id).toBe(caseId)
      })

      it('allows a case_id-only move for a note whose Mentions are global tags', () => {
        const caseId = newCase()
        const otherCaseId = newCase()
        createRow('notes', { ...noteRow('b-10', caseId), body_doc: docWith(mentionOf('tag', 't')) })

        expect(updateRow('notes', { id: 'b-10' }, { case_id: otherCaseId })).toBe(true)
      })

      it('rejects a non-string body_doc rather than storing it', () => {
        expect(() => createRow('notes', { ...noteRow('b-11', newCase()), body_doc: 42 })).toThrow(
          /must be a string or NULL/
        )
      })
    })
  })

  describe('updateRow', () => {
    it('updates a row by primary key', () => {
      createRow('tags', { id: 'tag-1', name: 'Old', color: '#000' })
      const result = updateRow('tags', { id: 'tag-1' }, { name: 'New' })
      expect(result).toBe(true)
      const rows = getTableRows({ table: 'tags', offset: 0, limit: 10 })
      expect(rows.rows[0]).toMatchObject({ name: 'New' })
    })

    it('returns false for non-existent row', () => {
      const result = updateRow('tags', { id: 'nope' }, { name: 'x' })
      expect(result).toBe(false)
    })

    it('returns false when no fields are provided', () => {
      createRow('tags', { id: 'tag-1', name: 'Old', color: '#000' })
      const result = updateRow('tags', { id: 'tag-1' }, {})
      expect(result).toBe(false)
    })

    // `pk` is caller-supplied and only checked for valid column names --
    // nothing else guarantees it names the table's actual primary key.
    // `color` has no uniqueness constraint, unlike `name`.
    it('rejects a pk that names a valid but non-unique column instead of the primary key', () => {
      createRow('tags', { id: 'tag-1', name: 'Alpha', color: 'shared' })
      createRow('tags', { id: 'tag-2', name: 'Beta', color: 'shared' })

      expect(() => updateRow('tags', { color: 'shared' }, { color: 'changed' })).toThrow(
        /primary key/
      )

      // Neither row must have been touched by the rejected write.
      const rows = getTableRows({ table: 'tags', offset: 0, limit: 10 })
      expect(rows.rows.map((r) => r.color).sort()).toEqual(['shared', 'shared'])
    })
  })

  describe('deleteRow', () => {
    it('deletes a row by primary key', () => {
      createRow('tags', { id: 'tag-1', name: 'Test' })
      const result = deleteRow('tags', { id: 'tag-1' })
      expect(result).toBe(true)
      const rows = getTableRows({ table: 'tags', offset: 0, limit: 10 })
      expect(rows.rows).toHaveLength(0)
    })

    it('returns false for non-existent row', () => {
      const result = deleteRow('tags', { id: 'nope' })
      expect(result).toBe(false)
    })

    it('throws for FTS tables', () => {
      expect(() => deleteRow('captures_fts', { rowid: '1' })).toThrow('not allowed')
    })

    it('rejects a pk that names a valid but non-unique column instead of the primary key', () => {
      createRow('tags', { id: 'tag-1', name: 'Alpha', color: 'shared' })
      createRow('tags', { id: 'tag-2', name: 'Beta', color: 'shared' })

      expect(() => deleteRow('tags', { color: 'shared' })).toThrow(/primary key/)

      const rows = getTableRows({ table: 'tags', offset: 0, limit: 10 })
      expect(rows.rows).toHaveLength(2)
    })
  })

  describe('vacuum', () => {
    it('runs without error and returns a result', () => {
      const result = vacuumDb(':memory:')
      expect(result).toHaveProperty('freedBytes')
      expect(typeof result.freedBytes).toBe('number')
    })
  })

  describe('rebuildFts', () => {
    it('rebuilds FTS indexes and preserves capture text content', () => {
      const c = createCase({ name: 'Test' })
      const cap = insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'abc123',
        timestamp: new Date().toISOString(),
        textContent: 'hello world'
      })
      const result = rebuildFts({ readArtifact: () => null })
      expect(result.rowsIndexed).toBeGreaterThanOrEqual(1)
      // no sidecar on disk → the DB copy of the text survives the rebuild
      expect(getCaptureTextContent(cap.id)).toBe('hello world')
    })
  })

  describe('purgeArchived', () => {
    it('deletes archived cases and returns counts', () => {
      const active = createCase({ name: 'Active' })
      const archived = createCase({ name: 'Archived' })
      updateCase({ id: archived.id, archived: true })

      const result = purgeArchived()
      expect(result.casesDeleted).toBe(1)
      const remaining = listCases()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(active.id)
    })
  })

  describe('findOrphans', () => {
    it('returns empty report when no orphans exist', () => {
      const result = findOrphans()
      expect(result.dbOrphans).toHaveLength(0)
      expect(result.fileOrphans).toHaveLength(0)
    })

    // A renamed import restores the source's thumbnail under the name its
    // signed entry gives it, which no Capture id here matches (#1813).
    it('keeps a flat file a derived_files row records, whatever id its name carries', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'bb-db-admin-derived-'))
      try {
        initStorage(tempDir)
        const caseId = createCase({ name: 'Imported', description: '' }).id
        ensureCaseDir(caseId)
        const parent = insertCapture({
          caseId,
          url: 'https://example.com/renamed',
          title: 'Renamed',
          hash: 'h',
          timestamp: '2026-01-01T00:00:00.000Z'
        }).id
        const recorded = join(caseId, 'source-capture-id_thumb.jpg')
        const stray = join(caseId, 'unknown-capture-id_thumb.jpg')
        for (const rel of [recorded, stray]) writeFileSync(join(tempDir, rel), 'jpeg')
        insertDerivedFile({
          exhibitId: parent,
          derivation: 'thumbnail',
          toolVersion: '0.1.0',
          contentHash: 'c'.repeat(64),
          path: recorded,
          createdAt: '2026-01-01T00:00:00.000Z',
          manifestSeq: 0
        })

        expect(findOrphans().fileOrphans).toEqual([stray])
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  // The capture engine's two files: a stray is reported, and a missing one never
  // reports its Capture (open question F of the capture engine first-slice plan).
  describe('findOrphans and the Transaction Record and PDF', () => {
    let tempDir: string
    let caseId: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'bb-db-admin-engine-'))
      initStorage(tempDir)
      caseId = createCase({ name: 'Engine', description: '' }).id
      ensureCaseDir(caseId)
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    function seedCapture(id: string, files: Array<'warc.gz' | 'pdf'>): string {
      const mhtml = defaultCaptureStore.artifactPaths(caseId, id, 'mhtml')
      insertCapture({
        id,
        caseId,
        url: `https://example.com/${id}`,
        title: id,
        hash: 'h',
        timestamp: '2026-10-18T12:00:00.000Z',
        format: 'mhtml',
        mhtmlPath: mhtml.rel
      })
      writeFileSync(mhtml.abs, 'mhtml')
      for (const type of files) {
        writeFileSync(defaultCaptureStore.artifactPaths(caseId, id, type).abs, type)
      }
      return id
    }

    it("reports a stray .warc.gz and .pdf, and never a live Capture's", () => {
      seedCapture('live', ['warc.gz', 'pdf'])
      const strays = ['ghost-capture.warc.gz', 'ghost-capture.pdf'].map((name) => {
        writeFileSync(join(tempDir, caseId, name), 'stray')
        return join(caseId, name)
      })

      const report = findOrphans()

      expect(report.dbOrphans).toEqual([])
      expect([...report.fileOrphans].sort()).toEqual([...strays].sort())
    })

    it('leaves a Capture whose Transaction Record or PDF is missing out of the report', () => {
      const noRecord = seedCapture('no-record', ['pdf'])
      const noPdf = seedCapture('no-pdf', ['warc.gz'])

      const report = findOrphans()
      expect(report).toEqual({ dbOrphans: [], fileOrphans: [] })
      expect(cleanOrphans(report)).toEqual({ dbRecordsRemoved: 0, filesRemoved: 0 })

      expect(getCapture(noRecord)).toBeDefined()
      expect(getCapture(noPdf)).toBeDefined()
      for (const [id, type] of [
        [noRecord, 'mhtml'],
        [noRecord, 'pdf'],
        [noPdf, 'mhtml'],
        [noPdf, 'warc.gz']
      ] as const) {
        expect(existsSync(defaultCaptureStore.artifactPaths(caseId, id, type).abs)).toBe(true)
      }
    })
  })

  describe('exportTableData', () => {
    it('exports table as CSV string', () => {
      createRow('tags', { id: 'tag-1', name: 'Urgent', color: '#ff0000' })
      createRow('tags', { id: 'tag-2', name: 'Review', color: null })
      const csv = exportTableData('tags', 'csv')
      expect(csv).toContain('id,name,color')
      expect(csv).toContain('tag-1')
      expect(csv).toContain('Urgent')
    })

    it('exports table as JSON string', () => {
      createRow('tags', { id: 'tag-1', name: 'Urgent', color: '#ff0000' })
      const json = exportTableData('tags', 'json')
      const parsed = JSON.parse(json)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe('Urgent')
    })
  })

  // exhibit_tags has no declared primary key since migration 39 (#1512); its
  // row is named by the unique index's columns, author included.
  describe('exhibit_tags row key', () => {
    let captureId: string
    let tagId: string

    beforeEach(() => {
      const caseId = createCase({ name: 'Keyed', description: '' }).id
      captureId = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'T',
        hash: 'h',
        timestamp: '2026-01-01T00:00:00.000Z'
      }).id
      tagId = createTag({ name: 'Evidence' }).id
      addTagToCapture({ captureId, tagId })
      getDb()
        .prepare(
          'INSERT INTO exhibit_tags (exhibit_id, tag_id, author_installation_id) VALUES (?, ?, ?)'
        )
        .run(captureId, tagId, 'installation-remote')
    })

    it('reports the index columns as the key', () => {
      expect(
        getTableColumns('exhibit_tags')
          .filter((c) => c.pk)
          .map((c) => c.name)
      ).toEqual(['exhibit_id', 'tag_id', 'author_installation_id'])
    })

    it('names this installation’s row with an empty author, and refuses a key without one', () => {
      expect(() => deleteRow('exhibit_tags', { exhibit_id: captureId, tag_id: tagId })).toThrow(
        /primary key/
      )
      expect(
        deleteRow('exhibit_tags', {
          exhibit_id: captureId,
          tag_id: tagId,
          author_installation_id: ''
        })
      ).toBe(true)
      const left = getTableRows({ table: 'exhibit_tags', offset: 0, limit: 10 }).rows
      expect(left.map((r) => r.author_installation_id)).toEqual(['installation-remote'])
      expect(
        updateRow(
          'exhibit_tags',
          { exhibit_id: captureId, tag_id: tagId, author_installation_id: 'installation-remote' },
          { version: 2 }
        )
      ).toBe(true)
      expect(getTableRows({ table: 'exhibit_tags', offset: 0, limit: 10 }).rows[0].version).toBe(2)
    })
  })

  // Ruling 2 of 13 October 2026 on #1512: the hatch refuses a Shared Case's
  // synced rows. A Case nobody shared keeps every write it had.
  describe('Shared Case rows', () => {
    let shared: { caseId: string; captureId: string; noteId: string }
    let local: { caseId: string; captureId: string; noteId: string }
    let tags: { onExhibit: string; onNoteOnly: string; local: string }

    function seedCase(name: string) {
      const caseId = createCase({ name, description: '' }).id
      const captureId = insertCapture({
        caseId,
        url: `https://example.com/${name}`,
        title: name,
        hash: 'h',
        timestamp: '2026-01-01T00:00:00.000Z'
      }).id
      const noteId = createNote({ caseId, title: name, body: '' }).id
      return { caseId, captureId, noteId }
    }

    function noteRow(caseId: string, id: string) {
      return {
        id,
        case_id: caseId,
        title: 'T',
        body: '',
        created_at: '2026-10-13T00:00:00Z',
        updated_at: '2026-10-13T00:00:00Z'
      }
    }

    let storageDir: string

    beforeEach(() => {
      // A write in a Shared Case records its version in the Case directory
      // (#1512), so the storage root has to exist.
      storageDir = mkdtempSync(join(tmpdir(), 'bb-db-admin-shared-'))
      initStorage(storageDir)
      shared = seedCase('Shared')
      local = seedCase('Local')
      getDb()
        .prepare("UPDATE cases SET shared_at = '2026-10-01T00:00:00.000Z' WHERE id = ?")
        .run(shared.caseId)
      tags = {
        onExhibit: createTag({ name: 'On exhibit' }).id,
        onNoteOnly: createTag({ name: 'On note' }).id,
        local: createTag({ name: 'Local' }).id
      }
      addTagToCapture({ captureId: shared.captureId, tagId: tags.onExhibit })
      addTagToNote({ noteId: shared.noteId, tagId: tags.onNoteOnly })
      addTagToCapture({ captureId: local.captureId, tagId: tags.local })
    })

    afterEach(() => {
      rmSync(storageDir, { recursive: true, force: true })
    })

    const exhibitTagKey = (captureId: string, tagId: string) => ({
      exhibit_id: captureId,
      tag_id: tagId,
      author_installation_id: ''
    })

    it('refuses to create a note or a tag application in a Shared Case', () => {
      expect(() => createRow('notes', noteRow(shared.caseId, 'new-note'))).toThrow(
        SharedCaseRowError
      )
      expect(() =>
        createRow('exhibit_tags', { exhibit_id: shared.captureId, tag_id: tags.local })
      ).toThrow(SharedCaseRowError)
      expect(getTableRows({ table: 'notes', offset: 0, limit: 10 }).total).toBe(2)
      expect(getTableRows({ table: 'exhibit_tags', offset: 0, limit: 10 }).total).toBe(2)
    })

    it('refuses to change or delete a Shared Case’s note, tags and tag applications', () => {
      const refused: Array<() => unknown> = [
        () => updateRow('notes', { id: shared.noteId }, { title: 'Edited' }),
        () => deleteRow('notes', { id: shared.noteId }),
        () => updateRow('tags', { id: tags.onExhibit }, { color: '#000' }),
        () => deleteRow('tags', { id: tags.onExhibit }),
        () => updateRow('tags', { id: tags.onNoteOnly }, { name: 'Renamed' }),
        () => deleteRow('tags', { id: tags.onNoteOnly }),
        () =>
          updateRow('exhibit_tags', exhibitTagKey(shared.captureId, tags.onExhibit), {
            version: 1
          }),
        () => deleteRow('exhibit_tags', exhibitTagKey(shared.captureId, tags.onExhibit))
      ]
      for (const write of refused) expect(write).toThrow(SharedCaseRowError)
      expect(() => deleteRow('notes', { id: shared.noteId })).toThrow(
        'This notes row belongs to a Shared Case. The Settings > Database table editor does not create, change or delete rows of a Shared Case.'
      )
      expect(getTableRows({ table: 'tags', offset: 0, limit: 10 }).total).toBe(3)
      expect(getTableRows({ table: 'exhibit_tags', offset: 0, limit: 10 }).total).toBe(2)
    })

    // The Case row and every other table whose rows belong to a Case: the
    // pre-pass on PR #1865 cleared `shared_at` to lift the refusal, and
    // deleted a Shared Case's capture and Case rows to cascade away its notes,
    // annotations and pins.
    it('refuses to clear shared_at, or change or delete a Shared Case’s row', () => {
      const refused: Array<() => unknown> = [
        () => updateRow('cases', { id: shared.caseId }, { shared_at: null }),
        () => updateRow('cases', { id: shared.caseId }, { name: 'Renamed' }),
        () => deleteRow('cases', { id: shared.caseId }),
        () =>
          createRow('cases', {
            id: 'new-shared',
            name: 'New',
            created_at: '2026-10-13T00:00:00Z',
            updated_at: '2026-10-13T00:00:00Z',
            shared_at: '2026-10-13T00:00:00Z'
          }),
        () => updateRow('cases', { id: local.caseId }, { shared_at: '2026-10-13T00:00:00Z' })
      ]
      for (const write of refused) expect(write).toThrow(SharedCaseRowError)
      expect(() => updateRow('notes', { id: shared.noteId }, { title: 'Edited' })).toThrow(
        SharedCaseRowError
      )
      expect(
        listCases()
          .map((c) => c.name)
          .sort()
      ).toEqual(['Local', 'Shared'])
    })

    it('refuses to change or delete a Shared Case’s capture, keeping its annotations and pins', () => {
      const db = getDb()
      const layer = db.prepare(
        `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width,
           image_height, updated_at, author_installation_id)
         VALUES (?, 1, '[]', 1, 1, '2026-10-13T00:00:00Z', ?)`
      )
      layer.run(shared.captureId, null)
      layer.run(shared.captureId, 'installation-remote')
      db.prepare(
        `INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at)
         VALUES ('pin-1', ?, 1, 'pin', '2026-10-13T00:00:00Z', '2026-10-13T00:00:00Z')`
      ).run(shared.captureId)

      const refused: Array<() => unknown> = [
        () => deleteRow('captures', { id: shared.captureId }),
        () => updateRow('captures', { id: shared.captureId }, { title: 'Edited' }),
        () => updateRow('captures', { id: shared.captureId }, { case_id: local.caseId }),
        () => updateRow('captures', { id: local.captureId }, { case_id: shared.caseId }),
        () =>
          createRow('captures', {
            id: 'new-capture',
            case_id: shared.caseId,
            url: 'https://example.com/new',
            hash: 'h',
            timestamp: '2026-10-13T00:00:00Z',
            created_at: '2026-10-13T00:00:00Z'
          })
      ]
      for (const write of refused) expect(write).toThrow(SharedCaseRowError)
      const count = (table: string) =>
        (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
      expect([count('annotations'), count('annotation_pins'), count('captures')]).toEqual([2, 1, 2])
    })

    it('refuses a Shared Case’s selectors, selector matches and favorites', () => {
      const db = getDb()
      const selector = db.prepare(
        `INSERT INTO selectors (id, case_id, pattern, created_at)
         VALUES (?, ?, 'p', '2026-10-13T00:00:00Z')`
      )
      selector.run('shared-selector', shared.caseId)
      selector.run('local-selector', local.caseId)
      db.prepare('INSERT INTO selector_matches (selector_id, capture_id) VALUES (?, ?)').run(
        'shared-selector',
        shared.captureId
      )
      db.prepare(
        "INSERT INTO capture_favorites (capture_id, created_at) VALUES (?, '2026-10-13T00:00:00Z')"
      ).run(shared.captureId)

      const refused: Array<() => unknown> = [
        () => updateRow('selectors', { id: 'shared-selector' }, { pattern: 'q' }),
        () => deleteRow('selectors', { id: 'shared-selector' }),
        () => updateRow('selectors', { id: 'local-selector' }, { case_id: shared.caseId }),
        () =>
          deleteRow('selector_matches', {
            selector_id: 'shared-selector',
            capture_id: shared.captureId
          }),
        () =>
          createRow('selector_matches', {
            selector_id: 'local-selector',
            capture_id: shared.captureId
          }),
        () => deleteRow('capture_favorites', { capture_id: shared.captureId }),
        () =>
          updateRow(
            'capture_favorites',
            { capture_id: shared.captureId },
            { created_at: '2026-10-14T00:00:00Z' }
          )
      ]
      for (const write of refused) expect(write).toThrow(SharedCaseRowError)
    })

    it('refuses to move a note into a Shared Case', () => {
      expect(() => updateRow('notes', { id: local.noteId }, { case_id: shared.caseId })).toThrow(
        SharedCaseRowError
      )
    })

    it('leaves every write on a Case nobody shared as it was', () => {
      expect(createRow('notes', noteRow(local.caseId, 'new-note'))).toMatchObject({
        id: 'new-note'
      })
      expect(updateRow('notes', { id: 'new-note' }, { title: 'Edited' })).toBe(true)
      expect(deleteRow('notes', { id: 'new-note' })).toBe(true)
      expect(
        createRow('exhibit_tags', { exhibit_id: local.captureId, tag_id: tags.onExhibit })
      ).toMatchObject({ exhibit_id: local.captureId })
      expect(deleteRow('exhibit_tags', exhibitTagKey(local.captureId, tags.onExhibit))).toBe(true)
      expect(updateRow('tags', { id: tags.local }, { color: '#000' })).toBe(true)
      expect(deleteRow('tags', { id: tags.local })).toBe(true)
      expect(createRow('tags', { id: 'admin-tag', name: 'Admin' })).toMatchObject({
        id: 'admin-tag'
      })
      expect(
        createRow('selectors', {
          id: 'local-selector',
          case_id: local.caseId,
          pattern: 'p',
          created_at: '2026-10-13T00:00:00Z'
        })
      ).toMatchObject({ id: 'local-selector' })
      expect(
        createRow('selector_matches', {
          selector_id: 'local-selector',
          capture_id: local.captureId
        })
      ).toMatchObject({ selector_id: 'local-selector' })
      expect(
        createRow('capture_favorites', {
          capture_id: local.captureId,
          created_at: '2026-10-13T00:00:00Z'
        })
      ).toMatchObject({ capture_id: local.captureId })
      expect(updateRow('captures', { id: local.captureId }, { title: 'Edited' })).toBe(true)
      expect(updateRow('cases', { id: local.caseId }, { name: 'Renamed' })).toBe(true)
      expect(deleteRow('captures', { id: local.captureId })).toBe(true)
      expect(deleteRow('selectors', { id: 'local-selector' })).toBe(true)
      expect(deleteRow('cases', { id: local.caseId })).toBe(true)
    })
  })

  // Maintainer ruling of 14 October 2026 on PR #1865: orphan cleanup leaves a
  // Shared Case's Captures alone, in the scan the screen counts and in the
  // cleanup it runs; a Case nobody shared is cleaned as before.
  describe('orphan cleanup and Shared Cases', () => {
    let tempDir: string
    let sharedCapture: string
    let localCapture: string

    function orphanedCapture(caseId: string, name: string): string {
      ensureCaseDir(caseId)
      const id = insertCapture({
        caseId,
        url: `https://example.com/${name}`,
        title: name,
        hash: 'h',
        timestamp: '2026-01-01T00:00:00.000Z',
        mhtmlPath: `${caseId}/${name}.mhtml`
      }).id
      // The screenshot is on disk and the MHTML is not, so the row looks orphaned.
      writeFileSync(defaultCaptureStore.artifactPaths(caseId, id, 'png').abs, 'png')
      return id
    }

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'bb-db-admin-orphans-'))
      initStorage(tempDir)
      const shared = createCase({ name: 'Shared', description: '' }).id
      getDb()
        .prepare("UPDATE cases SET shared_at = '2026-10-01T00:00:00.000Z' WHERE id = ?")
        .run(shared)
      sharedCapture = orphanedCapture(shared, 'shared')
      localCapture = orphanedCapture(createCase({ name: 'Local', description: '' }).id, 'local')
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it('counts and cleans only the Case nobody shared', () => {
      const report = findOrphans()
      expect(report.dbOrphans.map((o) => o.id)).toEqual([localCapture])
      // The Shared Case Capture's screenshot still has its row, so it is no file orphan.
      expect(report.fileOrphans).toEqual([])

      expect(cleanOrphans(report)).toEqual({ dbRecordsRemoved: 1, filesRemoved: 0 })
      expect(getCapture(sharedCapture)).toBeDefined()
      expect(getCapture(localCapture)).toBeUndefined()
    })

    it('skips a Shared Case Capture a stale or edited report names', () => {
      const shared = getCapture(sharedCapture)!
      const result = cleanOrphans({
        dbOrphans: [
          { table: 'captures', id: sharedCapture, caseId: shared.caseId, missingPaths: [] }
        ],
        fileOrphans: []
      })
      expect(result.dbRecordsRemoved).toBe(0)
      expect(getCapture(sharedCapture)).toBeDefined()
    })

    // A teammate's files arrive through the sync session (#1512) before any
    // row describes them (#1811), so nothing under a Shared Case's directory
    // is an orphan: not in the scan, and not when a report names it.
    it('never reports or deletes a file under a Shared Case directory', () => {
      const shared = getCapture(sharedCapture)!.caseId
      const local = getCapture(localCapture)!.caseId
      const remoteCapture = join(shared, 'remote-capture.mhtml')
      const remoteDocument = join(shared, 'documents', 'remote.pdf')
      const strayLocal = join(local, 'stray.mhtml')
      for (const rel of [remoteCapture, remoteDocument, strayLocal]) {
        mkdirSync(join(tempDir, rel, '..'), { recursive: true })
        writeFileSync(join(tempDir, rel), 'bytes')
      }

      const report = findOrphans()
      expect(report.fileOrphans).toEqual([strayLocal])

      const result = cleanOrphans({
        dbOrphans: [],
        fileOrphans: [remoteCapture, remoteDocument, strayLocal]
      })
      expect(result.filesRemoved).toBe(1)
      expect(existsSync(join(tempDir, remoteCapture))).toBe(true)
      expect(existsSync(join(tempDir, remoteDocument))).toBe(true)
      expect(existsSync(join(tempDir, strayLocal))).toBe(false)
    })
  })

  // Rows on a deleted Capture (#1877): the keys from these tables to captures
  // and exhibits are application code since v41, so the hatch removes what the
  // keys cascaded in a Case nobody shared, refuses another member's kept row in
  // a Shared Case, and refuses a reference to a row that does not exist.
  describe('rows on a deleted Capture (#1877)', () => {
    const count = (table: string, column: string, id: string): number =>
      (
        getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(id) as {
          n: number
        }
      ).n

    function captureWithRows(caseId: string, n: number): { captureId: string; noteId: string } {
      const captureId = insertCapture({
        caseId,
        url: `https://example.com/${n}`,
        title: `Page ${n}`,
        hash: 'h',
        timestamp: '2026-01-01T00:00:00.000Z'
      }).id
      saveAnnotations({ captureId, shapes: [], imageWidth: 1, imageHeight: 1 })
      upsertPin({ captureId, body: 'pin' })
      addTagToCapture({ captureId, tagId: createTag({ name: `Tag ${n}` }).id })
      return { captureId, noteId: createNote({ caseId, captureId, title: 'Linked' }).id }
    }

    it('cleanOrphans and deleteRow on a Capture of a Case never shared remove its annotations and pins as the foreign keys did', () => {
      const caseId = createCase({ name: 'Local', description: '' }).id
      const orphan = captureWithRows(caseId, 1)
      const row = captureWithRows(caseId, 2)

      expect(
        cleanOrphans({
          dbOrphans: [{ table: 'captures', id: orphan.captureId, caseId, missingPaths: [] }],
          fileOrphans: []
        }).dbRecordsRemoved
      ).toBe(1)
      expect(deleteRow('captures', { id: row.captureId })).toBe(true)

      for (const { captureId, noteId } of [orphan, row]) {
        expect(count('annotations', 'capture_id', captureId)).toBe(0)
        expect(count('annotation_pins', 'capture_id', captureId)).toBe(0)
        expect(getNote(noteId)?.captureId).toBeUndefined()
      }
      expect(count('exhibit_tags', 'exhibit_id', orphan.captureId)).toBe(0)
      // deleteRow leaves the Exhibit row, and with it the tag application, as before.
      expect(count('exhibit_tags', 'exhibit_id', row.captureId)).toBe(1)
      expect(getDb().prepare('SELECT * FROM deleted_captures').all()).toEqual([])
    })

    it("refuses to edit or delete another member's tag application on a deleted Capture of a Shared Case", () => {
      const caseId = createCase({ name: 'Shared', description: '' }).id
      getDb()
        .prepare("UPDATE cases SET shared_at = '2026-10-01T00:00:00.000Z' WHERE id = ?")
        .run(caseId)
      getDb()
        .prepare('INSERT INTO deleted_captures (id, case_id) VALUES (?, ?)')
        .run('deleted-capture', caseId)
      getDb()
        .prepare("INSERT INTO tags (id, name, author_installation_id) VALUES ('rt', 'theirs', 'r')")
        .run()
      getDb()
        .prepare(
          "INSERT INTO exhibit_tags (exhibit_id, tag_id, author_installation_id) VALUES ('deleted-capture', 'rt', 'r')"
        )
        .run()
      const pk = { exhibit_id: 'deleted-capture', tag_id: 'rt', author_installation_id: 'r' }

      expect(() => updateRow('exhibit_tags', pk, { version: 9 })).toThrow(SharedCaseRowError)
      expect(() => deleteRow('exhibit_tags', pk)).toThrow(SharedCaseRowError)
      expect(() => updateRow('tags', { id: 'rt' }, { name: 'mine' })).toThrow(SharedCaseRowError)
      expect(getDb().prepare('SELECT version FROM exhibit_tags').all()).toEqual([{ version: 0 }])
    })

    it("deleteRow and cleanOrphans on a deleted Capture's id leave the rows a Shared Case keeps on it", () => {
      const db = getDb()
      const caseId = createCase({ name: 'Shared', description: '' }).id
      db.prepare("UPDATE cases SET shared_at = '2026-10-01T00:00:00.000Z' WHERE id = ?").run(caseId)
      db.prepare('INSERT INTO deleted_captures (id, case_id) VALUES (?, ?)').run('gone', caseId)
      db.prepare(
        `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width,
           image_height, updated_at, author_installation_id)
         VALUES ('gone', 1, '[]', 1, 1, '2026-01-01T00:00:00.000Z', 'r')`
      ).run()
      db.prepare(
        `INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at,
           author_installation_id)
         VALUES ('pin', 'gone', 1, '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'r')`
      ).run()
      db.prepare(
        "INSERT INTO tags (id, name, author_installation_id) VALUES ('rt', 'theirs', 'r')"
      ).run()
      db.prepare(
        "INSERT INTO exhibit_tags (exhibit_id, tag_id, author_installation_id) VALUES ('gone', 'rt', 'r')"
      ).run()

      const expectKept = (): void => {
        expect(count('annotations', 'capture_id', 'gone')).toBe(1)
        expect(count('annotation_pins', 'capture_id', 'gone')).toBe(1)
        expect(count('exhibit_tags', 'exhibit_id', 'gone')).toBe(1)
      }

      expect(deleteRow('captures', { id: 'gone' })).toBe(false)
      expectKept()
      expect(
        cleanOrphans({
          dbOrphans: [{ table: 'captures', id: 'gone', caseId, missingPaths: [] }],
          fileOrphans: []
        }).dbRecordsRemoved
      ).toBe(0)
      expectKept()
    })

    it('createRow and updateRow refuse a notes.capture_id or exhibit_tags.exhibit_id that names no row', () => {
      const caseId = createCase({ name: 'Local', description: '' }).id
      const { captureId, noteId } = captureWithRows(caseId, 1)
      const tagId = createTag({ name: 'Spare' }).id
      const note = {
        id: 'admin-note',
        case_id: caseId,
        title: 'T',
        body: 'B',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }

      expect(() => createRow('notes', { ...note, capture_id: 'no-such-capture' })).toThrow(
        /FOREIGN KEY constraint failed/
      )
      expect(() =>
        createRow('exhibit_tags', { exhibit_id: 'no-such-exhibit', tag_id: tagId })
      ).toThrow(/FOREIGN KEY constraint failed/)
      expect(() => updateRow('notes', { id: noteId }, { capture_id: 'no-such-capture' })).toThrow(
        /FOREIGN KEY constraint failed/
      )
      expect(createRow('notes', { ...note, capture_id: captureId })).toMatchObject({
        capture_id: captureId
      })
      expect(updateRow('notes', { id: noteId }, { capture_id: null })).toBe(true)
      expect(getNote(noteId)?.captureId).toBeUndefined()
    })
  })
})
