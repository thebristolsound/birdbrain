import { useEffect, useState } from 'react'
import { Download, ChevronDown, FileText, Image, FileArchive } from 'lucide-react'
import type { Capture } from '@shared/types'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui'
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
  const [pdfExporting, setPdfExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
  }, [capture.id])

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    }
  }

  async function handlePdf() {
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

  return (
    <div className="relative flex shrink-0 items-center gap-1.5">
      {/* Out of the toolbar row rather than beside the trigger (#466): a
          download error has no length an operator can predict, and in the row it
          pushed the capture pager off screen at a narrow pane — 54px of overflow
          at the 360px panel minimum. Dropped below the trigger like the case
          ExportMenu's, it costs the row nothing and reads in full. The message
          may be one unbroken token — a destination path — so it wraps at any
          point rather than running past the box into the shell's clip. */}
      {error && (
        <div
          role="alert"
          data-testid="capture-download-error"
          className="absolute right-0 top-full z-40 mt-1 max-w-64 break-words rounded border border-danger-line bg-danger-surface px-2.5 py-1 text-[11px] text-danger-fg"
        >
          {error}
        </div>
      )}
      {/* The visible "Exporting…" label is hidden below 48rem, so the progress
          has to reach a screen reader some other way. A live region rather than
          a swapped aria-label: the button stays addressable by its purpose
          while the export runs. */}
      <span role="status" aria-live="polite" className="sr-only">
        {pdfExporting ? 'Exporting PDF' : ''}
      </span>
      <Menu>
        <MenuTrigger
          title="Download capture artifacts"
          aria-label="Download capture artifacts"
          data-testid="capture-download-menu-btn"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-accent hover:bg-accent-subtle"
        >
          <Download className="h-3.5 w-3.5 shrink-0" />
          {/* Icon-only below the viewer toolbar's widest tier (#466), where the
              label is what pushed the capture pager off screen. The container is
              named on the viewer shell in CaptureViewer, and the aria-label above
              carries the name the text no longer supplies. */}
          <span className="hidden @3xl/viewer:inline">
            {pdfExporting ? 'Exporting…' : 'Download'}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </MenuTrigger>
        <MenuContent className="w-52">
          <MenuItem
            data-testid="download-archive-btn"
            onSelect={() => run(() => downloadCapture(capture.id))}
          >
            <FileArchive className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            {archiveLabel}
          </MenuItem>
          <MenuItem data-testid="download-pdf-btn" disabled={pdfExporting} onSelect={handlePdf}>
            <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            {pdfExporting ? 'Exporting PDF…' : 'PDF report'}
          </MenuItem>
          <MenuItem
            data-testid="download-screenshot-btn"
            disabled={!capture.screenshotPath}
            title={capture.screenshotPath ? undefined : 'No screenshot for this capture'}
            onSelect={() => run(() => downloadCaptureScreenshot(capture.id))}
          >
            <Image className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            Screenshot (PNG)
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}
