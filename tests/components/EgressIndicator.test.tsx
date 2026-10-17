// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { EgressSetting } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { EgressIndicator, egressIndicatorText } from '@renderer/components/status/EgressIndicator'

function renderWith(egress: EgressSetting | undefined, vpnSeen: boolean) {
  const vpnStatus = vi.fn(async () => ({ vpnSeen }))
  fakeBridge({
    settings: { get: vi.fn(async () => (egress ? { egress } : {})) },
    egress: { vpnStatus }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<EgressIndicator />, { wrapper: Wrapper })
  return vpnStatus
}

afterEach(cleanup)

describe('egressIndicatorText', () => {
  it('says nothing is sent while the saved Egress cannot be read', () => {
    expect(egressIndicatorText({ kind: 'unavailable' }, undefined)).toBe(
      'Egress unknown · nothing sent'
    )
  })

  it('names the Egress, and while Direct whether a VPN was seen', () => {
    const direct = { kind: 'direct' } as const
    expect(egressIndicatorText(direct, undefined)).toBe('Direct')
    expect(egressIndicatorText(direct, true)).toBe('Direct · VPN seen')
    expect(egressIndicatorText(direct, false)).toBe('Direct · VPN not seen')
    const proxy = { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: '' } as const
    expect(egressIndicatorText(proxy, undefined)).toBe('Proxy')
    expect(egressIndicatorText({ ...proxy, label: 'Frankfurt' }, undefined)).toBe(
      'Proxy: Frankfurt'
    )
    const tor = { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9150', label: '' } as const
    expect(egressIndicatorText(tor, undefined)).toBe('Tor')
    expect(egressIndicatorText({ ...tor, label: 'Browser' }, undefined)).toBe('Tor: Browser')
  })
})

describe('EgressIndicator', () => {
  it('shows a Direct Egress with no VPN seen as a warning', async () => {
    renderWith({ kind: 'direct' }, false)
    expect(await screen.findByText('Direct · VPN not seen')).toBeDefined()
    const pill = screen.getByTestId('egress-indicator')
    expect(pill.getAttribute('title')).toBe('Egress: Direct · VPN not seen')
    expect(pill.className).toContain('text-warning-fg')
  })

  it('shows a Direct Egress with a VPN seen without the warning', async () => {
    renderWith({ kind: 'direct' }, true)
    expect(await screen.findByText('Direct · VPN seen')).toBeDefined()
    expect(screen.getByTestId('egress-indicator').className).not.toContain('text-warning-fg')
  })

  it('does not read the route while the Egress is a Proxy', async () => {
    const vpnStatus = renderWith(
      { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: 'Lab' },
      false
    )
    expect(await screen.findByText('Proxy: Lab')).toBeDefined()
    expect(vpnStatus).not.toHaveBeenCalled()
  })

  it('renders nothing until the settings load', () => {
    renderWith(undefined, true)
    expect(screen.queryByTestId('egress-indicator')).toBeNull()
  })
})
