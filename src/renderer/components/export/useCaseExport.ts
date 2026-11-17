import { useEffect, useRef, useState } from 'react'
import type { ArchiveExportResult } from '@shared/ipc'
import { useCasesMutations } from '@renderer/lib/queries'
import { notifyExportWritten } from '@renderer/components/export/exportNotice'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// A Case Archive export started from the Case menu: its progress while it runs, and its failure
// until the Operator dismisses it. Both belong to the Case on screen, so a switch of Case drops
// them, and an export that settles after the switch reports nothing here.
export function useCaseExport(caseId: string) {
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

  async function startArchive() {
    const exportCaseId = caseId
    setArchiveError('')
    setArchiveProgress({ step: 'Preparing archive…', percent: 0 })
    setExportingCaseId(exportCaseId)
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
    // A Case the Operator has left keeps nothing of this export.
    if (caseIdRef.current !== exportCaseId) return
    if (failure !== null) setArchiveError(failure)
    setArchiveProgress(null)
    setExportingCaseId(null)
  }

  const isExporting = exportingCaseId === caseId
  const progressLabel =
    isExporting && archiveProgress
      ? `${archiveProgress.step} — ${Math.round(archiveProgress.percent)}%`
      : null

  return {
    startArchive,
    isExporting,
    progressLabel,
    archiveError,
    dismissArchiveError: () => setArchiveError('')
  }
}
