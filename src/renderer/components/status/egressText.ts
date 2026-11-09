import {
  Layers,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestionMark,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import type { EgressSetting } from '@shared/types'

// The Egress and, while it is Direct, whether a VPN is seen on this computer's route
// (ADR-0032 rule 2). The check cannot see a VPN on the router, so the text says a VPN was not
// seen, never that there is none. The switch has no default, so a new Egress kind fails the
// typecheck here rather than reading as Direct.
export function egressIndicatorText(egress: EgressSetting, vpnSeen: boolean | undefined): string {
  switch (egress.kind) {
    case 'direct':
      if (vpnSeen === undefined) return 'Direct'
      return vpnSeen ? 'Direct · VPN seen' : 'Direct · VPN not seen'
    case 'proxy':
      return egress.label ? `Proxy: ${egress.label}` : 'Proxy'
    case 'tor':
      return egress.label ? `Tor: ${egress.label}` : 'Tor'
    case 'unavailable':
      // The saved Egress could not be read, so nothing goes out until one is chosen (#1695).
      return 'Egress unknown · nothing sent'
  }
}

// Each Egress, and each VPN state while Direct, keeps an icon of its own: the status group shows
// it when the Egress is the worst signal, so the state reads without colour. A new Egress kind
// fails the typecheck here until it has one.
const ICONS: Record<EgressSetting['kind'] | 'vpnSeen' | 'vpnNotSeen', LucideIcon> = {
  direct: Shield,
  vpnSeen: ShieldCheck,
  vpnNotSeen: ShieldAlert,
  proxy: Waypoints,
  tor: Layers,
  unavailable: ShieldQuestionMark
}

export function egressIcon(egress: EgressSetting, vpnSeen: boolean | undefined): LucideIcon {
  return ICONS[vpnSeen === undefined ? egress.kind : vpnSeen ? 'vpnSeen' : 'vpnNotSeen']
}
