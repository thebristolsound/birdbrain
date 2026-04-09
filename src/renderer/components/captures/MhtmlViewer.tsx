import { useEffect, useRef, useState } from 'react'

interface Props {
  captureId: string
}

// Renders MHTML via an Electron <webview> with JavaScript disabled.
export function MhtmlViewer({ captureId }: Props) {
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setError(null)
    setFileUrl(null)
    window.birdbrain.captures
      .getMhtmlUrl(captureId)
      .then((url) => {
        if (!url) setError('MHTML file not found on disk')
        else setFileUrl(url)
      })
      .catch((e) => setError(String(e)))
  }, [captureId])

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
    return <div className="p-4 text-sm text-red-400">{error}</div>
  }
  if (!fileUrl) {
    return <div className="p-4 text-text-muted">Loading MHTML...</div>
  }

  return (
    <webview
      ref={ref as unknown as React.RefObject<HTMLElement>}
      src={fileUrl}
      partition="mhtml-sandbox"
      nodeintegration="false"
      allowpopups="false"
      webpreferences="javascript=no,contextIsolation=yes,sandbox=yes"
      style={{ width: '100%', height: '100%', background: 'white' }}
    />
  )
}
