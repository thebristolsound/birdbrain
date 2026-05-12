import { app } from 'electron'
import { join } from 'path'
import * as db from '@main/services/database'
import { extractData } from '@main/services/dataExtractor'
import { readExtractionHtml } from '@main/services/extraction/extractionSource'
import { getInstallationId } from '@main/services/installationId'
import { withDeletionEntry, ManifestRollback } from '@main/services/manifest'
import {
  ingestMhtmlCapture,
  verifyCapture,
  type IngestParams,
  type IngestResult
} from '@main/services/mhtmlIngest'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { getSettings } from '@main/services/settings'
import { deleteCaptureFiles, getStorageRoot } from '@main/services/storage'
import type { HashVerification } from '@shared/types'

export interface CaptureLifecycleDeps {
  selectorLifecycle: SelectorLifecycle
}

export interface CaptureLifecycle {
  ingest: (params: IngestParams) => Promise<IngestResult>
  delete: (captureId: string) => Promise<boolean>
  verify: (captureId: string) => Promise<HashVerification>
}

function getToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}

export function createCaptureLifecycle(deps: CaptureLifecycleDeps): CaptureLifecycle {
  function runPostCaptureWork(
    captureId: string,
    caseId: string,
    url: string,
    textContent: string | undefined
  ): void {
    setImmediate(() => {
      try {
        if (textContent) {
          deps.selectorLifecycle.runActiveSelectorsForCapture(captureId, caseId, textContent)
        }
      } catch (err) {
        console.error('captureLifecycle: selector matching failed for capture', captureId, err)
      }

      try {
        const html = readExtractionHtml(caseId, captureId)
        if (html) {
          const extracted = extractData(html)
          db.insertExtractedData(captureId, caseId, url, extracted)
        }
      } catch (err) {
        console.error('captureLifecycle: data extraction failed for capture', captureId, err)
      }
    })
  }

  return {
    async ingest(params) {
      const result = await ingestMhtmlCapture(params)
      runPostCaptureWork(result.capture.id, params.caseId, params.url, params.textContent)
      return result
    },

    async delete(captureId) {
      const capture = db.getCapture(captureId)
      if (!capture) return false

      if (capture.format === 'mhtml') {
        const caseDir = join(getStorageRoot(), capture.caseId)
        try {
          await withDeletionEntry(
            caseDir,
            {
              captureId,
              caseId: capture.caseId,
              contentHash: capture.hash,
              operatorId: getInstallationId(),
              operatorName: getSettings().operatorName ?? '',
              toolVersion: getToolVersion()
            },
            () => {
              // Files first, DB row second. If the filesystem unlink throws,
              // the manifest rolls back with both DB and files intact (full retry).
              // If the DB delete fails after files are gone, the manifest still
              // rolls back and the user sees a broken capture row they can retry —
              // strictly better than the inverse, where a filesystem failure
              // after the DB delete would leave permanently orphaned files.
              deleteCaptureFiles(capture.caseId, captureId)
              const deleted = db.deleteCapture(captureId)
              if (!deleted) throw new ManifestRollback()
            }
          )
          return true
        } catch (err) {
          if (err instanceof ManifestRollback) return false
          throw err
        }
      }

      const deleted = db.deleteCapture(captureId)
      if (deleted) deleteCaptureFiles(capture.caseId, captureId)
      return deleted
    },

    verify(captureId) {
      return verifyCapture(captureId)
    }
  }
}
