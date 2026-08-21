/**
 * The note references index (#389).
 *
 * A Mention is identity, not text: (targetType, targetId) survives a rename and
 * outlives a deletion. The index that answers "what does this note mention" and
 * "what mentions this" is derived state — it is rewritten from the validated
 * document inside the same transaction as every note-body write, so a body and
 * the references drawn from it can never disagree on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { initDatabase, closeDatabase, getDb, type ImportCtx } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import {
  createNote,
  updateNote,
  deleteNote,
  getNote,
  importNoteRows
} from '@main/services/db/noteRepo'
import {
  MentionCaseMismatchError,
  backlinkCountsForCase,
  backlinksForTarget,
  rebuildForCase,
  referencesForNote
} from '@main/services/db/noteReferenceRepo'
import { insertCapture, deleteCapture } from '@main/services/db/captureRepo'
import { createSelector, deleteSelector } from '@main/services/db/selectorRepo'
import { createTag } from '@main/services/db/tagRepo'
import type { MentionTargetType } from '@shared/types'

const mention = (targetType: MentionTargetType, targetId: string, label = ''): JSONContent => ({
  type: 'mention',
  attrs: { targetType, targetId, label }
})

const text = (value: string): JSONContent => ({ type: 'text', text: value })

function docOf(...inline: JSONContent[]): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: inline }] })
}

function indexRows(noteId: string): Array<Record<string, unknown>> {
  return getDb()
    .prepare('SELECT * FROM note_references WHERE note_id = ? ORDER BY ord')
    .all(noteId) as Array<Record<string, unknown>>
}

describe('note references index', () => {
  let caseId: string

  beforeEach(async () => {
    await initDatabase(':memory:')
    caseId = createCase({ name: 'References', description: '' }).id
  })

  afterEach(() => closeDatabase())

  function capture(inCase = caseId, title = 'Acme homepage') {
    return insertCapture({
      caseId: inCase,
      url: 'https://acme.example',
      title,
      hash: 'abc123',
      timestamp: '2026-08-20T00:00:00Z'
    })
  }

  describe('schema', () => {
    it('keys rows by (note_id, ord) so document order and duplicates survive', () => {
      const cols = getDb().prepare("PRAGMA table_info('note_references')").all() as Array<{
        name: string
        pk: number
      }>

      // Which columns exist, not what order they sit in — a later migration
      // that rebuilds the table is free to reorder them.
      expect(cols.map((c) => c.name).sort()).toEqual(
        ['note_id', 'ord', 'target_id', 'target_type'].sort()
      )
      expect(cols.filter((c) => c.pk > 0).map((c) => c.name)).toEqual(['note_id', 'ord'])
    })

    it('carries a foreign key to notes only — a deleted TARGET stays representable', () => {
      const keys = getDb().prepare("PRAGMA foreign_key_list('note_references')").all() as Array<{
        table: string
        on_delete: string
      }>

      expect(keys).toHaveLength(1)
      expect(keys[0]).toMatchObject({ table: 'notes', on_delete: 'CASCADE' })
    })

    it('indexes the target side, which is what backlink reads scan', () => {
      const indexes = (
        getDb().prepare("PRAGMA index_list('note_references')").all() as Array<{ name: string }>
      ).map((i) => i.name)

      expect(indexes).toContain('idx_note_references_target')
    })
  })

  describe('writing the index', () => {
    it('records every mention of a new note in document order', () => {
      const cap = capture()
      const note = createNote({
        caseId,
        bodyDoc: docOf(text('see '), mention('capture', cap.id, 'Acme'), mention('tag', 'tag-1'))
      })

      expect(indexRows(note.id)).toEqual([
        { note_id: note.id, ord: 0, target_type: 'capture', target_id: cap.id },
        { note_id: note.id, ord: 1, target_type: 'tag', target_id: 'tag-1' }
      ])
    })

    it('keeps a repeated mention as its own row rather than deduplicating it', () => {
      const cap = capture()
      const note = createNote({
        caseId,
        bodyDoc: docOf(mention('capture', cap.id, 'first'), mention('capture', cap.id, 'again'))
      })

      expect(indexRows(note.id).map((r) => r.ord)).toEqual([0, 1])
    })

    it('replaces the whole set on a later body write', () => {
      const cap = capture()
      const note = createNote({ caseId, bodyDoc: docOf(mention('capture', cap.id)) })

      updateNote({ id: note.id, bodyDoc: docOf(mention('tag', 'tag-2')) })

      expect(indexRows(note.id)).toEqual([
        { note_id: note.id, ord: 0, target_type: 'tag', target_id: 'tag-2' }
      ])
    })

    // Spike constraint 8: resolveBody already clears body_doc on a plain-text
    // write; the references derived from that document must go with it, or the
    // index would describe a document the note no longer has.
    it('clears the index when a plain-text write clears body_doc', () => {
      const note = createNote({ caseId, bodyDoc: docOf(mention('tag', 'tag-1')) })

      updateNote({ id: note.id, body: 'plain text now' })

      expect(getNote(note.id)!.bodyDoc).toBeUndefined()
      expect(indexRows(note.id)).toEqual([])
    })

    // Mirrors the untouched-anchor branch: an unrelated edit must not
    // re-validate mentions a later case move has made questionable.
    it('leaves the index alone on a body-less update', () => {
      const note = createNote({ caseId, bodyDoc: docOf(mention('tag', 'tag-1')) })

      updateNote({ id: note.id, title: 'Retitled' })

      expect(indexRows(note.id)).toHaveLength(1)
    })

    it('writes nothing for a note with no mentions', () => {
      const note = createNote({ caseId, body: 'no mentions here' })

      expect(indexRows(note.id)).toEqual([])
    })

    it('drops a note’s rows when the note is deleted', () => {
      const note = createNote({ caseId, bodyDoc: docOf(mention('tag', 'tag-1')) })

      deleteNote(note.id)

      expect(indexRows(note.id)).toEqual([])
    })

    // The index is derived state; it must commit or roll back with the body it
    // was derived from, never on its own.
    it('leaves the previous index intact when a re-save is rejected', () => {
      const otherCase = createCase({ name: 'Elsewhere', description: '' }).id
      const cap = capture()
      const foreign = capture(otherCase, 'Foreign')
      const note = createNote({ caseId, bodyDoc: docOf(mention('capture', cap.id)) })

      expect(() =>
        updateNote({ id: note.id, bodyDoc: docOf(mention('capture', foreign.id)) })
      ).toThrow(MentionCaseMismatchError)

      expect(indexRows(note.id)).toEqual([
        { note_id: note.id, ord: 0, target_type: 'capture', target_id: cap.id }
      ])
      expect(getNote(note.id)!.bodyDoc).toContain(cap.id)
    })

    it('writes no note row at all when a create is rejected', () => {
      const otherCase = createCase({ name: 'Elsewhere', description: '' }).id
      const foreign = capture(otherCase, 'Foreign')

      expect(() => createNote({ caseId, bodyDoc: docOf(mention('capture', foreign.id)) })).toThrow(
        MentionCaseMismatchError
      )

      expect(getDb().prepare('SELECT COUNT(*) AS n FROM notes').get()).toEqual({ n: 0 })
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM note_references').get()).toEqual({ n: 0 })
    })
  })

  describe('case membership', () => {
    it('rejects a mention of a capture that exists in another case', () => {
      const otherCase = createCase({ name: 'Elsewhere', description: '' }).id
      const foreign = capture(otherCase, 'Foreign')

      expect(() => createNote({ caseId, bodyDoc: docOf(mention('capture', foreign.id)) })).toThrow(
        /capture .* belongs to a different case/
      )
    })

    it('rejects a mention of a selector that exists in another case', () => {
      const otherCase = createCase({ name: 'Elsewhere', description: '' }).id
      const foreign = createSelector({ caseId: otherCase, pattern: 'x' })

      expect(() => createNote({ caseId, bodyDoc: docOf(mention('selector', foreign.id)) })).toThrow(
        MentionCaseMismatchError
      )
    })

    it('rejects a mention of a note in another case', () => {
      const otherCase = createCase({ name: 'Elsewhere', description: '' }).id
      const foreign = createNote({ caseId: otherCase, title: 'Foreign' })

      expect(() => createNote({ caseId, bodyDoc: docOf(mention('note', foreign.id)) })).toThrow(
        MentionCaseMismatchError
      )
    })

    // Only an EXISTING target in the wrong case is a violation. A target that
    // does not exist is a dangling reference by design, and rejecting it would
    // make row order load-bearing in the archive importer.
    it('accepts a mention of a target that does not exist at all', () => {
      const note = createNote({ caseId, bodyDoc: docOf(mention('capture', 'never-existed')) })

      expect(indexRows(note.id)).toHaveLength(1)
    })

    it('accepts a note that mentions itself', () => {
      const note = createNote({ caseId, title: 'Self' })

      const updated = updateNote({ id: note.id, bodyDoc: docOf(mention('note', note.id, 'me')) })

      expect(updated).toBeDefined()
      expect(indexRows(note.id)).toHaveLength(1)
    })

    // Maintainer ruling 2026-08-20 (spike constraint 3): tags are global —
    // `tags` has no case_id — so any tag id is accepted. Scoping a tag to a
    // case would make removing it from a case invalidate mentions that were
    // valid when they were written.
    it('accepts any tag id, with no case check', () => {
      const tag = createTag({ name: 'Evidence', color: '#f00' })
      const note = createNote({
        caseId,
        bodyDoc: docOf(mention('tag', tag.id), mention('tag', 'no-such-tag'))
      })

      expect(indexRows(note.id).map((r) => r.target_id)).toEqual([tag.id, 'no-such-tag'])
    })
  })

  describe('reading a note’s outgoing references', () => {
    it('resolves each target’s CURRENT display name, not the label cached at insertion', () => {
      const cap = capture(caseId, 'Acme homepage')
      const selector = createSelector({ caseId, pattern: 'alpha', label: 'Alpha' })
      const tag = createTag({ name: 'Evidence', color: '#f00' })
      const other = createNote({ caseId, title: 'Sibling note' })
      const note = createNote({
        caseId,
        bodyDoc: docOf(
          mention('capture', cap.id, 'stale label'),
          mention('selector', selector.id),
          mention('tag', tag.id),
          mention('note', other.id)
        )
      })

      expect(referencesForNote(note.id)).toEqual([
        {
          noteId: note.id,
          ord: 0,
          targetType: 'capture',
          targetId: cap.id,
          label: 'Acme homepage',
          resolved: true
        },
        {
          noteId: note.id,
          ord: 1,
          targetType: 'selector',
          targetId: selector.id,
          label: 'Alpha',
          resolved: true
        },
        {
          noteId: note.id,
          ord: 2,
          targetType: 'tag',
          targetId: tag.id,
          label: 'Evidence',
          resolved: true
        },
        {
          noteId: note.id,
          ord: 3,
          targetType: 'note',
          targetId: other.id,
          label: 'Sibling note',
          resolved: true
        }
      ])
    })

    it('falls back to a selector’s pattern when it has no label', () => {
      const selector = createSelector({ caseId, pattern: 'bravo' })
      const note = createNote({ caseId, bodyDoc: docOf(mention('selector', selector.id)) })

      expect(referencesForNote(note.id)[0].label).toBe('bravo')
    })

    // AC: deleted targets surface as broken, never silently removed.
    it('keeps the reference and marks it broken when the target is deleted', () => {
      const cap = capture()
      const selector = createSelector({ caseId, pattern: 'alpha' })
      const note = createNote({
        caseId,
        bodyDoc: docOf(mention('capture', cap.id, 'Acme'), mention('selector', selector.id))
      })

      deleteCapture(cap.id)
      deleteSelector(selector.id)

      expect(referencesForNote(note.id)).toMatchObject([
        { ord: 0, targetType: 'capture', targetId: cap.id, label: null, resolved: false },
        { ord: 1, targetType: 'selector', targetId: selector.id, label: null, resolved: false }
      ])
    })

    it('returns nothing for a note with no references', () => {
      expect(referencesForNote(createNote({ caseId, title: 'Bare' }).id)).toEqual([])
    })
  })

  describe('backlinks', () => {
    it('groups the referring notes, counting repeated mentions once per note', () => {
      const cap = capture()
      const a = createNote({
        caseId,
        title: 'Twice',
        bodyDoc: docOf(text('body text '), mention('capture', cap.id), mention('capture', cap.id))
      })
      const b = createNote({
        caseId,
        title: 'Once',
        bodyDoc: docOf(mention('capture', cap.id))
      })
      createNote({ caseId, title: 'Unrelated', body: 'nothing' })

      const backlinks = backlinksForTarget({
        caseId,
        targetType: 'capture',
        targetId: cap.id
      })

      expect(backlinks.map((l) => l.noteId).sort()).toEqual([a.id, b.id].sort())
      expect(backlinks.find((l) => l.noteId === a.id)).toMatchObject({
        noteTitle: 'Twice',
        mentionCount: 2,
        snippet: 'body text @capture@capture'
      })
      expect(backlinks.find((l) => l.noteId === b.id)!.mentionCount).toBe(1)
    })

    // The index carries no case column; scope comes from the referring note,
    // which is what makes a global tag's backlinks case-scoped at all.
    it('excludes notes in other cases, which matters most for global tags', () => {
      const tag = createTag({ name: 'Evidence', color: '#f00' })
      const otherCase = createCase({ name: 'Elsewhere', description: '' }).id
      const mine = createNote({ caseId, bodyDoc: docOf(mention('tag', tag.id)) })
      createNote({ caseId: otherCase, bodyDoc: docOf(mention('tag', tag.id)) })

      const backlinks = backlinksForTarget({ caseId, targetType: 'tag', targetId: tag.id })

      expect(backlinks.map((l) => l.noteId)).toEqual([mine.id])
    })

    it('is empty for a target nothing mentions', () => {
      expect(backlinksForTarget({ caseId, targetType: 'capture', targetId: 'x' })).toEqual([])
    })
  })

  describe('whole-case backlink counts', () => {
    // Spike constraint 9: the Overview map (#402) needs one aggregate query,
    // not one backlink query per target.
    it('returns one row per mentioned target with note and mention totals', () => {
      const cap = capture()
      createNote({
        caseId,
        bodyDoc: docOf(mention('capture', cap.id), mention('capture', cap.id))
      })
      createNote({ caseId, bodyDoc: docOf(mention('capture', cap.id), mention('tag', 'tag-1')) })
      const otherCase = createCase({ name: 'Elsewhere', description: '' }).id
      createNote({ caseId: otherCase, bodyDoc: docOf(mention('tag', 'tag-1')) })

      const counts = backlinkCountsForCase(caseId)

      expect(counts).toEqual(
        expect.arrayContaining([
          { targetType: 'capture', targetId: cap.id, noteCount: 2, mentionCount: 3 },
          { targetType: 'tag', targetId: 'tag-1', noteCount: 1, mentionCount: 1 }
        ])
      )
      expect(counts).toHaveLength(2)
    })

    it('is empty for a case whose notes mention nothing', () => {
      createNote({ caseId, body: 'plain' })

      expect(backlinkCountsForCase(caseId)).toEqual([])
    })
  })

  // Spike constraint 7: the index is derived, so it must always be
  // reconstructible from the stored documents — the seam archive import and
  // any future repair path stand on.
  describe('rebuild', () => {
    it('re-derives the whole case from body_doc', () => {
      const cap = capture()
      const note = createNote({
        caseId,
        bodyDoc: docOf(mention('capture', cap.id), mention('tag', 'tag-1'))
      })
      const plain = createNote({ caseId, body: 'no mentions' })
      getDb().prepare('DELETE FROM note_references').run()

      expect(rebuildForCase(caseId)).toBe(2)
      expect(indexRows(note.id)).toHaveLength(2)
      expect(indexRows(plain.id)).toEqual([])
    })

    it('clears rows for a note whose document no longer mentions anything', () => {
      const note = createNote({ caseId, bodyDoc: docOf(mention('tag', 'tag-1')) })
      // Body drift the rebuild must correct: the document loses its mention
      // without the index being told.
      getDb()
        .prepare('UPDATE notes SET body_doc = ? WHERE id = ?')
        .run(docOf(text('nothing left')), note.id)

      expect(rebuildForCase(caseId)).toBe(0)
      expect(indexRows(note.id)).toEqual([])
    })

    // A document that no longer parses is exactly what this seam is for
    // (#662), so it must not leave the case half rebuilt: the first note's
    // rebuilt rows roll back with the failure rather than landing while the
    // rest stay stale.
    it('rolls the whole rebuild back when one stored document does not parse', () => {
      const cap = capture()
      const first = createNote({ caseId, bodyDoc: docOf(mention('capture', cap.id)) })
      const drifted = createNote({ caseId, bodyDoc: docOf(mention('tag', 'tag-1')) })
      getDb().prepare('UPDATE notes SET body_doc = ? WHERE id = ?').run('{not json', drifted.id)
      // Emptied so a committed rebuild of the first note would be visible.
      getDb().prepare('DELETE FROM note_references WHERE note_id = ?').run(first.id)

      expect(() => rebuildForCase(caseId)).toThrow(/not valid JSON/)

      expect(indexRows(first.id)).toEqual([])
      expect(indexRows(drifted.id)).toHaveLength(1)
    })
  })

  describe('archive import', () => {
    function ctx(overrides: Partial<ImportCtx> = {}): ImportCtx {
      return {
        newCaseId: caseId,
        mapId: (id) => id,
        mapTag: (id) => id,
        getText: () => '',
        ...overrides
      }
    }

    function importRows(rows: Array<Record<string, unknown>>, c: ImportCtx): void {
      importNoteRows(
        rows.map((r) => ({ created_at: 'x', updated_at: 'x', body: '', ...r })),
        c
      )
    }

    it('remaps capture, selector and note targets through mapId', () => {
      const cap = capture()
      importRows(
        [
          {
            id: 'imported-1',
            title: 'Imported',
            body_doc: docOf(mention('capture', 'source-cap'))
          }
        ],
        ctx({ mapId: (id) => (id === 'source-cap' ? cap.id : id) })
      )

      expect(referencesForNote('imported-1')).toMatchObject([
        { targetType: 'capture', targetId: cap.id, resolved: true }
      ])
    })

    // Tags merge by name on import, so mapId never covers them. A miss here
    // leaves plausible-looking references pointing at pre-merge tag ids that
    // silently resolve broken.
    it('remaps tag targets through mapTag, not mapId', () => {
      const local = createTag({ name: 'Evidence', color: '#f00' })
      importRows(
        [{ id: 'imported-2', title: 'Imported', body_doc: docOf(mention('tag', 'archive-tag')) }],
        ctx({
          mapId: (id) => (id === 'archive-tag' ? 'wrong-id-from-mapId' : id),
          mapTag: (id) => (id === 'archive-tag' ? local.id : id)
        })
      )

      expect(referencesForNote('imported-2')).toMatchObject([
        { targetType: 'tag', targetId: local.id, label: 'Evidence', resolved: true }
      ])
    })

    it('checks membership against the REMAPPED id, not the archive’s', () => {
      const otherCase = createCase({ name: 'Elsewhere', description: '' }).id
      const foreign = capture(otherCase, 'Foreign')

      expect(() =>
        importRows(
          [{ id: 'imported-3', body_doc: docOf(mention('capture', 'source-cap')) }],
          ctx({ mapId: (id) => (id === 'source-cap' ? foreign.id : id) })
        )
      ).toThrow(MentionCaseMismatchError)
      expect(getNote('imported-3')).toBeUndefined()
    })

    // Notes import in one batch, so a note mentioning a later sibling has no
    // row to check yet: accepted as dangling, resolved once the batch lands.
    it('accepts a mention of a note later in the same batch, which then resolves', () => {
      importRows(
        [
          { id: 'first', title: 'First', body_doc: docOf(mention('note', 'second')) },
          { id: 'second', title: 'Second' }
        ],
        ctx()
      )

      expect(referencesForNote('first')).toMatchObject([
        { targetType: 'note', targetId: 'second', label: 'Second', resolved: true }
      ])
    })

    // Fail-closed: parseNoteDoc's attr validation is inherited by import, and
    // the whole import runs in one transaction, so a malformed Mention refuses
    // the archive rather than half-landing it. The message names the note or
    // triage of a refused archive is impossible.
    it('fails the import on a malformed Mention, naming the note', () => {
      expect(() =>
        importRows(
          [
            { id: 'good', title: 'Good' },
            {
              id: 'bad',
              title: 'Bad note',
              body_doc: JSON.stringify({
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'mention', attrs: { targetType: 'x' } }] }
                ]
              })
            }
          ],
          ctx()
        )
      ).toThrow(/Note bad \("Bad note"\).*targetType/s)
    })
  })
})
