import { useQuery } from '@tanstack/react-query'
import {
  Layers,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestionMark,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { vpnStatusQueryOptions } from '@renderer/lib/api/egress'
import { cn } from '@renderer/lib/utils'
import type { EgressSetting } from '@shared/types'

// The Egress and, while it is Direct, whether a VPN is seen on this computer's route
// (ADR-0032 rule 2). The check cannot see a VPN on the router, so the indicator says a VPN
// was not seen, never that there is none. The switch has no default, so a new Egress kind
// fails the typecheck here rather than reading as Direct.
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

// Below 2xl the words fold away, so each Egress, and each VPN state while Direct, keeps an
// icon of its own there. A new Egress kind fails the typecheck here until it has one.
const ICONS: Record<EgressSetting['kind'] | 'vpnSeen' | 'vpnNotSeen', LucideIcon> = {
  direct: Shield,
  vpnSeen: ShieldCheck,
  vpnNotSeen: ShieldAlert,
  proxy: Waypoints,
  tor: Layers,
  unavailable: ShieldQuestionMark
}

export function EgressIndicator() {
  const { data: settings } = useQuery(settingsQueryOptions)
  const egress = settings?.egress
  const direct = egress?.kind === 'direct'
  const { data: status } = useQuery({ ...vpnStatusQueryOptions, enabled: direct })
  if (!egress) return null

  const vpnSeen = direct ? status?.vpnSeen : undefined
  const warning = vpnSeen === false || egress.kind === 'unavailable'
  const text = egressIndicatorText(egress, vpnSeen)
  const Icon = ICONS[vpnSeen === undefined ? egress.kind : vpnSeen ? 'vpnSeen' : 'vpnNotSeen']

  return (
    <div
      data-testid="egress-indicator"
      title={`Egress: ${text}`}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1',
        warning
          ? 'border-warning-line bg-warning-surface text-warning-fg'
          : 'border-border text-text-muted'
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {/* Shown below 2xl, the words move the case search off centre at 1400px
          (e2e/topbar-layout.spec.ts). From 2xl a warning or a label still can, so the cap keeps
          a long label from pushing the controls off the window; the title keeps the full text.
          not-sr-only resets overflow and white-space, so truncate has to come with it. */}
      <span className="sr-only text-[11px] font-medium 2xl:not-sr-only 2xl:max-w-44 2xl:truncate">
        {text}
      </span>
    </div>
  )
}
