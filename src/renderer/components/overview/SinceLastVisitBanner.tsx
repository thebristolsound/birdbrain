import { Sparkles, ArrowRight, Camera, Globe, Target, FileText } from 'lucide-react'
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

const ITEMS: { key: keyof SinceDeltas; label: string; icon: LucideIcon; tone: string }[] = [
  { key: 'captures', label: 'new captures', icon: Camera, tone: '#38bdf8' },
  { key: 'sources', label: 'new sources', icon: Globe, tone: '#2dd4bf' },
  { key: 'selectors', label: 'new selectors', icon: Target, tone: '#a78bfa' },
  { key: 'notes', label: 'notes added', icon: FileText, tone: '#fbbf24' }
]

export function SinceLastVisitBanner({
  deltas,
  lastVisitAt,
  newCount,
  onReview
}: SinceLastVisitBannerProps) {
  return (
    <div className="neu-card glow-indigo relative overflow-hidden rounded-2xl p-5">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 12% -40%, color-mix(in srgb, var(--color-accent) 22%, transparent), transparent 60%)'
        }}
      />
      <div className="relative">
        <div className="mb-3 flex items-center gap-2.5">
          <Sparkles size={14} strokeWidth={1.8} className="text-accent" />
          <span className="font-display text-[13.5px] font-bold text-text-primary">
            Since your last visit
          </span>
          <span className="font-mono text-[11px] text-text-faint">
            · {formatRelativeTime(lastVisitAt)}
          </span>
          <span className="flex-1" />
          <button
            onClick={onReview}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3 font-display text-xs font-semibold text-text-secondary hover:bg-elevated"
          >
            Review {newCount} new
            <ArrowRight size={13} strokeWidth={1.8} />
          </button>
        </div>
        <div className="flex gap-4">
          {ITEMS.map(({ key, label, icon: Icon, tone }) => (
            <div
              key={key}
              className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-elevated px-3 py-2.5"
            >
              <span
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
                style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)` }}
              >
                <Icon size={15} strokeWidth={1.8} style={{ color: tone }} />
              </span>
              <div className="min-w-0">
                <div className="font-display text-[17px] font-extrabold leading-none text-text-primary">
                  +{deltas[key]}
                </div>
                <div className="mt-1 whitespace-nowrap font-body text-[11px] text-text-muted">
                  {label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
