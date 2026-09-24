import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, updateCase, listCases } from '@main/services/db/caseRepo'
import { insertCapture, getCaptureTextContent } from '@main/services/db/captureRepo'
import { AnchorCaseMismatchError } from '@main/services/db/noteRepo'
import { MentionCaseMismatchError } from '@main/services/db/noteReferenceRepo'
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
  exportTableData
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
})
