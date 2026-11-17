import { useEffect, useRef, useState } from 'react'
import { FileOutput, FileText, Archive, Loader2, X } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { Button, Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { useCasesMutations } from '@renderer/lib/queries'
import { notifyExportWritten } from '@renderer/components/export/exportNotice'

interface ExportMenuProps {
  caseId: string
  caseName: string
}

export function ExportMenu({ caseId, caseName }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const { exportArchive } = useCasesMutations()
  const [archiveError, setArchiveError] = useState('')
  const [archiveProgress, setArchiveProgress] = useState<{ step: string; percent: number } | null>(
    null
  )
  const [exportingCaseId, setExportingCaseId] = useState<string | null>(null)

  // Tracks the currently-displayed case so a still-in-flight export that resolves
  // after a case switch can detect it's stale (the async closure captured the old id).
  const caseIdRef = useRef(caseId)

  useEffect(() => {
    caseIdRef.current = caseId
    // Switching cases must not carry a stale export banner/progress across.
    setArchiveError('')
    setArchiveProgress(null)
    setExportingCaseId(null)
  }, [caseId])

  useEffect(() => {
    const unsubscribe = window.birdbrain.onArchiveProgress((event) => {
      if (event.caseId === caseId) {
        setArchiveProgress({ step: event.step, percent: event.percent })
      }
    })
    return unsubscribe
  }, [caseId])

  async function handleExportArchive() {
    const exportCaseId = caseId
    setArchiveError('')
    setArchiveProgress({ step: 'Preparing archive…', percent: 0 })
    setExportingCaseId(exportCaseId)
    try {
      const { canceled, filePath } = await exportArchive.mutateAsync(exportCaseId)
      // The notice is app-wide and names its path, so it is raised even when the
      // operator has since switched cases: that is when it is most needed.
      if (!canceled && filePath) notifyExportWritten('Archive saved', filePath, filePath)
    } catch (err) {
      if (caseIdRef.current !== exportCaseId) return
      setArchiveError(err instanceof Error ? err.message : String(err))
    } finally {
      if (caseIdRef.current === exportCaseId) {
        setArchiveProgress(null)
        setExportingCaseId(null)
      }
    }
  }

  const isExporting = exportingCaseId === caseId
  const progressLabel =
    isExporting && archiveProgress
      ? `${archiveProgress.step} — ${Math.round(archiveProgress.percent)}%`
      : null

  return (
    <div className="relative" data-tour="export">
      <Menu
        open={open}
        onOpenChange={(next) => {
          if (isExporting) return
          setOpen(next)
        }}
      >
        <MenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            // aria-disabled rather than disabled: a disabled control cannot hold
            // focus, and the archive item hands focus back here as it starts.
            aria-disabled={isExporting}
            title={progressLabel ?? 'Export'}
            className="gap-1.5 aria-disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.8} />
            ) : (
              <FileOutput className="h-3 w-3" strokeWidth={1.8} />
            )}
            {/* In the top bar the label folds to the icon below lg and stays the button's
                accessible name. not-sr-only resets white-space, so truncate comes with it or a
                long step wraps out of the 28px button; the title carries the full step. No
                chevron: the format choice is the menu this opens, not a split control
                (docs/design-handoff/2026-11-08-top-bar/). */}
            <span className="sr-only lg:not-sr-only lg:max-w-44 lg:truncate">
              {progressLabel ?? 'Export'}
            </span>
          </Button>
        </MenuTrigger>
        <MenuContent aria-label="Export options">
          <MenuItem onSelect={() => setShowReport(true)}>
            <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
            Export evidence report
          </MenuItem>
          <MenuItem onSelect={handleExportArchive}>
            <Archive className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
            Export case file
          </MenuItem>
        </MenuContent>
      </Menu>

      {/* A failed archive stays up until dismissed rather than timing out:
          the mock has no failure path, and an error is not a transient notice. */}
      {archiveError && (
        <div
          role="alert"
          aria-live="assertive"
          className="absolute right-0 top-full z-40 mt-1 flex max-w-[260px] items-start gap-1.5 rounded border border-danger-line bg-danger-surface py-1 pr-1 pl-2.5 text-xs text-danger-fg"
        >
          <span className="min-w-0 flex-1">{archiveError}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="grid h-4 w-4 shrink-0 place-items-center rounded hover:bg-red-500/20"
            onClick={() => setArchiveError('')}
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      )}

      <AnimatePresence>
        {showReport && (
          <ExportDialog caseId={caseId} caseName={caseName} onClose={() => setShowReport(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
