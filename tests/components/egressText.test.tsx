import { describe, it, expect } from 'vitest'
import type { EgressSetting } from '@shared/types'
import { egressIcon, egressIndicatorText } from '@renderer/components/status/egressText'

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

describe('egressIcon', () => {
  it('gives each Egress, and each VPN state while Direct, an icon of its own', () => {
    const proxy = { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: '' } as const
    const tor = { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9150', label: '' } as const
    const states: Array<[EgressSetting, boolean | undefined]> = [
      [{ kind: 'direct' }, undefined],
      [{ kind: 'direct' }, true],
      [{ kind: 'direct' }, false],
      [proxy, undefined],
      [tor, undefined],
      [{ kind: 'unavailable' }, undefined]
    ]
    const icons = new Set(states.map(([egress, vpnSeen]) => egressIcon(egress, vpnSeen)))
    expect(icons.size).toBe(states.length)
  })
})
