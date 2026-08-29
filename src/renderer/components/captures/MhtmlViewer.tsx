import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { captureMhtmlUrlQueryOptions } from '@renderer/lib/queries'
import { useGuestFrameSize } from '@renderer/components/captures/useGuestFrameSize'
import { MHTML_PARTITION } from '@shared/constants'

interface Props {
  captureId: string
}

// Renders MHTML via an Electron <webview> with JavaScript disabled.
//
// Two surfaces mount it: the Page tab's mhtml branch in CaptureViewer, and the Wayback
// tab's stored-capture pane via CapturePane in WaybackCompare (asserted there by
// tests/components/WaybackCompare.test.tsx). A change to the frame or to the guest's
// posture here changes both, and the Wayback one sits beside a live archive.org guest
// still sized `100%` (#1126) — so the two panes of that comparison are not alike.
export function MhtmlViewer({ captureId }: Props) {
  const { data: fileUrl, error } = useQuery(captureMhtmlUrlQueryOptions(captureId))
  const ref = useRef<HTMLElement | null>(null)
  const frame = useGuestFrameSize()

  // Defense-in-depth: block navigation + disable link clicks via CSS injection
  useEffect(() => {
    const wv = ref.current as Electron.WebviewTag | null
    if (!wv) return
    const blockNav = (e: Event) => e.preventDefault()
    const disableLinks = () => {
      wv.insertCSS('a, area { pointer-events: none !important; cursor: default !important; }')
    }
    wv.addEventListener('will-navigate', blockNav)
    wv.addEventListener('new-window', blockNav)
    wv.addEventListener('dom-ready', disableLinks)
    return () => {
      wv.removeEventListener('will-navigate', blockNav)
      wv.removeEventListener('new-window', blockNav)
      wv.removeEventListener('dom-ready', disableLinks)
    }
  }, [fileUrl])

  if (error) {
    return <div className="p-4 text-sm text-red-400">{String(error)}</div>
  }
  if (!fileUrl) {
    return <div className="p-4 text-text-muted">Loading MHTML...</div>
  }

  return (
    // The guest is sized to its layout viewport rather than to the pane, and the pane
    // scrolls it — see useGuestFrameSize for why the two differ (#465). `min-*: 100%`
    // does one thing only: it stops the element being smaller than the pane, so a window
    // narrower than the pane leaves no strip of empty pane beside the page. It is not a
    // fallback for a stale measurement — the guest lays out against the *current* window
    // whatever size the element is, so an element read late still clips.
    <div data-testid="mhtml-viewer-scroll" className="h-full w-full overflow-auto">
      {/* Intentionally omit `nodeintegration` and `allowpopups` — both default to
          disabled in Electron, and passing them as string "false" historically
          *enabled* the features because HTML attribute presence = true. */}
      <webview
        data-testid="mhtml-viewer"
        ref={ref as unknown as React.RefObject<HTMLElement>}
        src={fileUrl}
        partition={MHTML_PARTITION}
        webpreferences="javascript=no,contextIsolation=yes,sandbox=yes"
        style={{
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          minWidth: '100%',
          minHeight: '100%',
          background: 'white'
        }}
      />
    </div>
  )
}
