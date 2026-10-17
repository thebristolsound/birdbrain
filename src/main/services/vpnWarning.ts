import { createHash } from 'crypto'
import { currentEgress } from '@main/services/egress'
import { getSettings, updateSettings } from '@main/services/settings'
import {
  detectNetwork,
  type NetworkIdentity,
  type NetworkReading
} from '@main/services/vpnDetection'
import type { VpnStatus, VpnWarningCheck, VpnWarningChoice } from '@shared/ipc'
import type { EgressSetting } from '@shared/types'

// ADR-0032 rule 2: while the Egress is Direct and a VPN is not seen, the first contact with a
// site in each Case warns, and "stop warning on this network" ends that for the network. The
// warned Cases are held for this run only; the muted networks are kept in settings. Nothing
// here reaches a Manifest Entry or a capture row (rule 4).

/** "This network": a hash of its name and the router's hardware address. */
export function networkHash({ name, routerMac }: NetworkIdentity): string {
  return createHash('sha256')
    .update(JSON.stringify([name, routerMac]))
    .digest('hex')
}

export interface VpnWarningDeps {
  detect: () => Promise<NetworkReading>
  egressKind: () => EgressSetting['kind']
  mutedNetworks: () => string[]
  muteNetwork: (hash: string) => void
}

const settingsDeps: VpnWarningDeps = {
  detect: () => detectNetwork(),
  egressKind: () => currentEgress().kind,
  mutedNetworks: () => getSettings().vpnWarningMutedNetworks,
  muteNetwork: (hash) => {
    const muted = getSettings().vpnWarningMutedNetworks
    if (!muted.includes(hash)) updateSettings({ vpnWarningMutedNetworks: [...muted, hash] })
  }
}

export interface VpnWarningService {
  status(): Promise<VpnStatus>
  check(caseId: string): Promise<VpnWarningCheck>
  answer(caseId: string, choice: VpnWarningChoice): void
}

export function createVpnWarningService(deps: VpnWarningDeps = settingsDeps): VpnWarningService {
  const warned = new Set<string>()
  // The network each open warning was raised on, so the mute applies to the network the
  // Operator was warned about.
  const raisedOn = new Map<string, string | null>()
  // One read at a time: the indicator's poll and a warning check share it.
  let reading: Promise<NetworkReading> | null = null

  function read(): Promise<NetworkReading> {
    reading ??= deps.detect().finally(() => {
      reading = null
    })
    return reading
  }

  return {
    async status() {
      const { vpnSeen } = await read()
      return { vpnSeen }
    },

    async check(caseId) {
      const quiet = { caseId, warn: false, canMute: false }
      if (deps.egressKind() !== 'direct' || warned.has(caseId)) return quiet
      const { vpnSeen, network } = await read()
      if (vpnSeen) return quiet
      const hash = network ? networkHash(network) : null
      if (hash && deps.mutedNetworks().includes(hash)) return quiet
      raisedOn.set(caseId, hash)
      return { caseId, warn: true, canMute: hash !== null }
    },

    answer(caseId, choice) {
      warned.add(caseId)
      const hash = raisedOn.get(caseId)
      raisedOn.delete(caseId)
      if (choice === 'mute-network' && hash) deps.muteNetwork(hash)
    }
  }
}
