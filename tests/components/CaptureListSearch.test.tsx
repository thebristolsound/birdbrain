// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture } from '@shared/types'

// The capture menu owns its own graph and its own coverage; what is under test
// here is the per-list query, the narrowing strip and the empty-state branch.
vi.mock('@renderer/components/captures/CaptureMenu', () => ({
  CaptureMenu: () => null
}))

import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CLEAR_NARROWING_LABEL } from '@renderer/components/captures/captureListModel'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'

function makeCapture(id: string, title: string, url: string, minutesAgo: number): Capture {
  const ts = new Date(Date.UTC(2026, 7, 1, 12, 0, 0) - minutesAgo * 60000).toISOString()
  return {
    id,
    caseId: 'case1',
    url,
    title,
    hash: `hash-${id}`,
    timestamp: ts,
    createdAt: ts,
    format: 'mhtml',
    method: 'extension'
  }
}

const CAPTURES = [
  makeCapture('cap-a', 'Acme quarterly', 'https://one.example.com/a', 1),
  makeCapture('cap-b', 'Unrelated notice', 'https://acme.example.com/b', 2),
  makeCapture('cap-c', 'Third party', 'https://two.example.com/c', 3)
]

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <CaptureList
      caseId="case1"
      view="detailed"
      onChangeView={vi.fn()}
      onCollapse={vi.fn()}
      onDeleteSelection={vi.fn()}
      onOpenExternal={vi.fn()}
      onQuoteIntoNote={vi.fn()}
    />,
    { wrapper: Wrapper }
  )
}

async function titles() {
  await screen.findByTestId('capture-list-search')
  return screen.queryAllByTestId('capture-item').map((row) => row.textContent ?? '')
}

// Rows leave through an AnimatePresence exit, so they outlive the state change
// that dropped them; settle on the count before asserting.
async function settledTitles(count: number) {
  await waitFor(async () => expect(await titles()).toHaveLength(count))
  return titles()
}

function searchInput() {
  return screen.getByTestId('capture-list-search')
}

function type(value: string) {
  fireEvent.change(searchInput(), { target: { value } })
}

// Re-points the bridge at a case with no captures at all. Must run before
// renderList, since the list issues its query on mount.
function emptyCase() {
  fakeBridge({
    captures: {
      list: vi.fn(async () => []),
      listFavorites: vi.fn(async () => []),
      getMatchingSelectors: vi.fn(async () => []),
      getThumbnail: vi.fn(async () => null)
    }
  })
}

beforeEach(() => {
  stubMatchMedia()
  fakeBridge({
    captures: {
      list: vi.fn(async () => CAPTURES),
      listFavorites: vi.fn(async () => []),
      getMatchingSelectors: vi.fn(async () => []),
      getThumbnail: vi.fn(async () => null)
    }
  })
  useAppStore.setState({
    selectedCaptureId: null,
    selectedCaptureIds: new Set(),
    selectionAnchorId: null,
    filteredCaptureIds: null,
    activeSelectorFilters: []
  })
})

afterEach(() => {
  cleanup()
  useAppStore.getState().clearSelectorFilters()
})

describe('CaptureList per-list search', () => {
  it('carries an input whose label is distinct from the case-wide SearchBar', async () => {
    renderList()
    await screen.findByText('Acme quarterly')
    expect(screen.getByLabelText('Filter captures in this list')).toBe(searchInput())
    expect(screen.queryByLabelText('Search case captures')).toBeNull()
  })

  // `outline-none` with nothing in its place left keyboard focus invisible
  // here; the app-wide accent ring only reaches a field that does not opt out
  // of it (#1536).
  it('does not suppress the focus outline on the search field', async () => {
    renderList()
    await screen.findByText('Acme quarterly')
    expect(searchInput().className).not.toMatch(/(^|\s)outline-none(\s|$)/)
  })

  it('keeps the collapse control the layout suite clicks', async () => {
    renderList()
    await screen.findByText('Acme quarterly')
    expect(screen.getByTestId('capture-list-collapse')).toBeDefined()
  })

  it('narrows the loaded list by title and by url, case-insensitively', async () => {
    renderList()
    expect(await titles()).toHaveLength(3)

    type('ACME')
    const shown = await settledTitles(2)
    expect(shown.join(' ')).toContain('Acme quarterly')
    expect(shown.join(' ')).toContain('Unrelated notice')
    expect(shown.join(' ')).not.toContain('Third party')
  })

  it('restores the full list when the query is cleared', async () => {
    renderList()
    await titles()
    type('acme')
    await settledTitles(2)
    type('')
    await settledTitles(3)
  })

  it('counts only the displayed captures in the footer', async () => {
    renderList()
    await titles()
    type('acme')
    expect(screen.getByText('Showing 2 of 3 captures')).toBeDefined()
  })

  it('shows the narrowed empty state, not "No captures yet", on a zero-match query', async () => {
    renderList()
    await titles()
    type('zebra')

    await settledTitles(0)
    expect(screen.queryByTestId('capture-list-empty-state')).toBeNull()
    const empty = screen.getByTestId('capture-list-narrowed-empty')
    expect(within(empty).getByText('No captures match')).toBeDefined()
    expect(empty.textContent).toContain('Search "zebra"')
  })

  it('still shows the first-run empty state when the case has no captures at all', async () => {
    emptyCase()
    renderList()
    expect(await screen.findByTestId('capture-list-empty-state')).toBeDefined()
    expect(screen.queryByTestId('capture-list-narrowed-empty')).toBeNull()
  })

  it('keeps the first-run empty state on an empty case once a query is typed', async () => {
    // The narrowed branch would otherwise claim "0 captures in this case are
    // hidden by Search ..." on a case that has none, and displace the
    // getting-started guidance for the first operator who touches the box.
    emptyCase()
    renderList()
    await screen.findByTestId('capture-list-empty-state')

    type('zebra')

    expect(screen.getByTestId('capture-list-empty-state')).toBeDefined()
    expect(screen.queryByTestId('capture-list-narrowed-empty')).toBeNull()
    expect(screen.queryByText(/hidden by/)).toBeNull()
  })

  it('keeps the first-run empty state on an empty case under a menu filter', async () => {
    // Same branch, reached from the Filter menu rather than the search box:
    // the guard is on the case being empty, not on which narrowing is active.
    emptyCase()
    renderList()
    await screen.findByTestId('capture-list-empty-state')

    fireEvent.click(screen.getByRole('button', { name: /^Filter$/ }))
    fireEvent.click(screen.getByText('Favorites only'))

    expect(screen.getByTestId('capture-list-empty-state')).toBeDefined()
    expect(screen.queryByTestId('capture-list-narrowed-empty')).toBeNull()
  })

  it('still names the narrowing on a case that does have hidden captures', async () => {
    // The guard must not swallow the narrowed state wholesale: with captures
    // loaded, a zero-match query still has to say what is hiding them.
    renderList()
    await titles()
    type('zebra')

    await settledTitles(0)
    const empty = await screen.findByTestId('capture-list-narrowed-empty')
    expect(empty.textContent).toContain('3 captures in this case are hidden')
    expect(screen.queryByTestId('capture-list-empty-state')).toBeNull()
  })

  it('leaves the Filter badge menu-scoped when only a query is active', async () => {
    renderList()
    await titles()
    type('acme')

    const filterButton = screen.getByRole('button', { name: /^Filter$/ })
    expect(filterButton.textContent).toBe('Filter')

    fireEvent.click(filterButton)
    fireEvent.click(screen.getByText('Favorites only'))
    expect(filterButton.textContent).toBe('Filter1')
  })
})

describe('CaptureList narrowing strip', () => {
  it('stays hidden until something narrows the list', async () => {
    renderList()
    await titles()
    expect(screen.queryByTestId('capture-list-narrowing')).toBeNull()

    type('acme')
    expect(screen.getByTestId('capture-list-narrowing').textContent).toContain('Search "acme"')
  })

  it('names the query and the selector filters together', async () => {
    useAppStore.setState({ activeSelectorFilters: ['sel-1'], filteredCaptureIds: ['cap-b'] })
    renderList()
    await titles()
    type('acme')

    const strip = screen.getByTestId('capture-list-narrowing')
    expect(strip.textContent).toContain('Search "acme"')
    expect(strip.textContent).toContain('1 selector filter')
  })

  it('clears query, selector filters and menu filters from its one control', async () => {
    useAppStore.setState({ activeSelectorFilters: ['sel-1'], filteredCaptureIds: ['cap-b'] })
    renderList()
    await titles()
    type('acme')
    fireEvent.click(screen.getByRole('button', { name: /^Filter$/ }))
    fireEvent.click(screen.getByText('Favorites only'))

    const strip = screen.getByTestId('capture-list-narrowing')
    fireEvent.click(within(strip).getByRole('button', { name: CLEAR_NARROWING_LABEL }))

    expect(searchInput()).toHaveProperty('value', '')
    expect(useAppStore.getState().activeSelectorFilters).toEqual([])
    expect(useAppStore.getState().filteredCaptureIds).toBeNull()
    expect(screen.queryByTestId('capture-list-narrowing')).toBeNull()
    await settledTitles(3)
  })
})

describe('CaptureList clear affordances', () => {
  it('offers the dropdown clear item for a query the Filter menu does not own', async () => {
    renderList()
    await titles()
    type('acme')

    fireEvent.click(screen.getByRole('button', { name: /^Filter$/ }))
    // The label names the query too: this one item clears it alongside the
    // menu's own filters, and an operator must not lose a typed search to a
    // control that only said "filters".
    const menu = screen.getByTestId('capture-list-filter-menu')
    fireEvent.click(within(menu).getByRole('button', { name: CLEAR_NARROWING_LABEL }))

    expect(searchInput()).toHaveProperty('value', '')
    await settledTitles(3)
    expect(screen.queryByText(CLEAR_NARROWING_LABEL)).toBeNull()
  })

  it('clears everything from the narrowed empty state button', async () => {
    useAppStore.setState({ activeSelectorFilters: ['sel-1'], filteredCaptureIds: ['cap-b'] })
    renderList()
    await titles()
    type('zebra')

    const empty = screen.getByTestId('capture-list-narrowed-empty')
    fireEvent.click(within(empty).getByRole('button', { name: CLEAR_NARROWING_LABEL }))

    expect(searchInput()).toHaveProperty('value', '')
    expect(useAppStore.getState().activeSelectorFilters).toEqual([])
    await settledTitles(3)
  })

  it('gives all three controls on the one handler the same accessible name', async () => {
    // The three drifted apart once already (#1033): a dropdown item saying
    // "Clear search and filters", a strip button labelled "Clear all narrowing"
    // and an empty-state button saying only "Clear filters", all clearing the
    // same five narrowings. Assert them together so a future divergence fails.
    useAppStore.setState({ activeSelectorFilters: ['sel-1'], filteredCaptureIds: ['cap-b'] })
    renderList()
    await titles()
    type('zebra')
    await settledTitles(0)
    fireEvent.click(screen.getByRole('button', { name: /^Filter$/ }))

    const menu = screen.getByTestId('capture-list-filter-menu')
    const strip = screen.getByTestId('capture-list-narrowing')
    const empty = screen.getByTestId('capture-list-narrowed-empty')
    expect(within(menu).getByRole('button', { name: CLEAR_NARROWING_LABEL })).toBeDefined()
    expect(within(empty).getByRole('button', { name: CLEAR_NARROWING_LABEL })).toBeDefined()

    // The strip's tooltip is the third wording that diverged, and it is not part
    // of the accessible name, so assert it against the same constant.
    const stripButton = within(strip).getByRole('button', { name: CLEAR_NARROWING_LABEL })
    expect(stripButton.getAttribute('title')).toBe(CLEAR_NARROWING_LABEL)
    expect(screen.getAllByRole('button', { name: CLEAR_NARROWING_LABEL })).toHaveLength(3)
  })
})
