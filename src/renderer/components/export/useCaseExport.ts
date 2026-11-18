import { useEffect, useRef, useState } from 'react'
import type { ArchiveExportResult } from '@shared/ipc'
import { useCasesMutations } from '@renderer/lib/queries'
import { notifyExportWritten } from '@renderer/components/export/exportNotice'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

type Progress = { step: string; percent: number }

// A Case Archive export started from the Case menu: its progress while it runs, and its failure
// until the Operator dismisses it. A running export belongs to its Case, not to the visit: it
// stays pending while the Operator looks at another Case, so coming back shows it still running
// and its item stays disabled. A failure shows only if that Case is on screen when it happens,
// and a switch of Case drops it.
export function useCaseExport(caseId: string) {
  const { exportArchive } = useCasesMutations()
  const [archiveError, setArchiveError] = useState('')
  const [pending, setPending] = useState<Record<string, Progress>>({})

  // Tracks the currently-displayed case so a still-in-flight export that resolves
  // after a case switch can detect it's stale (the async closure captured the old id).
  const caseIdRef = useRef(caseId)

  useEffect(() => {
    caseIdRef.current = caseId
    // Switching cases must not carry a stale export banner across.
    setArchiveError('')
  }, [caseId])

  useEffect(() => {
    const unsubscribe = window.birdbrain.onArchiveProgress((event) => {
      const { caseId: id, step, percent } = event
      // Only an export started here is tracked, so progress for any other Case is not kept.
      if (id === undefined) return
      setPending((now) => (id in now ? { ...now, [id]: { step, percent } } : now))
    })
    return unsubscribe
  }, [])

  async function startArchive() {
    const exportCaseId = caseId
    setArchiveError('')
    setPending((now) => ({ ...now, [exportCaseId]: { step: 'Preparing archive…', percent: 0 } }))
    let written: ArchiveExportResult | null = null
    let failure: string | null = null
    try {
      written = await exportArchive.mutateAsync(exportCaseId)
    } catch (err) {
      failure = messageOf(err)
    }
    // The notice is app-wide and names its path, so it is raised even when the
    // operator has since switched cases: that is when it is most needed.
    if (written && !written.canceled && written.filePath) {
      notifyExportWritten('Archive saved', written.filePath, written.filePath)
    }
    // Only this export ends here, whichever Case is on screen.
    setPending((now) => {
      const next = { ...now }
      delete next[exportCaseId]
      return next
    })
    // A Case the Operator is not looking at shows no failure of this export.
    if (caseIdRef.current !== exportCaseId) return
    if (failure !== null) setArchiveError(failure)
  }

  const progress = pending[caseId]
  const isExporting = progress !== undefined
  const progressLabel = progress ? `${progress.step} — ${Math.round(progress.percent)}%` : null

  return {
    startArchive,
    isExporting,
    progressLabel,
    archiveError,
    dismissArchiveError: () => setArchiveError('')
  }
}
