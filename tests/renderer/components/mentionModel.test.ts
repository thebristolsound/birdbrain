import { describe, it, expect } from 'vitest'
import {
  EMPTY_MENTION_SOURCES,
  mentionDisplayText,
  rankMentionCandidates,
  resolveMention
} from '@renderer/components/notes/mention/mentionModel'
import { noteDocToText } from '@shared/noteDoc'

// A Mention of a Capture is a citation in a note, so it leads with the Exhibit
// citation the main process resolved (#1510) and falls back to the title, then
// the URL, exactly as before when no citation is on the row.

const loaded = { capture: true, note: true, selector: true, tag: true }

describe('resolveMention — capture label', () => {
  it('leads with the Exhibit citation when the row carries one', () => {
    const sources = {
      ...EMPTY_MENTION_SOURCES,
      captures: [
        {
          id: 'cap1',
          title: 'Nightjar thread',
          url: 'https://x.example/t',
          exhibitCitation: 'NK-12'
        }
      ]
    }
    expect(resolveMention('capture', 'cap1', sources, loaded).label).toBe('NK-12 · Nightjar thread')
  })

  it('keeps the title, then the URL, when there is no citation', () => {
    const sources = {
      ...EMPTY_MENTION_SOURCES,
      captures: [
        { id: 'cap1', title: 'Nightjar thread', url: 'https://x.example/t' },
        { id: 'cap2', title: '', url: 'https://x.example/untitled' }
      ]
    }
    expect(resolveMention('capture', 'cap1', sources, loaded).label).toBe('Nightjar thread')
    expect(resolveMention('capture', 'cap2', sources, loaded).label).toBe(
      'https://x.example/untitled'
    )
  })
})

describe('rankMentionCandidates — capture citation', () => {
  const sources = {
    ...EMPTY_MENTION_SOURCES,
    captures: [
      { id: 'cap1', title: 'Nightjar thread', url: 'https://x.example/t', exhibitCitation: '12' }
    ]
  }

  it('finds a capture by its citation and shows it, but keeps it out of the stored label', () => {
    const [row] = rankMentionCandidates({ sigil: '@', query: '12', sources })
    expect(row).toMatchObject({ targetId: 'cap1', label: 'Nightjar thread', citation: '12' })
    expect(mentionDisplayText(row)).toBe('12 · Nightjar thread')
  })

  // Known answer: the label a picked row stores is what the note's text, its
  // search index and the exported notes file carry. It is the name alone, as
  // before #1510, because the citation prefix is decided when it is shown.
  it('stores the same note text as a mention of an uncited capture', () => {
    const [{ targetType, targetId, label }] = rankMentionCandidates({
      sigil: '@',
      query: 'nightjar',
      sources
    })
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'mention', attrs: { targetType, targetId, label } }
          ]
        }
      ]
    }
    expect(noteDocToText(doc)).toBe('See @Nightjar thread')
  })

  it('leaves an uncited row without a citation', () => {
    const [row] = rankMentionCandidates({
      sigil: '@',
      query: 'nightjar',
      sources: {
        ...EMPTY_MENTION_SOURCES,
        captures: [{ id: 'cap2', title: 'Nightjar thread', url: 'https://x.example/t' }]
      }
    })
    expect(row).not.toHaveProperty('citation')
    expect(mentionDisplayText(row)).toBe('Nightjar thread')
  })
})
