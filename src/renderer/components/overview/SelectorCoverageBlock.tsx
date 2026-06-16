import { Regex, Type } from 'lucide-react'

interface SelectorRow {
  id: string
  label?: string
  pattern: string
  isRegex: boolean
  matchCount: number
}

interface SelectorCoverageBlockProps {
  selectors: SelectorRow[]
  totalCaptures: number
}

export function SelectorCoverageBlock({ selectors, totalCaptures }: SelectorCoverageBlockProps) {
  if (selectors.length === 0) {
    return <p className="font-body text-xs text-text-faint">No selectors defined yet.</p>
  }
  return (
    <div className="flex flex-col">
      {selectors.map((s, i) => {
        const Icon = s.isRegex ? Regex : Type
        const primary = s.label || s.pattern
        const secondary = s.label ? s.pattern : s.isRegex ? 'Regex' : 'Text'
        const pct = totalCaptures > 0 ? Math.round((s.matchCount / totalCaptures) * 100) : 0
        return (
          <div
            key={s.id}
            className={`flex items-center gap-2.5 py-2.5 ${i === 0 ? '' : 'border-t border-border'}`}
          >
            <Icon size={13} strokeWidth={1.8} className="shrink-0 text-text-faint" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs text-text-secondary">{primary}</div>
              <div className="mt-0.5 truncate font-body text-[10px] text-text-faint">{secondary}</div>
            </div>
            <div className="w-24 shrink-0">
              <div className="h-[5px] overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-right font-mono text-[9.5px] text-text-faint">{pct}%</div>
            </div>
            <span className="w-7 shrink-0 text-right font-mono text-xs text-accent">{s.matchCount}</span>
          </div>
        )
      })}
    </div>
  )
}
