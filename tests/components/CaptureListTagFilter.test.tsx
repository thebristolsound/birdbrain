// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, Tag } from '@shared/types'

vi.mock('@renderer/components/captures/CaptureMenu', () => ({
  CaptureMenu: () => null
}))

import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CLEAR_NARROWING_LABEL } from '@renderer/components/captures/captureListModel'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'

function makeCapture(id: string, title: string, minutesAgo: number): Capture {
  const ts = new Date(Date.UTC(2026, 7, 1, 12, 0, 0) - minutesAgo * 60000).toISOString()
  return {
    id,
    caseId: 'case1',
    url: `https://example.com/${id}`,
    title,
    hash: `hash-${id}`,
    timestamp: ts,
    createdAt: ts,
    format: 'mhtml',
    method: 'extension'
  }
}

const CAPTURES = [
  makeCapture('cap-a', 'Acme quarterly', 1),
  makeCapture('cap-b', 'Unrelated notice', 2),
  makeCapture('cap-c', 'Third party', 3)
]

// `evidence` and `suspect` are used in this case; `elsewhere` belongs to
// another case only, so the menu must not offer it.
const TAGS: Tag[] = [
  { id: 'tag-evidence', name: 'evidence', color: '#22c55e' },
  { id: 'tag-suspect', name: 'suspect', color: '#ef4444' },
  { id: 'tag-elsewhere', name: 'elsewhere', color: '#3b82f6' }
]
const USAGE: Record<string, number> = { 'tag-evidence': 2, 'tag-suspect': 1 }

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

function bridge(usageCounts: Record<string, number> = USAGE, tags: Tag[] = TAGS) {
  fakeBridge({
    captures: {
      list: vi.fn(async () => CAPTURES),
      listFavorites: vi.fn(async () => []),
      getMatchingSelectors: vi.fn(async () => []),
      getThumbnail: vi.fn(async () => null)
    },
    tags: {
      list: vi.fn(async () => tags),
      usageCountsForCase: vi.fn(async () => usageCounts)
    }
  })
}

async function openFilterMenu() {
  await screen.findByText('Acme quarterly')
  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
  return screen.findByTestId('capture-list-filter-menu')
}

beforeEach(() => {
  stubMatchMedia()
  bridge()
  useAppStore.setState({
    selectedCaptureId: null,
    selectedCaptureIds: new Set(),
    selectionAnchorId: null,
    filteredCaptureIds: null,
    activeSelectorFilters: [],
    activeTagFilters: [],
    tagFilteredCaptureIds: null
  })
})

afterEach(() => {
  cleanup()
  useAppStore.getState().clearTagFilters()
  useAppStore.getState().clearSelectorFilters()
})

describe('CaptureList Filter menu — Tags (#918)', () => {
  it('offers the tags this case uses and no others', async () => {
    renderList()
    const menu = await openFilterMenu()

    expect(menu.textContent).toContain('Tags')
    expect(await screen.findByTestId('capture-list-filter-tag-tag-evidence')).toBeDefined()
    expect(screen.getByTestId('capture-list-filter-tag-tag-suspect')).toBeDefined()
    expect(screen.queryByTestId('capture-list-filter-tag-tag-elsewhere')).toBeNull()
  })

  it('says so when the case carries no tags at all', async () => {
    bridge({})
    renderList()
    await openFilterMenu()

    expect(await screen.findByTestId('capture-list-filter-no-tags')).toBeDefined()
  })

  it('ticks the tag, counts it on the badge and names it in the strip', async () => {
    renderList()
    await openFilterMenu()

    fireEvent.click(await screen.findByTestId('capture-list-filter-tag-tag-evidence'))

    expect(useAppStore.getState().activeTagFilters).toEqual(['tag-evidence'])
    expect(
      screen.getByTestId('capture-list-filter-tag-tag-evidence').getAttribute('aria-pressed')
    ).toBe('true')
    expect(screen.getByRole('button', { name: /^Filter/ }).textContent).toContain('1')
    expect(screen.getByTestId('capture-list-narrowing').textContent).toContain('1 tag filter')
  })

  // The union is the operator-facing claim, so the strip has to make it once a
  // second tag is picked rather than leaving "2 tag filters" to be read as AND.
  it('states the union in the strip once a second tag is picked', async () => {
    renderList()
    await openFilterMenu()

    fireEvent.click(await screen.findByTestId('capture-list-filter-tag-tag-evidence'))
    fireEvent.click(screen.getByTestId('capture-list-filter-tag-tag-suspect'))

    expect(useAppStore.getState().activeTagFilters).toEqual(['tag-evidence', 'tag-suspect'])
    expect(screen.getByTestId('capture-list-narrowing').textContent).toContain(
      '2 tag filters (any)'
    )
  })

  it('unticks a tag that is clicked again', async () => {
    renderList()
    await openFilterMenu()

    const tag = await screen.findByTestId('capture-list-filter-tag-tag-evidence')
    fireEvent.click(tag)
    fireEvent.click(screen.getByTestId('capture-list-filter-tag-tag-evidence'))

    expect(useAppStore.getState().activeTagFilters).toEqual([])
    expect(screen.queryByTestId('capture-list-narrowing')).toBeNull()
  })

  // Otherwise the only way out of the filter would be Clear all: the tag drops
  // out of the menu the moment its last capture in this case loses it.
  it('keeps offering a picked tag the case no longer uses', async () => {
    bridge({})
    useAppStore.getState().addTagFilter('tag-evidence')
    renderList()
    await openFilterMenu()

    const tag = await screen.findByTestId('capture-list-filter-tag-tag-evidence')
    expect(tag.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(tag)
    expect(useAppStore.getState().activeTagFilters).toEqual([])
  })

  it('hides the captures the tag filter does not cover', async () => {
    useAppStore.getState().addTagFilter('tag-evidence')
    useAppStore.getState().setTagFilteredCaptureIds(['cap-a'])
    renderList()

    await waitFor(() => expect(screen.getAllByTestId('capture-item')).toHaveLength(1))
    expect(screen.getByText('Showing 1 of 3 captures')).toBeDefined()
  })

  it('is cleared by the one control that clears every narrowing', async () => {
    useAppStore.getState().addTagFilter('tag-evidence')
    useAppStore.getState().setTagFilteredCaptureIds(['cap-a'])
    renderList()

    await screen.findByTestId('capture-list-narrowing')
    fireEvent.click(screen.getByRole('button', { name: CLEAR_NARROWING_LABEL }))

    expect(useAppStore.getState().activeTagFilters).toEqual([])
    expect(useAppStore.getState().tagFilteredCaptureIds).toBeNull()
    await waitFor(() => expect(screen.queryByTestId('capture-list-narrowing')).toBeNull())
  })
})
