import type { Selector } from '@shared/types'

interface OverviewSelectorsBlockProps {
  selectors: Selector[]
  /** Captures matched, keyed by selector id. */
  matchCounts: Record<string, number>
}

/**
 * Every selector in the case with the number of Captures it matches. Uncapped
 * on purpose: this is the case's whole selector set, so a cap here would
 * misreport what is running. Signals adds and edits them.
 */
export function OverviewSelectorsBlock({ selectors, matchCounts }: OverviewSelectorsBlockProps) {
  return (
    <div data-testid="overview-selectors-block">
      {selectors.length === 0 ? (
        <p className="font-body text-xs text-text-faint">No selectors defined yet.</p>
      ) : (
        <div className="flex flex-col">
          {selectors.map((selector) => {
            const count = matchCounts[selector.id] ?? 0
            return (
              <div
                key={selector.id}
                data-testid="overview-selector-row"
                className="flex items-center gap-2.5 border-t border-border py-2 first:border-t-0 first:pt-0 last:pb-0"
              >
                <span
                  className={`min-w-0 flex-1 truncate font-body text-xs font-medium text-text-primary ${
                    selector.enabled ? '' : 'opacity-40'
                  }`}
                >
                  {selector.label || selector.pattern}
                </span>
                <span className="shrink-0 font-body text-[11px] text-text-muted">
                  {count} {count === 1 ? 'Capture' : 'Captures'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
