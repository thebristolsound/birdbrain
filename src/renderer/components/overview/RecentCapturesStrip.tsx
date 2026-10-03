import { ShieldCheck, ShieldAlert } from 'lucide-react'
import type { Capture } from '@shared/types'
import { useCaptureThumbnail } from '@renderer/hooks/useCaptureThumbnail'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'

interface RecentCapturesStripProps {
  captures: Capture[]
  lastVisitAt: string | null
  onOpen: (captureId: string) => void
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function isTampered(status?: Capture['lastVerifiedStatus']): boolean {
  return status === 'tampered' || status === 'chain-broken' || status === 'missing'
}

function RecentCaptureCard({
  capture,
  isNew,
  onOpen
}: {
  capture: Capture
  isNew: boolean
  onOpen: (id: string) => void
}) {
  const { thumbnail } = useCaptureThumbnail(capture.id)
  const verified = capture.lastVerifiedStatus === 'verified'
  const tampered = isTampered(capture.lastVerifiedStatus)
  const ShieldIcon = verified ? ShieldCheck : ShieldAlert
  const shieldLabel = verified ? 'Verified' : tampered ? 'Verification failed' : 'Not yet verified'
  const shieldColor = verified ? 'text-emerald-400' : tampered ? 'text-red-400' : 'text-amber-400'

  return (
    <button
      onClick={() => onOpen(capture.id)}
      data-testid="overview-recent-item"
      className="w-[172px] shrink-0 text-left"
    >
      <div className="relative aspect-[172/107] w-full overflow-hidden rounded-md border border-border-strong bg-elevated">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-accent-subtle to-elevated" />
        )}
        <span className="absolute right-1.5 top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/40">
          <ShieldIcon
            size={11}
            strokeWidth={2}
            className={shieldColor}
            aria-label={shieldLabel}
            role="img"
          />
        </span>
        {isNew ? (
          <span className="absolute left-1.5 top-1.5 rounded-full border border-sky-400/40 bg-sky-400/15 px-1.5 py-px font-display text-[10px] font-bold tracking-wide text-sky-400">
            NEW
          </span>
        ) : null}
      </div>
      <div className="mt-2">
        <div className="line-clamp-2 font-display text-[11px] font-semibold leading-snug text-text-primary">
          {capture.title || hostOf(capture.url)}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {capture.exhibitCitation ? (
            <span
              data-testid="overview-recent-citation"
              className="shrink-0 rounded border border-border-strong px-1 font-mono text-[10px] leading-4 text-text-secondary"
            >
              {capture.exhibitCitation}
            </span>
          ) : null}
          <span className="truncate font-body text-[10px] text-text-muted">
            {hostOf(capture.url)}
          </span>
          <span className="shrink-0 font-body text-[10px] text-text-faint">
            · {formatRelativeTime(capture.createdAt)}
          </span>
        </div>
      </div>
    </button>
  )
}

export function RecentCapturesStrip({ captures, lastVisitAt, onOpen }: RecentCapturesStripProps) {
  if (captures.length === 0) {
    return <p className="font-body text-xs text-text-faint">No captures yet.</p>
  }
  return (
    <div
      className="flex gap-[var(--d-gap)] overflow-x-auto pb-1"
      data-testid="overview-recent-captures"
    >
      {captures.map((cap) => (
        <RecentCaptureCard
          key={cap.id}
          capture={cap}
          isNew={lastVisitAt != null && cap.createdAt > lastVisitAt}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
