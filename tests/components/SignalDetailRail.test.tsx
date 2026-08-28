// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, SelectorOrigin } from '@shared/types'
import { SignalDetailRail } from '@renderer/components/signals/SignalDetailRail'
import type { Signal } from '@renderer/components/signals/signalsModel'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate
}))

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
  },
  {
    id: 'c2',
    caseId: 'case-1',
    url: 'https://other.example/b',
    title: 'Page B',
    hash: 'h2',
    timestamp: '2026-01-02T00:00:00.000Z',
    format: 'mhtml',
    method: 'extension',
    createdAt: '2026-01-02T00:00:00.000Z'
  }
]

const selectorSignal: Signal = {
  id: 's1',
  kind: 'selector',
  name: 'acme',
  sub: 'acme',
  count: 1,
  enabled: true,
  isRegex: false,
  captureIds: ['c1']
}

const tagSignal: Signal = {
  id: 't1',
  kind: 'tag',
  name: 'evidence',
  sub: '',
  count: 1,
  enabled: true,
  isRegex: false,
  color: '#22c55e',
  captureIds: ['c2']
}

function renderRail(signal: Signal | null, overrides: Partial<Capture[]> = []) {
  const onToggleEnabled = vi.fn()
  const onMerge = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(
    <SignalDetailRail
      caseId="case-1"
      signal={signal}
      captures={overrides.length ? (overrides as Capture[]) : captures}
      totalCaptures={4}
      onToggleEnabled={onToggleEnabled}
      onMerge={onMerge}
    />,
    { wrapper: Wrapper }
  )
  return { onToggleEnabled, onMerge }
}

beforeEach(() => {
  navigate.mockClear()
  useAppStore.getState().clearSelectorFilters()
  fakeBridge({
    captures: { list: vi.fn(async () => captures), getContent: vi.fn(async () => null) },
    selectors: { matchingCaptures: vi.fn(async () => []), exportMatches: vi.fn(async () => ({ exported: true })) },
    tags: { update: vi.fn(async () => tagSignal) }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SignalDetailRail empty state', () => {
  it('explains what a selector and a tag are when nothing is selected', () => {
    renderRail(null)

    expect(screen.getByTestId('signal-rail-empty')).toBeTruthy()
    expect(screen.getByText('No signals in this case')).toBeTruthy()
  })
})

describe('SignalDetailRail provenance (#395)', () => {
  it.each([
    ['extension', 'Added from the extension'],
    ['capture', 'Added from a capture'],
    ['note', 'Added from a note'],
    ['manual', 'Added by hand']
  ] as Array<[SelectorOrigin, string]>)('names %s provenance exactly', async (origin, label) => {
    renderRail({ ...selectorSignal, origin })

    const pill = await screen.findByTestId('signal-origin')
    expect(pill.textContent).toBe(label)
  })

  // NULL means the row predates provenance recording; guessing would be a false
  // claim, so nothing renders.
  it('renders nothing when the selector has no origin', () => {
    renderRail(selectorSignal)

    expect(screen.queryByTestId('signal-origin')).toBeNull()
    for (const label of [
      'Added from the extension',
      'Added from a capture',
      'Added from a note',
      'Added by hand'
    ]) {
      expect(screen.queryByText(label)).toBeNull()
    }
  })
})

describe('SignalDetailRail branches', () => {
  it('shows the pattern block and no colour swatches for a selector', () => {
    renderRail(selectorSignal)

    expect(screen.getByTestId('signal-pattern').textContent).toBe('acme')
    expect(screen.queryByLabelText(/^Set color/)).toBeNull()
    expect(screen.getByText('Matches 1 of 4 captures')).toBeTruthy()
  })

  it('shows colour swatches and no pattern block for a tag', () => {
    renderRail(tagSignal)

    expect(screen.queryByTestId('signal-pattern')).toBeNull()
    expect(screen.getAllByLabelText(/^Set color/)).toHaveLength(8)
    expect(screen.getByText('Applied to 1 of 4 captures')).toBeTruthy()
  })

  it('offers Export CSV for a selector only', () => {
    renderRail(selectorSignal)
    expect(screen.getByTestId('signal-export-csv')).toBeTruthy()

    cleanup()
    renderRail(tagSignal)
    expect(screen.queryByTestId('signal-export-csv')).toBeNull()
  })

  it('lists the captures the signal appears in, newest label and host', () => {
    renderRail(selectorSignal)

    expect(screen.getByText('Page A')).toBeTruthy()
    expect(screen.getByText('example.com')).toBeTruthy()
    // Page B is not covered by this selector.
    expect(screen.queryByText('Page B')).toBeNull()
  })

  it('says so plainly when the signal has matched nothing', () => {
    renderRail({ ...selectorSignal, count: 0, captureIds: [] })

    expect(screen.getByTestId('signal-appears-empty').textContent).toContain('No captures yet')
  })

  // The window is bounded, so a selector matching more than it shows must say
  // the list is partial rather than imply those captures do not exist.
  it('names the captures outside the recent window', () => {
    renderRail({ ...selectorSignal, count: 9, captureIds: ['c1'] })

    expect(screen.getByText(/\+8 older captures outside the recent window/)).toBeTruthy()
  })
})

describe('SignalDetailRail actions', () => {
  it('filters the captures screen by the selected selector', () => {
    renderRail(selectorSignal)

    fireEvent.click(screen.getByText('Filter in Captures'))

    expect(useAppStore.getState().activeSelectorFilters).toEqual(['s1'])
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-1' }
    })
  })

  it('does not set a selector filter for a tag', () => {
    renderRail(tagSignal)

    fireEvent.click(screen.getByText('Filter in Captures'))

    expect(useAppStore.getState().activeSelectorFilters).toEqual([])
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('opens a listed capture on the captures screen', () => {
    renderRail(selectorSignal)

    fireEvent.click(screen.getByText('Page A'))

    expect(useAppStore.getState().selectedCaptureId).toBe('c1')
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('exports only the selected selector', async () => {
    const exportMatches = vi.fn(async () => ({ exported: true }))
    fakeBridge({
      captures: { list: vi.fn(async () => captures), getContent: vi.fn(async () => null) },
      selectors: { matchingCaptures: vi.fn(async () => []), exportMatches }
    })
    renderRail(selectorSignal)

    fireEvent.click(screen.getByTestId('signal-export-csv'))

    await waitFor(() => expect(exportMatches).toHaveBeenCalledWith('case-1', 's1'))
  })

  it('disables Export CSV when the selector has matched nothing', () => {
    renderRail({ ...selectorSignal, count: 0, captureIds: [] })

    expect(screen.getByTestId('signal-export-csv')).toHaveProperty('disabled', true)
  })

  it('toggles the selected selector from the rail switch', () => {
    const { onToggleEnabled } = renderRail(selectorSignal)

    fireEvent.click(screen.getByRole('switch'))

    expect(onToggleEnabled).toHaveBeenCalledWith(selectorSignal)
  })
})

describe('SignalDetailRail merge (#828)', () => {
  it('offers Merge into… for a tag and not for a selector', () => {
    renderRail(tagSignal)
    expect(screen.getByTestId('signal-merge-tag')).toBeTruthy()

    cleanup()
    renderRail(selectorSignal)
    expect(screen.queryByTestId('signal-merge-tag')).toBeNull()
  })

  // The dialog moved up to SignalsOverview when a tag row's context menu
  // gained its own Merge into… item (#701): two routes, one dialog. What the
  // rail owes is the source tag, and the whole tag rather than its id — the
  // dialog names it in its prompt.
  it('hands the selected tag up rather than opening the dialog itself', () => {
    const { onMerge } = renderRail(tagSignal)

    fireEvent.click(screen.getByTestId('signal-merge-tag'))

    expect(onMerge).toHaveBeenCalledWith(tagSignal)
    expect(screen.queryByTestId('merge-tag-dialog')).toBeNull()
  })
})
