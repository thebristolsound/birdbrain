// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { CaptureEvent, EgressSetting } from '@shared/types'
import type { RecaptureQueueStatus, VpnStatus } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubResizeObserver } from './resizeObserverStub'

const navigate = vi.hoisted(() => vi.fn())
const route = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useMatchRoute:
    () =>
    ({ to }: { to: string }) =>
      route.pathname === to ? {} : false
}))

import { StatusGroup } from '@renderer/components/status/StatusGroup'

function renderWith(
  egress: EgressSetting,
  vpnSeen: boolean | undefined,
  queueStatus = vi.fn(async (): Promise<RecaptureQueueStatus> => ({ pending: 0, activeUrl: null }))
) {
  return renderWithSettings(async () => ({ egress }), vpnSeen, queueStatus)
}

function renderWithSettings(
  getSettings: () => Promise<{ egress: EgressSetting }>,
  vpnSeen: boolean | undefined = undefined,
  queueStatus = vi.fn(async (): Promise<RecaptureQueueStatus> => ({ pending: 0, activeUrl: null }))
) {
  const vpnStatus = vi.fn(async () => ({ vpnSeen }))
  renderGroup(getSettings, vpnStatus, queueStatus)
  return vpnStatus
}

function renderGroup(
  getSettings: () => Promise<{ egress: EgressSetting }>,
  vpnStatus: () => Promise<Partial<VpnStatus>>,
  queueStatus = vi.fn(async (): Promise<RecaptureQueueStatus> => ({ pending: 0, activeUrl: null })),
  bridge: Record<string, unknown> = {}
) {
  fakeBridge({
    settings: { get: vi.fn(getSettings) },
    egress: { vpnStatus },
    recapture: { queueStatus },
    ...bridge
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<StatusGroup />, { wrapper: Wrapper })
  return client
}

beforeEach(() => {
  stubResizeObserver()
  route.pathname = '/'
  navigate.mockClear()
  useAppStore.setState({
    connectedToExtension: true,
    sessionActive: false,
    captureEvents: [],
    captureStats: { successCount: 0, failCount: 0, skipCount: 0 }
  })
})

afterEach(cleanup)

// docs/design-handoff/2026-11-08-top-bar/, Option B: one control for the three signals.
describe('StatusGroup', () => {
  it('reads the whole state in its accessible name and paints no background', async () => {
    renderWith({ kind: 'direct' }, false)
    const button = await screen.findByTestId('status-group')
    await waitFor(() => expect(button.dataset.severity).toBe('warning'))
    expect(button.getAttribute('aria-label')).toBe(
      'Status: a warning. Egress: Direct · VPN not seen. Extension: Connected. No captures logged.'
    )
    expect(button.className).not.toMatch(/bg-(warning|danger|success)-surface/)
    // The worst signal's icon joins the dots, so the state reads without colour.
    expect(button.querySelector('svg')).toBeTruthy()
  })

  it('keeps the Egress text where the VPN warning e2e reads it', async () => {
    renderWith({ kind: 'direct' }, false)
    await waitFor(() =>
      expect(screen.getByTestId('egress-indicator').getAttribute('title')).toBe(
        'Egress: Direct · VPN not seen'
      )
    )
  })

  it('is neutral with no icon while all is nominal', async () => {
    renderWith({ kind: 'direct' }, true)
    const button = await screen.findByTestId('status-group')
    await waitFor(() =>
      expect(button.getAttribute('aria-label')).toContain('Egress: Direct · VPN seen')
    )
    expect(button.getAttribute('aria-label')).toContain('all nominal')
    expect(button.dataset.severity).toBe('nominal')
    expect(button.querySelector('svg')).toBeNull()
  })

  it('does not read the route while the Egress is a Proxy', async () => {
    const vpnStatus = renderWith(
      { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: 'Lab' },
      false
    )
    await waitFor(() =>
      expect(screen.getByTestId('egress-indicator').getAttribute('title')).toBe(
        'Egress: Proxy: Lab'
      )
    )
    expect(vpnStatus).not.toHaveBeenCalled()
  })

  it('keeps a long Egress label whole in the title and the accessible name', async () => {
    const label = 'Field office relay through the harbour authority gateway, floor three'
    renderWith({ kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label }, undefined)
    await waitFor(() =>
      expect(screen.getByTestId('egress-indicator').getAttribute('title')).toBe(
        `Egress: Proxy: ${label}`
      )
    )
    expect(screen.getByTestId('egress-indicator').textContent).toBe(`Proxy: ${label}`)
    expect(screen.getByTestId('status-group').getAttribute('aria-label')).toContain(
      `Egress: Proxy: ${label}.`
    )
  })

  // In the popover the label gives way, not the row's name: it ends in an ellipsis and the
  // value's title holds it whole, the design's rule for a long name.
  it('keeps a long Egress label readable in its popover row', async () => {
    const label = 'Field office relay through the harbour authority gateway, floor three'
    renderWith({ kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label }, undefined)
    fireEvent.click(await screen.findByTestId('status-group'))
    const row = await screen.findByTestId('status-row-egress')
    await waitFor(() => expect(row.textContent).toContain(`Proxy: ${label}`))
    const value = within(row).getByTitle(`Proxy: ${label}`)
    expect(within(value).getByText(`Proxy: ${label}`).className).toContain('truncate')
    // The name's column sizes to the name; only the value's column may shrink.
    expect(row.className).toContain('grid-cols-[18px_auto_minmax(0,1fr)]')
  })

  it('shows the count while a session runs, and failures always', async () => {
    useAppStore.setState({
      sessionActive: true,
      captureStats: { successCount: 23, failCount: 3, skipCount: 0 }
    })
    renderWith({ kind: 'direct' }, true)
    const button = await screen.findByTestId('status-group')
    await waitFor(() => expect(button.dataset.severity).toBe('danger'))
    expect(button.textContent).toContain('23')
    expect(within(button).getByTestId('status-word').textContent).toBe('3 failed')
  })

  it('opens the three rows and the capture log behind Capture log', async () => {
    renderWith({ kind: 'direct' }, true)
    fireEvent.click(await screen.findByTestId('status-group'))
    const popover = await screen.findByRole('dialog', { name: 'Status' })
    expect(popover.querySelector('[data-testid="status-row-extension"]')?.textContent).toContain(
      'Connected'
    )
    expect(popover.querySelector('[data-testid="status-row-egress"]')).toBeTruthy()
    expect(popover.querySelector('[data-testid="status-row-health"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Capture log' }))
    expect(await screen.findByTestId('capture-log')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Egress settings' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/settings',
      search: { section: 'egress' },
      replace: false
    })
  })

  // Settings' "Return to Birdbrain" goes back one history entry, which must not be Settings.
  it('replaces the history entry when Egress settings is used from Settings', async () => {
    route.pathname = '/settings'
    renderWith({ kind: 'direct' }, true)
    fireEvent.click(await screen.findByTestId('status-group'))
    fireEvent.click(await screen.findByRole('button', { name: 'Egress settings' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/settings',
      search: { section: 'egress' },
      replace: true
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status' })).toBeNull())
  })
})

// Missing input is its own state: an Egress nobody has read is not a nominal one.
describe('StatusGroup before the Egress is read', () => {
  it('does not say all nominal while the settings are loading', async () => {
    renderWithSettings(() => new Promise(() => {}))
    const button = await screen.findByTestId('status-group')
    expect(button.getAttribute('aria-label')).toMatch(/^Status: reading the Egress\. /)
    expect(button.getAttribute('aria-label')).not.toContain('all nominal')
  })

  it('gives the Egress row the unknown-Egress icon, not the Capture Health one, while loading', async () => {
    renderWithSettings(() => new Promise(() => {}))
    fireEvent.click(await screen.findByTestId('status-group'))
    const row = await screen.findByTestId('status-row-egress')
    expect(row.textContent).toContain('Reading…')
    expect(row.querySelector('svg')?.getAttribute('class')).toContain('shield-question')
    expect(row.querySelector('svg')?.getAttribute('class')).not.toContain('lucide-activity')
  })

  // Only the app changes the Egress, so a re-read that fails keeps the one read before it.
  it('keeps the Egress it read when a later settings read fails', async () => {
    let failing = false
    const client = renderGroup(
      async () => {
        if (failing) throw new Error('settings unreadable')
        return { egress: { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: 'Lab' } }
      },
      async () => ({ vpnSeen: true })
    )
    const button = await screen.findByTestId('status-group')
    await waitFor(() => expect(button.getAttribute('aria-label')).toContain('Egress: Proxy: Lab'))
    failing = true
    await act(() => client.refetchQueries({ queryKey: queryKeys.settings }))
    expect(client.getQueryState(queryKeys.settings)?.status).toBe('error')
    expect(button.getAttribute('aria-label')).toMatch(
      /^Status: all nominal\. Egress: Proxy: Lab\. /
    )
    expect(button.dataset.severity).toBe('nominal')
  })

  it('shows a problem, with the unknown-Egress icon and word, when the settings read fails', async () => {
    renderWithSettings(async () => {
      throw new Error('settings unreadable')
    })
    const button = await screen.findByTestId('status-group')
    await waitFor(() => expect(button.dataset.severity).toBe('danger'))
    expect(button.getAttribute('aria-label')).toMatch(
      /^Status: a problem\. Egress: Egress unknown\. /
    )
    expect(within(button).getByTestId('status-word').textContent).toBe('Egress unknown')
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('shield-question')
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      button.getAttribute('aria-label')
    )
  })
})

// The VPN check is an input too: a Direct Egress nobody has checked is not a nominal one.
describe('StatusGroup before the VPN check answers', () => {
  const direct = async () => ({ egress: { kind: 'direct' as const } })

  it('does not say all nominal while the check is in flight', async () => {
    renderGroup(direct, () => new Promise(() => {}))
    const button = await screen.findByTestId('status-group')
    await waitFor(() =>
      expect(button.getAttribute('aria-label')).toMatch(
        /^Status: checking for a VPN\. Egress: Direct\. /
      )
    )
    expect(button.dataset.severity).toBe('nominal')
  })

  it('warns, with a word of its own, when the check fails', async () => {
    renderGroup(direct, async () => {
      throw new Error('route unreadable')
    })
    const button = await screen.findByTestId('status-group')
    await waitFor(() => expect(button.dataset.severity).toBe('warning'))
    expect(button.getAttribute('aria-label')).toMatch(
      /^Status: a warning\. Egress: Direct · VPN check failed\. /
    )
    expect(within(button).getByTestId('status-word').textContent).toBe('VPN check failed')
  })

  // A VPN drops outside Birdbrain, so the reading before a failed check says nothing.
  it('drops the last reading when a later check fails', async () => {
    let failing = false
    const client = renderGroup(direct, async () => {
      if (failing) throw new Error('route unreadable')
      return { vpnSeen: true }
    })
    const button = await screen.findByTestId('status-group')
    await waitFor(() =>
      expect(button.getAttribute('aria-label')).toContain('Egress: Direct · VPN seen')
    )
    failing = true
    await act(() => client.refetchQueries({ queryKey: queryKeys.vpnStatus }))
    await waitFor(() => expect(button.dataset.severity).toBe('warning'))
    expect(button.getAttribute('aria-label')).toContain('Egress: Direct · VPN check failed')
    expect(button.getAttribute('aria-label')).not.toContain('VPN seen')
    // The icons follow the failed check too: the plain shield, not the "VPN seen" one, in the
    // bar and in the popover's Egress row.
    expect(button.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-shield( |$)/)
    fireEvent.click(button)
    const row = await screen.findByTestId('status-row-egress')
    expect(row.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-shield( |$)/)
  })
})

describe('StatusGroup announcements and popover', () => {
  const liveRegion = () => document.querySelector('[aria-live="polite"]')!
  async function renderNominal() {
    renderWith({ kind: 'direct' }, true)
    const button = await screen.findByTestId('status-group')
    await waitFor(() =>
      expect(button.getAttribute('aria-label')).toContain('Egress: Direct · VPN seen')
    )
    return button
  }

  it('announces a change of severity in the polite live region', async () => {
    const button = await renderNominal()
    expect(liveRegion().textContent).toBe('')

    act(() =>
      useAppStore.setState({ captureStats: { successCount: 4, failCount: 2, skipCount: 0 } })
    )
    await waitFor(() => expect(button.dataset.severity).toBe('danger'))
    expect(liveRegion().textContent).toBe(button.getAttribute('aria-label'))
  })

  it('does not announce a new count at the same severity', async () => {
    await renderNominal()
    act(() =>
      useAppStore.setState({ captureStats: { successCount: 5, failCount: 0, skipCount: 0 } })
    )
    await waitFor(() =>
      expect(screen.getByTestId('status-group').getAttribute('aria-label')).toContain('5 captured')
    )
    expect(liveRegion().textContent).toBe('')
  })

  it('closes the capture log with the popover', async () => {
    const button = await renderNominal()
    fireEvent.click(button)
    fireEvent.click(await screen.findByRole('button', { name: 'Capture log' }))
    expect(await screen.findByTestId('capture-log')).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Status' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status' })).toBeNull())
    fireEvent.click(button)
    await screen.findByRole('dialog', { name: 'Status' })
    expect(screen.queryByTestId('capture-log')).toBeNull()
  })

  // The log unmounts with the popover, so a test started in it reports to the group.
  it('shows a self-test result that arrived while the popover was closed', async () => {
    let finish: (result: { success: boolean; durationMs: number }) => void = () => {}
    const testHttp = vi.fn(
      () => new Promise<{ success: boolean; durationMs: number }>((resolve) => (finish = resolve))
    )
    renderGroup(
      async () => ({ egress: { kind: 'direct' } }),
      async () => ({ vpnSeen: true }),
      undefined,
      { testHttp }
    )
    const button = await screen.findByTestId('status-group')
    fireEvent.click(button)
    fireEvent.click(await screen.findByRole('button', { name: 'Capture log' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Test HTTP' }))
    expect(testHttp).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Status' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status' })).toBeNull())
    await act(async () => finish({ success: true, durationMs: 12 }))

    fireEvent.click(button)
    fireEvent.click(await screen.findByRole('button', { name: 'Capture log' }))
    expect((await screen.findByRole('status')).textContent).toBe('HTTP OK, verified in 12ms')
  })

  // The event menu renders in a portal of its own: choosing one of its items leaves the status
  // popover and the log it was opened from on screen.
  it('stays open when an item of a capture event menu is chosen', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const event: CaptureEvent = {
      type: 'stored',
      captureId: 'saved-capture',
      source: 'manual',
      url: 'https://example.org/page',
      timestamp: '2026-11-09T03:48:00Z'
    }
    useAppStore.setState({ captureEvents: [event] })
    const button = await renderNominal()
    fireEvent.click(button)
    fireEvent.click(await screen.findByRole('button', { name: 'Capture log' }))
    fireEvent.contextMenu(await screen.findByText(event.url))
    await screen.findByRole('menu')
    const item = screen.getByTestId('context-menu-item-event-copy-url')
    fireEvent.pointerDown(item)
    fireEvent.mouseDown(item)
    fireEvent.click(item)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(event.url))
    expect(screen.getByRole('dialog', { name: 'Status' })).toBeTruthy()
    expect(screen.getByTestId('capture-log')).toBeTruthy()

    // The control: the same press outside both does close the popover.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status' })).toBeNull())
  })

  // Design rule "No fills in the chrome": in the bar a dot takes a colour only for the worst
  // signal. The dots sit in the order extension, Egress, Capture Health.
  it("colours only the worst signal's dot when two signals are off nominal", async () => {
    useAppStore.setState({ captureStats: { successCount: 1, failCount: 1, skipCount: 0 } })
    renderWith({ kind: 'direct' }, false)
    const button = await screen.findByTestId('status-group')
    await waitFor(() =>
      expect(button.getAttribute('aria-label')).toContain('Egress: Direct · VPN not seen')
    )
    const dots = [...button.querySelectorAll('[data-testid="status-dot"]')].map((d) => d.className)
    expect(dots).toHaveLength(3)
    expect(dots[0]).toContain('bg-text-faint')
    expect(dots[1]).toContain('bg-text-faint')
    expect(dots[2]).toContain('bg-danger-fg')
  })

  it('colours the Egress dot when the VPN warning is the only signal off nominal', async () => {
    renderWith({ kind: 'direct' }, false)
    const button = await screen.findByTestId('status-group')
    await waitFor(() => expect(button.dataset.severity).toBe('warning'))
    const dots = [...button.querySelectorAll('[data-testid="status-dot"]')].map((d) => d.className)
    expect(dots[0]).toContain('bg-text-faint')
    expect(dots[1]).toContain('bg-warning-fg')
    expect(dots[2]).toContain('bg-text-faint')
  })

  // Both are off nominal here, so the icon has an Egress icon to lose to.
  it('shows the Capture Health icon, not the Egress icon, when failures are the worst', async () => {
    useAppStore.setState({ captureStats: { successCount: 1, failCount: 1, skipCount: 0 } })
    renderWith({ kind: 'direct' }, false)
    const button = await screen.findByTestId('status-group')
    await waitFor(() =>
      expect(button.getAttribute('aria-label')).toContain('Egress: Direct · VPN not seen')
    )
    expect(button.dataset.severity).toBe('danger')
    const icons = button.querySelectorAll('svg')
    expect(icons).toHaveLength(1)
    expect(icons[0].getAttribute('class')).toContain('lucide-activity')
  })
})

// The closed button carries queued background captures, as the Capture Health pill did (#2122).
describe('StatusGroup background captures', () => {
  const queued = (pending: number) =>
    vi.fn(async (): Promise<RecaptureQueueStatus> => ({
      pending,
      activeUrl: pending ? 'https://example.org/queued' : null
    }))
  const started: CaptureEvent = {
    type: 'received',
    source: 'recapture',
    url: 'https://example.org/queued',
    timestamp: '2026-11-09T03:48:00Z'
  }

  it('shows a spinner with the pending count on the closed button', async () => {
    renderWith({ kind: 'direct' }, true, queued(3))

    const indicator = await screen.findByTestId('recapture-pending-indicator')
    expect(indicator.textContent).toBe('3')
    expect(indicator.getAttribute('title')).toBe('3 background captures queued or running')
    expect(indicator.querySelector('svg')?.getAttribute('class')).toContain('animate-spin')
    expect(screen.getByTestId('status-group').getAttribute('aria-label')).toContain(
      '3 background captures queued or running.'
    )
    expect(screen.queryByRole('dialog', { name: 'Status' })).toBeNull()
  })

  it('shows no pending indicator when the queue is empty', async () => {
    const queueStatus = queued(0)
    renderWith({ kind: 'direct' }, true, queueStatus)

    await waitFor(() => expect(queueStatus).toHaveBeenCalled())
    expect(screen.queryByTestId('recapture-pending-indicator')).toBeNull()
  })

  it('re-reads the queue when a background capture starts or finishes', async () => {
    const queueStatus = queued(0)
    renderWith({ kind: 'direct' }, true, queueStatus)
    await waitFor(() => expect(queueStatus).toHaveBeenCalledTimes(1))

    queueStatus.mockResolvedValue({ pending: 1, activeUrl: started.url })
    act(() => useAppStore.getState().addCaptureEvent(started))
    expect((await screen.findByTestId('recapture-pending-indicator')).textContent).toBe('1')

    queueStatus.mockResolvedValue({ pending: 0, activeUrl: null })
    act(() =>
      useAppStore
        .getState()
        .addCaptureEvent({ ...started, type: 'stored', timestamp: '2026-11-09T03:48:12Z' })
    )
    await waitFor(() => expect(screen.queryByTestId('recapture-pending-indicator')).toBeNull())
  })

  // The last capture's stored event can arrive before the queue drops it, so the
  // button relies on the poll to clear.
  it('polls while a capture is pending and stops once the queue empties', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const queueStatus = queued(1)
      renderWith({ kind: 'direct' }, true, queueStatus)
      expect((await screen.findByTestId('recapture-pending-indicator')).textContent).toBe('1')

      queueStatus.mockResolvedValue({ pending: 0, activeUrl: null })
      await act(() => vi.advanceTimersByTimeAsync(2000))
      await waitFor(() => expect(screen.queryByTestId('recapture-pending-indicator')).toBeNull())

      const calls = queueStatus.mock.calls.length
      await act(() => vi.advanceTimersByTimeAsync(6000))
      expect(queueStatus).toHaveBeenCalledTimes(calls)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not re-read the queue for a capture from another source', async () => {
    const queueStatus = queued(0)
    renderWith({ kind: 'direct' }, true, queueStatus)
    await waitFor(() => expect(queueStatus).toHaveBeenCalledTimes(1))

    act(() => useAppStore.getState().addCaptureEvent({ ...started, source: 'auto' }))

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(queueStatus).toHaveBeenCalledTimes(1)
  })
})
