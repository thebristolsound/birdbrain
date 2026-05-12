import * as db from '@main/services/database'
import { extractData } from '@main/services/dataExtractor'
import { readExtractionHtml } from '@main/services/extraction/extractionSource'
import {
  ingestMhtmlCapture,
  type IngestParams,
  type IngestResult
} from '@main/services/mhtmlIngest'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'

export interface CaptureLifecycleDeps {
  selectorLifecycle: SelectorLifecycle
}

export interface CaptureLifecycle {
  ingest: (params: IngestParams) => Promise<IngestResult>
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
    }
  }
}
