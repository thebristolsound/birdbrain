import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, getDb, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { createNote, deleteNote } from '@main/services/db/noteRepo'
import {
  createTag,
  getTagsForNote,
  getTagsForCapture,
  listTags,
  addTagToNote,
  removeTagFromNote,
  findOrCreateTagByName
} from '@main/services/db/tagRepo'
import { applyTagToNote, captureForNote, NoteNotFoundError } from '@main/services/noteTags'
import type { Note } from '@shared/types'

let caseId: string
let captureId: string

beforeEach(async () => {
  await initDatabase(':memory:')
  caseId = createCase({ name: 'Note tags', description: '', type: 'custom' }).id
  captureId = insertCapture({
    caseId,
    url: 'https://meridian-trust.example',
    title: 'Sign-in',
    hash: 'h1',
    timestamp: '2026-01-01T00:00:00Z',
    textContent: 'body',
    format: 'mhtml'
  }).id
})

afterEach(() => closeDatabase())

describe('note_tags schema (v32)', () => {
  it('creates the table at the latest schema version with both cascades', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(32)
    expect(getDb().pragma('user_version', { simple: true })).toBe(32)
    const columns = getDb().pragma('table_info(note_tags)') as Array<{ name: string; pk: number }>
    expect(columns.map((c) => c.name)).toEqual(['note_id', 'tag_id'])
    // Composite primary key over both foreign keys, like capture_tags: no
    // surrogate id, which is why the table stays out of ID_PROBE_TABLES.
    expect(columns.filter((c) => c.pk > 0).map((c) => c.name)).toEqual(['note_id', 'tag_id'])
    const fks = getDb().pragma('foreign_key_list(note_tags)') as Array<{
      table: string
      on_delete: string
    }>
    expect(fks.map((f) => [f.table, f.on_delete]).sort()).toEqual([
      ['notes', 'CASCADE'],
      ['tags', 'CASCADE']
    ])
  })

  it('cascades: deleting the note drops its tag links but not the tags', () => {
    const note = createNote({ caseId, title: 'N', body: 'text' })
    const tag = createTag({ name: 'evidence' })
    addTagToNote({ noteId: note.id, tagId: tag.id })
    expect(getTagsForNote(note.id)).toHaveLength(1)

    deleteNote(note.id)
    expect(listTags()).toHaveLength(1)
    expect(getTagsForNote(note.id)).toEqual([])
  })

  it('re-applying a tag the note already carries is a no-op, not an error', () => {
    const note = createNote({ caseId, title: 'N', body: 'text' })
    const tag = createTag({ name: 'evidence' })
    addTagToNote({ noteId: note.id, tagId: tag.id })
    addTagToNote({ noteId: note.id, tagId: tag.id })
    expect(getTagsForNote(note.id)).toHaveLength(1)

    removeTagFromNote({ noteId: note.id, tagId: tag.id })
    expect(getTagsForNote(note.id)).toEqual([])
  })
})

describe('findOrCreateTagByName', () => {
  it('reuses an exact name in preference to a case-insensitive one', () => {
    // Both spellings can exist: tags.name is case-sensitive UNIQUE, and the
    // IPC path permits it. Returning the wrong one attaches a tag with a
    // different identity and colour than the operator named.
    const lower = createTag({ name: 'evidence', color: '#111111' })
    const upper = createTag({ name: 'Evidence', color: '#222222' })
    expect(findOrCreateTagByName('Evidence').id).toBe(upper.id)
    expect(findOrCreateTagByName('evidence').id).toBe(lower.id)
  })

  it('falls back to a case-insensitive match rather than violating the UNIQUE index', () => {
    const existing = createTag({ name: 'Evidence' })
    expect(findOrCreateTagByName('EVIDENCE').id).toBe(existing.id)
    expect(listTags()).toHaveLength(1)
  })

  it('creates the tag when nothing matches', () => {
    const created = findOrCreateTagByName('meridian-trust')
    expect(created.name).toBe('meridian-trust')
    expect(listTags().map((t) => t.id)).toEqual([created.id])
  })
})

describe('applyTagToNote', () => {
  it('attaches to the note AND to the capture the note was written against', () => {
    const note = createNote({ caseId, captureId, title: 'N', body: 'text' })
    const result = applyTagToNote({ noteId: note.id, name: 'wire-transfer' })

    expect(result.captureId).toBe(captureId)
    expect(getTagsForNote(note.id).map((t) => t.name)).toEqual(['wire-transfer'])
    // The capture half is what keeps capture-level filtering and the Signals
    // coverage strip able to see tags raised from a note (ruling R15).
    expect(getTagsForCapture(captureId).map((t) => t.name)).toEqual(['wire-transfer'])
  })

  it('attaches to the capture an anchor names when the note has no capture_id', () => {
    const note = createNote({
      caseId,
      title: 'N',
      body: 'text',
      anchor: JSON.stringify({ kind: 'capture', captureId })
    })
    expect(note.captureId).toBeUndefined()

    const result = applyTagToNote({ noteId: note.id, name: 'anchored' })
    expect(result.captureId).toBe(captureId)
    expect(getTagsForCapture(captureId).map((t) => t.name)).toEqual(['anchored'])
  })

  it('attaches to the note only when it is anchored to nothing', () => {
    const note = createNote({ caseId, title: 'N', body: 'text' })
    const result = applyTagToNote({ noteId: note.id, name: 'note-only' })

    expect(result.captureId).toBeUndefined()
    expect(getTagsForNote(note.id).map((t) => t.name)).toEqual(['note-only'])
    expect(getTagsForCapture(captureId)).toEqual([])
  })

  it('reuses an existing tag rather than failing the UNIQUE index', () => {
    const existing = createTag({ name: 'evidence', color: '#f00' })
    const note = createNote({ caseId, title: 'N', body: 'text' })

    const result = applyTagToNote({ noteId: note.id, name: 'evidence' })
    expect(result.tag.id).toBe(existing.id)
    expect(result.tag.color).toBe('#f00')
    expect(listTags()).toHaveLength(1)
  })

  it('is idempotent: applying the same name twice leaves one link and one tag', () => {
    const note = createNote({ caseId, captureId, title: 'N', body: 'text' })
    applyTagToNote({ noteId: note.id, name: 'repeat' })
    applyTagToNote({ noteId: note.id, name: 'repeat' })

    expect(getTagsForNote(note.id)).toHaveLength(1)
    expect(getTagsForCapture(captureId)).toHaveLength(1)
    expect(listTags()).toHaveLength(1)
  })

  it('trims the name it is given', () => {
    const note = createNote({ caseId, title: 'N', body: 'text' })
    expect(applyTagToNote({ noteId: note.id, name: '  spaced  ' }).tag.name).toBe('spaced')
  })

  it('refuses a blank name rather than creating a nameless tag', () => {
    const note = createNote({ caseId, title: 'N', body: 'text' })
    expect(() => applyTagToNote({ noteId: note.id, name: '   ' })).toThrow(/required/i)
    expect(listTags()).toEqual([])
  })

  it('names the missing note rather than failing on a foreign key', () => {
    expect(() => applyTagToNote({ noteId: 'no-such-note', name: 'x' })).toThrow(NoteNotFoundError)
    // This one throws before the first write, so it says nothing about the
    // transaction; the rollback proper is the next test.
    expect(listTags()).toEqual([])
  })

  it('rolls the note half back when the capture half fails', () => {
    // The only failure that lands mid-transaction, after a tag row and its note
    // link already exist: an anchor is stored as JSON on the note and nothing
    // checks the capture it cites, so capture_tags' foreign key is the first
    // thing to notice. A half-applied tag would claim on getTagsForNote what
    // getTagsForCapture denies, which is why the whole apply is one transaction.
    const note = createNote({
      caseId,
      title: 'N',
      body: 'text',
      anchor: JSON.stringify({ kind: 'capture', captureId: 'deleted-capture' })
    })

    expect(() => applyTagToNote({ noteId: note.id, name: 'half-applied' })).toThrow(
      /FOREIGN KEY/i
    )
    expect(listTags()).toEqual([])
    expect(getTagsForNote(note.id)).toEqual([])
  })
})

describe('captureForNote', () => {
  it('prefers the note’s own capture_id over an anchor citing another', () => {
    const note = {
      id: 'n',
      caseId,
      captureId: 'own-capture',
      title: '',
      body: '',
      anchor: { kind: 'capture', captureId: 'cited-capture' },
      createdAt: '',
      updatedAt: ''
    } as Note
    expect(captureForNote(note)).toBe('own-capture')
  })

  it('returns undefined for a note bound to nothing', () => {
    const note = { id: 'n', caseId, title: '', body: '', createdAt: '', updatedAt: '' } as Note
    expect(captureForNote(note)).toBeUndefined()
  })
})
