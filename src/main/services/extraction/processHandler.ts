import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { extractData } from '@main/services/dataExtractor'
import type { ExtractedDatum } from '@main/services/dataExtractor'
import { htmlFromStoredPage } from '@main/services/extraction/extractionSource'
import { extractFields, type FieldBuildData } from '@main/services/search/fieldExtractor'

// The work the extraction utility process does for one Capture (#598), kept out
// of its entry file so unit tests, which run without `utilityProcess`, can call
// it directly. The main process names the stored files; the Capture Store is
// still the only module that decides where they live.

export interface ExtractionRequest {
  mhtmlPath: string
  // A legacy pre-v11 Capture's page, read only when there is no MHTML.
  htmlPath: string
  fieldUrl?: string
  textPath?: string
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
  | {
      id: number
      ok: true
      rows: ExtractedDatum[]
      durationMs: number
      fieldBuild?: FieldBuildReply
    }
  | {
      id: number
      ok: false
      error: ExtractionErrorInfo
      durationMs: number
      fieldBuild?: FieldBuildReply
    }

export type FieldBuildReply =
  | { ok: true; result: FieldBuildData; durationMs: number }
  | { ok: false; error: ExtractionErrorInfo; durationMs: number }

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
  htmlPath,
  fieldUrl,
  textPath
}: ExtractionRequestMessage): ExtractionReplyMessage {
  const t0 = performance.now()
  let mhtml: Buffer | null = null
  let legacyHtml: Buffer | null = null
  let rows: ExtractedDatum[] = []
  let extractionError: ExtractionErrorInfo | null = null
  let artifactReadError: ExtractionErrorInfo | null = null
  try {
    mhtml = readIfPresent(mhtmlPath)
    legacyHtml = mhtml ? null : readIfPresent(htmlPath)
  } catch (err) {
    artifactReadError = errorInfo(err)
    extractionError = artifactReadError
  }
  if (!artifactReadError) {
    try {
      const html = htmlFromStoredPage((type) => (type === 'mhtml' ? mhtml : legacyHtml))
      rows = html ? extractData(html) : []
    } catch (err) {
      extractionError = errorInfo(err)
    }
  }

  const durationMs = performance.now() - t0
  const fieldBuild: FieldBuildReply | undefined =
    fieldUrl === undefined
      ? undefined
      : artifactReadError
        ? { ok: false as const, error: artifactReadError, durationMs: 0 }
        : buildFields(fieldUrl, mhtml, legacyHtml, textPath)
  return extractionError
    ? { id, ok: false, error: extractionError, durationMs, fieldBuild }
    : { id, ok: true, rows, durationMs, fieldBuild }
}

function buildFields(
  fieldUrl: string,
  mhtml: Buffer | null,
  legacyHtml: Buffer | null,
  textPath: string | undefined
): FieldBuildReply {
  const t0 = performance.now()
  try {
    if (!mhtml && !legacyHtml) {
      return {
        ok: true,
        result: { fields: [], textHash: null, outcome: 'no-source', skippedJson: null },
        durationMs: performance.now() - t0
      }
    }
    const text = textPath ? readIfPresent(textPath) : null
    const textHash = text ? createHash('sha256').update(text).digest('hex') : null
    const { fields, skippedParts, mainDocumentSkipped, truncated } = extractFields({
      captureUrl: fieldUrl,
      mhtml,
      html: legacyHtml,
      text: text ? text.toString('utf-8') : null
    })
    const { tooLarge, overPartCount, overTotalSize } = skippedParts
    const partial = tooLarge + overPartCount + overTotalSize > 0 || mainDocumentSkipped || truncated
    const result: FieldBuildData = {
      fields,
      textHash,
      outcome: partial ? 'partial' : 'built',
      skippedJson: partial
        ? JSON.stringify({ ...skippedParts, mainDocumentSkipped, truncated })
        : null
    }
    return { ok: true, result, durationMs: performance.now() - t0 }
  } catch (err) {
    return { ok: false, error: errorInfo(err), durationMs: performance.now() - t0 }
  }
}
