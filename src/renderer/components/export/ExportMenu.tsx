import { useEffect, useRef, useState } from 'react'
import {
  FileOutput,
  ChevronDown,
  FileText,
  Archive,
  Loader2,
  CheckCircle2
} from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { Button } from '@renderer/components/ui'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { useCasesMutations } from '@renderer/lib/queries'
import { revealInFolder } from '@renderer/lib/api/system'

interface ExportMenuProps {
  caseId: string
  caseName: string
}

export function ExportMenu({ caseId, caseName }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const { exportArchive } = useCasesMutations()
  const [archiveResult, setArchiveResult] = useState<{ filePath: string } | null>(null)
  const [archiveError, setArchiveError] = useState('')
  const [archiveProgress, setArchiveProgress] = useState<{ step: string; percent: number } | null>(
    null
  )
  const [exportingCaseId, setExportingCaseId] = useState<string | null>(null)

  // Tracks the currently-displayed case so a still-in-flight export that resolves
  // after a case switch can detect it's stale (the async closure captured the old id).
  const caseIdRef = useRef(caseId)

  const menuRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    caseIdRef.current = caseId
    // Switching cases must not carry a stale export banner/progress across.
    setArchiveResult(null)
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

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function handleExportArchive() {
    setOpen(false)
    const exportCaseId = caseId
    setArchiveError('')
    setArchiveResult(null)
    setArchiveProgress({ step: 'Preparing archive…', percent: 0 })
    setExportingCaseId(exportCaseId)
    try {
      const result = await exportArchive.mutateAsync(exportCaseId)
      // Ignore a completion that lands after the user switched cases.
      if (caseIdRef.current !== exportCaseId) return
      if (!result.canceled && result.filePath) {
        setArchiveResult({ filePath: result.filePath })
      }
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

  // Reveal is the only way back to the archive from this banner, so a failed
  // one has to say so — reusing the export banner rather than adding a second
  // error surface, the same way ExportComplete reuses its actionError.
  async function handleReveal(filePath: string) {
    setArchiveError('')
    try {
      await revealInFolder(filePath)
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err))
    }
  }

  const isExporting = exportingCaseId === caseId

  return (
    <div className="relative">
      <Button
        ref={anchorRef}
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={isExporting}
        aria-haspopup="menu"
        aria-expanded={open}
        className="gap-1.5"
      >
        {isExporting ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.8} />
        ) : (
          <FileOutput className="h-3 w-3" strokeWidth={1.8} />
        )}
        {isExporting && archiveProgress
          ? `${archiveProgress.step} — ${Math.round(archiveProgress.percent)}%`
          : 'Export'}
        <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
      </Button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border-strong bg-card py-1 shadow-xl"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setShowReport(true)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
            Export evidence report
          </button>
          <button
            role="menuitem"
            onClick={handleExportArchive}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated"
          >
            <Archive className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
            Export case file
          </button>
        </div>
      )}

      {(archiveResult || archiveError) && (
        <div className="absolute right-0 top-full z-40 mt-1 flex flex-col items-end gap-1.5">
          {archiveResult && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400"
            >
              <CheckCircle2 size={12} strokeWidth={1.8} className="shrink-0" />
              <span className="max-w-[220px] truncate" title={archiveResult.filePath}>
                Archive saved
              </span>
              <button
                type="button"
                className="font-semibold underline underline-offset-2 hover:text-emerald-300"
                onClick={() => void handleReveal(archiveResult.filePath)}
              >
                Show in folder
              </button>
            </div>
          )}
          {archiveError && (
            <div
              role="alert"
              aria-live="assertive"
              className="max-w-[260px] rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs text-red-400"
            >
              {archiveError}
            </div>
          )}
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
