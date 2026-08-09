// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
import { fakeBridge } from '../renderer/fakeBridge'

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
