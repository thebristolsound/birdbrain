import type { ReactNode } from 'react'
import { TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  COPY,
  egressIsNotDirect,
  egressLabel,
  networkNoticeBody
} from '@renderer/components/sharing/memberModel'

// The warning frame the Members tab draws twice (#1514): the network notice
// and the relay-unreachable banner. Warning tint, never danger: nothing is
// broken, the operator is being told what the transport exposes.

interface WarnBannerProps {
  icon: LucideIcon
  title: string
  children?: ReactNode
  className?: string
  'data-testid'?: string
}

export function WarnBanner({
  icon: Icon,
  title,
  children,
  className,
  'data-testid': testId
}: WarnBannerProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex gap-2.5 rounded border border-warning-line bg-warning-surface px-3 py-2.5',
        className
      )}
    >
      <Icon size={14} className="mt-px shrink-0 text-warning-fg" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-text-primary">{title}</div>
        {children}
      </div>
    </div>
  )
}

// Shown whenever the Egress setting is not Direct (ruling 1 of 2026-10-10),
// 'unavailable' included: an unreadable Egress fails closed. No dismiss
// control, by design: the exposure does not go away.
export function NetworkNotice({ egress }: { egress: string | undefined }) {
  if (!egressIsNotDirect(egress)) return null
  return (
    <WarnBanner icon={TriangleAlert} title={COPY.networkNoticeTitle} data-testid="network-notice">
      <p className="mt-[3px] text-[11px] leading-[1.55] text-text-secondary">
        {networkNoticeBody(egressLabel(egress as string))}
      </p>
    </WarnBanner>
  )
}
