import { join } from 'path'
import { Readable } from 'stream'
import { initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { initManifest } from '@main/services/manifest'
import {
  createCaptureLifecycle,
  ingestMhtmlCapture,
  type CaptureLifecycle
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import type { ExportOptions } from '@shared/types'

// A Case under `tempDir` for the streamed-export tests (#932), whose page archives are large
// enough to span many read chunks. The caller closes the database and removes `tempDir`.
export async function openStreamedExportCase(
  tempDir: string
): Promise<{ caseId: string; lifecycle: CaptureLifecycle }> {
  initStorage(join(tempDir, 'captures'))
  await initDatabase(':memory:')
  resetInstallationId()
  initInstallationId(tempDir)
  initSettings(tempDir)
  updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })
  const caseId = createCase({ name: 'Streamed Export Case' }).id
  ensureCaseDir(caseId)
  initManifest(join(tempDir, 'captures', caseId))
  const lifecycle = createCaptureLifecycle({
    selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
  })
  return { caseId, lifecycle }
}

// Streams `bytes` into the Case as a page archive, so ingest never holds a large page whole.
export const ingestLargePage = (caseId: string, n: number, bytes: Buffer | Iterable<Buffer>) =>
  ingestMhtmlCapture({
    caseId,
    url: `https://example.com/${n}`,
    title: `Large page ${n}`,
    timestamp: '2026-04-05T12:00:00.000Z',
    stream: Readable.from(
      Buffer.isBuffer(bytes) ? [bytes] : bytes
    ) as unknown as ReadableStream<Uint8Array>,
    textContent: `page ${n}`,
    headers: {},
    browserVersion: '',
    userAgent: '',
    httpStatus: 200,
    extensionVersion: '',
    operatorId: 'op',
    operatorName: 'Test Operator',
    toolVersion: '0.1.0'
  })

export const streamedExportOptions = (
  outputPath: string,
  include: Partial<ExportOptions['include']> = {}
): ExportOptions => ({
  format: 'zip',
  include: {
    captures: true,
    screenshots: false,
    auditTrail: true,
    notes: false,
    annotations: 'none',
    ...include
  },
  exportClass: 'evidence',
  outputPath
})
