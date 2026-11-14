import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  launchedBrowserName,
  launchedBrowserStatusQueryOptions
} from '@renderer/lib/api/launchedBrowser'
import { formatElapsed } from '@renderer/components/launchedBrowser/captureSessionPanelModel'
import { useAppStore } from '@renderer/stores/appStore'
import { cn } from '@renderer/lib/utils'

// Recording, without the camcorder (docs/design-handoff/2026-11-08-top-bar/): a 6px danger dot,
// a mono elapsed timer where the session's start is known (a launched browser's), and the source
// in secondary text. No pill, no fill, no pulse, no "REC". On Case screens it sits in the Case
// action bar beside the switch that starts and stops it; on the dashboard and in Settings it
// stays in the top bar, where `trigger` adds the chevron of the Capture Session popover.
export function RecordingMark({
  trigger = false,
  className
}: {
  trigger?: boolean
  className?: string
}) {
  const { data: launched } = useQuery(launchedBrowserStatusQueryOptions)
  const open = launched?.state === 'open'
  const since = open ? launched.browser.sessionStartedAt : null
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  // A session outlives the launched browser that started it, and that browser needed no
  // extension, so the extension is named only while one is connected.
  const source = open
    ? launchedBrowserName(launched.browser.label)
    : connectedToExtension
      ? 'extension'
      : null
  return (
    <span
      data-testid="topbar-rec"
      className={cn(
        'inline-flex h-7 items-center gap-2 whitespace-nowrap px-1 text-[11px]',
        className
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-fg" aria-hidden="true" />
      {since !== null ? (
        <>
          <span className="sr-only">Recording</span>
          <Elapsed since={since} />
        </>
      ) : (
        <span className="font-mono text-text-primary">Recording</span>
      )}
      {source && <span className="text-text-muted">{source}</span>}
      {trigger && (
        <span aria-hidden="true" className="text-text-faint">
          ▾
        </span>
      )}
    </span>
  )
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <span role="timer" className="font-mono tabular-nums text-text-primary">
      {formatElapsed(now - since)}
    </span>
  )
}
