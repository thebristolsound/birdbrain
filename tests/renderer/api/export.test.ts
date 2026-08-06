import { describe, it, expect, vi } from 'vitest'
import type { ExportOptions } from '@shared/types'
import { fakeBridge } from '../fakeBridge'
import {
  exportPreflightQueryOptions,
  generateExportMutationOptions
} from '@renderer/lib/api/export'
import { queryKeys } from '@renderer/lib/api/keys'

describe('exportPreflightQueryOptions', () => {
  it('reads the preflight summary for a case', async () => {
    const preflight = vi.fn(async () => ({ captureCount: 3 }))
    fakeBridge({ export: { preflight } })

    const opts = exportPreflightQueryOptions('case1')

    expect(opts.queryKey).toEqual(queryKeys.exportPreflight('case1'))
    expect(opts.enabled).toBe(true)
    await expect(opts.queryFn?.({} as never)).resolves.toEqual({ captureCount: 3 })
    expect(preflight).toHaveBeenCalledWith('case1')
  })

  it('stays disabled without a case', () => {
    expect(exportPreflightQueryOptions('').enabled).toBe(false)
  })
})

describe('generateExportMutationOptions', () => {
  it('forwards the export options unchanged', async () => {
    const generateReport = vi.fn(async () => ({ canceled: false, filePath: '/out.zip' }))
    fakeBridge({ export: { generateReport } })

    // satisfies, not an assertion: the assertion would still accept a fixture
    // that had drifted from the ExportOptions contract this test claims to pin.
    const options = {
      format: 'zip',
      include: { captures: true, screenshots: true, auditTrail: true, annotations: 'burned' },
      investigatorName: 'Investigator',
      outputPath: 'case_evidence.zip'
    } satisfies ExportOptions

    await expect(
      generateExportMutationOptions.mutationFn({ caseId: 'case1', options })
    ).resolves.toEqual({ canceled: false, filePath: '/out.zip' })
    expect(generateReport).toHaveBeenCalledWith('case1', options)
  })

  // The package lands on disk and one entry lands in the on-disk case
  // manifest; no cached query reads either, so an invalidation here would only
  // refetch queries that cannot have moved.
  it('invalidates nothing', () => {
    expect('onSuccess' in generateExportMutationOptions).toBe(false)
  })
})
