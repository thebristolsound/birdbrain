import * as db from '@main/services/database'
import { extractData } from '@main/services/dataExtractor'
import { readExtractionHtml } from '@main/services/extraction/extractionSource'

// Re-runs extraction for every capture in a case. Yields to the event loop
// between captures so the main process stays responsive, and swallows
// per-capture errors so one bad source file doesn't poison the batch.
export async function reprocessCase(caseId: string): Promise<{ processed: number }> {
  const captures = db.listCaptures(caseId)
  for (const cap of captures) {
    await new Promise<void>((resolve) => setImmediate(resolve))
    try {
      // Always clear first so legacy rows don't linger when a capture has no
      // readable source file anymore.
      db.deleteExtractedDataForCapture(cap.id)
      const html = readExtractionHtml(caseId, cap.id)
      if (html) {
        const extracted = extractData(html)
        db.insertExtractedData(cap.id, caseId, cap.url, extracted)
      }
    } catch (err) {
      console.error('Reprocess extraction error for capture', cap.id, err)
    }
  }
  return { processed: captures.length }
}
