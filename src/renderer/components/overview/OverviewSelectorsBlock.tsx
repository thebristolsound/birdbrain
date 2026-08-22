import type { Selector } from '@shared/types'

interface OverviewSelectorsBlockProps {
  selectors: Selector[]
  /** Match totals keyed by selector id. */
  matchCounts: Record<string, number>
  onToggle: (selector: Selector, enabled: boolean) => void
}

/**
 * Every selector in the case with its match total, and a switch that enables or
 * disables it in place. Uncapped on purpose: this is the case's whole selector
 * set, so a cap here would misreport what is running.
 */
export function OverviewSelectorsBlock({
  selectors,
  matchCounts,
  onToggle
}: OverviewSelectorsBlockProps) {
  if (selectors.length === 0) {
    return <p className="font-body text-xs text-text-faint">No selectors defined yet.</p>
  }
  return (
    <div data-testid="overview-selectors-block" className="flex flex-col">
      {selectors.map((selector, i) => {
        const count = matchCounts[selector.id] ?? 0
        const { enabled } = selector
        return (
          <div
            key={selector.id}
            data-testid="overview-selector-row"
            className={`flex items-center gap-2.5 py-2 ${i === 0 ? '' : 'border-t border-border'}`}
          >
            <button
              role="switch"
              aria-checked={enabled}
              aria-label={`${enabled ? 'Disable' : 'Enable'} ${selector.label || selector.pattern}`}
              onClick={() => onToggle(selector, !enabled)}
              className={`relative inline-flex h-4 w-[30px] shrink-0 items-center rounded-full transition-colors ${
                enabled ? 'bg-accent' : 'bg-text-faint'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
            <div className={`min-w-0 flex-1 ${enabled ? '' : 'opacity-40'}`}>
              <div className="truncate font-body text-xs font-medium text-text-primary">
                {selector.label || selector.pattern}
              </div>
              <div className="mt-px truncate font-mono text-[10px] text-text-faint">
                {selector.pattern}
              </div>
            </div>
            <span
              className={`shrink-0 text-right font-mono text-xs ${
                count > 0 ? 'text-accent' : 'text-text-faint'
              }`}
            >
              {count}
            </span>
          </div>
        )
      })}
    </div>
  )
}
