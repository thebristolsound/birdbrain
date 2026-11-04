import { useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronLeft } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@renderer/components/ui'
import { useViewWidth } from '@renderer/components/investigate/useViewWidth'
import { SIDE_RAIL_PX } from '@renderer/components/captures/captureColumns'
import { launchedBrowserName } from '@renderer/lib/api/launchedBrowser'
import { useAppStore } from '@renderer/stores/appStore'
import {
  CaptureSessionPanel,
  useCaptureSessionView
} from '@renderer/components/launchedBrowser/CaptureSessionPanel'
import {
  noticeCard,
  railFits,
  tabCount,
  type PanelView
} from '@renderer/components/launchedBrowser/captureSessionPanelModel'

// Where the Capture Session panel sits on a Case screen (`1f`, `2a`): a 320-pixel rail at the right
// edge under the Case action bar where the screen keeps its minimums beside it, else a 40-pixel
// strip whose expand control opens the panel as an overlay over the screen, with no reflow. The
// row is measured as a whole, so docking the rail does not change the width that decides it.
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
  const fits = railFits(room, waybackTab)
  const [overlayOpen, setOverlayOpen] = useState(false)
  // An overlay left open as the rail docked would come back the next time the strip shows.
  const [fitted, setFitted] = useState(fits)
  if (fits !== fitted) {
    setFitted(fits)
    if (fits) setOverlayOpen(false)
  }

  return (
    <div ref={rowRef} className="flex min-h-0 flex-1">
      {children}
      {view.kind !== 'none' &&
        (fits ? (
          <aside
            data-testid="capture-session-rail"
            aria-label="Capture Session"
            className="flex w-80 shrink-0 flex-col border-l border-border bg-surface"
          >
            <CaptureSessionPanel form="rail" />
          </aside>
        ) : (
          <Strip view={view} open={overlayOpen} onOpenChange={setOverlayOpen} />
        ))}
    </div>
  )
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
  const sessionActive = useAppStore((s) => s.sessionActive)
  const browser = view.kind === 'notice' ? null : view.browser
  const name = browser ? launchedBrowserName(browser.label) : ''
  const recTitle = view.kind === 'closed' ? `REC · ${name} closed` : `REC · ${name}`
  const count = browser && view.kind !== 'closed' ? browser.tabs.length : null

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <aside
          data-testid="capture-session-strip"
          aria-label="Capture Session"
          className="flex w-10 shrink-0 flex-col items-center gap-1.5 border-l border-border bg-surface pt-2"
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Expand the Capture Session panel"
              title="Expand the Capture Session panel"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-text-muted transition-colors hover:bg-elevated hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          {view.kind === 'notice' ? (
            <span title={noticeCard(view.notice).title} className="mt-1 text-danger-fg">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          ) : (
            sessionActive && (
              <span title={recTitle} className="mt-1 h-2 w-2 rounded-full bg-danger-fg" />
            )
          )}
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
