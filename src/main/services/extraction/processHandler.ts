import { existsSync, readFileSync } from 'fs'
import { extractData } from '@main/services/dataExtractor'
import type { ExtractedDatum } from '@main/services/dataExtractor'
import { htmlFromStoredPage } from '@main/services/extraction/extractionSource'

// The work the extraction utility process does for one Capture (#598), kept out
// of its entry file so unit tests, which run without `utilityProcess`, can call
// it directly. The main process names the stored files; the Capture Store is
// still the only module that decides where they live.

export interface ExtractionRequest {
  mhtmlPath: string
  // A legacy pre-v11 Capture's page, read only when there is no MHTML.
  htmlPath: string
}

export interface ExtractionRequestMessage extends ExtractionRequest {
  id: number
}

// What crosses back to the main process when extraction throws: an Error's name
// and errno code survive the trip, the stack does not.
export interface ExtractionErrorInfo {
  name: string
  code: string | null
  message: string
}

export type ExtractionReplyMessage =
  | { id: number; ok: true; rows: ExtractedDatum[]; durationMs: number }
  | { id: number; ok: false; error: ExtractionErrorInfo; durationMs: number }

function readIfPresent(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null
}

function errorInfo(err: unknown): ExtractionErrorInfo {
  if (!(err instanceof Error)) return { name: 'Error', code: null, message: String(err) }
  const { code } = err as NodeJS.ErrnoException
  return { name: err.name, code: typeof code === 'string' ? code : null, message: err.message }
}

// `durationMs` covers reading, decoding and extracting: the extraction's own
// cost, without the wait in the main process's queue.
export function handleExtractionMessage({
  id,
  mhtmlPath,
  htmlPath
}: ExtractionRequestMessage): ExtractionReplyMessage {
  const t0 = performance.now()
  try {
    const html = htmlFromStoredPage((type) =>
      readIfPresent(type === 'mhtml' ? mhtmlPath : htmlPath)
    )
    const rows = html ? extractData(html) : []
    return { id, ok: true, rows, durationMs: performance.now() - t0 }
  } catch (err) {
    return { id, ok: false, error: errorInfo(err), durationMs: performance.now() - t0 }
  }
}
