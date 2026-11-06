import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, AppWindow, ArrowLeftToLine, ChevronLeft } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@renderer/components/ui'
import { useViewWidth } from '@renderer/components/investigate/useViewWidth'
import { captureSessionRailFits, SIDE_RAIL_PX } from '@renderer/components/captures/captureColumns'
import {
  dockPanel,
  launchedBrowserName,
  launchedBrowserPopOutQueryOptions,
  showPopOutWindow
} from '@renderer/lib/api/launchedBrowser'
import { useAppStore } from '@renderer/stores/appStore'
import {
  CaptureSessionPanel,
  useCaptureSessionView
} from '@renderer/components/launchedBrowser/CaptureSessionPanel'
import {
  noticeCard,
  tabCount,
  type PanelView
} from '@renderer/components/launchedBrowser/captureSessionPanelModel'

const RailDockedContext = createContext(false)

// Whether the Capture Session rail is docked beside this screen, so the Captures screen can keep
// its viewer at 480 pixels while it is (design review of 2026-11-04, answer 1).
export function useCaptureSessionRailDocked(): boolean {
  return useContext(RailDockedContext)
}

// Where the Capture Session panel sits on a Case screen (`1f`, `2a`): a 320-pixel rail at the right
// edge under the Case action bar where the screen keeps its minimums beside it, else a 40-pixel
// strip whose expand control opens the panel as an overlay over the screen, with no reflow. The
// row is measured as a whole, so docking the rail does not change the width that decides it.
// While the panel is popped out the strip stands in at any width (`1g`).
export function CaptureSessionDock({
  waybackTab,
  children
}: {
  waybackTab: boolean
  children: ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const room = useViewWidth(rowRef, window.innerWidth - SIDE_RAIL_PX)
  const view = useCaptureSessionView()
  const { data: poppedOut = false } = useQuery(launchedBrowserPopOutQueryOptions)
  const fits = captureSessionRailFits(room, waybackTab)
  const [overlayOpen, setOverlayOpen] = useState(false)
  // An overlay left open as the rail docked would come back the next time the strip shows.
  const [fitted, setFitted] = useState(fits)
  if (fits !== fitted) {
    setFitted(fits)
    if (fits) setOverlayOpen(false)
  }
  // The panel keeps a closed browser's state in the main window, as it does in its own form.
  const away = poppedOut && view.kind !== 'closed'

  let side: ReactNode = null
  if (view.kind !== 'none') {
    if (away) side = <PoppedOutStrip view={view} />
    else if (fits) {
      side = (
        <aside
          data-testid="capture-session-rail"
          aria-label="Capture Session"
          className="flex w-80 shrink-0 flex-col border-l border-border bg-surface"
        >
          <CaptureSessionPanel form="rail" />
        </aside>
      )
    } else side = <Strip view={view} open={overlayOpen} onOpenChange={setOverlayOpen} />
  }

  return (
    <RailDockedContext.Provider value={view.kind !== 'none' && fits && !away}>
      <div ref={rowRef} className="flex min-h-0 flex-1">
        {children}
        {side}
      </div>
    </RailDockedContext.Provider>
  )
}

const STRIP_CLASS =
  'flex w-10 shrink-0 flex-col items-center gap-1.5 border-l border-border bg-surface pt-2'

const STRIP_BUTTON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded text-text-muted transition-colors hover:bg-elevated hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

// The REC dot, or a notice's warning glyph, as the strip shows it.
function StripMark({ view }: { view: Exclude<PanelView, { kind: 'none' }> }) {
  const sessionActive = useAppStore((s) => s.sessionActive)
  if (view.kind === 'notice') {
    return (
      <span title={noticeCard(view.notice).title} className="mt-1 text-danger-fg">
        <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
    )
  }
  if (!sessionActive) return null
  const name = launchedBrowserName(view.browser.label)
  const recTitle = view.kind === 'closed' ? `REC · ${name} closed` : `REC · ${name}`
  return <span title={recTitle} className="mt-1 h-2 w-2 rounded-full bg-danger-fg" />
}

function Strip({
  view,
  open,
  onOpenChange
}: {
  view: Exclude<PanelView, { kind: 'none' }>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const count = view.kind === 'notice' || view.kind === 'closed' ? null : view.browser.tabs.length

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <aside
          data-testid="capture-session-strip"
          aria-label="Capture Session"
          className={STRIP_CLASS}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Expand the Capture Session panel"
              title="Expand the Capture Session panel"
              className={STRIP_BUTTON_CLASS}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <StripMark view={view} />
          {count !== null && (
            <span title={tabCount(count)} className="mt-1.5 font-mono text-[10px] text-text-muted">
              {count}
            </span>
          )}
        </aside>
      </PopoverAnchor>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={0}
        avoidCollisions={false}
        aria-label="Capture Session"
        className="flex h-[var(--radix-popover-trigger-height)] w-80 flex-col rounded-none border-y-0 border-r-0 bg-surface"
      >
        <CaptureSessionPanel form="overlay" onDone={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  )
}

// The main window while the panel is in its own window (`1g`, revised 2026-11-04): the strip's 40
// pixels in place of an empty rail, so the screen takes the width back.
function PoppedOutStrip({ view }: { view: Exclude<PanelView, { kind: 'none' }> }) {
  return (
    <aside
      data-testid="capture-session-popped-out"
      aria-label="Capture Session"
      className={STRIP_CLASS}
    >
      <StripMark view={view} />
      <button
        type="button"
        aria-label="Show window"
        title="Show window"
        onClick={() => void showPopOutWindow()}
        className={`${STRIP_BUTTON_CLASS} mt-1.5`}
      >
        <AppWindow aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Dock"
        title="Dock"
        onClick={() => void dockPanel()}
        className={STRIP_BUTTON_CLASS}
      >
        <ArrowLeftToLine aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </aside>
  )
}
