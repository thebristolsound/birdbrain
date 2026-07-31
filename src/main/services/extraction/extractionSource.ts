import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import { extractHtmlFromMhtml } from '@main/services/mhtmlDecoder'

// Prefer MHTML (current format); fall back to .html for legacy captures
// saved before migration v11, which had format='html' and no mhtml file.
export function readExtractionHtml(
  caseId: string,
  captureId: string,
  store: CaptureStore = defaultCaptureStore
): string | null {
  const mhtmlBuffer = store.readArtifact(caseId, captureId, 'mhtml')
  if (mhtmlBuffer) return extractHtmlFromMhtml(mhtmlBuffer)
  const htmlBuffer = store.readArtifact(caseId, captureId, 'html')
  return htmlBuffer ? htmlBuffer.toString('utf8') : null
}
