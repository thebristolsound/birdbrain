import { describe, it, expect, vi } from 'vitest'
import type { ExportOptions } from '@shared/types'
import { fakeBridge } from '../fakeBridge'
import { exportPreflight, generateExportReport } from '@renderer/lib/api/export'

describe('export commands', () => {
  it('reads the preflight summary for a case', async () => {
    const preflight = vi.fn(async () => ({ captureCount: 3 }))
    fakeBridge({ export: { preflight } })

    await expect(exportPreflight('case1')).resolves.toEqual({ captureCount: 3 })
    expect(preflight).toHaveBeenCalledWith('case1')
  })

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

    await expect(generateExportReport('case1', options)).resolves.toEqual({
      canceled: false,
      filePath: '/out.zip'
    })
    expect(generateReport).toHaveBeenCalledWith('case1', options)
  })
})
