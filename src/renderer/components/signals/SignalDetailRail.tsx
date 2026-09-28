import { useEffect, useId, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Crosshair } from 'lucide-react'
import type { Capture } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'
import { exportSelectorMatches } from '@renderer/lib/api/selectors'
import { useForegroundMatchPreview } from '@renderer/components/selectors/useForegroundMatchPreview'
import { ORIGIN_ICON, ORIGIN_LABEL } from '@renderer/components/selectors/selectorOrigin'
import { useTagsMutations } from '@renderer/lib/api/tags'
import {
  useSelectorRescan,
  type SelectorRescanStatus
} from '@renderer/components/signals/useSelectorRescan'
import {
  signalCountLabel,
  TAG_PALETTE_LABELS,
  type Signal
} from '@renderer/components/signals/signalsModel'

interface SignalDetailRailProps {
  caseId: string
  signal: Signal | null
  /** The recent captures the coverage window is drawn from, newest first. */
  captures: Capture[]
  totalCaptures: number
  onToggleEnabled: (signal: Signal) => void
  /**
   * Start a tag merge with this tag as the source. The dialog lives on the
   * Signals screen, which reaches it from a row's context menu too (#701).
   */
  onMerge: (signal: Signal) => void
}

const BLOCK_LABEL = 'mb-1.5 text-[10px] font-semibold uppercase tracking-[.05em] text-text-faint'

const RESCAN_LABEL: Record<SelectorRescanStatus, string> = {
  idle: 'Rescan all captures',
  running: 'Rescanning…',
  done: 'Rescan complete',
  error: 'Rescan failed'
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// The right-hand rail: everything known about the selected signal, and the two
// things an operator does next with it — filter the captures by it, or take its
// matches out of the tool.
export function SignalDetailRail({
  caseId,
  signal,
  captures,
  totalCaptures,
  onToggleEnabled,
  onMerge
}: SignalDetailRailProps) {
  const navigate = useNavigate()
  const addSelectorFilter = useAppStore((s) => s.addSelectorFilter)
  const addTagFilter = useAppStore((s) => s.addTagFilter)
  const { update: updateTag } = useTagsMutations(caseId)
  const colorLabelId = useId()
  const [exporting, setExporting] = useState(false)
  const { previews, run, reset } = useForegroundMatchPreview(caseId, {
    maxCaptures: 5,
    maxMatchesPerCapture: 10
  })
  const { status: rescanStatus, run: runRescan, reset: resetRescan } = useSelectorRescan(caseId)

  const isSelector = signal?.kind === 'selector'
  // Keyed on primitives rather than on the signal object: the list is rebuilt
  // on every query settle, so depending on identity would re-read capture text
  // each time anything on the screen refetched.
  const selectorId = isSelector ? signal.id : null
  const pattern = isSelector ? signal.sub : ''
  const patternIsRegex = isSelector ? signal.isRegex : false

  // Recomputed per selection rather than cached: the values come from capture
  // text read in the renderer (the Foreground Match Preview), and a stale
  // example would attribute a hit to a selector that no longer makes it.
  useEffect(() => {
    reset()
    // A finished rescan belongs to the selector it ran for; carrying its outcome
    // onto the next selection would claim a pass that never touched it.
    resetRescan()
    if (selectorId) void run(pattern, patternIsRegex, selectorId)
  }, [selectorId, pattern, patternIsRegex])

  if (!signal) {
    return (
      <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-border bg-surface">
        <div
          className="flex flex-col items-center gap-2.5 px-2 py-10 text-center"
          data-testid="signal-rail-empty"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card">
            <Crosshair className="h-[18px] w-[18px] text-text-faint" strokeWidth={1.6} />
          </div>
          <h4 className="font-display text-xs font-semibold text-text-primary">
            No signals in this case
          </h4>
        </div>
      </aside>
    )
  }

  const OriginIcon = signal.origin ? ORIGIN_ICON[signal.origin] : null
  const appearsIn = captures.filter((capture) => signal.captureIds.includes(capture.id))
  const hiddenCount = Math.max(0, signal.count - appearsIn.length)
  const examples = [
    ...new Set((previews ?? []).flatMap((p) => p.matches.map((m) => m.matchText)))
  ].slice(0, 6)

  async function handleExport() {
    if (!signal) return
    setExporting(true)
    try {
      await exportSelectorMatches(caseId, signal.id)
    } catch (err) {
      console.error('Export selector matches failed:', err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-border bg-surface">
      <div className="flex flex-col gap-[var(--d-gap)] p-[var(--d-pad)]" data-testid="signal-rail">
        <div>
          <div className="flex items-center gap-2">
            {isSelector ? (
              <Crosshair className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
            ) : (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: signal.color }}
              />
            )}
            <span className="min-w-0 flex-1 truncate font-display text-xs font-bold tracking-tight text-text-primary">
              {signal.name}
            </span>
            {isSelector && (
              <button
                type="button"
                role="switch"
                aria-checked={signal.enabled}
                aria-label={`Enable ${signal.name}`}
                onClick={() => onToggleEnabled(signal)}
                className={[
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                  signal.enabled ? 'bg-accent' : 'bg-text-faint'
                ].join(' ')}
              >
                <span
                  className={[
                    'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                    signal.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  ].join(' ')}
                />
              </button>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-[7px] text-[11px] text-text-muted">
            <span>{signalCountLabel(signal, totalCaptures)}</span>
            {/* Provenance (#395). A selector with no origin predates provenance
                recording and has none to state, so nothing renders — guessing
                'manual' would be a false claim in an evidence tool. */}
            {signal.origin && OriginIcon && (
              <span
                data-testid="signal-origin"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-canvas px-2 py-px text-[10px] text-text-faint"
              >
                <OriginIcon className="h-2.5 w-2.5" strokeWidth={2} />
                {ORIGIN_LABEL[signal.origin]}
              </span>
            )}
          </div>
        </div>

        {isSelector && (
          <div>
            <div className={BLOCK_LABEL}>Pattern</div>
            <div
              data-testid="signal-pattern"
              className="break-all rounded border border-border bg-canvas px-[10px] py-2 font-mono text-[11px] text-text-secondary"
            >
              {signal.sub}
            </div>
          </div>
        )}

        {isSelector && examples.length > 0 && (
          <div>
            <div className={BLOCK_LABEL}>Matched values</div>
            <div className="flex flex-col gap-1">
              {examples.map((example) => (
                <div
                  key={example}
                  data-testid="signal-example"
                  className="break-all rounded bg-accent-subtle px-2 py-[5px] font-mono text-[11px] text-accent"
                >
                  {example}
                </div>
              ))}
            </div>
          </div>
        )}

        {!isSelector && (
          <div>
            <div id={colorLabelId} className={BLOCK_LABEL}>
              Color
            </div>
            <div role="group" aria-labelledby={colorLabelId} className="flex gap-1.5">
              {TAG_PALETTE_LABELS.map(({ value, label }) => {
                const selected = signal.color === value
                return (
                  <button
                    key={value}
                    type="button"
                    // The hex was the accessible name until #472: a screen reader
                    // spells it out character by character, which names nothing.
                    // TAG_PALETTE_LABELS is the same palette with a word against
                    // each swatch, already used by the row context menu (#701).
                    aria-label={`Set color ${label}`}
                    aria-pressed={selected}
                    onClick={() => updateTag.mutate({ id: signal.id, color: value })}
                    className="h-[18px] w-[18px] rounded-full"
                    style={{
                      background: value,
                      boxShadow: selected
                        ? '0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-accent)'
                        : 'none'
                    }}
                  />
                )
              })}
            </div>
          </div>
        )}

        <div>
          <div className={BLOCK_LABEL}>Appears in</div>
          {appearsIn.length === 0 ? (
            <div
              data-testid="signal-appears-empty"
              className="rounded border border-dashed border-border p-3.5 text-center text-[11px] text-text-faint"
            >
              No matches yet
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {appearsIn.map((capture) => (
                <button
                  key={capture.id}
                  type="button"
                  onClick={() => {
                    useAppStore.getState().setSelectedCaptureId(capture.id)
                    navigate({ to: '/cases/$caseId/captures', params: { caseId } })
                  }}
                  className="flex w-full flex-col items-stretch gap-px rounded px-[10px] py-[7px] text-left hover:bg-elevated"
                >
                  <span className="truncate text-xs font-medium text-text-primary">
                    {capture.title || capture.url}
                  </span>
                  <span className="flex gap-1.5 text-[10px] text-text-faint">
                    <span className="truncate text-text-muted">{hostOf(capture.url)}</span>
                    <span className="shrink-0">· {formatRelativeTime(capture.timestamp)}</span>
                  </span>
                </button>
              ))}
              {hiddenCount > 0 && (
                <p className="px-[10px] pt-1 text-[10px] text-text-faint">
                  +{hiddenCount} older {hiddenCount === 1 ? 'capture' : 'captures'} outside the
                  recent window
                </p>
              )}
            </div>
          )}
        </div>

        {/* The mock's footer (#1549): the same two buttons for every signal.
            Both kinds narrow the captures list (#918); until the tag branch
            existed this navigated for a tag and applied nothing. */}
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="signal-filter-in-captures"
            onClick={() => {
              if (isSelector) addSelectorFilter(signal.id)
              else addTagFilter(signal.id)
              navigate({ to: '/cases/$caseId/captures', params: { caseId } })
            }}
            className="h-7 flex-1 rounded border border-border-strong text-xs font-medium text-text-primary hover:bg-elevated"
          >
            Filter in Captures
          </button>
          {/* Drawn for a tag too, as the mock draws it, but disabled there: the
              CSV joins selector_matches to captures, so a tag has nothing to
              export through it. A tag exports from its row menu (#1542). */}
          <button
            type="button"
            data-testid="signal-export-csv"
            onClick={handleExport}
            disabled={!isSelector || exporting || signal.count === 0}
            title={
              isSelector
                ? undefined
                : 'CSV export is for selectors. Right-click the tag to export its captures.'
            }
            className="h-7 flex-1 rounded border border-border-strong text-xs font-medium text-text-primary hover:bg-elevated disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>

        {/* Tags only (#828), below the footer the way Rescan is for a
            selector. The mock keeps merge in the row menu alone, but that menu
            is an accelerator and never the only route (ruling 3 on #701), so
            the rail keeps this one. The dialog holds the target
            pick and the confirm; this button only opens it. */}
        {!isSelector && (
          <button
            type="button"
            data-testid="signal-merge-tag"
            onClick={() => onMerge(signal)}
            className="h-7 w-full rounded border border-border-strong text-xs font-medium text-text-primary hover:bg-elevated"
          >
            Merge into…
          </button>
        )}

        {/* Selectors only (#829). Ingest already matches enabled selectors as
            captures arrive, so this is for the captures it did not reach —
            chiefly those older than the create-time window, those taken while
            the selector was off, those whose text arrived later, and duplicates
            (#1082). Never disabled for a turned-off selector — matching does not
            consult `enabled`, so the pass would run either way and greying it
            would imply otherwise. */}
        {isSelector && (
          <div>
            <button
              type="button"
              data-testid="signal-rescan"
              onClick={() => runRescan(signal.id)}
              disabled={rescanStatus === 'running'}
              className="h-7 w-full rounded border border-border-strong text-xs font-medium text-text-primary hover:bg-elevated disabled:opacity-50"
            >
              {RESCAN_LABEL[rescanStatus]}
            </button>
            <p className="mt-1.5 text-[10px] leading-relaxed text-text-faint">
              Existing matches are never removed.
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
