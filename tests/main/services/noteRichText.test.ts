/**
 * Rich-text note storage (schema v26).
 *
 * The property that matters is that `body` and `body_doc` cannot disagree:
 * `body` is what FTS indexes and what a report would quote, and it is derived
 * in main from the stored document rather than accepted from the renderer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import {
  createNote,
  updateNote,
  searchNotes,
  getNote,
  importNoteRows,
  listNotes
} from '@main/services/db/noteRepo'
import { noteDocToText } from '@shared/noteDoc'

const DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Registrant listed as ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'Acme Holdings' },
        { type: 'text', text: ' in the WHOIS record.' }
      ]
    }
  ]
}

const DOC_TEXT = 'Registrant listed as Acme Holdings in the WHOIS record.'

describe('rich-text notes', () => {
  let caseId: string

  beforeEach(() => {
    initDatabase(':memory:')
    caseId = createCase({ name: 'Notes Case', description: '' }).id
  })

  afterEach(() => {
    closeDatabase()
  })

  function rawRow(id: string): Record<string, unknown> {
    return getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as Record<string, unknown>
  }

  it('adds body_doc to the notes table', () => {
    const cols = (
      getDb().prepare("PRAGMA table_info('notes')").all() as Array<{ name: string }>
    ).map((c) => c.name)

    expect(cols).toContain('body_doc')
  })

  it('derives body from the document rather than storing what the caller sent', () => {
    const note = createNote({
      caseId,
      title: 'WHOIS',
      // A renderer claiming different text must not be able to seed the index.
      body: 'text the note does not contain',
      bodyDoc: JSON.stringify(DOC)
    })

    expect(note.body).toBe(DOC_TEXT)
    expect(note.bodyDoc).toBe(JSON.stringify(DOC))
    expect(noteDocToText(JSON.parse(note.bodyDoc!))).toBe(note.body)
  })

  it('indexes the derived text in FTS, so rich notes are searchable by their words', () => {
    createNote({ caseId, title: 'WHOIS', bodyDoc: JSON.stringify(DOC) })

    expect(searchNotes(caseId, 'Acme').map((n) => n.title)).toEqual(['WHOIS'])
    // The formatting mark split "Acme Holdings" into three text nodes; the
    // phrase must still be indexed as contiguous words.
    expect(searchNotes(caseId, '"Acme Holdings"')).toHaveLength(1)
  })

  it('keeps a plain-text note valid with no document', () => {
    const note = createNote({ caseId, title: 'Legacy', body: 'plain observation' })

    expect(note.body).toBe('plain observation')
    expect(note.bodyDoc).toBeUndefined()
    expect(rawRow(note.id).body_doc).toBeNull()
    expect(searchNotes(caseId, 'observation')).toHaveLength(1)
  })

  it('re-derives body when the document is updated', () => {
    const note = createNote({ caseId, title: 'WHOIS', bodyDoc: JSON.stringify(DOC) })
    const revised = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Registrant redacted.' }] }]
    }

    const updated = updateNote({ id: note.id, bodyDoc: JSON.stringify(revised) })

    expect(updated!.body).toBe('Registrant redacted.')
    expect(searchNotes(caseId, 'Acme')).toHaveLength(0)
    expect(searchNotes(caseId, 'redacted')).toHaveLength(1)
  })

  it('leaves both body columns alone when only the title is updated', () => {
    const note = createNote({ caseId, title: 'WHOIS', bodyDoc: JSON.stringify(DOC) })

    const updated = updateNote({ id: note.id, title: 'WHOIS (revised)' })

    expect(updated!.title).toBe('WHOIS (revised)')
    expect(updated!.body).toBe(DOC_TEXT)
    expect(updated!.bodyDoc).toBe(JSON.stringify(DOC))
  })

  it('drops the document when a note is overwritten as plain text', () => {
    const note = createNote({ caseId, title: 'WHOIS', bodyDoc: JSON.stringify(DOC) })

    const updated = updateNote({ id: note.id, body: 'plain again' })

    // Keeping the old document would leave a note whose rich body and
    // searchable text describe different things.
    expect(updated!.body).toBe('plain again')
    expect(updated!.bodyDoc).toBeUndefined()
    expect(rawRow(note.id).body_doc).toBeNull()
  })

  it('rejects a document that is off the shared schema, storing nothing', () => {
    expect(() =>
      createNote({
        caseId,
        title: 'Rogue',
        bodyDoc: JSON.stringify({
          type: 'doc',
          content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }]
        })
      })
    ).toThrow()

    expect(searchNotes(caseId, 'Rogue')).toHaveLength(0)
  })

  it('rejects an update whose document is unparseable, leaving the note intact', () => {
    const note = createNote({ caseId, title: 'WHOIS', bodyDoc: JSON.stringify(DOC) })

    expect(() => updateNote({ id: note.id, bodyDoc: '{oops' })).toThrow(/not valid JSON/)
    expect(getNote(note.id)!.body).toBe(DOC_TEXT)
  })

  describe('archive import', () => {
    // An archive comes from outside this installation, so its `body` column is
    // no more trustworthy than a renderer's. It is the one path that could
    // make a body/body_doc disagreement permanent.
    const ctx = { newCaseId: '', mapId: (id: string) => id }

    function importRow(row: Record<string, unknown>): void {
      importNoteRows([{ created_at: 'x', updated_at: 'x', ...row }], {
        ...ctx,
        newCaseId: caseId
      } as Parameters<typeof importNoteRows>[1])
    }

    it('re-derives body from the imported document rather than trusting the archive', () => {
      importRow({
        id: 'imported-1',
        title: 'Imported',
        body: 'text the archive claims',
        body_doc: JSON.stringify(DOC)
      })

      const imported = getNote('imported-1')!
      expect(imported.body).toBe(DOC_TEXT)
      expect(searchNotes(caseId, 'Acme')).toHaveLength(1)
      expect(searchNotes(caseId, 'claims')).toHaveLength(0)
    })

    it('imports a pre-v26 row, which has no body_doc at all, as plain text', () => {
      importRow({ id: 'imported-2', title: 'Legacy', body: 'plain from an old archive' })

      const imported = getNote('imported-2')!
      expect(imported.body).toBe('plain from an old archive')
      expect(imported.bodyDoc).toBeUndefined()
    })

    it('rejects an off-schema document rather than importing it', () => {
      expect(() =>
        importRow({
          id: 'imported-3',
          title: 'Rogue',
          body: 'looks fine',
          body_doc: JSON.stringify({
            type: 'doc',
            content: [{ type: 'text', text: 'no paragraph around me' }]
          })
        })
      ).toThrow(/does not fit the note schema/)

      // The whole import runs in one transaction upstream, so failing here
      // fails the import; nothing half-lands.
      expect(listNotes(caseId).map((n) => n.id)).not.toContain('imported-3')
    })
  })
})
