import { describe, it, expect, vi } from 'vitest'
import type { ExportOptions, ExportPreflight } from '@shared/types'
import { fakeBridge } from '../fakeBridge'
import {
  exportPreflightQueryOptions,
  generateExportMutationOptions
} from '@renderer/lib/api/export'
import { queryKeys } from '@renderer/lib/api/keys'

describe('exportPreflightQueryOptions', () => {
  it('reads the preflight summary for a case', async () => {
    // The whole summary, not a one-field stand-in: the dialog renders the
    // unstamped/pending/none counts, and a stub shaped unlike the real read
    // lets this test pass over a query that no longer returns them.
    const summary = {
      captureCount: 3,
      stampedCaptureCount: 1,
      unstampedCaptureCount: 2,
      pendingCaptureCount: 1,
      noneCaptureCount: 1
    } satisfies ExportPreflight
    const preflight = vi.fn(async () => summary)
    fakeBridge({ export: { preflight } })

    const opts = exportPreflightQueryOptions('case1')

    expect(opts.queryKey).toEqual(queryKeys.exportPreflight('case1'))
    expect(opts.enabled).toBe(true)
    await expect(opts.queryFn?.({} as never)).resolves.toEqual(summary)
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
      exportClass: 'evidence',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: true,
        notes: true,
        annotations: 'burned'
      },
      purposeOrAuthority: 'Disclosure under CPS request 2026/114',
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
