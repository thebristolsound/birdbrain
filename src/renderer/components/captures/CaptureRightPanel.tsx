import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui'
import { launchedBrowserPopOutQueryOptions, popOutPanel } from '@renderer/lib/api/launchedBrowser'
import { useAppStore } from '@renderer/stores/appStore'
import { cn } from '@renderer/lib/utils'
import { CaptureSessionStripMarks } from '@renderer/components/launchedBrowser/CaptureSessionDock'
import { CaptureSessionPanel } from '@renderer/components/launchedBrowser/CaptureSessionPanel'
import type { PanelView } from '@renderer/components/launchedBrowser/captureSessionPanelModel'

export type RightPanelTab = 'details' | 'session'

type SessionView = Exclude<PanelView, { kind: 'none' }>

const ICON_BUTTON_CLASS =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary'

const TAB_CLASS = 'h-7 flex-none px-2.5 text-xs'

interface PanelProps {
  // The Capture Session to show beside the details, or null for the details alone.
  session: SessionView | null
  // Docked in the column, or over the screen from the folded strip.
  form: 'rail' | 'overlay'
  tab: RightPanelTab
  onTabChange: (tab: RightPanelTab) => void
  // Folds the docked panel to its strip, or closes the overlay.
  onCollapse: () => void
  // The selected Capture's details panel, or null with none selected.
  details: ReactNode
}

// The Captures screen's one right panel. With no Capture Session to show it is the details panel
// alone. With one, the details and the Capture Session are its two tabs, so the screen keeps
// to four columns: the rail, the list, the viewer and this panel.
export function CaptureRightPanel({ session, details, ...props }: PanelProps) {
  if (!session) return <>{details}</>
  return <TabbedPanel session={session} details={details} {...props} />
}

function TabbedPanel({
  session,
  form,
  tab,
  onTabChange,
  onCollapse,
  details
}: PanelProps & { session: SessionView }) {
  const recording = useAppStore((s) => s.sessionActive)
  const { data: poppedOut = false } = useQuery(launchedBrowserPopOutQueryOptions)

  // The stub in the tab stands for a popped-out panel, and a closed browser has no window.
  const popsOut = (session.kind === 'open' || session.kind === 'closing') && !poppedOut
  // An overlay closes as one of its controls hands over to a dialog or another window.
  const onDone = form === 'overlay' ? onCollapse : undefined
  // The details panel has a collapse control of its own.
  const ownCollapse = tab === 'session' || !details

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as RightPanelTab)}
      className="h-full min-h-0 flex-1 gap-0"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border pr-2">
        <TabsList
          variant="line"
          aria-label="Right panel"
          className="h-auto justify-start px-2.5 pt-1"
        >
          <TabsTrigger value="details" className={TAB_CLASS}>
            Details
          </TabsTrigger>
          <TabsTrigger value="session" className={TAB_CLASS}>
            {recording && (
              <span
                data-testid="session-tab-rec"
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-fg"
              />
            )}
            Capture Session
          </TabsTrigger>
        </TabsList>
        <span className="flex-1" />
        {popsOut && (
          <Button
            variant="link"
            disabled={session.kind === 'closing'}
            className="shrink-0 px-0 text-[11px] text-text-muted underline"
            onClick={() => {
              onDone?.()
              void popOutPanel()
            }}
          >
            Pop out
          </Button>
        )}
        {ownCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse panel"
            aria-label="Collapse panel"
            className={ICON_BUTTON_CLASS}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* Kept mounted while the other tab shows, so a note being typed is not dropped. */}
      <TabsContent
        value="details"
        forceMount
        hidden={tab !== 'details'}
        className="flex min-h-0 flex-col"
      >
        {details ?? (
          <p className="px-5 py-4 text-xs text-text-muted">Select a Capture to see its details.</p>
        )}
      </TabsContent>
      <TabsContent value="session" className="flex min-h-0 flex-col">
        <CaptureSessionPanel form={form} tabbed onDone={onDone} />
      </TabsContent>
    </Tabs>
  )
}

interface StripProps {
  session: SessionView | null
  onExpandSession: () => void
  // The selected Capture's rail, or null with none selected.
  children: ReactNode
}

// The right panel folded to 40 pixels. Under the selected Capture's rail it says of the Capture
// Session what the session's own strip says on the other Case screens, with a control that opens
// the panel on that tab.
export function CaptureRightStrip({ session, onExpandSession, children }: StripProps) {
  return (
    <aside
      data-testid="capture-details-aside"
      className="flex w-10 shrink-0 flex-col items-center overflow-hidden border-l border-border bg-surface"
    >
      {children && <div className="shrink-0">{children}</div>}
      {session && (
        <div
          data-testid="right-strip-session"
          className={cn(
            'flex w-full flex-col items-center py-2',
            children && 'border-t border-border'
          )}
        >
          <button
            type="button"
            onClick={onExpandSession}
            title="Expand the Capture Session panel"
            aria-label="Expand the Capture Session panel"
            className={ICON_BUTTON_CLASS}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <CaptureSessionStripMarks view={session} />
        </div>
      )}
    </aside>
  )
}
