import { readCaptureFile } from '@main/services/storage'
import * as db from '@main/services/database'
import { extractData } from '@main/services/dataExtractor'

function loadCaptureContent(
  caseId: string,
  captureId: string,
  fallbackText?: string
): string | null {
  const htmlBuffer = readCaptureFile(caseId, captureId, 'html')
  if (htmlBuffer) return htmlBuffer.toString('utf-8')

  const textBuffer = readCaptureFile(caseId, captureId, 'txt')
  if (textBuffer) return textBuffer.toString('utf-8')

  const ftsContent = db.getCaptureTextContent(captureId)
  if (ftsContent) return ftsContent

  return fallbackText ?? null
}

export function extractAndStoreForCapture(params: {
  captureId: string
  caseId: string
  sourceUrl: string
  fallbackText?: string
}): void {
  db.deleteExtractedDataForCapture(params.captureId)
  const content = loadCaptureContent(params.caseId, params.captureId, params.fallbackText)
  if (!content) return
  const extracted = extractData(content)
  if (extracted.length === 0) return
  db.insertExtractedData(params.captureId, params.caseId, params.sourceUrl, extracted)
}

export function reprocessExtractedDataForCase(caseId: string): Promise<{ processed: number }> {
  const captures = db.listCaptures(caseId)
  db.deleteExtractedDataForCase(caseId)

  return new Promise((resolve) => {
    const CHUNK_SIZE = 25
    let processed = 0

    const processChunk = (start: number) => {
      const end = Math.min(start + CHUNK_SIZE, captures.length)
      for (let i = start; i < end; i++) {
        const cap = captures[i]
        extractAndStoreForCapture({
          captureId: cap.id,
          caseId,
          sourceUrl: cap.url
        })
        processed++
      }

      if (end < captures.length) {
        setImmediate(() => processChunk(end))
      } else {
        resolve({ processed })
      }
    }

    if (captures.length === 0) {
      resolve({ processed: 0 })
      return
    }

    processChunk(0)
  })
}
