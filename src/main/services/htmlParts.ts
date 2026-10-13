import type { CheerioAPI } from 'cheerio'
import type { CaptureLink, CaptureLinks } from '@shared/types'
import { listHtmlPartsInMhtml } from '@main/services/mhtmlDecoder'

// Reading a stored page's HTML parts under fixed ceilings, and resolving the links in
// them. Shared by the Links tab (captureLinks.ts) and the Case search field index
// (search/fieldExtractor.ts), so both refuse the same parts and resolve an href the
// same way.

export interface CaptureLinkBudgets {
  /** An HTML part larger than this, as stored, is skipped without being decoded. */
  maxPartBytes: number
  /** HTML parts after this many are skipped. */
  maxParts: number
  /**
   * The most bytes, summed over the parts read, that are decoded at all. Checked on
   * each part's stored size before decoding it: no encoding the decoder reads yields
   * more bytes than it stores, so the decoded total stays under the same ceiling.
   */
  maxTotalBytes: number
  /** Rows after this many are not listed, and reading stops at the first one. */
  maxRows: number
}

// These ceilings are applied before a part is decoded. MAX_HTML_BYTES is a different
// rule (the sanitizer truncates a document and still parses it), so it is not reused.
export const CAPTURE_LINK_BUDGETS: CaptureLinkBudgets = {
  maxPartBytes: 8 * 1024 * 1024,
  maxParts: 64,
  maxTotalBytes: 32 * 1024 * 1024,
  maxRows: 5000
}

export function resolveUrl(value: string, base: string): string | null {
  try {
    return new URL(value, base).href
  } catch {
    return null
  }
}

// A part's document URL: its Content-Location against the Capture's URL. A `cid:`
// location names a part, not a page, so it falls back to the Capture's URL, as does
// one that does not parse.
export function partDocumentUrl(contentLocation: string | null, captureUrl: string): string {
  if (!contentLocation || /^cid:/i.test(contentLocation)) return captureUrl
  return resolveUrl(contentLocation, captureUrl) ?? captureUrl
}

/** The URL an href in this document resolves against: its first `<base href>`, if valid. */
export function documentBase($: CheerioAPI, documentUrl: string): string {
  const baseHref = $('base[href]').first().attr('href')
  return (baseHref && resolveUrl(baseHref, documentUrl)) || documentUrl
}

export interface HtmlPartInput {
  html: string
  documentUrl: string
  frame: CaptureLink['frame']
  /** The part's position among the archive's text/html parts, in file order. */
  part: number
}

export interface HtmlPartsRead {
  /** The main document first, then the embedded frames in file order. */
  parts: HtmlPartInput[]
  skippedParts: CaptureLinks['skippedParts']
  mainDocumentSkipped: boolean
}

/**
 * The decoded HTML parts of an MHTML. The main document is the part whose
 * Content-Location is the archive's `Snapshot-Content-Location`, else the first HTML
 * part; every other HTML part is a subframe. Ceilings are checked before a part is
 * decoded, and anything they refuse is counted rather than dropped in silence.
 */
export function readHtmlParts(
  buffer: Buffer,
  captureUrl: string,
  budgets: CaptureLinkBudgets = CAPTURE_LINK_BUDGETS
): HtmlPartsRead {
  const { snapshotLocation, parts } = listHtmlPartsInMhtml(buffer)
  const snapshotIndex =
    snapshotLocation === null
      ? -1
      : parts.findIndex((part) => part.contentLocation === snapshotLocation)
  const mainIndex = snapshotIndex === -1 ? 0 : snapshotIndex
  const ordered =
    parts.length === 0 ? [] : [mainIndex, ...parts.map((_, i) => i).filter((i) => i !== mainIndex)]

  const read: HtmlPartInput[] = []
  const skippedParts: CaptureLinks['skippedParts'] = {
    tooLarge: 0,
    overPartCount: 0,
    overTotalSize: 0
  }
  let mainDocumentSkipped = false
  let bytesRead = 0
  ordered.forEach((partIndex, index) => {
    const part = parts[partIndex]
    const refusal =
      index >= budgets.maxParts
        ? 'overPartCount'
        : part.encodedSize > budgets.maxPartBytes
          ? 'tooLarge'
          : bytesRead + part.encodedSize > budgets.maxTotalBytes
            ? 'overTotalSize'
            : null
    if (refusal) {
      // The main document has its own flag; the counts are for embedded frames.
      if (index === 0) mainDocumentSkipped = true
      else skippedParts[refusal] += 1
      return
    }
    bytesRead += part.encodedSize
    read.push({
      html: part.decode(),
      documentUrl: partDocumentUrl(part.contentLocation, captureUrl),
      frame: index === 0 ? 'main' : 'subframe',
      part: partIndex
    })
  })
  return { parts: read, skippedParts, mainDocumentSkipped }
}
