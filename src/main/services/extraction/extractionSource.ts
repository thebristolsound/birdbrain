import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import { extractHtmlFromMhtml } from '@main/services/mhtmlDecoder'

// Prefer MHTML (current format); fall back to .html for legacy captures
// saved before migration v11, which had format='html' and no mhtml file.
// `read` returns a stored file's bytes, or null when it is not there.
export function htmlFromStoredPage(read: (type: 'mhtml' | 'html') => Buffer | null): string | null {
  const mhtmlBuffer = read('mhtml')
  if (mhtmlBuffer) return extractHtmlFromMhtml(mhtmlBuffer)
  const htmlBuffer = read('html')
  return htmlBuffer ? htmlBuffer.toString('utf8') : null
}

export function readExtractionHtml(
  caseId: string,
  captureId: string,
  store: CaptureStore = defaultCaptureStore
): string | null {
  return htmlFromStoredPage((type) => store.readArtifact(caseId, captureId, type))
}
