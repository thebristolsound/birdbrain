import { useMutation } from '@tanstack/react-query'
import type { ExportProgressEvent, ArchiveProgressEvent } from '@shared/ipc'
import type { ExportOptions, ExportPreflight } from '@shared/types'

export const preflightExport = (caseId: string): Promise<ExportPreflight> =>
  window.birdbrain.export.preflight(caseId)

export function useGenerateReport() {
  return useMutation({
    mutationFn: ({ caseId, options }: { caseId: string; options: ExportOptions }) =>
      window.birdbrain.export.generateReport(caseId, options)
  })
}

// Progress arrives over event channels (main -> renderer); components keep
// their subscribe-in-effect wiring and just import these 1:1 wrappers.
export const subscribeExportProgress = (
  callback: (event: ExportProgressEvent) => void
): (() => void) => window.birdbrain.onExportProgress(callback)

export const subscribeArchiveProgress = (
  callback: (event: ArchiveProgressEvent) => void
): (() => void) => window.birdbrain.onArchiveProgress(callback)
