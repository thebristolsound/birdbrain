import { Star, Check, RefreshCcw } from 'lucide-react'
import type { Capture, Selector } from '@shared/types'
import { useCaptureThumbnail } from '@renderer/hooks/useCaptureThumbnail'

const THUMB_COLORS = [
  { from: 'rgba(49,46,129,0.3)', to: 'rgba(30,27,75,0.2)', bar: 'rgba(129,140,248,0.25)' },
  { from: 'rgba(6,78,59,0.3)', to: 'rgba(4,47,36,0.2)', bar: 'rgba(52,211,153,0.25)' },
  { from: 'rgba(124,45,18,0.25)', to: 'rgba(67,20,7,0.15)', bar: 'rgba(251,146,60,0.25)' },
  { from: 'rgba(12,74,110,0.25)', to: 'rgba(7,47,75,0.15)', bar: 'rgba(56,189,248,0.25)' },
  { from: 'rgba(76,29,149,0.25)', to: 'rgba(46,16,101,0.15)', bar: 'rgba(167,139,250,0.25)' },
  { from: 'rgba(136,19,55,0.25)', to: 'rgba(76,5,25,0.15)', bar: 'rgba(251,113,133,0.25)' },
  { from: 'rgba(19,78,74,0.25)', to: 'rgba(4,47,46,0.15)', bar: 'rgba(45,212,191,0.25)' },
  { from: 'rgba(51,65,85,1)', to: 'rgba(30,41,59,1)', bar: 'rgba(100,116,139,0.3)' }
]

function getThumbColor(url: string) {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0
  }
  return THUMB_COLORS[Math.abs(hash) % THUMB_COLORS.length]
}

function formatTimestamp(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  return new Date(ts).toLocaleDateString()
}

interface CaptureItemProps {
  capture: Capture
  isSelected: boolean
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

  const color = getThumbColor(capture.url)

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="capture-item"
      data-capture-id={capture.id}
      onClick={onClick}
      onMouseDown={(e) => {
        // Shift-click extends the selection range; without this the browser
        // also starts a native text selection across the rows.
        if (e.shiftKey) e.preventDefault()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(e)
        }
      }}
      className={`group relative w-full rounded-xl border p-2 text-left transition-colors cursor-pointer ${
        isSelected ? 'border-accent/35' : isMultiSelected ? 'border-accent/20' : 'border-transparent'
      } ${isSelected || isMultiSelected ? 'bg-accent-subtle' : 'hover:bg-elevated'}`}
    >
      {/* Multi-select rail (session-3 note: multi-select only; single
          selection relies on the accent border + tint) */}
      {isMultiSelected && (
        <span
          aria-hidden="true"
          data-testid="capture-multiselect-rail"
          className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-r-sm bg-accent"
        />
      )}
      <div className="flex gap-2">
        {/* Multi-select checkbox: fades in on row hover, stays once any row
            is checked (showCheckbox) or this row is. It stays mounted so rows
            never shift, which means opacity is the only thing hiding it — and
            opacity: 0 does not leave the tab order. focus-visible reveals it,
            so keyboard focus can never land on a control the operator cannot
            see. */}
        {onToggleMultiSelect && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleMultiSelect(e)
            }}
            aria-label={isMultiSelected ? 'Deselect capture' : 'Select capture'}
            aria-checked={isMultiSelected}
            role="checkbox"
            data-testid="capture-select-checkbox"
            className={`mt-1.5 shrink-0 self-start transition-opacity duration-150 ${
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
        )}
        {/* Thumbnail */}
        <div className="relative h-12 w-16 shrink-0 rounded-lg overflow-hidden flex items-center justify-center bg-gray-900/50">
          {thumbnail ? (
            <img src={thumbnail} alt="" className="h-full w-full object-cover object-top" />
          ) : (
            <div
              className="h-full w-full flex flex-col justify-center gap-1 px-1.5"
              style={{
                background: `linear-gradient(to bottom right, ${color.from}, ${color.to})`
              }}
            >
              <div className="h-1 w-full rounded-full" style={{ backgroundColor: color.bar }} />
              <div
                className="h-1 w-3/4 rounded-full"
                style={{ backgroundColor: color.bar, opacity: 0.7 }}
              />
              <div
                className="h-1 w-1/2 rounded-full"
                style={{ backgroundColor: color.bar, opacity: 0.5 }}
              />
            </div>
          )}
          {/* Distinguish background recaptures from operator-witnessed captures */}
          {capture.method === 'background' && (
            <div
              data-testid="recapture-thumb-badge"
              title="Background recapture"
              aria-hidden="true"
              className="absolute bottom-0.5 right-0.5 flex items-center justify-center rounded bg-black/65 p-0.5"
            >
              <RefreshCcw className="h-2.5 w-2.5 text-white" />
            </div>
          )}
        </div>
        {/* Text */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <div
              className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary"
              title={capture.title || hostname}
            >
              {capture.title || hostname}
            </div>
            {/* Favorite star */}
            {onToggleFavorite && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFavorite(e)
                }}
                aria-label={isFavorite ? 'Unfavorite capture' : 'Favorite capture'}
                aria-pressed={isFavorite}
                className="shrink-0 p-0.5 rounded hover:bg-elevated/50 transition-colors"
              >
                <Star
                  className={`h-3.5 w-3.5 ${
                    isFavorite ? 'fill-yellow-500 text-yellow-500' : 'text-text-faint'
                  }`}
                />
              </button>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-text-muted">{hostname}</div>
          <div className="mt-0.5 flex items-center gap-1">
            <div className="text-[11px] text-text-faint">{formatTimestamp(capture.timestamp)}</div>
            {/* Selector badges */}
            {matchingSelectors.length > 0 && (
              <div className="flex gap-0.5">
                {matchingSelectors.slice(0, 3).map((selector) => (
                  <div
                    key={selector.id}
                    className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent"
                    title={selector.label || selector.pattern}
                  >
                    {selector.label || selector.pattern.substring(0, 8)}
                  </div>
                ))}
                {matchingSelectors.length > 3 && (
                  <div
                    className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-text-faint"
                    title={`${matchingSelectors.length - 3} more`}
                  >
                    +{matchingSelectors.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
