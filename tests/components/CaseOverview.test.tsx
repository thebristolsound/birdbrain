// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, Case, Note, Selector, Tag } from '@shared/types'

vi.mock('@renderer/hooks/useReduceMotion', () => ({ useReduceMotion: () => true }))

const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' }),
  useNavigate: () => navigate
}))

import { CaseOverview } from '@renderer/components/overview/CaseOverview'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const CASE: Case = {
  id: 'case1',
  name: 'Acme investigation',
  description: 'A case',
  isDemo: false,
  archived: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

const CAPTURES: Capture[] = [
  {
    id: 'cap1',
    caseId: 'case1',
    url: 'https://example.com/a',
    title: 'Alpha',
    hash: 'h1',
    timestamp: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-02T00:00:00.000Z',
    format: 'mhtml',
    method: 'extension',
    lastVerifiedStatus: 'verified'
  },
  {
    id: 'cap2',
    caseId: 'case1',
    url: 'https://test.org/b',
    title: 'Bravo',
    hash: 'h2',
    timestamp: '2026-08-03T00:00:00.000Z',
    createdAt: '2026-08-03T00:00:00.000Z',
    format: 'mhtml',
    method: 'extension',
    lastVerifiedStatus: 'tampered'
  }
]

const SELECTORS: Selector[] = [
  {
    id: 'sel1',
    caseId: 'case1',
    pattern: 'acme',
    isRegex: false,
    enabled: true,
    createdAt: '2026-08-01T00:00:00.000Z'
  }
]

const TAGS: Tag[] = [{ id: 'tag1', name: 'evidence', color: '#22c55e' }]

const NOTES: Note[] = [
  {
    id: 'n1',
    caseId: 'case1',
    title: 'Lead note',
    body: 'body',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z'
  },
  {
    id: 'n2',
    caseId: 'case1',
    title: 'Follow-up',
    body: 'body',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z'
  }
]

const REFERENCE_EDGES = [
  { noteId: 'n1', targetType: 'capture' as const, targetId: 'cap1', mentionCount: 1 },
  { noteId: 'n1', targetType: 'note' as const, targetId: 'n2', mentionCount: 1 }
]

let updateSelector: ReturnType<typeof vi.fn>

function seedBridge(over: Record<string, unknown> = {}) {
  updateSelector = vi.fn(async () => SELECTORS[0])
  fakeBridge({
    cases: { get: vi.fn(async () => CASE) },
    captures: {
      list: vi.fn(async () => CAPTURES),
      getThumbnail: vi.fn(async () => null)
    },
    selectors: {
      list: vi.fn(async () => SELECTORS),
      matchCounts: vi.fn(async () => ({ sel1: 4 })),
      update: updateSelector
    },
    tags: {
      list: vi.fn(async () => TAGS),
      countForCase: vi.fn(async () => 1),
      usageCountsForCase: vi.fn(async () => ({ tag1: 3 }))
    },
    notes: {
      list: vi.fn(async () => NOTES),
      referenceEdges: vi.fn(async () => REFERENCE_EDGES),
      create: vi.fn(async () => NOTES[0])
    },
    ...over
  })
}

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<CaseOverview />, { wrapper: Wrapper })
}

beforeEach(() => {
  navigate.mockClear()
  localStorage.clear()
  seedBridge()
})

afterEach(cleanup)

describe('CaseOverview', () => {
  it('renders the consolidated bands once the case loads', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getByTestId('case-overview')).toBeTruthy())
    expect(screen.getByTestId('overview-link-map')).toBeTruthy()
    expect(screen.getByTestId('overview-quick-notes')).toBeTruthy()
    expect(screen.getByTestId('overview-tags-block')).toBeTruthy()
    expect(screen.getByTestId('overview-selectors-block')).toBeTruthy()
  })

  it('shows a skeleton until the case query resolves', () => {
    renderOverview()

    expect(screen.queryByTestId('case-overview')).toBeNull()
  })

  it('drives the five metrics from the case’s own data', async () => {
    renderOverview()

    await waitFor(() =>
      expect(screen.getByTestId('overview-metric-captures').textContent).toBe('2')
    )
    expect(screen.getByTestId('overview-metric-sources').textContent).toBe('2')
    expect(screen.getByTestId('overview-metric-selectors').textContent).toBe('1')
    expect(screen.getByTestId('overview-metric-tags').textContent).toBe('1')
    expect(screen.getByTestId('overview-metric-notes').textContent).toBe('2')
  })

  // The ruled deviation from the mock's consolidated branch, which drops this
  // card: it is the app's only case-level verified/tampered display.
  it('keeps the evidence-integrity card and its verify bucketing', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getByText('Evidence integrity')).toBeTruthy())
    expect(screen.getByTitle('Verified: 1')).toBeTruthy()
    expect(screen.getByTitle('Tampered: 1')).toBeTruthy()
  })

  it('renders no selector-coverage card', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getByTestId('case-overview')).toBeTruthy())
    expect(screen.queryByText('Selector coverage')).toBeNull()
  })

  it('draws the map from the reference edges', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getAllByTestId('overview-map-node')).toHaveLength(3))
    expect(screen.getByTestId('overview-map-count').textContent).toBe('3 nodes · 1 backlinks')
  })

  it('labels a mapped capture with its current title, not the cached Mention text', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getByTitle('Alpha')).toBeTruthy())
  })

  it('hides the since-last-visit card on a first visit', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getByTestId('case-overview')).toBeTruthy())
    expect(screen.queryByTestId('overview-since-last-visit')).toBeNull()
  })

  it('shows the since-last-visit card and the metric deltas once a prior visit exists', async () => {
    localStorage.setItem('birdbrain:lastVisit:case1', '2026-08-01T12:00:00.000Z')
    renderOverview()

    await waitFor(() => expect(screen.getByTestId('overview-since-last-visit')).toBeTruthy())
    // Deltas stay in both places, matching the prototype: the metric row's `+2`
    // and the card's tiles are the same fact at two levels of detail.
    expect(screen.getByTestId('overview-metric-captures').parentElement?.textContent).toContain(
      '+2'
    )
  })

  it('sends both Manage buttons to the signals screen', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getAllByText('Manage')).toHaveLength(2))
    for (const button of screen.getAllByText('Manage')) fireEvent.click(button)

    expect(navigate).toHaveBeenCalledTimes(2)
    for (const call of navigate.mock.calls) {
      expect(call[0]).toEqual({ to: '/cases/$caseId/signals', params: { caseId: 'case1' } })
    }
  })

  it('opens a mapped note on double-click', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getAllByTestId('overview-map-node').length).toBe(3))
    const noteNode = screen
      .getAllByTestId('overview-map-node')
      .find((n) => n.dataset.nodeKey === 'note:n1')
    fireEvent.doubleClick(noteNode!)

    expect(useAppStore.getState().selectedNoteId).toBe('n1')
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/notes',
      params: { caseId: 'case1' }
    })
  })

  it('opens a recent capture into the captures screen', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getAllByTestId('overview-recent-item').length).toBe(2))
    fireEvent.click(screen.getAllByTestId('overview-recent-item')[0])

    expect(useAppStore.getState().selectedCaptureId).toBe('cap2')
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case1' }
    })
  })

  it('writes a selector toggle back through the mutation', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getByTestId('overview-selectors-block')).toBeTruthy())
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(updateSelector).toHaveBeenCalledWith({ id: 'sel1', enabled: false }))
  })

  it('routes the map header and the quick-notes header to the notes screen', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getAllByText('All notes')).toHaveLength(2))
    for (const button of screen.getAllByText('All notes')) fireEvent.click(button)

    expect(navigate).toHaveBeenCalledTimes(2)
    for (const call of navigate.mock.calls) {
      expect(call[0]).toEqual({ to: '/cases/$caseId/notes', params: { caseId: 'case1' } })
    }
  })

  it('routes the capture-facing headers to the captures screen', async () => {
    renderOverview()

    await waitFor(() => expect(screen.getByText('View all')).toBeTruthy())
    fireEvent.click(screen.getByText('View all'))
    fireEvent.click(screen.getByText('Open timeline'))
    fireEvent.click(screen.getByText('All sources'))

    expect(navigate).toHaveBeenCalledTimes(3)
    for (const call of navigate.mock.calls) {
      expect(call[0]).toEqual({ to: '/cases/$caseId/captures', params: { caseId: 'case1' } })
    }
  })
})
