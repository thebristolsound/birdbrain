import type { ExportResult } from '@shared/ipc'
import type { ExportOptions, ExportPreflight } from '@shared/types'

// Both calls stay plain wrappers rather than becoming a query and a mutation.
// ExportDialog drives the preflight from a mount effect and the generate from
// its own phase machine, and rehoming either into the cache is a behaviour
// change the design keeps out of the mechanical move. Tracked in #346.

export function exportPreflight(caseId: string): Promise<ExportPreflight> {
  return window.birdbrain.export.preflight(caseId)
}

export function generateExportReport(
  caseId: string,
  options: ExportOptions
): Promise<ExportResult> {
  return window.birdbrain.export.generateReport(caseId, options)
}
