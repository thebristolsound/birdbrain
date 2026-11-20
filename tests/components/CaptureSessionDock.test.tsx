// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Case, LaunchedBrowserStatus, LaunchedBrowserSummary } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubResizeObserver, stubResizeObserverWithWidth } from './resizeObserverStub'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ caseId: 'case-1' })
}))

import {
  CaptureSessionDock,
  useHostedCaptureSessionPanel
} from '@renderer/components/launchedBrowser/CaptureSessionDock'
import { SIDE_RAIL_PX } from '@renderer/components/captures/captureColumns'

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
// The room beside the side rail the rail needs beside the Captures screen's minimums, with its
// right panel folded and the viewer kept at 480 pixels (list 240, separator 7, viewer 480, strip
// 40).
const FITS = 240 + 7 + 480 + 40 + 320
const INNER_WIDTH = window.innerWidth

let reportWidth: (width: number) => void

// A screen that leaves the panel to the dock.
function Screen() {
  return <div data-testid="screen" />
}

// A screen that shows the panel in a place of its own, as Captures does, saying what it is given.
function HostingScreen() {
  return <div data-testid="hosting-screen">{useHostedCaptureSessionPanel()?.kind ?? 'nothing'}</div>
}

function mount({
  status = OPEN,
  hosts = false,
  poppedOut = false
}: { status?: LaunchedBrowserStatus; hosts?: boolean; poppedOut?: boolean } = {}) {
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
  const tree = (hosting: boolean) => (
    <QueryClientProvider client={client}>
      <CaptureSessionDock>{hosting ? <HostingScreen /> : <Screen />}</CaptureSessionDock>
    </QueryClientProvider>
  )
  const { rerender } = render(tree(hosts))
  return { client, showPopOut, dock, rerender: (hosting: boolean) => rerender(tree(hosting)) }
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

  // The top bar's recording mark hides and shows a launched browser's panel.
  it('shows no rail and no strip while the panel is hidden, and takes neither width', async () => {
    try {
      const { client } = mount()
      await act(() => client.refetchQueries({ queryKey: queryKeys.launchedBrowserStatus }))
      report(FITS)
      // The browser is open and the rail is docked, so hiding has something to hide.
      await screen.findByTestId('capture-session-rail')

      act(() => useAppStore.setState({ captureSessionPanelHidden: true }))
      expect(screen.queryByTestId('capture-session-rail')).toBeNull()
      expect(screen.queryByTestId('capture-session-strip')).toBeNull()
      report(FITS - 1)
      expect(screen.queryByTestId('capture-session-strip')).toBeNull()

      act(() => useAppStore.setState({ captureSessionPanelHidden: false }))
      expect(screen.getByTestId('capture-session-strip')).toBeTruthy()
    } finally {
      useAppStore.setState({ captureSessionPanelHidden: false })
    }
  })

  // A notice is not a launched browser's panel, so the mark's hiding does not reach it.
  it('still shows a notice while the panel is hidden', async () => {
    useAppStore.setState({ captureSessionPanelHidden: true, dismissedLaunchNotice: null })
    try {
      mount({
        status: { state: 'none', notice: { code: 'EGRESS_CHANGED', message: 'It changed.' } }
      })
      report(FITS)
      expect(await screen.findByTestId('capture-session-rail')).toBeTruthy()
    } finally {
      useAppStore.setState({ captureSessionPanelHidden: false })
    }
  })

  it('reads the window, less the side rail, until the first measurement', async () => {
    stubResizeObserver()
    window.innerWidth = SIDE_RAIL_PX + FITS
    mount()
    expect(await screen.findByTestId('capture-session-rail')).toBeTruthy()
    cleanup()
    window.innerWidth = SIDE_RAIL_PX + FITS - 1
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

  // The Captures screen shows the panel as a tab of its right panel.
  describe('beside a screen that hosts the panel itself', () => {
    it('adds no rail and no strip, and gives the screen the view to show', async () => {
      mount({ hosts: true })
      report(FITS)
      await waitFor(() => expect(screen.getByTestId('hosting-screen').textContent).toBe('open'))
      expect(screen.queryByRole('complementary', { name: 'Capture Session' })).toBeNull()
      report(FITS - 1)
      expect(screen.queryByRole('complementary', { name: 'Capture Session' })).toBeNull()
    })

    it('adds no popped-out strip either', async () => {
      const { client } = mount({ hosts: true, poppedOut: true })
      report(FITS)
      await waitFor(() => expect(screen.getByTestId('hosting-screen').textContent).toBe('open'))
      await act(() => client.refetchQueries({ queryKey: queryKeys.launchedBrowserPopOut }))
      expect(client.getQueryData(queryKeys.launchedBrowserPopOut)).toBe(true)
      expect(screen.queryByRole('complementary', { name: 'Capture Session' })).toBeNull()
    })

    it('gives the screen a notice to show', async () => {
      const notice = { code: 'EGRESS_CHANGED', message: 'It changed.' }
      mount({ hosts: true, status: { state: 'none', notice } })
      report(FITS)
      await waitFor(() => expect(screen.getByTestId('hosting-screen').textContent).toBe('notice'))
      expect(screen.queryByRole('complementary', { name: 'Capture Session' })).toBeNull()
    })

    it('gives the screen nothing with no launched browser, or while the panel is hidden', async () => {
      try {
        const { client } = mount({ hosts: true, status: { state: 'none' } })
        await act(() => client.refetchQueries({ queryKey: queryKeys.launchedBrowserStatus }))
        expect(screen.getByTestId('hosting-screen').textContent).toBe('nothing')

        act(() => client.setQueryData(queryKeys.launchedBrowserStatus, OPEN))
        await waitFor(() => expect(screen.getByTestId('hosting-screen').textContent).toBe('open'))
        act(() => useAppStore.setState({ captureSessionPanelHidden: true }))
        expect(screen.getByTestId('hosting-screen').textContent).toBe('nothing')
        act(() => useAppStore.setState({ captureSessionPanelHidden: false }))
        expect(screen.getByTestId('hosting-screen').textContent).toBe('open')
      } finally {
        useAppStore.setState({ captureSessionPanelHidden: false })
      }
    })

    it('docks the rail again for the next screen, and takes it away on the way back', async () => {
      const { rerender } = mount({ hosts: true })
      report(FITS)
      await waitFor(() => expect(screen.getByTestId('hosting-screen').textContent).toBe('open'))
      rerender(false)
      expect(await screen.findByTestId('capture-session-rail')).toBeTruthy()
      rerender(true)
      expect(screen.queryByTestId('capture-session-rail')).toBeNull()
      expect(screen.getByTestId('hosting-screen').textContent).toBe('open')
    })
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
