import { ChevronRight, Camera, ChevronUp, ChevronDown } from 'lucide-react'

interface Props {
  captureCount: number
  onExpand: () => void
  onPrev: () => void
  onNext: () => void
  canGoPrev: boolean
  canGoNext: boolean
}

const BUTTON_CLASS =
  'flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary disabled:opacity-40 disabled:hover:bg-transparent'

/** The 40px stand-in for the capture list while it is collapsed. */
export function CaptureListRail({
  captureCount,
  onExpand,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext
}: Props) {
  return (
    <aside
      data-testid="capture-list-rail"
      className="flex h-full w-10 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2"
    >
      <button
        onClick={onExpand}
        title="Expand capture list"
        data-testid="capture-list-rail-expand"
        className={BUTTON_CLASS}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        onClick={onExpand}
        title={`${captureCount} capture${captureCount === 1 ? '' : 's'}`}
        className={BUTTON_CLASS}
      >
        <Camera className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onPrev}
        disabled={!canGoPrev}
        title="Previous capture"
        className={BUTTON_CLASS}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button onClick={onNext} disabled={!canGoNext} title="Next capture" className={BUTTON_CLASS}>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </aside>
  )
}
