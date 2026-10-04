import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { FileOutput, ChevronDown, FileText, Archive, Loader2, X } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { Button } from '@renderer/components/ui'
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

  const menuRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  // Focus lands on the first item when the menu opens, as the menu role promises.
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    )
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (index + 1) % items.length
    else if (e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (next < 0) return
    e.preventDefault()
    items[next]?.focus()
  }

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
        anchorRef.current?.focus()
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
    // The item unmounts with the menu, so hand focus back first or the
    // keyboard lands on the document once the save dialog closes.
    anchorRef.current?.focus()
    setOpen(false)
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

  return (
    <div className="relative" data-tour="export">
      <Button
        ref={anchorRef}
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={isExporting}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
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
          id={menuId}
          role="menu"
          aria-label="Export options"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border-strong bg-card py-1 shadow-xl"
        >
          <button
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              setOpen(false)
              // The item unmounts with the menu, so the dialog would record a
              // detached opener and have nowhere to hand focus back to.
              anchorRef.current?.focus()
              setShowReport(true)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
            Export evidence report
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            onClick={handleExportArchive}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-elevated"
          >
            <Archive className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.8} />
            Export case file
          </button>
        </div>
      )}

      {/* A failed archive stays up until dismissed rather than timing out:
          the mock has no failure path, and an error is not a transient notice. */}
      {archiveError && (
        <div
          role="alert"
          aria-live="assertive"
          className="absolute right-0 top-full z-40 mt-1 flex max-w-[260px] items-start gap-1.5 rounded border border-red-500/30 bg-red-500/10 py-1 pr-1 pl-2.5 text-xs text-red-400"
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
