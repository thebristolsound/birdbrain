import { useEffect, useRef, useState } from 'react'
import { Download, ChevronDown, FileText, Image, FileArchive } from 'lucide-react'
import type { Capture } from '@shared/types'
import {
  downloadCapture,
  downloadCapturePdf,
  downloadCaptureScreenshot
} from '@renderer/lib/api/system'

interface Props {
  capture: Capture
}

// Single always-visible entry point for every capture artifact download
// (MHTML/HTML archive, PDF report, screenshot). Lives in the viewer toolbar so
// it stays reachable even when the details panel is collapsed to the rail.
export function CaptureDownloadMenu({ capture }: Props) {
  const [open, setOpen] = useState(false)
  const [pdfExporting, setPdfExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setError(null)
  }, [capture.id])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function run(fn: () => Promise<unknown>) {
    setOpen(false)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    }
  }

  async function handlePdf() {
    setOpen(false)
    setError(null)
    setPdfExporting(true)
    try {
      await downloadCapturePdf(capture.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF export failed')
    } finally {
      setPdfExporting(false)
    }
  }

  const archiveLabel = capture.format === 'mhtml' ? 'MHTML archive' : 'HTML page'
  const itemClass =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated disabled:opacity-50'

  return (
    <div className="relative flex shrink-0 items-center gap-1.5">
      {error && (
        <span
          data-testid="capture-download-error"
          title={error}
          className="max-w-40 truncate text-[11px] text-red-500"
        >
          {error}
        </span>
      )}
      <button
        ref={anchorRef}
        onClick={() => setOpen((v) => !v)}
        title="Download capture artifacts"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="capture-download-menu-btn"
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-accent hover:bg-accent-subtle"
      >
        <Download className="h-3.5 w-3.5" />
        {pdfExporting ? 'Exporting…' : 'Download'}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border-strong bg-card py-1 shadow-xl"
        >
          <button
            role="menuitem"
            data-testid="download-archive-btn"
            onClick={() => run(() => downloadCapture(capture.id))}
            className={itemClass}
          >
            <FileArchive className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            {archiveLabel}
          </button>
          <button
            role="menuitem"
            data-testid="download-pdf-btn"
            disabled={pdfExporting}
            onClick={handlePdf}
            className={itemClass}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            {pdfExporting ? 'Exporting PDF…' : 'PDF report'}
          </button>
          <button
            role="menuitem"
            data-testid="download-screenshot-btn"
            disabled={!capture.screenshotPath}
            title={capture.screenshotPath ? undefined : 'No screenshot for this capture'}
            onClick={() => run(() => downloadCaptureScreenshot(capture.id))}
            className={itemClass}
          >
            <Image className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            Screenshot (PNG)
          </button>
        </div>
      )}
    </div>
  )
}
