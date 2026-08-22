import { useEffect, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Camera, ChevronDown, X } from 'lucide-react'
import type { AutoCaptureExclusionMode } from '@shared/types'
import { validateIgnorePattern } from '@shared/urlPatterns'
import { settingsQueryOptions, useSettingsMutations } from '@renderer/lib/api/settings'
import {
  caseAutoCapturePolicyQueryOptions,
  useCaseAutoCapturePolicyMutation
} from '@renderer/lib/api/cases'
import {
  AUTO_CAPTURE_DESCRIPTION,
  AUTO_CAPTURE_SUSPENDED,
  exclusionFooter,
  exclusionSummary
} from '@renderer/components/signals/signalsModel'

interface AutoCaptureCardProps {
  caseId: string
}

const MODES: Array<{ mode: AutoCaptureExclusionMode; label: string; title: string }> = [
  {
    mode: 'stack',
    label: 'Stack on global',
    title: 'Case exclusions apply in addition to the global ignore list'
  },
  {
    mode: 'override',
    label: 'Override global',
    title: "Only this case's exclusions apply — the global ignore list is bypassed for this case"
  }
]

// The Auto-capture card, and the per-case exclusion list inside it (#400).
//
// Two things sit here that are easy to confuse, so the copy separates them: the
// switch writes a single app-wide setting, and the exclusion list belongs to
// this case alone.
export function AutoCaptureCard({ caseId }: AutoCaptureCardProps) {
  const { data: settings } = useQuery(settingsQueryOptions)
  const { data: policy } = useQuery(caseAutoCapturePolicyQueryOptions(caseId))
  const { update: updateSettings } = useSettingsMutations()
  const savePolicy = useCaseAutoCapturePolicyMutation(caseId)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const exclusions = policy?.exclusions ?? []
  const mode = policy?.mode ?? 'stack'
  const autoCaptureMode = settings?.autoCaptureMode ?? 'notify'
  // 'auto' captures every page, not only selector matches. A two-state switch
  // cannot say that, so it reads on and refuses to move rather than quietly
  // rewriting the operator's capture policy to something narrower.
  const modeIsAuto = autoCaptureMode === 'auto'
  const switchOn = autoCaptureMode !== 'notify'

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
    <section className="rounded-md border border-border bg-card p-[var(--d-card)]">
      <div className="flex items-center gap-3">
        <Camera
          className={`h-4 w-4 shrink-0 ${switchOn ? 'text-accent' : 'text-text-faint'}`}
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-text-primary">Auto-capture</div>
          <div className="mt-px text-[10px] text-text-muted" data-testid="auto-capture-description">
            {AUTO_CAPTURE_DESCRIPTION}
          </div>
        </div>

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

        <button
          type="button"
          role="switch"
          aria-checked={switchOn}
          aria-label="Auto-capture"
          disabled={modeIsAuto}
          data-testid="auto-capture-switch"
          onClick={() =>
            updateSettings.mutate({ autoCaptureMode: switchOn ? 'notify' : 'per-case' })
          }
          className={[
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            switchOn ? 'bg-accent' : 'bg-text-faint',
            modeIsAuto ? 'cursor-not-allowed opacity-60' : ''
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
              switchOn ? 'translate-x-[18px]' : 'translate-x-[2px]'
            ].join(' ')}
          />
        </button>
      </div>

      <p className="mt-2 text-[10px] text-text-faint" data-testid="auto-capture-suspended">
        {AUTO_CAPTURE_SUSPENDED}
      </p>

      {modeIsAuto && (
        <p className="mt-2 text-[10px] text-text-faint" data-testid="auto-capture-locked">
          Auto-capture is set to capture every page, not only selector matches. A two-state switch
          cannot represent that, so it is locked here.
        </p>
      )}

      {open && (
        <div className="mt-3 border-t border-border pt-3">
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
                  title={entry.title}
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
            <p className="mt-1.5 text-[10px] text-red-400" data-testid="exclusion-error">
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
