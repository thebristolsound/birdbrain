import { useState, type FormEvent } from 'react'
import type { Selector } from '@shared/types'
import { regexPatternError } from '@shared/selectorPattern'
import { useSelectorsMutations } from '@renderer/lib/queries'
import { notify } from '@renderer/lib/notify'
import {
  findDuplicateSelector,
  parseSelectorInput
} from '@renderer/components/signals/signalsModel'

interface OverviewSelectorsBlockProps {
  caseId: string
  selectors: Selector[]
  /** Match totals keyed by selector id. */
  matchCounts: Record<string, number>
  onToggle: (selector: Selector, enabled: boolean) => void
}

/**
 * A one-line selector add, then every selector in the case with its match total
 * and a switch that enables or disables it in place. Uncapped on purpose: this
 * is the case's whole selector set, so a cap here would misreport what is
 * running. The add takes exact text, or `/pattern/` for a regex, and refuses
 * what the Signals add row refuses.
 */
export function OverviewSelectorsBlock({
  caseId,
  selectors,
  matchCounts,
  onToggle
}: OverviewSelectorsBlockProps) {
  const { create } = useSelectorsMutations(caseId)
  const [value, setValue] = useState('')
  const [regexError, setRegexError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseSelectorInput(value, false)
    if (!parsed || create.isPending) return
    const { pattern, isRegex } = parsed
    // An invalid regex would be saved and then match nothing (#1754).
    const invalid = isRegex ? regexPatternError(pattern) : null
    if (invalid) {
      setRegexError(invalid)
      return
    }
    // A second selector on one pattern doubles every count downstream (#1549).
    if (findDuplicateSelector(selectors, pattern, isRegex)) {
      notify.info(`‘${pattern}’ is already a selector in this case`)
      return
    }
    try {
      // 'manual' (#395): typed in by the operator, with no capture behind it.
      await create.mutateAsync({ caseId, pattern, isRegex, origin: 'manual' })
      setValue('')
    } catch {
      // Preserve the pattern on failure so the user can retry
    }
  }

  return (
    <div data-testid="overview-selectors-block">
      <form onSubmit={handleSubmit}>
        <input
          data-testid="overview-selector-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setRegexError(null)
          }}
          placeholder="Add a selector, or /pattern/ for a regex…"
          aria-label="Add a selector"
          aria-invalid={regexError ? true : undefined}
          aria-describedby={regexError ? 'overview-selector-error' : undefined}
          className="w-full rounded-md border border-input bg-canvas px-2.5 py-[7px] font-mono text-xs text-text-primary outline-none placeholder:font-body placeholder:text-text-faint focus:border-accent"
        />
      </form>
      {regexError ? (
        <p
          id="overview-selector-error"
          role="alert"
          className="mt-1.5 font-body text-[11px] text-danger-fg"
        >
          Not a valid regular expression: {regexError}
        </p>
      ) : null}
      {selectors.length === 0 ? (
        <p className="mt-2.5 font-body text-xs text-text-faint">No selectors defined yet.</p>
      ) : (
        <div className="mt-1 flex flex-col">
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
      )}
    </div>
  )
}
