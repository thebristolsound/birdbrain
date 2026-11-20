// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Note, Selector, Tag } from '@shared/types'
import { QuickNotesBlock } from '@renderer/components/overview/QuickNotesBlock'
import { OverviewTagsBlock } from '@renderer/components/overview/OverviewTagsBlock'
import { OverviewSelectorsBlock } from '@renderer/components/overview/OverviewSelectorsBlock'
import { SinceLastVisitBanner } from '@renderer/components/overview/SinceLastVisitBanner'
import { fakeBridge } from '../renderer/fakeBridge'

const note = (over: Partial<Note>): Note => ({
  id: 'n1',
  caseId: 'case1',
  title: 'A note',
  body: 'body text',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over
})

const selector = (over: Partial<Selector>): Selector => ({
  id: 's1',
  caseId: 'case1',
  pattern: 'acme',
  isRegex: false,
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over
})

function withClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<>{ui}</>, { wrapper: Wrapper })
}

afterEach(cleanup)

describe('QuickNotesBlock', () => {
  it('shows only the two most recent notes', () => {
    withClient(
      <QuickNotesBlock
        caseId="case1"
        notes={[note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c' })]}
      />
    )

    expect(screen.getAllByTestId('overview-quick-note-row')).toHaveLength(2)
  })

  it('falls back to a placeholder for an untitled note and omits an empty body', () => {
    withClient(<QuickNotesBlock caseId="case1" notes={[note({ title: '', body: '' })]} />)
    const [row] = screen.getAllByTestId('overview-quick-note-row')

    expect(row.textContent).toContain('(Untitled note)')
    expect(row.querySelector('p')).toBeNull()
  })

  it('says so when the case has no notes at all', () => {
    withClient(<QuickNotesBlock caseId="case1" notes={[]} />)

    expect(screen.getByText('No notes yet.')).toBeTruthy()
  })

  // Same shape CreateNoteCard writes: a title plus an empty body document, so a
  // quick note is an ordinary note rather than a second kind of record.
  it('creates a note with an empty body document and clears the field', async () => {
    const create = vi.fn(async () => note({}))
    fakeBridge({ notes: { create } })
    withClient(<QuickNotesBlock caseId="case1" notes={[]} />)
    const input = screen.getByTestId('overview-quick-note-input') as HTMLInputElement

    fireEvent.change(input, { target: { value: '  Follow up on the domain  ' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create).toHaveBeenCalledWith({
      caseId: 'case1',
      title: 'Follow up on the domain',
      bodyDoc: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })
    })
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('does not write a note from whitespace alone', async () => {
    const create = vi.fn(async () => note({}))
    fakeBridge({ notes: { create } })
    withClient(<QuickNotesBlock caseId="case1" notes={[]} />)
    const input = screen.getByTestId('overview-quick-note-input') as HTMLInputElement

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.submit(input.closest('form')!)

    expect(create).not.toHaveBeenCalled()
  })
})

describe('OverviewTagsBlock', () => {
  const tags: Tag[] = [
    { id: 't1', name: 'evidence', color: '#22c55e' },
    { id: 't2', name: 'lead' },
    { id: 't3', name: 'unused' }
  ]

  it('ranks the tags this case actually uses and drops the ones it does not', () => {
    withClient(<OverviewTagsBlock tags={tags} usageCounts={{ t1: 2, t2: 5 }} />)
    const chips = screen.getAllByTestId('overview-tag-chip').map((c) => c.textContent)

    expect(chips).toEqual(['lead5', 'evidence2'])
    expect(screen.queryByText('No Tags applied in this Case yet.')).toBeNull()
  })

  it('says so when nothing in the case is tagged', () => {
    withClient(<OverviewTagsBlock tags={tags} usageCounts={{}} />)

    expect(screen.queryAllByTestId('overview-tag-chip')).toHaveLength(0)
    expect(screen.getByText('No Tags applied in this Case yet.')).toBeTruthy()
  })

  it('offers no control that creates a tag, with or without tags to list', () => {
    const cases: Array<Record<string, number>> = [{}, { t1: 1 }]
    for (const usageCounts of cases) {
      withClient(<OverviewTagsBlock tags={tags} usageCounts={usageCounts} />)
      const block = within(screen.getByTestId('overview-tags-block'))

      expect(block.queryAllByRole('button')).toHaveLength(0)
      expect(block.queryAllByRole('textbox')).toHaveLength(0)
      cleanup()
    }
  })

  it('tints a colourless tag from a theme token rather than a broken value', () => {
    withClient(<OverviewTagsBlock tags={tags} usageCounts={{ t2: 1 }} />)
    const [chip] = screen.getAllByTestId('overview-tag-chip')

    expect(chip.getAttribute('style')).toContain('var(--color-text-muted)')
  })
})

describe('OverviewSelectorsBlock', () => {
  it('lists every selector, uncapped, with the Captures each matches', () => {
    const selectors = Array.from({ length: 9 }, (_, i) => selector({ id: `s${i}` }))
    withClient(<OverviewSelectorsBlock selectors={selectors} matchCounts={{ s0: 4, s1: 1 }} />)
    const rows = screen.getAllByTestId('overview-selector-row').map((row) => row.textContent)

    expect(rows).toHaveLength(9)
    expect(rows[0]).toBe('acme4 Captures')
    expect(rows[1]).toBe('acme1 Capture')
    expect(rows.slice(2)).toEqual(Array(7).fill('acme0 Captures'))
  })

  it('names a selector by its label, and by its pattern when it has none', () => {
    withClient(
      <OverviewSelectorsBlock
        selectors={[
          selector({ id: 's1', label: 'Acme Corp', pattern: 'acme\\.example' }),
          selector({ id: 's2', pattern: 'bc1[a-z0-9]+' })
        ]}
        matchCounts={{}}
      />
    )
    const rows = screen.getAllByTestId('overview-selector-row').map((row) => row.textContent)

    expect(rows).toEqual(['Acme Corp0 Captures', 'bc1[a-z0-9]+0 Captures'])
  })

  it('dims the name of a selector that is switched off, and no other', () => {
    withClient(
      <OverviewSelectorsBlock
        selectors={[
          selector({ id: 's1', pattern: 'on' }),
          selector({ id: 's2', pattern: 'off', enabled: false })
        ]}
        matchCounts={{}}
      />
    )

    expect(screen.getByText('on').className).not.toContain('opacity-40')
    expect(screen.getByText('off').className).toContain('opacity-40')
  })

  it('says in words that a selector is switched off, for a reader who cannot see the dimming', () => {
    withClient(
      <OverviewSelectorsBlock
        selectors={[
          selector({ id: 's1', pattern: 'on' }),
          selector({ id: 's2', pattern: 'off', enabled: false })
        ]}
        matchCounts={{}}
      />
    )

    const [on, off] = screen.getAllByTestId('overview-selector-row')
    expect(within(on).queryByText('Switched off')).toBeNull()
    expect(within(off).getByText('Switched off').className).toContain('sr-only')
  })

  it('offers no control that adds or toggles a selector, with or without selectors', () => {
    for (const selectors of [[], [selector({}), selector({ id: 's2', enabled: false })]]) {
      withClient(<OverviewSelectorsBlock selectors={selectors} matchCounts={{}} />)
      const block = within(screen.getByTestId('overview-selectors-block'))

      expect(block.queryAllByRole('switch')).toHaveLength(0)
      expect(block.queryAllByRole('button')).toHaveLength(0)
      expect(block.queryAllByRole('textbox')).toHaveLength(0)
      cleanup()
    }
  })

  it('says so when the case has no selectors', () => {
    withClient(<OverviewSelectorsBlock selectors={[]} matchCounts={{}} />)

    expect(screen.getByText('No selectors defined yet.')).toBeTruthy()
    expect(screen.queryAllByTestId('overview-selector-row')).toHaveLength(0)
  })
})

describe('SinceLastVisitBanner', () => {
  const deltas = { captures: 3, sources: 2, selectors: 1, notes: 4 }

  it('lays the four deltas out as one tile each', () => {
    render(
      <SinceLastVisitBanner
        deltas={deltas}
        lastVisitAt="2026-08-01T00:00:00.000Z"
        newCount={10}
        onReview={vi.fn()}
      />
    )
    const card = screen.getByTestId('overview-since-last-visit')

    expect(card.textContent).toContain('+3')
    expect(card.textContent).toContain('+4')
    expect(card.textContent).toContain('new captures')
  })

  it('offers a review action carrying the total', () => {
    const onReview = vi.fn()
    render(
      <SinceLastVisitBanner
        deltas={deltas}
        lastVisitAt="2026-08-01T00:00:00.000Z"
        newCount={10}
        onReview={onReview}
      />
    )

    fireEvent.click(screen.getByText(/Review 10/))
    expect(onReview).toHaveBeenCalled()
  })
})
