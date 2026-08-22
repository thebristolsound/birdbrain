import { Sparkles, ChevronRight, Camera, Globe, Target, FileText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'

interface SinceDeltas {
  captures: number
  sources: number
  selectors: number
  notes: number
}

interface SinceLastVisitBannerProps {
  deltas: SinceDeltas
  lastVisitAt: string
  newCount: number
  onReview: () => void
}

// Monochrome by design: the four tiles are one fact split four ways, not four
// categories to tell apart, so the colour that used to distinguish them is
// spent on nothing (2026-08-21 consolidated Overview).
const ITEMS: { key: keyof SinceDeltas; label: string; icon: LucideIcon }[] = [
  { key: 'captures', label: 'new captures', icon: Camera },
  { key: 'sources', label: 'new sources', icon: Globe },
  { key: 'selectors', label: 'new selectors', icon: Target },
  { key: 'notes', label: 'notes added', icon: FileText }
]

export function SinceLastVisitBanner({
  deltas,
  lastVisitAt,
  newCount,
  onReview
}: SinceLastVisitBannerProps) {
  return (
    <div
      data-testid="overview-since-last-visit"
      className="shrink-0 rounded-[var(--d-r)] border border-border bg-card p-[var(--d-card)]"
    >
      <div className="mb-2.5 flex items-center gap-[7px]">
        <Sparkles size={13} strokeWidth={1.8} className="shrink-0 text-text-faint" />
        <span className="shrink-0 font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-text-faint">
          Since your last visit
        </span>
        <span className="min-w-0 truncate font-mono text-[10px] text-text-faint">
          · {formatRelativeTime(lastVisitAt)}
        </span>
        <span className="flex-1" />
        <button
          onClick={onReview}
          className="inline-flex shrink-0 items-center gap-1 font-display text-[11px] font-semibold text-text-muted hover:text-text-secondary"
        >
          Review {newCount}
          <ChevronRight size={12} strokeWidth={1.8} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {ITEMS.map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            className="flex min-w-0 items-center gap-2.5 rounded-md border border-border bg-elevated px-2.5 py-2.5"
          >
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-surface">
              <Icon size={14} strokeWidth={1.8} className="text-text-secondary" />
            </span>
            <div className="min-w-0">
              <div className="font-display text-sm font-extrabold leading-none text-text-primary">
                +{deltas[key]}
              </div>
              <div className="mt-[3px] truncate font-body text-[11px] text-text-muted">{label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
