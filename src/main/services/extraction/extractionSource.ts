import * as storage from '@main/services/storage'
import { extractHtmlFromMhtml } from '@main/services/mhtmlDecoder'

// Prefer MHTML (current format); fall back to .html for legacy captures
// saved before migration v11, which had format='html' and no mhtml file.
export function readExtractionHtml(caseId: string, captureId: string): string | null {
  const mhtmlBuffer = storage.readCaptureFile(caseId, captureId, 'mhtml')
  if (mhtmlBuffer) return extractHtmlFromMhtml(mhtmlBuffer)
  const htmlBuffer = storage.readCaptureFile(caseId, captureId, 'html')
  return htmlBuffer ? htmlBuffer.toString('utf8') : null
}
