// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, Selector, Tag } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case-1' }),
  useNavigate: () => vi.fn()
}))

// The rail has its own test file and drags in the Foreground Match Preview's
// data graph; the shell's job is composing the two cards and the selection.
vi.mock('@renderer/components/signals/SignalDetailRail', () => ({
  SignalDetailRail: ({ signal }: { signal: { id: string; name: string } | null }) => (
    <div data-testid="rail">{signal ? signal.name : 'empty'}</div>
  )
}))
// Likewise the advanced create card: it is the surviving CreateSelectorCard and
// keeps its own test.
vi.mock('@renderer/components/selectors/CreateSelectorCard', () => ({
  CreateSelectorCard: () => <div data-testid="create-selector-card" />
}))
vi.mock('@renderer/components/signals/AutoCaptureCard', () => ({
  AutoCaptureCard: () => <div data-testid="auto-capture-card" />
}))

import { SignalsOverview } from '@renderer/components/signals/SignalsOverview'

const selectors: Selector[] = [
  {
    id: 's1',
    caseId: 'case-1',
    pattern: 'acme',
    label: 'Acme mentions',
    isRegex: false,
    enabled: true,
    createdAt: '2026-08-01T00:00:00.000Z'
  },
  {
    id: 's2',
    caseId: 'case-1',
    pattern: 'bc1[a-z0-9]+',
    isRegex: true,
    enabled: false,
    createdAt: '2026-08-02T00:00:00.000Z'
  }
]

const tags: Tag[] = [{ id: 't1', name: 'evidence', color: '#22c55e' }]

const captures: Capture[] = [
  {
    id: 'c1',
    caseId: 'case-1',
    url: 'https://example.com/a',
    title: 'Page A',
    hash: 'h1',
    timestamp: '2026-01-01T00:00:00.000Z',
    format: 'mhtml',
    method: 'extension',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
]

function install(overrides: Record<string, unknown> = {}) {
  return fakeBridge({
    selectors: {
      list: vi.fn(async () => selectors),
      matchCounts: vi.fn(async () => ({ s1: 4 })),
      captureMatrix: vi.fn(async () => ({ s1: ['c1'] })),
      create: vi.fn(async () => ({ ...selectors[0], id: 's3', pattern: 'new' })),
      update: vi.fn(async () => selectors[0]),
      delete: vi.fn(async () => true),
      exportMatches: vi.fn(async () => ({ exported: true })),
      ...(overrides.selectors as object)
    },
    tags: {
      list: vi.fn(async () => tags),
      usageCountsForCase: vi.fn(async () => ({ t1: 1 })),
      captureMatrix: vi.fn(async () => ({ t1: ['c1'] })),
      create: vi.fn(async () => tags[0]),
      update: vi.fn(async () => tags[0]),
      delete: vi.fn(async () => true),
      ...(overrides.tags as object)
    },
    captures: { list: vi.fn(async () => captures) }
  })
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<SignalsOverview />, { wrapper: Wrapper })
}

beforeEach(() => {
  install()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SignalsOverview', () => {
  it('shows selectors and tags on one screen', async () => {
    renderScreen()

    expect(await screen.findByTestId('signal-row-s1')).toBeTruthy()
    expect(screen.getByTestId('signal-row-s2')).toBeTruthy()
    expect(screen.getByTestId('signal-row-t1')).toBeTruthy()
    expect(screen.getByTestId('auto-capture-card')).toBeTruthy()
  })

  it('selects the first signal by default and follows a click', async () => {
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    await waitFor(() => expect(screen.getByTestId('rail').textContent).toBe('Acme mentions'))

    fireEvent.click(screen.getByTestId('signal-row-t1'))
    expect(screen.getByTestId('rail').textContent).toBe('evidence')
  })

  it('shows the empty rail when the case has no signals at all', async () => {
    install({ selectors: { list: vi.fn(async () => []) }, tags: { list: vi.fn(async () => []) } })
    renderScreen()

    await waitFor(() => expect(screen.getByTestId('rail').textContent).toBe('empty'))
    expect(
      screen.getByText('No selectors yet — type a pattern above to add the first.')
    ).toBeTruthy()
    expect(screen.getByText('No tags yet — name one above to add the first.')).toBeTruthy()
  })

  it('adds a selector from the inline row, stamped as added by hand', async () => {
    const create = vi.fn(async () => ({ ...selectors[0], id: 's3', pattern: 'new' }))
    install({ selectors: { create } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    const input = screen.getByTestId('add-selector-input')
    fireEvent.change(input, { target: { value: 'new' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        caseId: 'case-1',
        pattern: 'new',
        isRegex: false,
        origin: 'manual'
      })
    )
  })

  it('adds a tag with the next palette colour', async () => {
    const create = vi.fn(async () => tags[0])
    install({ tags: { create } })
    renderScreen()
    await screen.findByTestId('signal-row-t1')

    const input = screen.getByTestId('add-tag-input')
    fireEvent.change(input, { target: { value: 'Bank Records' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // One tag exists, so the new one takes palette[1].
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'bank-records', color: '#ef4444' })
    )
  })

  it('switches a selector off through the row toggle', async () => {
    const update = vi.fn(async () => selectors[0])
    install({ selectors: { update } })
    renderScreen()
    const row = await screen.findByTestId('signal-row-s1')

    fireEvent.click(within(row).getByRole('switch'))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 's1', enabled: false }))
  })

  it('flips a selector between exact text and regex', async () => {
    const update = vi.fn(async () => selectors[0])
    install({ selectors: { update } })
    renderScreen()
    const row = await screen.findByTestId('signal-row-s1')

    fireEvent.click(within(row).getByText('Aa'))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 's1', isRegex: true }))
  })

  it('deletes a selector and a tag from their rows', async () => {
    const removeSelector = vi.fn(async () => true)
    const removeTag = vi.fn(async () => true)
    install({ selectors: { delete: removeSelector }, tags: { delete: removeTag } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    fireEvent.click(screen.getByLabelText('Delete Acme mentions'))
    fireEvent.click(screen.getByLabelText('Delete evidence'))

    await waitFor(() => expect(removeSelector).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(removeTag).toHaveBeenCalledWith('t1'))
  })

  it('renames a selector by its pattern and a tag by its name', async () => {
    const update = vi.fn(async () => selectors[0])
    const updateTag = vi.fn(async () => tags[0])
    install({ selectors: { update }, tags: { update: updateTag } })
    renderScreen()
    const row = await screen.findByTestId('signal-row-s1')

    fireEvent.doubleClick(row)
    const patternInput = screen.getByLabelText('Edit selector pattern')
    // The edit starts from the pattern, not the label: the pattern is what
    // matches, so that is what a rename has to be able to change.
    expect((patternInput as HTMLInputElement).value).toBe('acme')
    fireEvent.change(patternInput, { target: { value: 'acme corp' } })
    fireEvent.keyDown(patternInput, { key: 'Enter' })

    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 's1', pattern: 'acme corp' }))

    fireEvent.doubleClick(screen.getByTestId('signal-row-t1'))
    const nameInput = screen.getByLabelText('Edit tag name')
    fireEvent.change(nameInput, { target: { value: 'exhibits' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })

    await waitFor(() => expect(updateTag).toHaveBeenCalledWith({ id: 't1', name: 'exhibits' }))
  })

  it('opens and closes the bulk import drawer', async () => {
    renderScreen()
    await screen.findByTestId('signal-row-s1')
    expect(screen.queryByTestId('bulk-add-modal')).toBeNull()

    fireEvent.click(screen.getByTestId('bulk-add-btn'))
    expect(screen.getByTestId('bulk-add-modal')).toBeTruthy()

    fireEvent.click(screen.getByTestId('bulk-add-btn'))
    expect(screen.queryByTestId('bulk-add-modal')).toBeNull()
  })

  it('exports every match in the case from the card header', async () => {
    const exportMatches = vi.fn(async () => ({ exported: true }))
    install({ selectors: { exportMatches } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')
    // Disabled until the match counts land, so wait rather than click into a
    // no-op and then wait for a call that can never arrive.
    await waitFor(() =>
      expect(screen.getByTestId('export-matches-btn')).toHaveProperty('disabled', false)
    )

    fireEvent.click(screen.getByTestId('export-matches-btn'))

    // No selector id: this button is the case-wide export, unlike the rail's.
    await waitFor(() => expect(exportMatches).toHaveBeenCalledWith('case-1', undefined))
  })

  it('disables the case-wide export when nothing has matched', async () => {
    install({ selectors: { matchCounts: vi.fn(async () => ({})) } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    await waitFor(() =>
      expect(screen.getByTestId('export-matches-btn')).toHaveProperty('disabled', true)
    )
  })

  it('keeps the advanced create card reachable for labels and the match preview', async () => {
    renderScreen()

    expect(await screen.findByTestId('create-selector-card')).toBeTruthy()
  })
})
