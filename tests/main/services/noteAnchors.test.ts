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
  importNoteRows
} from '@main/services/db/noteRepo'

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
  })
})
