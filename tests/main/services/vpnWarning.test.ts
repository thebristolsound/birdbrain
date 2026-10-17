import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { NetworkIdentity, NetworkReading } from '@main/services/vpnDetection'
import type { EgressSetting } from '@shared/types'

const detectNetwork = vi.hoisted(() => vi.fn())
vi.mock('@main/services/vpnDetection', () => ({ detectNetwork }))

import {
  createVpnWarningService,
  networkHash,
  type VpnWarningDeps
} from '@main/services/vpnWarning'
import { getSettings, initSettings, updateSettings } from '@main/services/settings'

const HOME: NetworkIdentity = { name: 'Example Network', routerMac: '00:00:5e:00:53:02' }
const CAFE: NetworkIdentity = { name: 'Cafe', routerMac: '00:00:5e:00:53:03' }

function harness(initial: NetworkReading = { vpnSeen: false, network: HOME }) {
  const state = {
    reading: initial,
    egress: 'direct' as EgressSetting['kind'],
    muted: [] as string[]
  }
  const deps: VpnWarningDeps = {
    detect: vi.fn(async () => state.reading),
    egressKind: () => state.egress,
    mutedNetworks: () => state.muted,
    muteNetwork: vi.fn((hash: string) => {
      state.muted.push(hash)
    })
  }
  return { state, deps, service: createVpnWarningService(deps) }
}

describe('networkHash', () => {
  // Known answer: SHA-256 of the JSON array [name, routerMac]. A change to the input shape
  // would move every muted network's hash, and every muted network would warn again.
  it('hashes the network name and the router address', () => {
    expect(networkHash(HOME)).toBe(
      'ba8e1be531cb8b1d61963ffcc7ea006d1222cbb0989d558fb1b0064a748f6c2c'
    )
    expect(networkHash({ ...HOME, name: '' })).not.toBe(networkHash(HOME))
    expect(networkHash({ ...HOME, routerMac: CAFE.routerMac })).not.toBe(networkHash(HOME))
  })
})

describe('the VPN warning', () => {
  it('warns on the first contact in a Case, not the second, and again in a new Case', async () => {
    const { service } = harness()
    expect(await service.check('case-a')).toEqual({ caseId: 'case-a', warn: true, canMute: true })
    service.answer('case-a', 'continue')
    expect(await service.check('case-a')).toMatchObject({ warn: false })
    expect(await service.check('case-b')).toMatchObject({ warn: true })
  })

  it('warns again in a Case whose warning was not answered', async () => {
    const { service } = harness()
    expect(await service.check('case-a')).toMatchObject({ warn: true })
    expect(await service.check('case-a')).toMatchObject({ warn: true })
  })

  it('stops warning on a muted network, and warns on a different one', async () => {
    const { state, deps, service } = harness()
    await service.check('case-a')
    service.answer('case-a', 'mute-network')
    expect(deps.muteNetwork).toHaveBeenCalledWith(networkHash(HOME))
    expect(await service.check('case-b')).toMatchObject({ warn: false })

    state.reading = { vpnSeen: false, network: CAFE }
    expect(await service.check('case-b')).toMatchObject({ warn: true, canMute: true })
  })

  it('mutes the network the warning was raised on, even after a move', async () => {
    const { state, deps, service } = harness()
    await service.check('case-a')
    state.reading = { vpnSeen: false, network: CAFE }
    service.answer('case-a', 'mute-network')
    expect(deps.muteNetwork).toHaveBeenCalledWith(networkHash(HOME))
  })

  it('cannot mute a network whose router address was not read', async () => {
    const { deps, service } = harness({ vpnSeen: false, network: null })
    expect(await service.check('case-a')).toEqual({ caseId: 'case-a', warn: true, canMute: false })
    service.answer('case-a', 'mute-network')
    expect(deps.muteNetwork).not.toHaveBeenCalled()
    expect(await service.check('case-a')).toMatchObject({ warn: false })
  })

  it('does not warn while a VPN is seen', async () => {
    const { service } = harness({ vpnSeen: true, network: null })
    expect(await service.check('case-a')).toEqual({ caseId: 'case-a', warn: false, canMute: false })
  })

  it('does not warn, or read the route, while the Egress is a Proxy or Tor', async () => {
    const { state, deps, service } = harness()
    for (const kind of ['proxy', 'tor'] as const) {
      state.egress = kind
      expect(await service.check('case-a')).toMatchObject({ warn: false })
    }
    expect(deps.detect).not.toHaveBeenCalled()
  })

  it('reports whether a VPN is seen, sharing one read between callers', async () => {
    const { deps, service } = harness({ vpnSeen: true, network: null })
    const [status, check] = await Promise.all([service.status(), service.check('case-a')])
    expect(status).toEqual({ vpnSeen: true })
    expect(check).toMatchObject({ warn: false })
    expect(deps.detect).toHaveBeenCalledTimes(1)
    await service.status()
    expect(deps.detect).toHaveBeenCalledTimes(2)
  })
})

describe('the VPN warning on the installed settings', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'birdbrain-vpn-warning-'))
    initSettings(dir)
    detectNetwork.mockResolvedValue({ vpnSeen: false, network: HOME })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the muted network in settings, once, as its hash alone', async () => {
    const service = createVpnWarningService()
    // Two warnings open on one network, both answered with the mute.
    await service.check('case-a')
    await service.check('case-b')
    service.answer('case-a', 'mute-network')
    service.answer('case-b', 'mute-network')
    expect(getSettings().vpnWarningMutedNetworks).toEqual([networkHash(HOME)])
    expect(await service.check('case-c')).toMatchObject({ warn: false })
  })

  it('reads the Egress from settings', async () => {
    updateSettings({ egress: { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9150', label: '' } })
    const service = createVpnWarningService()
    expect(await service.check('case-a')).toMatchObject({ warn: false })
  })
})
