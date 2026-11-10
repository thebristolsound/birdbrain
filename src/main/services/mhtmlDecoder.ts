// Extracts concatenated HTML from an MHTML (multipart/related) file.
// Parses the top-level MIME boundary, decodes each text/html part according to
// its Content-Transfer-Encoding (quoted-printable, base64, 7bit, 8bit, binary),
// and reinterprets the decoded bytes using the part's charset.
//
// This is intentionally dependency-free: MHTML from Chrome/Edge (the formats we
// ingest) is a simple flat multipart/related with one or more text/html parts.
//
// We operate on Buffers (not a whole-file binary string) so large base64 image
// parts can be skipped without ever being materialized as JS strings. For typical
// MHTML captures, embedded images dwarf the HTML parts, so this keeps peak
// memory bounded by the text/html parts plus header scanning regions.

export function extractHtmlFromMhtml(buffer: Buffer): string {
  return extractHtmlPartsFromMhtml(buffer)
    .map((part) => part.html)
    .join('\n')
}

/** One decoded text/html part, with the address it was saved from. */
export interface MhtmlHtmlPartText {
  contentLocation: string | null
  html: string
}

/** Every text/html part, decoded, in file order. */
export function extractHtmlPartsFromMhtml(buffer: Buffer): MhtmlHtmlPartText[] {
  return listHtmlPartsInMhtml(buffer).parts.map(({ contentLocation, decode }) => ({
    contentLocation,
    html: decode()
  }))
}

/** A text/html part found but not yet decoded, so a caller can refuse it by size first. */
export interface MhtmlHtmlPart {
  contentLocation: string | null
  /** The part body's size in bytes as stored, before any transfer decoding. */
  encodedSize: number
  decode: () => string
}

export interface MhtmlHtmlPartList {
  /** The top-level `Snapshot-Content-Location` header Chrome writes, if present. */
  snapshotLocation: string | null
  parts: MhtmlHtmlPart[]
}

/**
 * The text/html parts of an MHTML, located but not decoded. A Content-Location that
 * was folded across header lines is unfolded with its whitespace removed, as RFC 2557
 * asks for a folded URI.
 */
export function listHtmlPartsInMhtml(buffer: Buffer): MhtmlHtmlPartList {
  const parts: MhtmlHtmlPart[] = []
  const { snapshotLocation } = walkMhtml(buffer, (part) => {
    if (!part.headersTerminated || !part.html) return
    const encoding = (part.transferEncoding ?? '7bit').toLowerCase()
    const charset = parseCharset(part.contentType)
    const { bodyStart, bodyEnd } = part
    parts.push({
      contentLocation: part.contentLocation,
      encodedSize: bodyEnd - bodyStart,
      decode: () => decodePartBody(buffer, bodyStart, bodyEnd, encoding, charset)
    })
  })
  return { snapshotLocation, parts }
}

/** One part of an MHTML, of any type, as the walk finds it. Offsets index the buffer. */
export interface MhtmlWalkPart {
  /** The first byte after the delimiter line. */
  partStart: number
  /** The next delimiter, or the end of the buffer when none follows. */
  partEnd: number
  /**
   * The body as stored, before transfer decoding: after the header blank line, or at
   * `partStart` when the headers never end, up to the line break before `partEnd`.
   */
  bodyStart: number
  bodyEnd: number
  /**
   * False when no blank line ends the headers inside the part. Its headers are then not read:
   * `html` is false and the header fields below are null.
   */
  headersTerminated: boolean
  html: boolean
  contentType: string | null
  transferEncoding: string | null
  contentLocation: string | null
  contentId: string | null
}

interface MhtmlWalkTop {
  topContentType: string | null
  snapshotLocation: string | null
}

export type MhtmlWalk =
  | (MhtmlWalkTop & {
      status: 'no-mime-header' | 'no-boundary'
      boundary: null
      closed: false
      totalParts: 0
    })
  | (MhtmlWalkTop & {
      status: 'walked'
      boundary: string
      /** The walk ended at a closing `--boundary--` delimiter rather than at the end of the buffer. */
      closed: boolean
      totalParts: number
    })

/**
 * Every part of an MHTML in file order, passed to `onPart` one at a time so a caller keeps
 * only what it needs. The HTML part list above is this walk filtered to terminated text/html
 * parts, so a part's index among those is the index the HTML readers use.
 */
export function walkMhtml(buffer: Buffer, onPart: (part: MhtmlWalkPart) => void): MhtmlWalk {
  const topHeaderEnd = findHeaderEndBuf(buffer, 0)
  if (topHeaderEnd === -1) {
    return {
      status: 'no-mime-header',
      topContentType: null,
      snapshotLocation: null,
      boundary: null,
      closed: false,
      totalParts: 0
    }
  }

  const topHeaders = buffer.slice(0, topHeaderEnd).toString('latin1')
  const topContentType = parseHeader(topHeaders, 'content-type')
  const snapshotLocation = parseLocation(topHeaders, 'snapshot-content-location')
  const boundary = parseBoundary(topContentType)
  if (!boundary) {
    return {
      status: 'no-boundary',
      topContentType,
      snapshotLocation,
      boundary: null,
      closed: false,
      totalParts: 0
    }
  }

  const delimiter = Buffer.from('--' + boundary, 'latin1')
  let closed = false
  let totalParts = 0

  let at = buffer.indexOf(delimiter, topHeaderEnd)
  while (at !== -1) {
    const after = at + delimiter.length
    // Closing boundary marker: `--boundary--`
    if (buffer[after] === 0x2d && buffer[after + 1] === 0x2d) {
      closed = true
      break
    }

    // Consume the CRLF (or LF) that separates the boundary line from the part.
    let partStart = after
    if (buffer[partStart] === 0x0d && buffer[partStart + 1] === 0x0a) partStart += 2
    else if (buffer[partStart] === 0x0a) partStart += 1

    const nextAt = buffer.indexOf(delimiter, partStart)
    const partEnd = nextAt === -1 ? buffer.length : nextAt

    const partHeaderEnd = findHeaderEndBuf(buffer, partStart, partEnd)
    const headersTerminated = partHeaderEnd !== -1
    // Decode headers as latin1 (header bytes are ASCII per RFC 2045); cheap.
    const headers = headersTerminated
      ? buffer.slice(partStart, partHeaderEnd).toString('latin1')
      : null
    const contentType = headers === null ? null : parseHeader(headers, 'content-type')
    const bodyStart = headersTerminated ? partHeaderEnd : partStart
    totalParts += 1
    onPart({
      partStart,
      partEnd,
      bodyStart,
      bodyEnd: stripTrailingNewlineEnd(buffer, bodyStart, partEnd),
      headersTerminated,
      html: isTextHtml(contentType),
      contentType,
      transferEncoding: headers === null ? null : parseHeader(headers, 'content-transfer-encoding'),
      contentLocation: headers === null ? null : parseLocation(headers, 'content-location'),
      contentId: headers === null ? null : parseHeader(headers, 'content-id')
    })

    if (nextAt === -1) break
    at = nextAt
  }

  return { status: 'walked', topContentType, snapshotLocation, boundary, closed, totalParts }
}

/**
 * Which of the text/html parts is the main document: the one saved from the archive's
 * `Snapshot-Content-Location`, else the first. Null when there is no HTML part.
 */
export function mainHtmlPartIndex(
  snapshotLocation: string | null,
  htmlParts: readonly { contentLocation: string | null }[]
): number | null {
  if (htmlParts.length === 0) return null
  const snapshotIndex =
    snapshotLocation === null
      ? -1
      : htmlParts.findIndex((part) => part.contentLocation === snapshotLocation)
  return snapshotIndex === -1 ? 0 : snapshotIndex
}

/**
 * The page title an MHTML records: its top-level `Subject` header, else the first `<title>` of
 * its first text/html part. Null when neither holds one.
 */
export function readMhtmlTitle(buffer: Buffer): string | null {
  const topHeaderEnd = findHeaderEndBuf(buffer, 0)
  if (topHeaderEnd === -1) return null
  const subject = headerOnItsLine(buffer.slice(0, topHeaderEnd).toString('latin1'), 'subject')
  const decoded = subject ? collapseWhitespace(decodeEncodedWords(subject)) : ''
  if (decoded) return decoded

  const [first] = listHtmlPartsInMhtml(buffer).parts
  if (!first) return null
  const content = firstTitleContent(first.decode())
  const title = content === null ? '' : collapseWhitespace(decodeXmlEntities(content))
  return title ? title : null
}

// A header's value, read from its own line only, so a header written with no value is absent.
// parseHeader's `\s*` crosses the line break and returns the next header line instead.
function headerOnItsLine(headers: string, name: string): string | null {
  const m = unfoldHeaders(headers).match(new RegExp('^' + name + ':[ \\t]*([^\\r\\n]*)', 'im'))
  const value = m ? m[1].trim() : ''
  return value ? value : null
}

// The text of the first `<title>` element: the first `<title` tag, the `>` that ends it, then
// the first closing tag after that, each found by one forward search. A regex with a lazy body
// rescans the rest of the page from every `<title` that is never closed, which is quadratic.
function firstTitleContent(html: string): string | null {
  const open = html.search(/<title\b/i)
  if (open === -1) return null
  const end = html.indexOf('>', open)
  if (end === -1) return null
  const close = /<\/title\s*>/gi
  close.lastIndex = end + 1
  const match = close.exec(html)
  return match ? html.slice(end + 1, match.index) : null
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

const ENCODED_WORD = /=\?([^?\s]+)\?([QqBb])\?([^?\s]*)\?=/g

// RFC 2047: whitespace between two adjacent encoded words is not part of the text. Text outside
// encoded words is header bytes read as latin1, so it is re-read as UTF-8.
function decodeEncodedWords(header: string): string {
  const joined = header.replace(/(\?=)\s+(?==\?)/g, '$1')
  let out = ''
  let last = 0
  for (const match of joined.matchAll(ENCODED_WORD)) {
    const [word, charset, encoding, text] = match
    const at = match.index ?? 0
    out += Buffer.from(joined.slice(last, at), 'latin1').toString('utf8')
    const bytes =
      encoding.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64')
        : Buffer.from(decodeQuotedPrintable(text.replace(/_/g, ' ')), 'latin1')
    out += bytes.toString(toNodeEncoding(charset.toLowerCase()))
    last = at + word.length
  }
  return out + Buffer.from(joined.slice(last), 'latin1').toString('utf8')
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] !== '#') return XML_ENTITIES[name] ?? whole
    const code =
      name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

function parseLocation(headers: string, name: string): string | null {
  const value = parseHeader(headers, name)?.replace(/\s+/g, '')
  return value ? value : null
}

// Locate the blank-line separator between headers and body, within [from, to). A part's search
// stops at the part's end, so a file with no LF LF pair does not cost every part a scan to the
// end of the file.
function findHeaderEndBuf(buf: Buffer, from: number, to: number = buf.length): number {
  const crlfcrlf = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a])
  const lflf = Buffer.from([0x0a, 0x0a])
  const region = buf.subarray(from, to)
  const crlf = region.indexOf(crlfcrlf)
  const lf = region.indexOf(lflf)
  if (crlf === -1 && lf === -1) return -1
  if (crlf === -1) return from + lf + 2
  if (lf === -1) return from + crlf + 4
  return from + (crlf < lf ? crlf + 4 : lf + 2)
}

function stripTrailingNewlineEnd(buf: Buffer, start: number, end: number): number {
  if (end - start >= 2 && buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) return end - 2
  if (end - start >= 1 && buf[end - 1] === 0x0a) return end - 1
  return end
}

function decodePartBody(
  buf: Buffer,
  start: number,
  end: number,
  encoding: string,
  charset: string | null
): string {
  if (encoding === 'base64') {
    // Body is base64-encoded bytes; materialize as ascii, strip whitespace, decode.
    const b64 = buf.slice(start, end).toString('ascii').replace(/\s+/g, '')
    return Buffer.from(b64, 'base64').toString(toNodeEncoding(charset))
  }
  if (encoding === 'quoted-printable') {
    // QP is ASCII-safe; process as latin1 then decode escapes into real bytes.
    const qp = buf.slice(start, end).toString('latin1')
    const decodedBinary = decodeQuotedPrintable(qp)
    return Buffer.from(decodedBinary, 'latin1').toString(toNodeEncoding(charset))
  }
  // 7bit / 8bit / binary: body bytes are the content verbatim.
  return buf.slice(start, end).toString(toNodeEncoding(charset))
}

function unfoldHeaders(headers: string): string {
  return headers.replace(/\r?\n[ \t]+/g, ' ')
}

function parseHeader(headers: string, name: string): string | null {
  const unfolded = unfoldHeaders(headers)
  const re = new RegExp('^' + name + ':\\s*([^\\r\\n]+)', 'im')
  const m = unfolded.match(re)
  return m ? m[1].trim() : null
}

function parseBoundary(ct: string | null): string | null {
  if (!ct) return null
  const m = ct.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)
  return m ? (m[1] ?? m[2]) : null
}

function isTextHtml(ct: string | null): boolean {
  return !!ct && /^\s*text\/html\b/i.test(ct)
}

function parseCharset(ct: string | null): string | null {
  if (!ct) return null
  const m = ct.match(/charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)
  return m ? (m[1] ?? m[2]).toLowerCase() : null
}

function toNodeEncoding(charset: string | null): BufferEncoding {
  if (!charset) return 'utf8'
  if (charset === 'utf-8' || charset === 'utf8') return 'utf8'
  if (charset === 'iso-8859-1' || charset === 'latin1' || charset === 'windows-1252') {
    return 'latin1'
  }
  if (charset === 'us-ascii' || charset === 'ascii') return 'ascii'
  return 'utf8'
}

function decodeQuotedPrintable(input: string): string {
  // Remove soft line breaks ("=" at end of line)
  let out = input.replace(/=\r?\n/g, '')
  // Decode =XX hex escapes
  out = out.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  return out
}
