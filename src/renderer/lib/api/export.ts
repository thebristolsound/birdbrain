import { queryOptions, useMutation } from '@tanstack/react-query'
import type { ExportResult } from '@shared/ipc'
import type { ExportOptions } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

// The preflight is a plain read of case state — how many captures carry RFC
// 3161 trusted time — rendered as a warning above the export button, so it
// takes the cacheable-read shape rather than a one-shot command.
export const exportPreflightQueryOptions = (caseId: string, captureIds?: string[]) =>
  queryOptions({
    queryKey: queryKeys.exportPreflight(caseId, captureIds),
    queryFn: () => window.birdbrain.export.preflight(caseId, captureIds),
    enabled: !!caseId
  })

export interface GenerateExportInput {
  caseId: string
  options: ExportOptions
}

// No invalidation, and so no QueryClient: generating a package writes a .zip
// outside the database and appends one `export` entry to the on-disk case
// manifest. Nothing a cached query reads moves — `manifestIndex` on a capture
// row is written at ingest and is not touched here — so there is nothing to
// refetch. Same reasoning as `exportTable` in db.ts.
export const generateExportMutationOptions = {
  mutationFn: ({ caseId, options }: GenerateExportInput): Promise<ExportResult> =>
    window.birdbrain.export.generateReport(caseId, options),
  meta: { action: 'export the case' }
}

export function useExportMutations() {
  return { generate: useMutation(generateExportMutationOptions) }
}
