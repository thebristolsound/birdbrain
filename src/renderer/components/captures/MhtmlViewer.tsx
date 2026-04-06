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
      nodeintegration="false"
      allowpopups="false"
      webpreferences="javascript=no,contextIsolation=yes"
      style={{ width: '100%', height: '100%', minHeight: '500px', background: 'white' }}
    />
  )
}
