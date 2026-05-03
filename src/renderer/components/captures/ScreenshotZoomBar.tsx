import { Hand, Minus, Plus, Eye, EyeOff } from 'lucide-react'

interface Props {
  scale: number
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
  oneToOne: () => void
  panMode: boolean
  setPanMode: (next: boolean) => void
  overlayVisible: boolean
  setOverlayVisible: (next: boolean) => void
  /** True when active tool is a draw tool (not 'select' and not 'hand'). */
  drawing: boolean
}

function Separator() {
  return <span aria-hidden className="mx-1 w-px h-5 bg-border" />
}

export function ScreenshotZoomBar({
  scale,
  zoomIn,
  zoomOut,
  fit,
  oneToOne,
  panMode,
  setPanMode,
  overlayVisible,
  setOverlayVisible,
  drawing
}: Props) {
  const eyeDisabled = drawing
  const EyeIcon = overlayVisible ? Eye : EyeOff
  return (
    <div className="flex items-center gap-1 border-b border-border bg-surface px-3 py-1.5">
      <button
        type="button"
        aria-label="Hand tool"
        aria-pressed={panMode}
        onClick={() => setPanMode(!panMode)}
        className={[
          'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
          panMode
            ? 'bg-accent-subtle text-accent'
            : 'text-text-muted hover:bg-elevated hover:text-text-primary'
        ].join(' ')}
      >
        <Hand size={16} />
      </button>

      <Separator />

      <button
        type="button"
        aria-label="Zoom out"
        onClick={zoomOut}
        className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary"
      >
        <Minus size={16} />
      </button>
      <span className="min-w-[3.5rem] text-center text-xs text-text-muted tabular-nums">
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={zoomIn}
        className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary"
      >
        <Plus size={16} />
      </button>

      <Separator />

      <button
        type="button"
        onClick={fit}
        className="h-8 px-2 rounded-lg text-xs text-text-muted hover:bg-elevated hover:text-text-primary"
      >
        Fit
      </button>
      <button
        type="button"
        onClick={oneToOne}
        className="h-8 px-2 rounded-lg text-xs text-text-muted hover:bg-elevated hover:text-text-primary"
      >
        1:1
      </button>

      <div className="ml-auto">
        <button
          type="button"
          aria-label={overlayVisible ? 'Hide annotations' : 'Show annotations'}
          aria-pressed={!overlayVisible}
          aria-disabled={eyeDisabled}
          onClick={() => {
            if (eyeDisabled) return
            setOverlayVisible(!overlayVisible)
          }}
          title={
            eyeDisabled
              ? 'Switch to the cursor tool to hide annotations'
              : overlayVisible
                ? 'Hide annotations'
                : 'Show annotations'
          }
          className={[
            'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
            eyeDisabled
              ? 'text-text-faint opacity-50 cursor-not-allowed'
              : 'text-text-muted hover:bg-elevated hover:text-text-primary'
          ].join(' ')}
        >
          <EyeIcon size={16} />
        </button>
      </div>
    </div>
  )
}
