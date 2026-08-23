import { Camera, Globe, Target, Tags, FileText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type MetricKey = 'captures' | 'sources' | 'selectors' | 'tags' | 'notes'

interface MetricRowProps {
  captures: number
  sources: number
  selectors: number
  tags: number
  notes: number
  deltas?: Partial<Record<MetricKey, number>>
}

const DEFS: { key: MetricKey; label: string; icon: LucideIcon }[] = [
  { key: 'captures', label: 'Captures', icon: Camera },
  { key: 'sources', label: 'Sources', icon: Globe },
  { key: 'selectors', label: 'Selectors', icon: Target },
  { key: 'tags', label: 'Tags', icon: Tags },
  { key: 'notes', label: 'Notes', icon: FileText }
]

export function MetricRow({ captures, sources, selectors, tags, notes, deltas = {} }: MetricRowProps) {
  const values: Record<MetricKey, number> = { captures, sources, selectors, tags, notes }
  return (
    <div className="flex gap-[var(--d-gap)]">
      {DEFS.map(({ key, label, icon: Icon }) => {
        const delta = deltas[key]
        return (
          <div
            key={key}
            className="neu-card flex flex-1 flex-col gap-2.5 rounded-2xl p-[var(--d-cardsm)]"
          >
            <div className="flex items-center gap-1.5">
              <Icon size={13} strokeWidth={1.8} className="text-text-faint" />
              <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                {label}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span
                data-testid={`overview-metric-${key}`}
                className="font-display text-[length:var(--d-metric)] font-extrabold leading-none tracking-tight text-text-primary"
              >
                {values[key]}
              </span>
              {delta ? <span className="font-mono text-[11px] text-emerald-400">+{delta}</span> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
