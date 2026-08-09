/**
 * Anchor storage on notes (schema v27).
 *
 * An anchor is what a report will later cite, so it gets the same treatment
 * `body_doc` got in v26: validated in main on every write path, never trusted
 * from a renderer or an archive. The rule with teeth is that an extracted-data
 * anchor cannot carry a surrogate id, because re-extraction churns every one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import {
  createNote,
  updateNote,
  getNote,
  listNotes,
  importNoteRows,
  AnchorCaseMismatchError
} from '@main/services/db/noteRepo'
import { insertCapture, deleteCapture } from '@main/services/db/captureRepo'
import { createSelector } from '@main/services/db/selectorRepo'

const TEXT_ANCHOR = {
  kind: 'text',
  captureId: 'cap-1',
  quote: 'transferred on 4 April',
  prefix: 'the sum was ',
  suffix: ' to an account',
  textOffset: 12
}

const FINDING_ANCHOR = {
  kind: 'finding',
  finding: 'extractedData',
  captureId: 'cap-1',
  category: 'contact',
  subcategory: 'email',
  value: 'ops@example.com'
}

describe('anchored notes', () => {
  let caseId: string

  beforeEach(() => {
    initDatabase(':memory:')
    caseId = createCase({ name: 'Anchors', description: '' }).id
  })

  afterEach(() => {
    closeDatabase()
  })

  function rawRow(id: string): Record<string, unknown> {
    return getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as Record<string, unknown>
  }

  it('adds anchor_kind and anchor_json to the notes table', () => {
    const cols = (
      getDb().prepare("PRAGMA table_info('notes')").all() as Array<{ name: string }>
    ).map((c) => c.name)

    expect(cols).toContain('anchor_kind')
    expect(cols).toContain('anchor_json')
  })

  it('stores an anchor and gives it back parsed', () => {
    const note = createNote({
      caseId,
      title: 'Transfer',
      body: 'observed',
      anchor: JSON.stringify(TEXT_ANCHOR)
    })

    expect(note.anchor).toEqual(TEXT_ANCHOR)
  })

  it('records the kind in its own column, so anchors can be found without parsing', () => {
    const note = createNote({ caseId, title: 'T', anchor: JSON.stringify(TEXT_ANCHOR) })

    expect(rawRow(note.id).anchor_kind).toBe('text')
  })

  it('leaves an unanchored note with neither column set', () => {
    const note = createNote({ caseId, title: 'Loose', body: 'no anchor' })

    expect(note.anchor).toBeUndefined()
    expect(rawRow(note.id).anchor_kind).toBeNull()
    expect(rawRow(note.id).anchor_json).toBeNull()
  })

  it('refuses an anchor of unknown kind, storing nothing', () => {
    expect(() =>
      createNote({
        caseId,
        title: 'Rogue',
        anchor: JSON.stringify({ kind: 'vibes', captureId: 'c' })
      })
    ).toThrow(/anchor kind/i)

    expect(listNotes(caseId)).toHaveLength(0)
  })

  it('strips a surrogate extracted_data id before it can reach storage', () => {
    const note = createNote({
      caseId,
      title: 'Finding',
      anchor: JSON.stringify({ ...FINDING_ANCHOR, id: 'extracted-row-42' })
    })

    expect(rawRow(note.id).anchor_json).not.toContain('extracted-row-42')
    expect(note.anchor).toEqual(FINDING_ANCHOR)
  })

  it('replaces an anchor on update', () => {
    const note = createNote({ caseId, title: 'T', anchor: JSON.stringify(TEXT_ANCHOR) })

    const updated = updateNote({
      id: note.id,
      anchor: JSON.stringify({ kind: 'capture', captureId: 'cap-2' })
    })

    expect(updated!.anchor).toEqual({ kind: 'capture', captureId: 'cap-2' })
  })

  it('leaves the anchor alone when an update does not mention it', () => {
    const note = createNote({ caseId, title: 'T', anchor: JSON.stringify(TEXT_ANCHOR) })

    const updated = updateNote({ id: note.id, title: 'T (revised)' })

    expect(updated!.anchor).toEqual(TEXT_ANCHOR)
  })

  it('clears the anchor when an update passes null', () => {
    const note = createNote({ caseId, title: 'T', anchor: JSON.stringify(TEXT_ANCHOR) })

    const updated = updateNote({ id: note.id, anchor: null })

    expect(updated!.anchor).toBeUndefined()
    expect(rawRow(note.id).anchor_kind).toBeNull()
  })

  it('rejects a bad anchor on update, leaving the stored one intact', () => {
    const note = createNote({ caseId, title: 'T', anchor: JSON.stringify(TEXT_ANCHOR) })

    expect(() => updateNote({ id: note.id, anchor: '{oops' })).toThrow(/not valid JSON/)
    expect(getNote(note.id)!.anchor).toEqual(TEXT_ANCHOR)
  })

  // An empty string is a malformed payload, not an absent one. Only null
  // clears an anchor, and only an omitted `anchor` leaves it alone; a falsy
  // guard would collapse all three and let a broken payload unanchor a note
  // without ever reporting an error.
  it('rejects an empty-string anchor on create rather than storing nothing', () => {
    expect(() => createNote({ caseId, title: 'T', anchor: '' })).toThrow(/not valid JSON/)
  })

  it('rejects an empty-string anchor on update, leaving the stored one intact', () => {
    const note = createNote({ caseId, title: 'T', anchor: JSON.stringify(TEXT_ANCHOR) })

    expect(() => updateNote({ id: note.id, anchor: '' })).toThrow(/not valid JSON/)
    expect(getNote(note.id)!.anchor).toEqual(TEXT_ANCHOR)
  })

  // SQLite sets notes.capture_id to NULL when a capture goes, but cannot
  // reach the captureId inside anchor_json. Scrubbing the anchor to match
  // would destroy the record that the note ever cited evidence -- the same
  // reason brief blocks keep a deleted referent as a visible gap.
  describe('when the anchored capture is deleted', () => {
    function anchoredNote(): { noteId: string; captureId: string } {
      const capture = insertCapture({
        caseId,
        url: 'https://example.com',
        title: 'Example',
        hash: 'abc123',
        timestamp: new Date().toISOString()
      })
      const note = createNote({
        caseId,
        captureId: capture.id,
        title: 'Anchored',
        anchor: JSON.stringify({ ...TEXT_ANCHOR, captureId: capture.id })
      })
      return { noteId: note.id, captureId: capture.id }
    }

    it('nulls the capture_id column, as the foreign key says', () => {
      const { noteId, captureId } = anchoredNote()

      deleteCapture(captureId)

      expect(getNote(noteId)!.captureId).toBeUndefined()
    })

    it('keeps the anchor, so the note still records what it cited', () => {
      const { noteId, captureId } = anchoredNote()

      deleteCapture(captureId)

      const note = getNote(noteId)!
      expect(note.anchor).toMatchObject({ kind: 'text', captureId })
      expect(rawRow(noteId).anchor_kind).toBe('text')
    })
  })

  describe('archive import', () => {
    function importRow(row: Record<string, unknown>): void {
      importNoteRows([{ created_at: 'x', updated_at: 'x', ...row }], {
        newCaseId: caseId,
        mapId: (id: string) => id
      } as Parameters<typeof importNoteRows>[1])
    }

    it('re-validates an imported anchor rather than trusting the archive', () => {
      expect(() =>
        importRow({
          id: 'imported-1',
          title: 'Rogue',
          body: 'looks fine',
          anchor_kind: 'text',
          anchor_json: JSON.stringify({ kind: 'vibes', captureId: 'c' })
        })
      ).toThrow(/anchor kind/i)

      expect(listNotes(caseId).map((n) => n.id)).not.toContain('imported-1')
    })

    it('derives anchor_kind from the anchor itself, not from the archive column', () => {
      // An archive whose columns disagree must not be able to file a text
      // anchor under some other kind.
      importRow({
        id: 'imported-2',
        title: 'Mismatched',
        body: 'x',
        anchor_kind: 'capture',
        anchor_json: JSON.stringify(TEXT_ANCHOR)
      })

      expect(rawRow('imported-2').anchor_kind).toBe('text')
    })

    it('imports a pre-v27 row, which has no anchor columns, as unanchored', () => {
      importRow({ id: 'imported-3', title: 'Legacy', body: 'from an old archive' })

      expect(getNote('imported-3')!.anchor).toBeUndefined()
    })

    // A pre-v27 row is missing the key entirely; an empty string is a present
    // but corrupt value, and the two must not import the same way.
    it('fails the import on an empty-string anchor rather than importing it loose', () => {
      expect(() =>
        importRow({ id: 'imported-4', title: 'Corrupt', body: 'x', anchor_json: '' })
      ).toThrow(/not valid JSON/)

      expect(listNotes(caseId).map((n) => n.id)).not.toContain('imported-4')
    })

    // The collision remap rewrites the capture_id column; an anchor left
    // holding the pre-import id would point at whatever already owns that id
    // here -- a note citing evidence it was never written about.
    function importRemapped(row: Record<string, unknown>): void {
      importNoteRows([{ created_at: 'x', updated_at: 'x', ...row }], {
        newCaseId: caseId,
        mapId: (id: string) => (id === 'cap-1' ? 'cap-1-remapped' : id)
      } as Parameters<typeof importNoteRows>[1])
    }

    it('remaps the captureId embedded in an imported anchor', () => {
      importRemapped({
        id: 'imported-5',
        title: 'Anchored',
        body: 'x',
        anchor_json: JSON.stringify(TEXT_ANCHOR)
      })

      expect(getNote('imported-5')!.anchor).toMatchObject({
        kind: 'text',
        captureId: 'cap-1-remapped'
      })
    })

    it('remaps the selectorId inside an imported selector-match anchor', () => {
      importNoteRows(
        [
          {
            id: 'imported-6',
            title: 'Selector',
            body: 'x',
            created_at: 'x',
            updated_at: 'x',
            anchor_json: JSON.stringify({
              kind: 'finding',
              finding: 'selectorMatch',
              captureId: 'cap-1',
              selectorId: 'sel-1'
            })
          }
        ],
        {
          newCaseId: caseId,
          mapId: (id: string) => `${id}-remapped`
        } as Parameters<typeof importNoteRows>[1]
      )

      expect(getNote('imported-6-remapped')!.anchor).toEqual({
        kind: 'finding',
        finding: 'selectorMatch',
        captureId: 'cap-1-remapped',
        selectorId: 'sel-1-remapped'
      })
    })
  })

  // #234: a note belongs to exactly one case. An anchor whose target EXISTS in
  // a different case is rejected at write time; a target that does not exist
  // at all is untouched by this rule (that is resolveTextAnchor's documented
  // capture-missing gap, not a case violation).
  describe('same-case enforcement', () => {
    function captureInCase(otherCaseId: string) {
      return insertCapture({
        caseId: otherCaseId,
        url: 'https://example.com',
        title: 'Elsewhere',
        hash: 'abc123',
        timestamp: new Date().toISOString()
      })
    }

    it('allows an anchor targeting a capture in the same case as the note', () => {
      const capture = captureInCase(caseId)

      const note = createNote({
        caseId,
        anchor: JSON.stringify({ ...TEXT_ANCHOR, captureId: capture.id })
      })

      expect(note.anchor).toMatchObject({ captureId: capture.id })
    })

    it('allows an anchor targeting a captureId that does not exist at all', () => {
      // Not a case violation -- the design's capture-missing gap, which this
      // feature deliberately preserves. Structural (TEXT_ANCHOR's captureId
      // 'cap-1') rather than a UUID collision.
      const note = createNote({ caseId, anchor: JSON.stringify(TEXT_ANCHOR) })

      expect(note.anchor).toMatchObject({ captureId: 'cap-1' })
    })

    it('rejects on create an anchor targeting a capture in a different case', () => {
      const otherCaseId = createCase({ name: 'Other', description: '' }).id
      const capture = captureInCase(otherCaseId)

      expect(() =>
        createNote({ caseId, anchor: JSON.stringify({ ...TEXT_ANCHOR, captureId: capture.id }) })
      ).toThrow(AnchorCaseMismatchError)
      expect(listNotes(caseId)).toHaveLength(0)
    })

    it('rejects on update a NEW anchor targeting a capture in a different case', () => {
      const otherCaseId = createCase({ name: 'Other', description: '' }).id
      const capture = captureInCase(otherCaseId)
      const note = createNote({ caseId, title: 'T' })

      expect(() =>
        updateNote({
          id: note.id,
          anchor: JSON.stringify({ ...TEXT_ANCHOR, captureId: capture.id })
        })
      ).toThrow(AnchorCaseMismatchError)
      expect(getNote(note.id)!.anchor).toBeUndefined()
    })

    it('rejects a cross-case selectorMatch anchor by the selectorId, not just the captureId', () => {
      const capture = captureInCase(caseId) // capture is IN case, selector is not
      const otherCaseId = createCase({ name: 'Other', description: '' }).id
      const selector = createSelector({ caseId: otherCaseId, pattern: 'x' })

      expect(() =>
        createNote({
          caseId,
          anchor: JSON.stringify({
            kind: 'finding',
            finding: 'selectorMatch',
            captureId: capture.id,
            selectorId: selector.id
          })
        })
      ).toThrow(AnchorCaseMismatchError)
    })

    // AC#8: a row that already violates the rule (written before #234, or via
    // direct SQL below standing in for that) is not destroyed by an unrelated
    // read or write. Re-validating an anchor the caller did not touch would
    // turn a title fix into a rejection of data this PR does not migrate.
    it('does not re-validate an untouched anchor on an unrelated update', () => {
      const otherCaseId = createCase({ name: 'Other', description: '' }).id
      const capture = captureInCase(otherCaseId)
      const now = new Date().toISOString()
      const violatingId = 'pre-234-violation'
      // Bypass createNote: this row predates the case-membership rule.
      getDb()
        .prepare(
          `INSERT INTO notes (id, case_id, title, body, anchor_kind, anchor_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          violatingId,
          caseId,
          'Legacy',
          '',
          'text',
          JSON.stringify({ ...TEXT_ANCHOR, captureId: capture.id }),
          now,
          now
        )

      // A read must not choke on it either.
      expect(getNote(violatingId)!.anchor).toMatchObject({ captureId: capture.id })

      const updated = updateNote({ id: violatingId, title: 'Legacy (edited)' })

      expect(updated!.title).toBe('Legacy (edited)')
      expect(updated!.anchor).toMatchObject({ captureId: capture.id })
    })

    // AC#8, structural half: a row whose anchor_json predates #232's field
    // validation (e.g. a 'text' anchor with no `quote`) parses fine as JSON but
    // fails parseNoteAnchor. An unrelated title edit must not round-trip that
    // anchor through resolveAnchor/parseNoteAnchor and throw on it.
    it('does not re-parse a structurally invalid legacy anchor on an unrelated update', () => {
      const capture = captureInCase(caseId)
      const now = new Date().toISOString()
      const invalidId = 'pre-232-structural-violation'
      // Bypass createNote: parseNoteAnchor would reject this ('text' requires
      // `quote`), so only a pre-validation write or raw SQL can produce it.
      getDb()
        .prepare(
          `INSERT INTO notes (id, case_id, title, body, anchor_kind, anchor_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          invalidId,
          caseId,
          'Legacy',
          '',
          'text',
          JSON.stringify({ kind: 'text', captureId: capture.id }),
          now,
          now
        )

      const updated = updateNote({ id: invalidId, title: 'Legacy (edited)' })

      expect(updated!.title).toBe('Legacy (edited)')
      expect(updated!.anchor).toMatchObject({ captureId: capture.id })
    })

    describe('archive import', () => {
      it('accepts an anchor whose REMAPPED captureId lands in the same case', () => {
        // The capture this note anchors is already present locally under
        // caseId -- as it would be by the time importNoteRows runs, since
        // captures import before notes in caseArchive.ts's insertImportedRows.
        const capture = captureInCase(caseId)

        importNoteRows(
          [
            {
              id: 'imported-ok',
              title: 'Anchored',
              body: 'x',
              created_at: 'x',
              updated_at: 'x',
              anchor_json: JSON.stringify({ ...TEXT_ANCHOR, captureId: 'source-cap-id' })
            }
          ],
          {
            newCaseId: caseId,
            mapId: (id: string) => (id === 'source-cap-id' ? capture.id : id)
          } as Parameters<typeof importNoteRows>[1]
        )

        expect(getNote('imported-ok')!.anchor).toMatchObject({ captureId: capture.id })
      })

      it('rejects an anchor whose REMAPPED captureId lands in a different case', () => {
        const otherCaseId = createCase({ name: 'Other', description: '' }).id
        const capture = captureInCase(otherCaseId)

        expect(() =>
          importNoteRows(
            [
              {
                id: 'imported-bad',
                title: 'Anchored',
                body: 'x',
                created_at: 'x',
                updated_at: 'x',
                anchor_json: JSON.stringify({ ...TEXT_ANCHOR, captureId: 'source-cap-id' })
              }
            ],
            {
              newCaseId: caseId,
              mapId: (id: string) => (id === 'source-cap-id' ? capture.id : id)
            } as Parameters<typeof importNoteRows>[1]
          )
        ).toThrow(AnchorCaseMismatchError)
        expect(listNotes(caseId).map((n) => n.id)).not.toContain('imported-bad')
      })
    })
  })
})
