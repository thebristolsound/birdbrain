import { useCallback, useRef, useState } from 'react'
import type { ArchiveInspectReport } from '@shared/types'
import { inspectCaseArchive } from '@renderer/lib/api/cases'

// Picks a Case Archive and inspects it; the caller renders ImportCaseDialog
// with the report. Shared by the dashboard, the New Case start step and the Case menu.
export function useCaseArchiveImport() {
  const [report, setReport] = useState<ArchiveInspectReport | null>(null)
  const [error, setError] = useState('')

  // The item that starts this stays enabled while the file picker is up, and each call opens a
  // picker of its own, so a call made while one is up does nothing.
  const inspecting = useRef(false)

  const start = useCallback(async () => {
    if (inspecting.current) return
    inspecting.current = true
    setError('')
    try {
      const inspected = await inspectCaseArchive()
      if (inspected) setReport(inspected)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    inspecting.current = false
  }, [])

  const close = useCallback(() => setReport(null), [])
  const dismissError = useCallback(() => setError(''), [])

  return { report, error, start, close, dismissError }
}
