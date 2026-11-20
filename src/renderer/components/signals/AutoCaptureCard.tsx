import { useEffect, useState, type KeyboardEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { AutoCaptureExclusionMode } from '@shared/types'
import { validateIgnorePattern } from '@shared/urlPatterns'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import {
  caseAutoCapturePolicyQueryOptions,
  useCaseAutoCapturePolicyMutation
} from '@renderer/lib/api/cases'
import { exclusionFooter, exclusionSummary } from '@renderer/components/signals/signalsModel'

interface AutoCaptureCardProps {
  caseId: string
}

const MODES: Array<{ mode: AutoCaptureExclusionMode; label: string }> = [
  { mode: 'stack', label: 'Stack on global' },
  { mode: 'override', label: 'Override global' }
]

// The per-case exclusion list (#400), collapsed to one row. The app-wide switch
// is in Settings, which the row links to.
export function AutoCaptureCard({ caseId }: AutoCaptureCardProps) {
  const navigate = useNavigate()
  const { data: settings } = useQuery(settingsQueryOptions)
  const { data: policy } = useQuery(caseAutoCapturePolicyQueryOptions(caseId))
  const savePolicy = useCaseAutoCapturePolicyMutation(caseId)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const exclusions = policy?.exclusions ?? []
  const mode = policy?.mode ?? 'stack'

  useEffect(() => {
    setError(null)
  }, [mode])

  function writePolicy(next: { exclusions?: string[]; mode?: AutoCaptureExclusionMode }) {
    savePolicy.mutate({
      caseId,
      exclusions: next.exclusions ?? exclusions,
      mode: next.mode ?? mode
    })
  }

  function addExclusion(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const pattern = draft.trim()
    if (!pattern) return
    if (exclusions.includes(pattern)) {
      setError('That pattern is already excluded for this case.')
      return
    }
    // Refused here as well as at the IPC seam. The main process is what makes
    // it true, but an operator typing a bad regex should be told before the
    // chip appears, not after a round trip that leaves it looking accepted.
    const validation = validateIgnorePattern(pattern)
    if (!validation.ok) {
      setError(validation.reason)
      return
    }
    setError(null)
    setDraft('')
    writePolicy({ exclusions: [...exclusions, pattern] })
  }

  return (
    <section className="rounded-md border border-border bg-card px-[var(--d-card)] py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          data-testid="exclusions-summary"
          className="inline-flex shrink-0 items-center gap-1.5 border-none bg-transparent p-0 text-[11px] text-text-muted hover:text-accent"
        >
          {exclusionSummary(exclusions.length, mode)}
          <ChevronDown
            className={`h-[11px] w-[11px] transition-transform ${open ? 'rotate-180' : ''}`}
            strokeWidth={2}
          />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => navigate({ to: '/settings' })}
          data-testid="exclusions-settings-link"
          className="inline-flex shrink-0 items-center gap-1 border-none bg-transparent p-0 text-[11px] text-text-muted hover:text-accent"
        >
          Capture settings
          <ChevronRight className="h-[11px] w-[11px]" strokeWidth={2} />
        </button>
      </div>

      {open && (
        <div className="mt-2.5 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[.05em] text-text-faint">
              Never capture in this case
            </span>
            <span className="flex-1" />
            <div
              role="radiogroup"
              aria-label="Exclusion mode"
              className="inline-flex overflow-hidden rounded border border-border-strong"
            >
              {MODES.map((entry, index) => (
                <button
                  key={entry.mode}
                  type="button"
                  role="radio"
                  aria-checked={mode === entry.mode}
                  onClick={() => writePolicy({ mode: entry.mode })}
                  className={[
                    'h-[22px] px-[9px] text-[11px] font-medium transition-colors',
                    index > 0 ? 'border-l border-border-strong' : '',
                    mode === entry.mode
                      ? 'bg-accent-subtle text-accent'
                      : 'bg-transparent text-text-muted'
                  ].join(' ')}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-[5px]">
            {exclusions.map((pattern) => (
              <span
                key={pattern}
                data-testid="exclusion-chip"
                className="inline-flex items-center gap-[5px] rounded-full border border-border-strong bg-surface py-0.5 pl-[9px] pr-1 font-mono text-[11px] text-text-secondary"
              >
                {pattern}
                <button
                  type="button"
                  aria-label={`Remove exclusion ${pattern}`}
                  onClick={() =>
                    writePolicy({ exclusions: exclusions.filter((p) => p !== pattern) })
                  }
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-faint hover:text-text-primary"
                >
                  <X className="h-[9px] w-[9px]" strokeWidth={2.4} />
                </button>
              </span>
            ))}
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={addExclusion}
              placeholder="domain or /pattern/ — Enter to add"
              aria-label="Add exclusion"
              data-testid="exclusion-input"
              className="min-w-[180px] flex-1 border-none bg-transparent px-1 py-[3px] font-mono text-[11px] text-text-primary outline-none"
            />
          </div>

          {error && (
            <p className="mt-1.5 text-[10px] text-danger-fg" data-testid="exclusion-error">
              {error}
            </p>
          )}

          <p className="mt-[7px] text-[10px] text-text-faint" data-testid="exclusion-footer">
            {exclusionFooter(mode, settings?.ignoredUrlPatterns.length ?? 0)}
          </p>
        </div>
      )}
    </section>
  )
}
