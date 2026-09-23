import { describe, it, expect } from 'vitest'
import {
  EMPTY_MENTION_SOURCES,
  resolveMention
} from '@renderer/components/notes/mention/mentionModel'

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
