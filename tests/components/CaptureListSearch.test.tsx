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
    fakeBridge({
      captures: {
        list: vi.fn(async () => []),
        listFavorites: vi.fn(async () => []),
        getMatchingSelectors: vi.fn(async () => []),
        getThumbnail: vi.fn(async () => null)
      }
    })
    renderList()
    expect(await screen.findByTestId('capture-list-empty-state')).toBeDefined()
    expect(screen.queryByTestId('capture-list-narrowed-empty')).toBeNull()
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

    fireEvent.click(screen.getByLabelText('Clear all narrowing'))

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
    fireEvent.click(screen.getByText('Clear all filters'))

    expect(searchInput()).toHaveProperty('value', '')
    await settledTitles(3)
    expect(screen.queryByText('Clear all filters')).toBeNull()
  })

  it('clears everything from the narrowed empty state button', async () => {
    useAppStore.setState({ activeSelectorFilters: ['sel-1'], filteredCaptureIds: ['cap-b'] })
    renderList()
    await titles()
    type('zebra')

    const empty = screen.getByTestId('capture-list-narrowed-empty')
    fireEvent.click(within(empty).getByText('Clear filters'))

    expect(searchInput()).toHaveProperty('value', '')
    expect(useAppStore.getState().activeSelectorFilters).toEqual([])
    await settledTitles(3)
  })
})
