import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@renderer/components/ui'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import {
  dockPanel,
  followLaunchedBrowserStatus,
  launchedBrowserStatusQueryOptions
} from '@renderer/lib/api/launchedBrowser'
import {
  WINDOW_CONTROLS_LEFT_PROPERTY,
  WINDOW_CONTROLS_RIGHT_PROPERTY
} from '@renderer/lib/windowControls'
import { CaptureSessionPanel } from '@renderer/components/launchedBrowser/CaptureSessionPanel'
import { StopSessionDialog } from '@renderer/components/launchedBrowser/StopSessionDialog'
import { popOutTitle } from '@renderer/components/launchedBrowser/captureSessionPanelModel'

// The OS title bar is hidden (src/main/windowChrome.ts), so this bar keeps clear of the native
// window controls by the room lib/windowControls.ts publishes for each side, past its own padding.
const BAR_INSETS = {
  paddingLeft: `calc(0.625rem + var(${WINDOW_CONTROLS_LEFT_PROPERTY}, 0px))`,
  paddingRight: `calc(0.625rem + var(${WINDOW_CONTROLS_RIGHT_PROPERTY}, 0px))`
} as const

// The Capture Session panel popped out (`1g`), the whole page of the pop-out window. A bare root:
// no router, session restore, command palette or tour. Main keeps it current through the
// launched browser's status events and closes the window once the browser has gone.
export function CaptureSessionWindow() {
  const client = useQueryClient()
  useEffect(() => followLaunchedBrowserStatus(client), [client])
  const { data: status } = useQuery(launchedBrowserStatusQueryOptions)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const caseId = status && status.state !== 'none' ? status.browser.caseId : null
  const caseName = cases.find(({ id }) => id === caseId)?.name ?? ''

  // The page's <title> is the one the desktop shows, whatever the window was created with.
  useEffect(() => {
    document.title = popOutTitle(caseName)
  }, [caseName])

  return (
    <div className="flex h-screen flex-col bg-surface text-[11px] leading-[1.45] text-text-secondary">
      {/* h-8 is POP_OUT_TITLE_BAR_HEIGHT, the height of the controls overlay beside it. */}
      <header
        style={BAR_INSETS}
        className="app-drag flex h-8 shrink-0 items-center gap-1.5 border-t-2 border-b border-t-accent border-b-border bg-accent-subtle"
      >
        {status?.state === 'open' && (
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-fg" />
        )}
        <span className="shrink-0 font-semibold text-text-primary">Birdbrain</span>
        {caseName && (
          <span aria-hidden="true" className="text-text-faint">
            ·
          </span>
        )}
        {/* The canvas adds "· Capture Session". Beside the window controls that left the Case no
            room in 300 pixels (measured under X11), so the panel's header carries it. */}
        <span className="min-w-0 flex-1 truncate text-text-primary">{caseName}</span>
        <Button
          variant="link"
          className="shrink-0 px-0 text-[11px] text-text-muted underline"
          onClick={() => void dockPanel()}
        >
          Dock
        </Button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-auto">
        <CaptureSessionPanel form="window" />
      </main>
      <StopSessionDialog />
    </div>
  )
}
