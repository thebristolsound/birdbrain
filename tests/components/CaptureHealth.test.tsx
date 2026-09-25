// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, CaptureEvent } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { notify } from '@renderer/lib/notify'
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
import { fakeBridge } from '../renderer/fakeBridge'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@renderer/lib/notify', () => ({
  notify: { success: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const capture: Capture = {
  id: 'saved-capture',
  caseId: 'original-case',
  url: 'https://example.org/page',
  title: 'Saved page',
  hash: 'hash',
  timestamp: '2026-09-23T12:00:00Z',
  createdAt: '2026-09-23T12:00:00Z',
  format: 'mhtml',
  method: 'extension'
}
const storedEvent: CaptureEvent = {
  type: 'stored',
  captureId: capture.id,
  source: 'manual',
  url: capture.url,
  timestamp: capture.timestamp
}

async function openEvent(event: CaptureEvent = storedEvent) {
  openPopover()
  const rowText = event.url.length > 40 ? event.url.slice(0, 40) + '...' : event.url
  fireEvent.contextMenu(screen.getByText(rowText))
  return screen.findByRole('menu')
}

function renderHealth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<CaptureHealth />, { wrapper: Wrapper })
}

function openPopover() {
  fireEvent.click(screen.getByTitle('Capture pipeline health'))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({
    captureEvents: [],
    selectedCaptureId: null,
    selectedCaptureIds: new Set(),
    captureStats: { successCount: 0, failCount: 0, skipCount: 0 }
  })
  fakeBridge()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CaptureHealth', () => {
  it('does not read the recapture queue while the popover is closed', async () => {
    const queueStatus = vi.fn(async () => ({ pending: 0, inFlight: 0 }))
    fakeBridge({ recapture: { queueStatus } })

    renderHealth()

    await waitFor(() => expect(screen.getByTitle('Capture pipeline health')).toBeDefined())
    expect(queueStatus).not.toHaveBeenCalled()
  })

  it('shows pending background captures once the popover is open', async () => {
    fakeBridge({ recapture: { queueStatus: vi.fn(async () => ({ pending: 2, inFlight: 1 })) } })

    renderHealth()
    openPopover()

    expect(await screen.findByTestId('recapture-pending-badge')).toBeDefined()
    expect(screen.getByTestId('recapture-pending-badge').textContent).toContain(
      '2 background captures pending'
    )
  })

  it('reports a successful pipeline test', async () => {
    fakeBridge({
      recapture: { queueStatus: vi.fn(async () => ({ pending: 0, inFlight: 0 })) },
      testPipeline: vi.fn(async () => ({ success: true, durationMs: 42 }))
    })

    renderHealth()
    openPopover()
    fireEvent.click(screen.getByText('Test Pipeline'))

    expect(await screen.findByText('Pipeline OK — verified in 42ms')).toBeDefined()
  })

  it('surfaces a rejected http test as a failure rather than swallowing it', async () => {
    fakeBridge({
      recapture: { queueStatus: vi.fn(async () => ({ pending: 0, inFlight: 0 })) },
      testHttp: vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))
    })

    renderHealth()
    openPopover()
    fireEvent.click(screen.getByText('Test HTTP'))

    expect(await screen.findByText(/Pipeline FAILED/)).toBeDefined()
  })
})

describe('pipeline event context menu', () => {
  const get = vi.fn()
  const enqueueCaptures = vi.fn()
  const writeText = vi.fn()

  beforeEach(() => {
    get.mockReset().mockResolvedValue(capture)
    enqueueCaptures.mockReset().mockResolvedValue({ accepted: 1, rejected: [] })
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    fakeBridge({
      captures: { get },
      recapture: { enqueueCaptures, queueStatus: vi.fn(async () => ({ pending: 0, inFlight: 0 })) }
    })
    useAppStore.setState({ captureEvents: [storedEvent] })
  })

  it('opens the exact saved capture in its original case through the route handoff', async () => {
    renderHealth()
    const menu = await openEvent()
    expect(menu.getAttribute('aria-label')).toBe('Event actions: example.org')
    fireEvent.click(screen.getByTestId('context-menu-item-event-open'))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/cases/$caseId/captures',
        params: { caseId: 'original-case' },
        search: { captureId: 'saved-capture' }
      })
    )
    expect(get).toHaveBeenCalledWith('saved-capture')
  })

  it('copies the full event URL and keeps the parent popover open when selecting a portal item', async () => {
    const event = { ...storedEvent, url: 'https://example.org/a/very/long/path/that/is/truncated' }
    useAppStore.setState({ captureEvents: [event] })
    renderHealth()
    await openEvent(event)
    const item = screen.getByTestId('context-menu-item-event-copy-url')
    fireEvent.mouseDown(item)
    fireEvent.click(item)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(event.url))
    expect(screen.getByText('Capture Pipeline')).toBeDefined()
    expect(get).not.toHaveBeenCalled()
  })

  it('recaptures the clicked capture and never guesses a case from the visible route or URL', async () => {
    renderHealth()
    await openEvent()
    fireEvent.click(screen.getByTestId('context-menu-item-event-recapture'))
    await waitFor(() =>
      expect(enqueueCaptures).toHaveBeenCalledWith({
        caseId: 'original-case',
        captureIds: ['saved-capture']
      })
    )
    expect(notify.success).toHaveBeenCalledWith('Recapture queued — 1 capture')
  })

  it('reports an admission rejection without claiming recapture was queued', async () => {
    enqueueCaptures.mockResolvedValue({
      accepted: 0,
      rejected: [{ captureId: capture.id, reason: 'excluded' }]
    })
    renderHealth()
    await openEvent()
    fireEvent.click(screen.getByTestId('context-menu-item-event-recapture'))
    await waitFor(() => expect(notify.warn).toHaveBeenCalledWith('Recapture rejected: excluded'))
    expect(notify.success).not.toHaveBeenCalled()
  })

  it.each(['open', 'recapture'])(
    'does not %s a capture deleted since its pipeline event',
    async (action) => {
      get.mockResolvedValue(null)
      renderHealth()
      await openEvent()
      fireEvent.click(screen.getByTestId(`context-menu-item-event-${action}`))
      await waitFor(() =>
        expect(notify.warn).toHaveBeenCalledWith('This capture is no longer available')
      )
      expect(navigate).not.toHaveBeenCalled()
      expect(enqueueCaptures).not.toHaveBeenCalled()
    }
  )

  it.each(['open', 'recapture'])(
    'reports a bridge failure when attempting to %s',
    async (action) => {
      const cause = new Error('bridge unavailable')
      if (action === 'open') get.mockRejectedValue(cause)
      else enqueueCaptures.mockRejectedValue(cause)
      renderHealth()
      await openEvent()
      fireEvent.click(screen.getByTestId(`context-menu-item-event-${action}`))
      await waitFor(() =>
        expect(notify.error).toHaveBeenCalledWith(
          action === 'open' ? "Couldn't open capture" : "Couldn't queue recapture",
          { cause }
        )
      )
    }
  )

  it('clears only the clicked event and retains the session counters', async () => {
    const other = { ...storedEvent, captureId: 'other', url: 'https://other.example/' }
    useAppStore.setState({
      captureEvents: [storedEvent, other],
      captureStats: { successCount: 2, failCount: 0, skipCount: 0 }
    })
    renderHealth()
    await openEvent()
    fireEvent.click(screen.getByTestId('context-menu-item-event-clear'))
    expect(useAppStore.getState().captureEvents).toEqual([other])
    expect(useAppStore.getState().captureStats.successCount).toBe(2)
  })

  it('keeps unavailable capture actions disabled while preserving copy and clear for failures', async () => {
    const event: CaptureEvent = {
      ...storedEvent,
      type: 'failed',
      captureId: undefined,
      url: 'invalid URL',
      error: 'Unavailable'
    }
    useAppStore.setState({ captureEvents: [event] })
    renderHealth()
    const menu = await openEvent(event)
    expect(menu.getAttribute('aria-label')).toBe('Event actions: invalid URL')
    for (const action of ['open', 'recapture']) {
      const item = screen.getByTestId(`context-menu-item-event-${action}`)
      expect(item.getAttribute('data-disabled')).not.toBeNull()
      fireEvent.click(item)
    }
    expect(get).not.toHaveBeenCalled()
    expect(enqueueCaptures).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('context-menu-item-event-copy-url'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('invalid URL'))
  })
})
