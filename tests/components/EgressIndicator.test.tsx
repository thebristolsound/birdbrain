// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { EgressSetting } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { EgressIndicator, egressIndicatorText } from '@renderer/components/status/EgressIndicator'

function renderWith(egress: EgressSetting | undefined, vpnSeen: boolean | undefined) {
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

  it('shows its words only from 2xl, on one capped line, with the full text in the title', async () => {
    renderWith({ kind: 'direct' }, false)
    const words = await screen.findByText('Direct · VPN not seen')
    // Shown below 2xl, the words move the case search off centre (e2e/topbar-layout.spec.ts).
    // A bare not-sr-only would show them at every width, and a later 2xl class could undo
    // the one line or the cap.
    const classes = words.className.split(' ')
    expect(classes).toContain('sr-only')
    expect(classes.filter((c) => c.endsWith('not-sr-only'))).toEqual(['2xl:not-sr-only'])
    expect(classes.filter((c) => c.startsWith('2xl:')).sort()).toEqual([
      '2xl:max-w-44',
      '2xl:not-sr-only',
      '2xl:truncate'
    ])
    expect(screen.getByTestId('egress-indicator').getAttribute('title')).toBe(
      'Egress: Direct · VPN not seen'
    )
  })

  it('keeps a long label whole in the text and the title, past the cap', async () => {
    const label = 'Mullvad SOCKS5 relay over WireGuard, Stockholm se-sto-wg-socks5-001'.repeat(2)
    renderWith({ kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label }, true)
    expect(await screen.findByText(`Proxy: ${label}`)).toBeDefined()
    expect(screen.getByTestId('egress-indicator').getAttribute('title')).toBe(
      `Egress: Proxy: ${label}`
    )
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

  it('gives each Egress, and each VPN state while Direct, an icon of its own', async () => {
    const proxy = { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: '' } as const
    const tor = { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9150', label: '' } as const
    const states: Array<[EgressSetting, boolean | undefined, string]> = [
      [{ kind: 'direct' }, undefined, 'Direct'],
      [{ kind: 'direct' }, true, 'Direct · VPN seen'],
      [{ kind: 'direct' }, false, 'Direct · VPN not seen'],
      [proxy, undefined, 'Proxy'],
      [tor, undefined, 'Tor'],
      [{ kind: 'unavailable' }, undefined, 'Egress unknown · nothing sent']
    ]
    const icons = new Set<string | null | undefined>()
    for (const [egress, vpnSeen, text] of states) {
      renderWith(egress, vpnSeen)
      await screen.findByText(text)
      icons.add(screen.getByTestId('egress-indicator').querySelector('svg')?.getAttribute('class'))
      cleanup()
    }
    expect(icons.size).toBe(states.length)
  })

  it('renders nothing until the settings load', () => {
    renderWith(undefined, true)
    expect(screen.queryByTestId('egress-indicator')).toBeNull()
  })
})
