// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { CaptureEvent, EgressSetting } from '@shared/types'
import type { RecaptureQueueStatus } from '@shared/ipc'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubResizeObserver } from './resizeObserverStub'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

import { StatusGroup } from '@renderer/components/status/StatusGroup'

function renderWith(
  egress: EgressSetting,
  vpnSeen: boolean | undefined,
  queueStatus = vi.fn(async (): Promise<RecaptureQueueStatus> => ({ pending: 0, activeUrl: null }))
) {
  const vpnStatus = vi.fn(async () => ({ vpnSeen }))
  fakeBridge({
    settings: { get: vi.fn(async () => ({ egress })) },
    egress: { vpnStatus },
    recapture: { queueStatus }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<StatusGroup />, { wrapper: Wrapper })
  return vpnStatus
}

beforeEach(() => {
  stubResizeObserver()
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
      'Status: a warning. Egress: Direct · VPN not seen. Extension: Connected. Nothing captured yet.'
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

  it('shows the count while a session runs, and failures always', async () => {
    useAppStore.setState({
      sessionActive: true,
      captureStats: { successCount: 23, failCount: 3, skipCount: 0 }
    })
    renderWith({ kind: 'direct' }, true)
    const button = await screen.findByTestId('status-group')
    await waitFor(() => expect(button.dataset.severity).toBe('danger'))
    expect(button.textContent).toContain('23')
    expect(button.textContent).toContain('3 failed')
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
    expect(navigate).toHaveBeenCalledWith({ to: '/settings', search: { section: 'egress' } })
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
