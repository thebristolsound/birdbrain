import { describe, expect, it } from 'vitest'
import {
  filterNotes,
  noteAge,
  noteMentions,
  noteSource,
  noteSnippet,
  usedNoteTags
} from '@renderer/components/notes/notesWorkspaceModel'
import type { Note } from '@shared/types'
const now = Date.parse('2026-09-23T12:00:00Z')
const notes: Note[] = [
  {
    id: 'a',
    caseId: 'c',
    title: 'Zulu',
    body: '',
    createdAt: '2026-09-23T10:00:00Z',
    updatedAt: ''
  },
  {
    id: 'b',
    caseId: 'c',
    title: 'Alpha',
    body: '',
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '',
    bodyDoc: JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { targetType: 'tag', targetId: 't', label: 'Research' } }
          ]
        }
      ]
    })
  },
  {
    id: 'c',
    caseId: 'c',
    title: 'Older',
    body: '',
    createdAt: '2026-08-20T10:00:00Z',
    updatedAt: ''
  }
]
describe('note list projection', () => {
  it('sorts independently of filtering without mutating the server list', () => {
    expect(filterNotes(notes, 'newest', '', 'all', now).map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(filterNotes(notes, 'oldest', '', 'all', now).map((n) => n.id)).toEqual(['c', 'b', 'a'])
    expect(filterNotes(notes, 'title', '', 'all', now).map((n) => n.id)).toEqual(['b', 'c', 'a'])
    expect(filterNotes(notes, 'newest', '', 'today', now).map((n) => n.id)).toEqual(['a'])
    expect(filterNotes(notes, 'newest', '', '7days', now).map((n) => n.id)).toEqual(['a', 'b'])
    expect(filterNotes(notes, 'newest', 't', 'all', now).map((n) => n.id)).toEqual(['b'])
    expect(notes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })
  it('gets tag identities only from real body mentions, tolerating legacy and corrupt documents', () => {
    expect(usedNoteTags([...notes, notes[1]])).toEqual([
      { targetType: 'tag', targetId: 't', label: 'Research' }
    ])
    expect(noteMentions('{')).toEqual([])
    expect(noteMentions()).toEqual([])
  })
  it('keeps snippets plain and resolves mention labels while preserving legacy fallback text', () => {
    const resolve = () => ({ label: 'Renamed tag' })
    expect(noteSnippet(notes[1], resolve)).toBe('#Renamed tag')
    expect(noteSnippet(notes[1], () => ({ label: null }))).toBe('#Research')
    expect(noteSnippet({ ...notes[0], body: 'Legacy' }, resolve)).toBe('Legacy')
    expect(noteSnippet({ ...notes[0], bodyDoc: '{', body: 'Fallback' }, resolve)).toBe('Fallback')
  })

  it('provides compact source and age labels', () => {
    expect(noteSource(notes[0])).toBe('No linked capture')
    expect(
      noteSource({ ...notes[0], captureId: 'cap', sourceUrl: 'https://example.com/path' })
    ).toBe('example.com')
    expect(noteSource({ ...notes[0], captureId: 'cap', sourceUrl: 'broken' })).toBe('broken')
    expect(noteAge('2026-09-23T12:00:00Z', now)).toBe('just now')
    expect(noteAge('2026-09-23T11:30:00Z', now)).toBe('30m ago')
    expect(noteAge(notes[0].createdAt, now)).toBe('2h ago')
    expect(noteAge(notes[1].createdAt, now)).toBe('3d ago')
  })
})
