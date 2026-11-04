// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Case, LaunchedBrowserStatus, LaunchedBrowserSummary } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubResizeObserver, stubResizeObserverWithWidth } from './resizeObserverStub'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

import { CaptureSessionDock } from '@renderer/components/launchedBrowser/CaptureSessionDock'

const FERRY: Case = {
  id: 'case-1',
  name: 'Ferry Line',
  isDemo: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  archived: false
}
const SUMMARY: LaunchedBrowserSummary = {
  family: 'chrome',
  label: 'Google Chrome',
  caseId: 'case-1',
  version: '149.0.7827.55',
  extensionWarnings: [],
  sessionStartedAt: null,
  tabs: [
    { targetId: 't1', title: 'Tuesday sailings', url: 'https://ferry.test/routes/tue' },
    { targetId: 't2', title: 'Harbor notices', url: 'https://ferry.test/notices' },
    { targetId: 't3', title: 'Port timetable', url: 'https://ferry.test/port' }
  ]
}
const OPEN: LaunchedBrowserStatus = { state: 'open', browser: SUMMARY }
// The room beside the side rail the folded Captures screen and the rail need, and with the
// Wayback slide-out.
const FITS = 647 + 320
const FITS_WAYBACK = 836 + 320
const INNER_WIDTH = window.innerWidth

let reportWidth: (width: number) => void

function mount({
  status = OPEN,
  waybackTab = false
}: { status?: LaunchedBrowserStatus; waybackTab?: boolean } = {}) {
  fakeBridge({
    cases: { list: vi.fn(async () => [FERRY]) },
    settings: { get: vi.fn(async () => ({ egress: { kind: 'direct' } })) },
    launchedBrowser: { status: vi.fn(async () => status) }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (wayback: boolean) => (
    <QueryClientProvider client={client}>
      <CaptureSessionDock waybackTab={wayback}>
        <div data-testid="screen">Captures</div>
      </CaptureSessionDock>
    </QueryClientProvider>
  )
  const { rerender } = render(tree(waybackTab))
  return { client, rerender: (wayback: boolean) => rerender(tree(wayback)) }
}

function report(width: number) {
  act(() => reportWidth(width))
}

beforeEach(() => {
  reportWidth = stubResizeObserverWithWidth()
  useAppStore.setState({ sessionActive: true, dismissedLaunchNotice: null })
})

afterEach(() => {
  cleanup()
  window.innerWidth = INNER_WIDTH
})

describe('CaptureSessionDock', () => {
  it('adds nothing beside the screen while no launched browser is open', async () => {
    const { client } = mount({ status: { state: 'none' } })
    await act(() => client.refetchQueries({ queryKey: queryKeys.launchedBrowserStatus }))
    report(FITS)
    expect(screen.getByTestId('screen')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Capture Session' })).toBeNull()
  })

  it('docks the 320-pixel rail where the folded Captures screen and the rail both fit', async () => {
    mount()
    report(FITS)
    const rail = await screen.findByTestId('capture-session-rail')
    expect(rail.className).toContain('w-80')
    expect(within(rail).getByRole('list', { name: 'Tabs' })).toBeTruthy()
    expect(screen.queryByTestId('capture-session-strip')).toBeNull()
  })

  it('folds to the 40-pixel strip where they do not, with the REC dot and the tab count', async () => {
    mount()
    report(FITS - 1)
    const strip = await screen.findByTestId('capture-session-strip')
    expect(strip.className).toContain('w-10')
    expect(within(strip).getByTitle('REC · Launched Google Chrome')).toBeTruthy()
    expect(within(strip).getByTitle('3 tabs').textContent).toBe('3')
    expect(screen.queryByTestId('capture-session-rail')).toBeNull()
  })

  it("needs the Wayback slide-out's room while that tab is up", async () => {
    const { rerender } = mount({ waybackTab: true })
    report(FITS_WAYBACK - 1)
    expect(await screen.findByTestId('capture-session-strip')).toBeTruthy()
    rerender(false)
    expect(await screen.findByTestId('capture-session-rail')).toBeTruthy()
    rerender(true)
    report(FITS_WAYBACK)
    expect(await screen.findByTestId('capture-session-rail')).toBeTruthy()
  })

  it('keeps rail or strip as it is when a Capture is selected or cleared', async () => {
    mount()
    report(FITS - 1)
    await screen.findByTestId('capture-session-strip')
    act(() => useAppStore.getState().setSelectedCaptureId('cap-1'))
    expect(screen.getByTestId('capture-session-strip')).toBeTruthy()
    act(() => useAppStore.getState().setSelectedCaptureId(null))
    expect(screen.getByTestId('capture-session-strip')).toBeTruthy()
  })

  it('opens the panel over the screen from the strip, and closes it on Escape', async () => {
    mount()
    report(FITS - 1)
    fireEvent.click(await screen.findByRole('button', { name: 'Expand the Capture Session panel' }))
    const overlay = await screen.findByRole('dialog', { name: 'Capture Session' })
    expect(within(overlay).getByRole('list', { name: 'Tabs' })).toBeTruthy()
    expect(screen.getByTestId('screen')).toBeTruthy()
    act(() => {
      fireEvent.keyDown(overlay, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog', { name: 'Capture Session' })).toBeNull()
  })

  it('closes the overlay when its control hands over, and when the rail comes to fit', async () => {
    mount()
    report(FITS - 1)
    const expand = await screen.findByRole('button', { name: 'Expand the Capture Session panel' })
    fireEvent.click(expand)
    const overlay = await screen.findByRole('dialog', { name: 'Capture Session' })
    fireEvent.click(within(overlay).getByRole('button', { name: 'Stop…' }))
    expect(screen.queryByRole('dialog', { name: 'Capture Session' })).toBeNull()
    act(() => useAppStore.getState().setStopConfirmOpen(false))

    fireEvent.click(expand)
    await screen.findByRole('dialog', { name: 'Capture Session' })
    report(FITS)
    expect(await screen.findByTestId('capture-session-rail')).toBeTruthy()
    report(FITS - 1)
    await screen.findByTestId('capture-session-strip')
    expect(screen.queryByRole('dialog', { name: 'Capture Session' })).toBeNull()
  })

  it('marks a notice on the strip, and shows it in the rail', async () => {
    const notice = { code: 'EGRESS_BYPASS', message: 'A response did not come through…' }
    mount({ status: { state: 'none', notice } })
    report(FITS - 1)
    const strip = await screen.findByTestId('capture-session-strip')
    expect(within(strip).getByTitle('Browser closed: traffic went around the proxy')).toBeTruthy()
    report(FITS)
    const rail = await screen.findByTestId('capture-session-rail')
    expect(within(rail).getByRole('status').textContent).toContain('The Capture Session ended.')
  })

  it('names a closed browser on the strip with no tab count', async () => {
    mount({ status: { state: 'closed', browser: { ...SUMMARY, tabs: [] } } })
    report(FITS - 1)
    const strip = await screen.findByTestId('capture-session-strip')
    expect(within(strip).getByTitle('REC · Launched Google Chrome closed')).toBeTruthy()
    expect(within(strip).queryByTitle(/tabs?$/)).toBeNull()
  })

  it('reads the window, less the side rail, until the first measurement', async () => {
    stubResizeObserver()
    window.innerWidth = 48 + FITS
    mount()
    expect(await screen.findByTestId('capture-session-rail')).toBeTruthy()
    cleanup()
    window.innerWidth = 48 + FITS - 1
    mount()
    expect(await screen.findByTestId('capture-session-strip')).toBeTruthy()
  })
})
