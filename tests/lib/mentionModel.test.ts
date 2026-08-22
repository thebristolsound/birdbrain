import { describe, it, expect } from 'vitest'
import type { Capture, Note, Selector, Tag } from '@shared/types'
import {
  EMPTY_MENTION_SOURCES,
  MAX_MENTION_LABEL,
  MENTION_SCOPE_LABEL,
  MENTION_SIGIL,
  isMentionTargetType,
  maskMention,
  mentionColor,
  mentionPlainText,
  mentionRoute,
  mentionTooltip,
  rankMentionCandidates,
  resolveMention,
  truncateMentionLabel,
  type MentionSources,
  type MentionSourcesLoaded
} from '@renderer/components/notes/mention/mentionModel'

const ALL_LOADED: MentionSourcesLoaded = { capture: true, note: true, selector: true, tag: true }

function capture(id: string, title: string, url = `https://example.com/${id}`): Capture {
  return {
    id,
    caseId: 'case1',
    url,
    title,
    hash: 'h',
    timestamp: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    format: 'mhtml',
    method: 'extension'
  }
}

function note(id: string, title: string): Note {
  return {
    id,
    caseId: 'case1',
    title,
    body: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  }
}

function selector(id: string, pattern: string, label?: string): Selector {
  return {
    id,
    caseId: 'case1',
    pattern,
    isRegex: false,
    enabled: true,
    label,
    createdAt: '2026-08-01T00:00:00.000Z'
  }
}

function tag(id: string, name: string, color?: string): Tag {
  return { id, name, color }
}

function sources(overrides: Partial<MentionSources> = {}): MentionSources {
  return { ...EMPTY_MENTION_SOURCES, ...overrides }
}

describe('MENTION_SIGIL', () => {
  it('splits the four kinds across the two trigger keys', () => {
    // The design source, not the ticket body: @ offers captures and notes,
    // # offers selectors and tags.
    expect(MENTION_SIGIL).toEqual({ capture: '@', note: '@', selector: '#', tag: '#' })
  })

  it('labels each popup with the kinds it offers', () => {
    expect(MENTION_SCOPE_LABEL['@']).toBe('captures · notes')
    expect(MENTION_SCOPE_LABEL['#']).toBe('selectors · tags')
  })
})

describe('isMentionTargetType', () => {
  it.each(['capture', 'note', 'selector', 'tag'])('accepts %s', (value) => {
    expect(isMentionTargetType(value)).toBe(true)
  })

  it.each([['null'], ['case'], [''], [null], [undefined], [42]])(
    'rejects %p, which is what a lossy paste produces',
    (value) => {
      expect(isMentionTargetType(value)).toBe(false)
    }
  )
})

describe('truncateMentionLabel', () => {
  it('passes a label of exactly the limit through untouched', () => {
    const at = 'x'.repeat(MAX_MENTION_LABEL)
    expect(truncateMentionLabel(at)).toBe(at)
    expect(truncateMentionLabel(at)).toHaveLength(30)
  })

  it('passes a label one under the limit through untouched', () => {
    const under = 'x'.repeat(MAX_MENTION_LABEL - 1)
    expect(truncateMentionLabel(under)).toBe(under)
  })

  it('elides a label one over the limit to 29 characters plus an ellipsis', () => {
    const over = 'x'.repeat(MAX_MENTION_LABEL + 1)
    expect(truncateMentionLabel(over)).toBe(`${'x'.repeat(29)}…`)
    expect(truncateMentionLabel(over)).toHaveLength(30)
  })
})

describe('maskMention and mentionPlainText', () => {
  it('renders a Mention as its sigil plus its label', () => {
    expect(maskMention('capture', 'Thread 88213')).toBe('@Thread 88213')
    expect(maskMention('selector', 'nightjar')).toBe('#nightjar')
  })

  it('elides the masked form but not the plain-text one', () => {
    const long = 'x'.repeat(40)
    expect(maskMention('note', long)).toBe(`@${'x'.repeat(29)}…`)
    expect(mentionPlainText('note', long)).toBe(`@${long}`)
  })
})

describe('mentionColor', () => {
  it('maps capture, note and selector onto palette tokens', () => {
    expect(mentionColor('capture')).toBe('var(--color-amber-500)')
    expect(mentionColor('note')).toBe('var(--color-accent)')
    expect(mentionColor('selector')).toBe('var(--color-violet-500)')
  })

  it("uses a tag's own colour when it has one", () => {
    expect(mentionColor('tag', '#22c55e')).toBe('#22c55e')
  })

  it('falls a colourless tag back to the design pink, never to a hex literal', () => {
    expect(mentionColor('tag')).toBe('var(--color-pink-500)')
    expect(mentionColor('tag', '')).toBe('var(--color-pink-500)')
    expect(mentionColor('tag', null)).toBe('var(--color-pink-500)')
  })
})

describe('mentionTooltip', () => {
  it('says what a click will do, in the app vocabulary', () => {
    expect(mentionTooltip('selector', 'nightjar')).toBe(
      'selector · nightjar — click to edit the rule'
    )
    expect(mentionTooltip('capture', 'Thread')).toBe('capture · Thread — click to open')
    expect(mentionTooltip('tag', 'suspect')).toBe('tag · suspect — click to view')
  })

  it('does not invite a click on a target that is gone', () => {
    expect(mentionTooltip('capture', 'Thread', true)).toBe('capture · Thread — target deleted')
  })
})

describe('mentionRoute', () => {
  it('sends each kind to the screen that shows it', () => {
    expect(mentionRoute('capture')).toBe('/cases/$caseId/captures')
    expect(mentionRoute('note')).toBe('/cases/$caseId/notes')
    expect(mentionRoute('selector')).toBe('/cases/$caseId/selectors')
    expect(mentionRoute('tag')).toBe('/cases/$caseId/tags')
  })
})

describe('resolveMention', () => {
  const live = sources({
    captures: [capture('cap1', 'Thread 88213')],
    notes: [note('n1', 'Timeline')],
    selectors: [selector('s1', 'nightjar', 'Handle')],
    tags: [tag('t1', 'suspect', '#22c55e')]
  })

  it('reports loading, not missing, while the list is still in flight', () => {
    const loading = resolveMention('capture', 'cap1', EMPTY_MENTION_SOURCES, {
      ...ALL_LOADED,
      capture: false
    })
    expect(loading).toEqual({ status: 'loading', label: null, color: null })
  })

  it('returns the current label so a rename lands without rewriting the note', () => {
    expect(resolveMention('capture', 'cap1', live, ALL_LOADED)).toEqual({
      status: 'resolved',
      label: 'Thread 88213',
      color: null
    })
    expect(resolveMention('note', 'n1', live, ALL_LOADED).label).toBe('Timeline')
    expect(resolveMention('selector', 's1', live, ALL_LOADED).label).toBe('Handle')
  })

  it("carries a tag's own colour back with its name", () => {
    expect(resolveMention('tag', 't1', live, ALL_LOADED)).toEqual({
      status: 'resolved',
      label: 'suspect',
      color: '#22c55e'
    })
  })

  it('identifies an untitled capture by its URL rather than by nothing', () => {
    const untitled = sources({ captures: [capture('cap2', '', 'https://example.com/x')] })
    expect(resolveMention('capture', 'cap2', untitled, ALL_LOADED).label).toBe(
      'https://example.com/x'
    )
  })

  it('falls a label-less selector back to its pattern, as the references index does', () => {
    const bare = sources({ selectors: [selector('s2', 'nightjar')] })
    expect(resolveMention('selector', 's2', bare, ALL_LOADED).label).toBe('nightjar')
  })

  it.each(['capture', 'note', 'selector', 'tag'] as const)(
    'reports a deleted %s target as missing',
    (kind) => {
      expect(resolveMention(kind, 'gone', live, ALL_LOADED)).toEqual({
        status: 'missing',
        label: null,
        color: null
      })
    }
  )
})

describe('rankMentionCandidates', () => {
  const populated = sources({
    captures: [capture('cap1', 'Nightjar thread'), capture('cap2', 'Unrelated page')],
    notes: [note('n1', 'Nightjar timeline'), note('n2', 'Other')],
    selectors: [selector('s1', 'nightjar', 'Handle'), selector('s2', 'kestrel')],
    tags: [tag('t1', 'suspect'), tag('t2', 'nightjar-linked')],
    tagUsage: { t1: 4 },
    selectorMatchCounts: { s1: 12 }
  })

  it('offers captures then notes behind @', () => {
    const rows = rankMentionCandidates({ sigil: '@', query: '', sources: populated })
    expect(rows.map((r) => r.targetType)).toEqual(['capture', 'capture', 'note', 'note'])
  })

  it('offers selectors then tags behind #', () => {
    const rows = rankMentionCandidates({ sigil: '#', query: '', sources: populated })
    expect(rows.map((r) => r.targetType)).toEqual(['selector', 'selector', 'tag', 'tag'])
  })

  it('filters case-insensitively on a substring of the label', () => {
    const rows = rankMentionCandidates({ sigil: '@', query: 'NIGHTJAR', sources: populated })
    expect(rows.map((r) => r.targetId)).toEqual(['cap1', 'n1'])
  })

  it('shows a selector its live match count and every other kind its type', () => {
    const rows = rankMentionCandidates({ sigil: '#', query: '', sources: populated })
    expect(rows.find((r) => r.targetId === 's1')?.meta).toBe('12 hits')
    expect(rows.find((r) => r.targetId === 's2')?.meta).toBe('0 hits')
    expect(rows.find((r) => r.targetId === 't1')?.meta).toBe('tag')
  })

  it('ranks tags this case already uses above the rest, then alphabetically', () => {
    const many = sources({
      tags: [tag('t1', 'zebra'), tag('t2', 'alpha'), tag('t3', 'beta')],
      tagUsage: { t1: 9 }
    })
    const rows = rankMentionCandidates({ sigil: '#', query: '', sources: many })
    expect(rows.map((r) => r.label)).toEqual(['zebra', 'alpha', 'beta'])
  })

  it('does not offer the note being written as a target of itself', () => {
    const rows = rankMentionCandidates({
      sigil: '@',
      query: '',
      sources: populated,
      excludeNoteId: 'n1'
    })
    expect(rows.map((r) => r.targetId)).not.toContain('n1')
  })

  it('filters before it caps, so the ninth capture is still reachable', () => {
    // The design source caps the primary kind at eight rows before filtering,
    // which hides a matching capture behind eight that do not match.
    const captures = Array.from({ length: 12 }, (_, i) => capture(`cap${i}`, `Page ${i}`))
    captures[8] = capture('cap8', 'Nightjar thread')
    const rows = rankMentionCandidates({
      sigil: '@',
      query: 'nightjar',
      sources: sources({ captures })
    })
    expect(rows.map((r) => r.targetId)).toEqual(['cap8'])
  })

  it('never shows more than six rows', () => {
    const captures = Array.from({ length: 20 }, (_, i) => capture(`cap${i}`, `Page ${i}`))
    const rows = rankMentionCandidates({ sigil: '@', query: '', sources: sources({ captures }) })
    expect(rows).toHaveLength(6)
  })

  it('identifies an untitled capture and a label-less selector by what they have', () => {
    const bare = sources({
      captures: [capture('cap1', '', 'https://example.com/thread')],
      selectors: [selector('s1', 'nightjar')]
    })
    expect(rankMentionCandidates({ sigil: '@', query: '', sources: bare })[0].label).toBe(
      'https://example.com/thread'
    )
    expect(rankMentionCandidates({ sigil: '#', query: '', sources: bare })[0].label).toBe(
      'nightjar'
    )
  })

  it('names an untitled note rather than offering a blank row', () => {
    const bare = sources({ notes: [note('n1', '')] })
    expect(rankMentionCandidates({ sigil: '@', query: '', sources: bare })[0].label).toBe(
      '(Untitled note)'
    )
  })

  it('returns nothing when a case has nothing to offer', () => {
    expect(
      rankMentionCandidates({ sigil: '@', query: 'x', sources: EMPTY_MENTION_SOURCES })
    ).toEqual([])
  })
})
