import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { createNote } from '@main/services/db/noteRepo'
import {
  addTagToCapture,
  addTagToCaptures,
  addTagToNote,
  createTag,
  findOrCreateTagByName,
  getTagCountsForCaptures,
  getTagsForCapture,
  getTagsForNote,
  listTags,
  removeTagFromCaptures
} from '@main/services/db/tagRepo'

/**
 * Known-answer test for the batch tag-membership reads and writes (#665).
 *
 * The fixture is fixed and small enough to state the whole answer rather than
 * probe it: four captures in Meridian, one in Unrelated, two tags, and one
 * note. Every assertion below is a complete membership list or a complete
 * counts object, so an extra or missing row fails rather than passing an
 * `arrayContaining`.
 *
 * These functions carry no evidentiary payload — tag membership is
 * investigator-applied metadata, outside the hash chain and the manifest — but
 * they do write to `capture_tags`, which case archives export, so the answers
 * they give are what a later reader sees.
 */

let meridian = ''
let unrelated = ''
let A = ''
let B = ''
let C = ''
let D = ''
let Z = ''
let noteId = ''
let alpha = ''
let beta = ''

function seed(caseId: string, slug: string): string {
  return insertCapture({
    caseId,
    url: `https://example.test/${slug}`,
    title: slug,
    hash: `hash-${slug}`,
    timestamp: '2026-02-01T00:00:00.000Z',
    format: 'mhtml'
  }).id
}

beforeEach(async () => {
  await initDatabase(':memory:')
  meridian = createCase({ name: 'Meridian', description: '', type: 'custom' }).id
  unrelated = createCase({ name: 'Unrelated', description: '', type: 'custom' }).id
  A = seed(meridian, 'a')
  B = seed(meridian, 'b')
  C = seed(meridian, 'c')
  D = seed(meridian, 'd')
  Z = seed(unrelated, 'z')
  noteId = createNote({ caseId: meridian, title: 'Note', body: 'body' }).id

  alpha = createTag({ name: 'alpha', color: '#f59e0b' }).id
  beta = createTag({ name: 'beta', color: '#3b82f6' }).id

  // Pre-state: alpha on A, B and Z; beta on B and on the note.
  addTagToCapture({ captureId: A, tagId: alpha })
  addTagToCapture({ captureId: B, tagId: alpha })
  addTagToCapture({ captureId: Z, tagId: alpha })
  addTagToCapture({ captureId: B, tagId: beta })
  addTagToNote({ noteId, tagId: beta })
})

afterEach(() => {
  closeDatabase()
})

describe('getTagCountsForCaptures (#665)', () => {
  it('counts only the captures named, and omits tags none of them carry', () => {
    // Selection [A, B, C]: alpha on two of the three, beta on one, and no
    // key at all for a tag nobody in the selection holds.
    expect(getTagCountsForCaptures([A, B, C])).toEqual({ [alpha]: 2, [beta]: 1 })
    // D carries nothing.
    expect(getTagCountsForCaptures([D])).toEqual({})
    // An empty selection is an empty answer, with no query run.
    expect(getTagCountsForCaptures([])).toEqual({})
  })

  it('de-duplicates repeated ids rather than double-counting them', () => {
    expect(getTagCountsForCaptures([A, A, A, B])).toEqual({ [alpha]: 2, [beta]: 1 })
  })

  it('never reaches a capture outside the ids given', () => {
    // Z carries alpha and is not named, so it contributes nothing.
    expect(getTagCountsForCaptures([A])).toEqual({ [alpha]: 1 })
  })
})

describe('removeTagFromCaptures (#665)', () => {
  it('clears the tag from exactly the ids named and leaves every other link', () => {
    expect(removeTagFromCaptures([A, B, C], alpha)).toBe(3)

    expect(getTagsForCapture(A).map((t) => t.id)).toEqual([])
    expect(getTagsForCapture(B).map((t) => t.id)).toEqual([beta])
    expect(getTagsForCapture(C).map((t) => t.id)).toEqual([])
    // Another case's capture is untouched: the repo removes what it is given,
    // and the same-case guard that decides what it is given lives in the
    // handler.
    expect(getTagsForCapture(Z).map((t) => t.id)).toEqual([alpha])
    // Untagging captures is not deleting the tag, and never touches note_tags.
    expect(listTags().map((t) => t.name)).toEqual(['alpha', 'beta'])
    expect(getTagsForNote(noteId).map((t) => t.id)).toEqual([beta])
  })

  it('reports the ids asked for, not the rows deleted', () => {
    // C and D never carried alpha. The count answers "how many of the ids you
    // named lack the tag now", matching addTagToCaptures' reading.
    expect(removeTagFromCaptures([C, D], alpha)).toBe(2)
    expect(getTagCountsForCaptures([A, B, C, D])).toEqual({ [alpha]: 2, [beta]: 1 })
    expect(removeTagFromCaptures([], alpha)).toBe(0)
  })

  it('round-trips against addTagToCaptures', () => {
    expect(addTagToCaptures([A, B, C, D], alpha)).toBe(4)
    expect(getTagCountsForCaptures([A, B, C, D])).toEqual({ [alpha]: 4, [beta]: 1 })
    expect(removeTagFromCaptures([A, B, C, D], alpha)).toBe(4)
    expect(getTagCountsForCaptures([A, B, C, D])).toEqual({ [beta]: 1 })
    // Back to the pre-state for alpha, exactly.
    expect(addTagToCaptures([A, B], alpha)).toBe(2)
    expect(getTagCountsForCaptures([A, B, C, D])).toEqual({ [alpha]: 2, [beta]: 1 })
  })
})

describe('findOrCreateTagByName with a colour (#665)', () => {
  it('reuses an exact-name match without repainting it', () => {
    const found = findOrCreateTagByName('alpha', '#ef4444')
    expect(found.id).toBe(alpha)
    expect(found.color).toBe('#f59e0b')
    expect(listTags()).toHaveLength(2)
  })

  it('reuses a case-insensitive match', () => {
    expect(findOrCreateTagByName('ALPHA').id).toBe(alpha)
    expect(listTags()).toHaveLength(2)
  })

  it('applies the colour only on the create branch', () => {
    const made = findOrCreateTagByName('gamma', '#10b981')
    expect(made.name).toBe('gamma')
    expect(made.color).toBe('#10b981')
    expect(listTags().map((t) => t.name)).toEqual(['alpha', 'beta', 'gamma'])
    // No colour given means no colour stored, as createTag already did.
    expect(findOrCreateTagByName('delta').color).toBeUndefined()
  })
})
