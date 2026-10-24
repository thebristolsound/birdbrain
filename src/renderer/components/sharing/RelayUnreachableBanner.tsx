import { WifiOff } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { WarnBanner } from '@renderer/components/sharing/NetworkNotice'
import {
  COPY,
  relayUnreachableBody,
  relayUnreachableTitle
} from '@renderer/components/sharing/memberModel'

interface RelayUnreachableBannerProps {
  since: string
  nowMs: number
  // Member Codes: who is reached directly and who waits on the relay.
  connected: string[]
  unreachable: string[]
  retrying: boolean
  onRetry: () => void
  onChangeRelay: () => void
}

// Shown after a command came back 'relay-unreachable' (#1514, mock 1b). No
// field reports relay status, so the banner holds the time of that refusal
// and clears when a later command resolves or a later round succeeds.
export function RelayUnreachableBanner({
  since,
  nowMs,
  connected,
  unreachable,
  retrying,
  onRetry,
  onChangeRelay
}: RelayUnreachableBannerProps) {
  return (
    <WarnBanner
      icon={WifiOff}
      title={relayUnreachableTitle(since, nowMs)}
      data-testid="relay-unreachable-banner"
    >
      <p className="mt-[3px] text-[11px] leading-[1.55] text-text-secondary">
        {relayUnreachableBody(connected, unreachable)}
      </p>
      <div className="mt-2 flex gap-1.5">
        <Button
          variant="outline"
          size="xs"
          className="h-6 border-border bg-card px-2 text-[11px] text-text-secondary"
          disabled={retrying}
          onClick={onRetry}
        >
          {COPY.retry}
        </Button>
        <Button variant="ghost" size="xs" className="h-6 px-2 text-[11px]" onClick={onChangeRelay}>
          {COPY.changeRelay}
        </Button>
      </div>
    </WarnBanner>
  )
}
