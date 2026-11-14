import { createHash } from 'crypto'
import { open, type FileHandle } from 'fs/promises'
import type { Capture, MhtmlPartRow, MhtmlPartsListing } from '@shared/types'
import { MAX_MHTML_SIZE } from '@shared/constants'
import { mainHtmlPartIndex, walkMhtml } from '@main/services/mhtmlDecoder'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'

// The parts of a Capture's stored MHTML, for the Data screen's MHTML Parts tab (#991). Read on
// demand and never stored: a part is a view inside one Exhibit's bytes, not an Exhibit or a
// Derived File (ADR-0023), so its hash is computed at read time and anchored nowhere. The walk
// is the one the HTML readers use, so the tab lists the parts the app's checks read.

export interface MhtmlPartsLimits {
  /** A file larger than this is refused before any of it is read. */
  maxFileBytes: number
  /** Parts past this many are counted but not listed or hashed. */
  maxRows: number
  /** A header value longer than this is cut, and the cut is flagged. */
  maxFieldChars: number
}

export const MHTML_PARTS_LIMITS: MhtmlPartsLimits = {
  // The cap ingest writes under, so every stored Capture fits.
  maxFileBytes: MAX_MHTML_SIZE,
  maxRows: 5000,
  maxFieldChars: 2048
}

interface Capped {
  value: string | null
  cut: boolean
}

function cap(value: string | null, maxChars: number): Capped {
  if (value === null || value.length <= maxChars) return { value, cut: false }
  return { value: value.slice(0, maxChars), cut: true }
}

/** The parts of an MHTML held in `buffer`, with each listed part's raw span hashed. */
export function listMhtmlParts(
  buffer: Buffer,
  limits: Pick<MhtmlPartsLimits, 'maxRows' | 'maxFieldChars'> = MHTML_PARTS_LIMITS,
  readAt: string = new Date().toISOString()
): MhtmlPartsListing {
  const { maxRows, maxFieldChars } = limits
  const rows: Omit<MhtmlPartRow, 'mainDocument'>[] = []
  // Every HTML part's full Content-Location, so the main document is chosen before any cut.
  const htmlLocations: { contentLocation: string | null }[] = []
  let position = 0
  let unterminatedParts = 0

  const walk = walkMhtml(buffer, (part) => {
    position += 1
    if (!part.headersTerminated) unterminatedParts += 1
    const htmlPart = part.html ? htmlLocations.length : null
    if (part.html) htmlLocations.push({ contentLocation: part.contentLocation })
    if (rows.length >= maxRows) return

    const { bodyStart, bodyEnd } = part
    const fields = {
      contentType: cap(part.contentType, maxFieldChars),
      transferEncoding: cap(part.transferEncoding, maxFieldChars),
      contentLocation: cap(part.contentLocation, maxFieldChars),
      contentId: cap(part.contentId, maxFieldChars)
    }
    rows.push({
      position,
      htmlPart,
      contentType: fields.contentType.value,
      transferEncoding: fields.transferEncoding.value,
      contentLocation: fields.contentLocation.value,
      contentId: fields.contentId.value,
      offset: bodyStart,
      size: bodyEnd - bodyStart,
      sha256: createHash('sha256').update(buffer.subarray(bodyStart, bodyEnd)).digest('hex'),
      headersTerminated: part.headersTerminated,
      endsAtEndOfFile: part.partEnd === buffer.length,
      fieldsTruncated: Object.values(fields).some(({ cut }) => cut)
    })
  })

  const topContentType = cap(walk.topContentType, maxFieldChars)
  if (walk.status === 'no-mime-header') {
    return { status: 'refused', readAt, refusal: { reason: 'no-mime-header' } }
  }
  if (walk.status === 'no-boundary') {
    const { value: contentType, cut: fieldsTruncated } = topContentType
    return {
      status: 'refused',
      readAt,
      refusal: { reason: 'no-boundary', contentType, fieldsTruncated }
    }
  }
  const boundary = cap(walk.boundary, maxFieldChars)
  if (walk.totalParts === 0) {
    return {
      status: 'refused',
      readAt,
      refusal: { reason: 'no-parts', boundary: boundary.value ?? '', fieldsTruncated: boundary.cut }
    }
  }

  const snapshotLocation = cap(walk.snapshotLocation, maxFieldChars)
  const mainIndex = mainHtmlPartIndex(walk.snapshotLocation, htmlLocations)
  return {
    status: 'listed',
    readAt,
    fileSize: buffer.length,
    topContentType: topContentType.value,
    boundary: boundary.value ?? '',
    snapshotLocation: snapshotLocation.value,
    fieldsTruncated: topContentType.cut || boundary.cut || snapshotLocation.cut,
    closed: walk.closed,
    totalParts: walk.totalParts,
    unterminatedParts,
    truncated: walk.totalParts > rows.length,
    parts: rows.map((row) => ({
      ...row,
      mainDocument: row.htmlPart !== null && row.htmlPart === mainIndex
    }))
  }
}

// Reads to the end of the file, growing the buffer as needed, and stops once more than `limit`
// bytes have arrived, so a file that grows during the read cannot take memory past the limit.
async function readBounded(handle: FileHandle, expected: number, limit: number): Promise<Buffer> {
  let buffer = Buffer.alloc(Math.min(expected, limit) + 1)
  let length = 0
  for (;;) {
    if (length === buffer.length) {
      if (length > limit) break
      const grown = Buffer.alloc(Math.min(buffer.length * 2, limit + 1))
      buffer.copy(grown, 0, 0, length)
      buffer = grown
    }
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
    if (bytesRead === 0) break
    length += bytesRead
  }
  return buffer.subarray(0, length)
}

/**
 * The parts of a Capture's stored MHTML, or null when it has none: no Capture, or not an MHTML
 * Capture with a stored path, the same gate verification applies before it hashes the file
 * (captureLifecycle.ts). Writes nothing.
 */
export async function readMhtmlParts(
  capture: Capture | null | undefined,
  store: Pick<CaptureStore, 'resolveAbsolute'> = defaultCaptureStore,
  limits: MhtmlPartsLimits = MHTML_PARTS_LIMITS
): Promise<MhtmlPartsListing | null> {
  if (!capture || capture.format !== 'mhtml' || !capture.mhtmlPath) return null
  const readAt = new Date().toISOString()
  const { maxFileBytes: limit } = limits

  let handle: FileHandle
  try {
    handle = await open(store.resolveAbsolute(capture.mhtmlPath), 'r')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        status: 'refused',
        readAt,
        refusal: { reason: 'file-missing', path: capture.mhtmlPath }
      }
    }
    throw err
  }

  try {
    const { size } = await handle.stat()
    if (size > limit)
      return { status: 'refused', readAt, refusal: { reason: 'too-large', size, limit } }
    const buffer = await readBounded(handle, size, limit)
    if (buffer.length > limit) {
      // The file grew after it was measured. The read stopped one byte past the limit, so the
      // size reported is the larger of the file's size now and the bytes read.
      const { size: grown } = await handle.stat()
      return {
        status: 'refused',
        readAt,
        refusal: { reason: 'too-large', size: Math.max(grown, buffer.length), limit }
      }
    }
    return listMhtmlParts(buffer, limits, readAt)
  } finally {
    await handle.close()
  }
}
