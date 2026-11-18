import { create } from 'zustand'
import type { ArchiveExportResult } from '@shared/ipc'
import { useCasesMutations } from '@renderer/lib/api/cases'
import { notifyExportWritten } from '@renderer/components/export/exportNotice'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

type Progress = { step: string; percent: number }

interface CaseExports {
  pending: Record<string, Progress>
  failed: Record<string, string>
}

// A Case Archive export belongs to its Case, not to the menu that started it. The menu leaves
// the screen on the dashboard and in Settings, and changes Case in place from the palette,
// while an export can still be running. So the running steps and the failures are kept here,
// outside any component and keyed by Case: coming back to the Case by any route finds its
// export still running, or its failure still to dismiss.
export const useCaseExports = create<CaseExports>(() => ({ pending: {}, failed: {} }))

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map }
  delete next[key]
  return next
}

// The Case menu's side of a Case Archive export: its progress while it runs, and its failure
// until the Operator dismisses it, both for the Case on screen only.
export function useCaseExport(caseId: string) {
  const { exportArchive } = useCasesMutations()
  const progress = useCaseExports((s) => s.pending[caseId])
  const archiveError = useCaseExports((s) => s.failed[caseId] ?? '')

  async function startArchive() {
    const id = caseId
    useCaseExports.setState((s) => ({
      pending: { ...s.pending, [id]: { step: 'Preparing archive…', percent: 0 } },
      failed: without(s.failed, id)
    }))
    // The export listens for its own steps for as long as it runs, whether or not the menu is
    // on screen, so coming back shows how far it has got. Steps of any other Case's export,
    // such as one the Members tab started, are not its to keep.
    const stopListening = window.birdbrain.onArchiveProgress(({ caseId: from, step, percent }) => {
      if (from !== id) return
      useCaseExports.setState((s) =>
        id in s.pending ? { pending: { ...s.pending, [id]: { step, percent } } } : s
      )
    })
    let written: ArchiveExportResult | null = null
    let failure: string | null = null
    try {
      written = await exportArchive.mutateAsync(id)
    } catch (err) {
      failure = messageOf(err)
    }
    // The notice is app-wide and names its path, so it is raised even when the
    // operator has since switched cases: that is when it is most needed.
    if (written && !written.canceled && written.filePath) {
      notifyExportWritten('Archive saved', written.filePath, written.filePath)
    }
    stopListening()
    const failed = failure
    useCaseExports.setState((s) => ({
      pending: without(s.pending, id),
      failed: failed === null ? s.failed : { ...s.failed, [id]: failed }
    }))
  }

  return {
    startArchive,
    isExporting: progress !== undefined,
    progressLabel: progress ? `${progress.step} — ${Math.round(progress.percent)}%` : null,
    archiveError,
    dismissArchiveError: () =>
      useCaseExports.setState((s) => ({ failed: without(s.failed, caseId) }))
  }
}
