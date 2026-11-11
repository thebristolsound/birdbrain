import type { MhtmlPartRow, MhtmlPartsListing, MhtmlPartsRefusal } from '@shared/types'

// The words of the Data screen's MHTML Parts tab (#991). A part is a view inside one
// Exhibit's bytes, not an Exhibit (ADR-0023), so nothing here calls a part's hash anything
// but computed now: ruling R6 (docs/plans/2026-08-24-wave3-phase2-intake-rulings.md) rules out
// a shield and the word "verified".

export type ListedParts = Extract<MhtmlPartsListing, { status: 'listed' }>

export const PARTS_TAB_HINT = 'read when shown'

export const PARTS_COLUMNS = {
  position: '#',
  htmlPart: 'HTML part',
  contentLocation: 'Content-Location',
  contentType: 'Content-Type',
  encoding: 'Encoding',
  offset: 'Offset',
  size: 'Size',
  sha256: 'SHA-256 (computed now)',
  copy: 'Copy'
} as const

export const OFFSET_TITLE =
  'The byte offset in the file where the hashed span starts. To check a part outside ' +
  'Birdbrain, run tail -c +$((offset+1)) <file> | head -c <size> | sha256sum with its ' +
  'offset and size.'

export const PARTS_CAPTION =
  'Only the whole MHTML file is anchored in the manifest, and Verify checks it against its ' +
  "Content Hash. Each part's SHA-256 is computed now, over the part's bytes as stored before " +
  'transfer decoding, and is not anchored.'

// For a Capture whose Exhibit has no Manifest Entry, which the Data table badges unanchored.
export const UNANCHORED_PARTS_CAPTION =
  'This MHTML file has no Manifest Entry (unanchored), so neither the file nor its parts are ' +
  "anchored. Each part's SHA-256 is computed now, over the part's bytes as stored before " +
  'transfer decoding.'

export const NO_STORED_MHTML = 'This row has no stored MHTML to read.'

export const COPY_LABELS = {
  sha256: 'SHA-256 (computed now, not anchored)',
  contentLocation: 'Content-Location',
  byteRange: 'byte range'
} as const

// The walker decodes header values as latin1, so each of their characters is at most U+00FF.
// These are the ones in that range that render as nothing or move the text, plus the backslash,
// so a value that holds a literal `\x0a` cannot read as an escaped line feed.
function escapes(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0xa0) || code === 0xad || code === 0x5c
}

/** A header value as the tab shows it, with each invisible character written as `\xNN`. */
export function showValue(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    out += escapes(code) ? `\\x${code.toString(16).padStart(2, '0')}` : char
  }
  return out
}

export function countText(count: number): string {
  return count.toLocaleString('en-US')
}

export function refusalSentence(refusal: MhtmlPartsRefusal): string {
  switch (refusal.reason) {
    case 'file-missing':
      return `The stored MHTML file is not on disk at ${showValue(refusal.path)}.`
    case 'too-large':
      return `The stored file is ${countText(refusal.size)} bytes, over the ${countText(refusal.limit)}-byte limit this tab reads. Nothing was listed.`
    case 'no-mime-header':
    case 'no-boundary':
      return 'The stored file is not a multipart MHTML archive: it has no header block naming a boundary, so it holds no parts to list.'
    case 'no-parts': {
      const boundary = showValue(refusal.boundary)
      const named = refusal.fieldsTruncated
        ? `a boundary starting ${boundary}`
        : `boundary ${boundary}`
      return `The file names ${named} but holds no part delimited by it.`
    }
  }
}

export interface PartsBanner {
  id: 'unclosed' | 'ceiling' | 'unterminated' | 'fields-cut'
  text: string
}

// Each banner states a failure beside the list, so a partial list never reads as complete.
export function partsBanners(listing: ListedParts): PartsBanner[] {
  const banners: PartsBanner[] = []
  if (!listing.closed) {
    banners.push({
      id: 'unclosed',
      text: 'The file ends without its closing boundary. The last part runs to the end of the file and may be cut short, so this list may be incomplete.'
    })
  }
  if (listing.truncated) {
    banners.push({
      id: 'ceiling',
      text: `Listing stops at ${countText(listing.parts.length)} of ${countText(listing.totalParts)} parts.`
    })
  }
  const unterminated = listing.unterminatedParts
  if (unterminated === 1) {
    banners.push({
      id: 'unterminated',
      text: '1 part has no blank line ending its headers. Its type and encoding cannot be read, and the HTML readers skip it.'
    })
  } else if (unterminated > 1) {
    banners.push({
      id: 'unterminated',
      text: `${countText(unterminated)} parts have no blank line ending their headers. Their type and encoding cannot be read, and the HTML readers skip them.`
    })
  }
  if (listing.fieldsTruncated || listing.parts.some(({ fieldsTruncated }) => fieldsTruncated)) {
    banners.push({
      id: 'fields-cut',
      text: 'Some header values are too long to show in full and are cut short. A row with a cut value offers no Content-Location copy.'
    })
  }
  return banners
}

// The `part N` wording search hits and field hit checks print, so a hit's part can be found.
export function htmlPartLabel({ htmlPart }: MhtmlPartRow): string {
  return htmlPart === null ? '' : `part ${htmlPart}`
}

export function encodingText({ transferEncoding }: MhtmlPartRow): string {
  return transferEncoding === null ? '(none)' : showValue(transferEncoding)
}

export function byteRange({ offset, size }: MhtmlPartRow): string {
  return `offset ${offset} length ${size}`
}
