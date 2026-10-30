import { useCallback, useState } from 'react'
import type { ArchiveInspectReport } from '@shared/types'
import { inspectCaseArchive } from '@renderer/lib/api/cases'

// Picks a Case Archive and inspects it; the caller renders ImportCaseDialog
// with the report. Shared by the dashboard and the New Case start step.
export function useCaseArchiveImport() {
  const [report, setReport] = useState<ArchiveInspectReport | null>(null)
  const [error, setError] = useState('')

  const start = useCallback(async () => {
    setError('')
    try {
      const inspected = await inspectCaseArchive()
      if (inspected) setReport(inspected)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const close = useCallback(() => setReport(null), [])

  return { report, error, start, close }
}
