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

import {
  CaptureSessionDock,
  useCaptureSessionRailDocked
} from '@renderer/components/launchedBrowser/CaptureSessionDock'

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
// The room beside the side rail the rail needs beside the Captures screen with its details panel
// folded and the viewer kept at 480 pixels (list 240, separator 7, viewer 480, details strip 40),
// and beside the Wayback tab (viewer 480, slide-out 436, details strip 40).
const FITS = 240 + 7 + 480 + 40 + 320
const FITS_WAYBACK = 480 + 436 + 40 + 320
const INNER_WIDTH = window.innerWidth

let reportWidth: (width: number) => void

// The screen inside the dock, saying whether it reads the rail as docked.
function Screen() {
  return <div data-testid="screen">{useCaptureSessionRailDocked() ? 'docked' : 'free'}</div>
}

function mount({
  status = OPEN,
  waybackTab = false,
  poppedOut = false
}: { status?: LaunchedBrowserStatus; waybackTab?: boolean; poppedOut?: boolean } = {}) {
  const showPopOut = vi.fn(async () => {})
  const dock = vi.fn(async () => {})
  fakeBridge({
    cases: { list: vi.fn(async () => [FERRY]) },
    settings: { get: vi.fn(async () => ({ egress: { kind: 'direct' } })) },
    launchedBrowser: {
      status: vi.fn(async () => status),
      popOutState: vi.fn(async () => poppedOut),
      showPopOut,
      dock
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (wayback: boolean) => (
    <QueryClientProvider client={client}>
      <CaptureSessionDock waybackTab={wayback}>
        <Screen />
      </CaptureSessionDock>
    </QueryClientProvider>
  )
  const { rerender } = render(tree(waybackTab))
  return { client, showPopOut, dock, rerender: (wayback: boolean) => rerender(tree(wayback)) }
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
  // Design review of 2026-11-04, answer 1: the viewer keeps 480 pixels beside the docked rail.
  it('leaves room for a 480-pixel viewer beside the folded Captures screen', async () => {
    mount()
    report(240 + 7 + 360 + 40 + 320)
    expect(await screen.findByTestId('capture-session-strip')).toBeTruthy()
    report(FITS)
    expect(await screen.findByTestId('capture-session-rail')).toBeTruthy()
  })

  it('tells the screen inside it whether the rail is docked', async () => {
    mount()
    report(FITS)
    await screen.findByTestId('capture-session-rail')
    expect(screen.getByTestId('screen').textContent).toBe('docked')
    report(FITS - 1)
    await screen.findByTestId('capture-session-strip')
    expect(screen.getByTestId('screen').textContent).toBe('free')
  })

  it('tells the screen the rail is not docked while no launched browser is open', async () => {
    const { client } = mount({ status: { state: 'none' } })
    await act(() => client.refetchQueries({ queryKey: queryKeys.launchedBrowserStatus }))
    report(FITS)
    expect(screen.getByTestId('screen').textContent).toBe('free')
  })

  // 1g, answer 2: the main window keeps the strip's 40 pixels while the panel is popped out.
  describe('while the panel is popped out', () => {
    it('keeps a 40-pixel strip in place of the rail, and the screen takes the width', async () => {
      mount({ poppedOut: true })
      report(FITS + 400)
      const strip = await screen.findByTestId('capture-session-popped-out')
      expect(strip.className).toContain('w-10')
      expect(within(strip).getByTitle('REC · Launched Google Chrome')).toBeTruthy()
      expect(screen.queryByTestId('capture-session-rail')).toBeNull()
      expect(screen.queryByText('Panel popped out')).toBeNull()
      expect(screen.getByTestId('screen').textContent).toBe('free')
    })

    it('shows the window and docks the panel from glyphs with tooltips', async () => {
      const { showPopOut, dock } = mount({ poppedOut: true })
      report(FITS)
      const show = await screen.findByRole('button', { name: 'Show window' })
      expect(show.getAttribute('title')).toBe('Show window')
      fireEvent.click(show)
      await vi.waitFor(() => expect(showPopOut).toHaveBeenCalledTimes(1))
      const dockButton = screen.getByRole('button', { name: 'Dock' })
      expect(dockButton.getAttribute('title')).toBe('Dock')
      fireEvent.click(dockButton)
      await vi.waitFor(() => expect(dock).toHaveBeenCalledTimes(1))
    })

    it('stands in for the narrow strip too, with no overlay to expand', async () => {
      mount({ poppedOut: true })
      report(FITS - 1)
      await screen.findByTestId('capture-session-popped-out')
      expect(screen.queryByRole('button', { name: 'Expand the Capture Session panel' })).toBeNull()
      expect(screen.queryByTestId('capture-session-strip')).toBeNull()
    })

    it('gives the rail back once the browser has closed, as the panel does', async () => {
      const { client } = mount({
        status: { state: 'closed', browser: { ...SUMMARY, tabs: [] } },
        poppedOut: true
      })
      report(FITS)
      await act(() => client.refetchQueries({ queryKey: queryKeys.launchedBrowserPopOut }))
      expect(client.getQueryData(queryKeys.launchedBrowserPopOut)).toBe(true)
      expect(await screen.findByTestId('capture-session-rail')).toBeTruthy()
      expect(screen.queryByTestId('capture-session-popped-out')).toBeNull()
    })
  })
})
