// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Note, Selector, Tag } from '@shared/types'
import { QuickNotesBlock } from '@renderer/components/overview/QuickNotesBlock'
import { OverviewTagsBlock } from '@renderer/components/overview/OverviewTagsBlock'
import { OverviewSelectorsBlock } from '@renderer/components/overview/OverviewSelectorsBlock'
import { SinceLastVisitBanner } from '@renderer/components/overview/SinceLastVisitBanner'
import { fakeBridge } from '../renderer/fakeBridge'

const notifyInfo = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/notify', () => ({ notify: { info: notifyInfo } }))

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

afterEach(() => {
  cleanup()
  notifyInfo.mockClear()
})

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
    withClient(<OverviewTagsBlock caseId="case1" tags={tags} usageCounts={{ t1: 2, t2: 5 }} />)
    const chips = screen.getAllByTestId('overview-tag-chip').map((c) => c.textContent)

    expect(chips).toEqual(['lead5', 'evidence2'])
  })

  it('renders only the new-tag affordance when nothing is tagged yet', () => {
    withClient(<OverviewTagsBlock caseId="case1" tags={tags} usageCounts={{}} />)

    expect(screen.queryAllByTestId('overview-tag-chip')).toHaveLength(0)
    expect(screen.getByTestId('overview-tags-new')).toBeTruthy()
  })

  it('opens an inline menu from the new-tag button, and Escape closes it', () => {
    withClient(<OverviewTagsBlock caseId="case1" tags={tags} usageCounts={{ t1: 1 }} />)

    fireEvent.click(screen.getByTestId('overview-tags-new'))
    expect(screen.getByTestId('overview-new-tag-popover')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('overview-new-tag-popover')).toBeNull()
  })

  // Named the way the Signals add row names it, and kept on screen at zero uses
  // so the create is visible rather than filtered straight back out.
  it('creates a slugged tag and shows it with a zero count', async () => {
    const created: Tag = { id: 't9', name: 'follow-up', color: '#ef4444' }
    const create = vi.fn(async () => created)
    fakeBridge({ tags: { create, list: vi.fn(async () => [...tags, created]) } })
    const { rerender } = withClient(
      <OverviewTagsBlock caseId="case1" tags={tags} usageCounts={{}} />
    )

    fireEvent.click(screen.getByTestId('overview-tags-new'))
    fireEvent.click(screen.getByLabelText('Pick color'))
    fireEvent.click(screen.getByLabelText('Use color #ef4444'))
    const input = screen.getByTestId('overview-new-tag-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: ' #Follow Up ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'follow-up', color: '#ef4444' })
    )
    await waitFor(() => expect(input.value).toBe(''))
    rerender(<OverviewTagsBlock caseId="case1" tags={[...tags, created]} usageCounts={{}} />)
    expect(screen.getAllByTestId('overview-tag-chip').map((c) => c.textContent)).toEqual([
      'follow-up0'
    ])
  })

  it('refuses a name another tag already has, without writing', () => {
    const create = vi.fn()
    fakeBridge({ tags: { create } })
    withClient(<OverviewTagsBlock caseId="case1" tags={tags} usageCounts={{}} />)

    fireEvent.click(screen.getByTestId('overview-tags-new'))
    const input = screen.getByTestId('overview-new-tag-input')
    fireEvent.change(input, { target: { value: 'Evidence' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(create).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('A tag named ‘evidence’ already exists')
  })

  it('tints a colourless tag from a theme token rather than a broken value', () => {
    withClient(<OverviewTagsBlock caseId="case1" tags={tags} usageCounts={{ t2: 1 }} />)
    const [chip] = screen.getAllByTestId('overview-tag-chip')

    expect(chip.getAttribute('style')).toContain('var(--color-text-muted)')
  })
})

describe('OverviewSelectorsBlock', () => {
  it('lists every selector, uncapped, with its match count', () => {
    const selectors = Array.from({ length: 9 }, (_, i) => selector({ id: `s${i}` }))
    withClient(
      <OverviewSelectorsBlock
        caseId="case1"
        selectors={selectors}
        matchCounts={{ s0: 4 }}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getAllByTestId('overview-selector-row')).toHaveLength(9)
    expect(screen.getAllByText('0')).toHaveLength(8)
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('prefers the label and keeps the pattern underneath it', () => {
    withClient(
      <OverviewSelectorsBlock
        caseId="case1"
        selectors={[selector({ label: 'Acme Corp', pattern: 'acme\\.example' })]}
        matchCounts={{}}
        onToggle={vi.fn()}
      />
    )
    const [row] = screen.getAllByTestId('overview-selector-row')

    expect(row.textContent).toContain('Acme Corp')
    expect(row.textContent).toContain('acme\\.example')
  })

  it('reports the switch state and asks for the opposite one on click', () => {
    const onToggle = vi.fn()
    const off = selector({ id: 's2', enabled: false })
    withClient(
      <OverviewSelectorsBlock
        caseId="case1"
        selectors={[off]}
        matchCounts={{}}
        onToggle={onToggle}
      />
    )
    const sw = screen.getByRole('switch')

    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.getAttribute('aria-label')).toBe('Enable acme')
    fireEvent.click(sw)
    expect(onToggle).toHaveBeenCalledWith(off, true)
  })

  it('says so when the case has no selectors', () => {
    withClient(
      <OverviewSelectorsBlock caseId="case1" selectors={[]} matchCounts={{}} onToggle={vi.fn()} />
    )

    expect(screen.getByText('No selectors defined yet.')).toBeTruthy()
  })

  function addSelector(existing: Selector[], value: string) {
    const create = vi.fn(async () => selector({ id: 's9' }))
    fakeBridge({ selectors: { create } })
    withClient(
      <OverviewSelectorsBlock
        caseId="case1"
        selectors={existing}
        matchCounts={{}}
        onToggle={vi.fn()}
      />
    )
    const input = screen.getByTestId('overview-selector-input') as HTMLInputElement
    fireEvent.change(input, { target: { value } })
    fireEvent.submit(input.closest('form')!)
    return { create, input }
  }

  it('quick-adds exact text as a manual selector and clears the field', async () => {
    const { create, input } = addSelector([], '  acme.example  ')

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        caseId: 'case1',
        pattern: 'acme.example',
        isRegex: false,
        origin: 'manual'
      })
    )
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('reads a slash-wrapped value as a regex', async () => {
    const { create } = addSelector([], '/bc1[a-z0-9]{20,}/')

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: 'bc1[a-z0-9]{20,}', isRegex: true })
      )
    )
  })

  // Saved, it would match nothing and read as "the term is absent" (#1754).
  it('refuses a regex that does not compile and says why', () => {
    const { create, input } = addSelector([], '/acme(/')

    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Not a valid regular expression')
    expect(input.value).toBe('/acme(/')
  })

  it('refuses a pattern the case already has, case-insensitively', () => {
    const { create, input } = addSelector([selector({ pattern: 'acme' })], 'ACME')

    expect(create).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('‘ACME’ is already a selector in this case')
    expect(input.value).toBe('ACME')
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
