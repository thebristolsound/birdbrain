// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { EgressSetting } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubResizeObserver } from './resizeObserverStub'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

import { StatusGroup } from '@renderer/components/status/StatusGroup'

function renderWith(egress: EgressSetting, vpnSeen: boolean | undefined) {
  const vpnStatus = vi.fn(async () => ({ vpnSeen }))
  fakeBridge({
    settings: { get: vi.fn(async () => ({ egress })) },
    egress: { vpnStatus },
    recapture: { queueStatus: vi.fn(async () => ({ pending: 0, inFlight: 0 })) }
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
    await waitFor(() => expect(button.getAttribute('aria-label')).toContain('all nominal'))
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
