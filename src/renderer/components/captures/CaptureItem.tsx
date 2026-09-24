import { Star, Check, CopyPlus, RefreshCcw, Clock } from 'lucide-react'
import type { Capture, Selector } from '@shared/types'
import { useCaptureThumbnail } from '@renderer/hooks/useCaptureThumbnail'
import { getProvenanceColor } from '@renderer/components/captures/getProvenanceColor'
import type { CaptureView } from '@renderer/components/captures/useCaptureView'
import {
  formatRelativeTime,
  formatRelativeTimeShort,
  formatCaptureTimestampFull
} from '@renderer/lib/formatRelativeTime'
import logoImg from '@renderer/assets/logo.png'

interface CaptureItemProps {
  capture: Capture
  isSelected: boolean
  // Which of the two designed row treatments to draw. Both keep the same
  // selection affordances; only the density and the time format differ.
  view?: CaptureView
  // Injected so every row in one render agrees on "now" and the tests can
  // assert an exact string.
  nowMs?: number
  // Modifier-aware (#396): plain click selects, cmd/ctrl toggles the
  // multi-set, shift extends from the anchor. Keyboard Enter/Space reuses it.
  onClick: (e: React.MouseEvent | React.KeyboardEvent) => void
  isFavorite?: boolean
  onToggleFavorite?: (e: React.MouseEvent) => void
  isMultiSelected?: boolean
  onToggleMultiSelect?: (e: React.MouseEvent) => void
  // Sticky mode: once any row is checked, every row's checkbox stays visible.
  showCheckbox?: boolean
  matchingSelectors?: Selector[]
}

export function CaptureItem({
  capture,
  isSelected,
  view = 'detailed',
  nowMs,
  onClick,
  isFavorite = false,
  onToggleFavorite,
  isMultiSelected = false,
  onToggleMultiSelect,
  showCheckbox = false,
  matchingSelectors = []
}: CaptureItemProps) {
  const { thumbnail } = useCaptureThumbnail(capture.id)

  let hostname = ''
  try {
    hostname = new URL(capture.url).hostname
  } catch {
    hostname = capture.url
  }

  const provenance = getProvenanceColor(capture.lastVerifiedStatus)
  const now = nowMs ?? Date.now()
  const fullTimestamp = `Captured ${formatCaptureTimestampFull(capture.timestamp)}`
  const shownSelectors = matchingSelectors.slice(0, 2)
  const overflowSelectors = matchingSelectors.slice(2)

  const rowClass = `group relative w-full cursor-pointer rounded-[4px] border text-left transition-colors ${
    isSelected ? 'border-accent/35' : isMultiSelected ? 'border-accent/20' : 'border-transparent'
  } ${isSelected || isMultiSelected ? 'bg-accent-subtle' : 'hover:bg-elevated'}`

  const checkbox = onToggleMultiSelect && (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onToggleMultiSelect(e)
      }}
      aria-label={isMultiSelected ? 'Deselect capture' : 'Select capture'}
      aria-checked={isMultiSelected}
      role="checkbox"
      data-testid="capture-select-checkbox"
      className={`shrink-0 transition-opacity duration-150 ${
        view === 'detailed' ? 'mt-1 self-start' : 'self-center'
      } ${
        isMultiSelected || showCheckbox
          ? 'opacity-100'
          : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border ${
          isMultiSelected ? 'border-accent bg-accent' : 'border-border-strong'
        }`}
      >
        {isMultiSelected && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
      </span>
    </button>
  )

  // The design draws no checkbox at all — selection there is modifier-clicks
  // only. Keeping it is deliberate: multi-select is shipped, e2e-covered
  // behaviour and dropping the control would remove the only pointer-visible
  // way into it.
  const rail = isMultiSelected && (
    <span
      aria-hidden="true"
      data-testid="capture-multiselect-rail"
      className={`absolute left-0 w-0.5 rounded-r-sm bg-accent ${
        view === 'detailed' ? 'bottom-1.5 top-1.5' : 'bottom-[3px] top-[3px]'
      }`}
    />
  )

  const rowProps = {
    role: 'button',
    tabIndex: 0,
    'data-testid': 'capture-item',
    'data-capture-id': capture.id,
    onClick,
    onMouseDown: (e: React.MouseEvent) => {
      // Shift-click extends the selection range; without this the browser
      // also starts a native text selection across the rows.
      if (e.shiftKey) e.preventDefault()
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick(e)
      }
    }
  }

  if (view === 'list') {
    return (
      <div {...rowProps} className={`${rowClass} flex items-center gap-2 px-2.5 py-[5px]`}>
        {rail}
        {checkbox}
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${provenance.dot}`}
          title={provenance.label}
        />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary"
          title={capture.title || hostname}
        >
          {capture.title || hostname}
        </span>
        {isFavorite && (
          <Star aria-hidden="true" className="h-2.5 w-2.5 shrink-0 fill-amber-400 text-amber-400" />
        )}
        {capture.method === 'duplicate' && (
          <span
            data-testid="duplicate-list-badge"
            title="Duplicate of another capture"
            className="shrink-0 leading-none"
          >
            <CopyPlus aria-hidden="true" className="h-2.5 w-2.5 text-text-faint" />
            <span className="sr-only">Duplicate of another capture</span>
          </span>
        )}
        <span className="w-24 shrink-0 truncate text-right text-[10px] text-text-faint">
          {hostname}
        </span>
        <span
          title={fullTimestamp}
          className="inline-flex w-[38px] shrink-0 items-center justify-end gap-[3px] text-[10px] tabular-nums text-text-faint"
        >
          <Clock aria-hidden="true" className="h-[9px] w-[9px] shrink-0" />
          {formatRelativeTimeShort(capture.timestamp, now)}
        </span>
      </div>
    )
  }

  return (
    <div
      {...rowProps}
      className={`${rowClass} flex gap-2.5 px-[var(--d-itemx)] py-[var(--d-itemy)]`}
    >
      {rail}
      {checkbox}
      {/* Thumbnail */}
      <div className="relative h-9 w-14 shrink-0 overflow-hidden rounded-[2px] border border-border-strong">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          // One neutral token pair for every row, so the tile follows the theme.
          <div
            data-testid="capture-thumb-fallback-tile"
            className="grid h-full w-full place-items-center bg-gradient-to-br from-elevated to-surface"
          >
            <img
              src={logoImg}
              alt=""
              data-testid="capture-thumb-fallback"
              className="h-5 w-5 opacity-[.28] brightness-[1.9] grayscale"
            />
          </div>
        )}
        <span
          aria-hidden="true"
          data-testid="capture-provenance-dot"
          title={provenance.label}
          className={`absolute bottom-[3px] right-[3px] h-1.5 w-1.5 rounded-full border border-black/35 ${provenance.dot}`}
        />
      </div>
      {/* Text */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary"
            title={capture.title || hostname}
          >
            {capture.title || hostname}
          </span>
          {onToggleFavorite && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite(e)
              }}
              aria-label={isFavorite ? 'Unfavorite capture' : 'Favorite capture'}
              aria-pressed={isFavorite}
              className="shrink-0 self-center rounded p-0.5 transition-colors hover:bg-elevated/50"
            >
              <Star
                className={`h-[11px] w-[11px] ${
                  isFavorite ? 'fill-amber-400 text-amber-400' : 'text-text-faint'
                }`}
              />
            </button>
          )}
        </div>
        <div className="mt-[3px] flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[11px] leading-[1.5] text-text-muted">
            {hostname}
          </span>
          {capture.method === 'background' && (
            <span
              data-testid="recapture-thumb-badge"
              title="Background recapture"
              aria-hidden="true"
              className="shrink-0 leading-none"
            >
              <RefreshCcw className="h-[11px] w-[11px] text-text-faint" />
            </span>
          )}
          {capture.method === 'duplicate' && (
            // Not aria-hidden, unlike the recapture badge above: this marker is
            // what keeps a byte copy from reading as a second sighting, so it
            // must reach the accessibility tree too.
            <span
              data-testid="duplicate-thumb-badge"
              title="Duplicate of another capture"
              className="shrink-0 leading-none"
            >
              <CopyPlus aria-hidden="true" className="h-[11px] w-[11px] text-text-faint" />
              <span className="sr-only">Duplicate of another capture</span>
            </span>
          )}
          <span className="shrink-0 text-[10px] text-text-faint" title={fullTimestamp}>
            {formatRelativeTime(capture.timestamp, now)}
          </span>
        </div>
        {matchingSelectors.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {shownSelectors.map((selector) => (
              <div
                key={selector.id}
                className="max-w-[110px] truncate rounded-md border border-border px-1.5 py-px text-[10px] font-medium text-text-faint"
                title={selector.label || selector.pattern}
              >
                {selector.label || selector.pattern}
              </div>
            ))}
            {overflowSelectors.length > 0 && (
              <div
                className="rounded-md border border-border px-1.5 py-px text-[10px] font-medium text-text-faint"
                title={overflowSelectors.map((s) => s.label || s.pattern).join(', ')}
              >
                +{overflowSelectors.length}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
