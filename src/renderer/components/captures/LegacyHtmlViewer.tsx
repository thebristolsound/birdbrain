import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { captureHtmlUrlQueryOptions } from '@renderer/lib/api/captures'
import { LEGACY_HTML_PARTITION } from '@shared/constants'

interface Props {
  captureId: string
  /** Copy for the missing-artefact state, which each mount words for its own pane. */
  emptyLabel?: string
}

// Renders a pre-v11 `format: 'html'` capture via an Electron <webview> with
// JavaScript disabled, on a partition whose policy allows no request host at all
// (#906). It replaced an `<iframe sandbox="" srcDoc={content}>`, which denied those
// subresource fetches by accident rather than by design: `sandbox=""` stops scripts,
// forms and popups and governs no fetch at all. Shipped builds issued none of them —
// measured 0, in both the dev `http://` and packaged `file://` shapes — but what
// stopped them was src/renderer/index.html's CSP plus the srcdoc frame's own opaque
// origin, two controls that name neither this viewer nor this guarantee and that
// nothing tests. Remove the CSP from that harness and the same document issues nine.
// The guest session's onBeforeRequest filter (hardenWebviewSessions in
// src/main/index.ts) is the control now: it sits in the main process, so nothing the
// renderer or the archived document does reaches past it, and webviewPolicy.ts states
// the denial where the other two evidence partitions state theirs.
export function LegacyHtmlViewer({ captureId, emptyLabel = 'No HTML available' }: Props) {
  const { data: fileUrl, error } = useQuery(captureHtmlUrlQueryOptions(captureId))
  const ref = useRef<HTMLElement | null>(null)

  // Same defence-in-depth as MhtmlViewer: navigation is already refused by
  // decideWebviewNavigation, and the CSS makes a dead link look dead.
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
    return <div className="p-4 text-text-muted">{emptyLabel}</div>
  }

  return (
    <webview
      data-testid="legacy-html-viewer"
      ref={ref as unknown as React.RefObject<HTMLElement>}
      src={fileUrl}
      partition={LEGACY_HTML_PARTITION}
      webpreferences="javascript=no,contextIsolation=yes,sandbox=yes"
      style={{ width: '100%', height: '100%', background: 'white' }}
    />
  )
}
