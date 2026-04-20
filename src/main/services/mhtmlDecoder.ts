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
  const topHeaderEnd = findHeaderEndBuf(buffer, 0)
  if (topHeaderEnd === -1) return ''

  const boundary = parseBoundary(buffer.slice(0, topHeaderEnd).toString('latin1'))
  if (!boundary) return ''

  const delimiter = Buffer.from('--' + boundary, 'latin1')
  const chunks: string[] = []

  let at = indexOfBuf(buffer, delimiter, topHeaderEnd)
  while (at !== -1) {
    const after = at + delimiter.length
    // Closing boundary marker: `--boundary--`
    if (buffer[after] === 0x2d && buffer[after + 1] === 0x2d) break

    // Consume the CRLF (or LF) that separates the boundary line from the part.
    let partStart = after
    if (buffer[partStart] === 0x0d && buffer[partStart + 1] === 0x0a) partStart += 2
    else if (buffer[partStart] === 0x0a) partStart += 1

    const nextAt = indexOfBuf(buffer, delimiter, partStart)
    const partEnd = nextAt === -1 ? buffer.length : nextAt

    const partHeaderEnd = findHeaderEndBuf(buffer, partStart)
    if (partHeaderEnd !== -1 && partHeaderEnd <= partEnd) {
      // Decode headers as latin1 (header bytes are ASCII per RFC 2045); cheap.
      const headers = buffer.slice(partStart, partHeaderEnd).toString('latin1')
      if (isTextHtml(headers)) {
        const encoding = (parseHeader(headers, 'content-transfer-encoding') ?? '7bit').toLowerCase()
        const charset = parseCharset(headers)
        const bodyEnd = stripTrailingNewlineEnd(buffer, partHeaderEnd, partEnd)
        chunks.push(decodePartBody(buffer, partHeaderEnd, bodyEnd, encoding, charset))
      }
    }

    if (nextAt === -1) break
    at = nextAt
  }

  return chunks.join('\n')
}

// --- helpers ---

function indexOfBuf(buf: Buffer, needle: Buffer, from: number): number {
  return buf.indexOf(needle, from)
}

function findHeaderEndBuf(buf: Buffer, from: number): number {
  // Locate the blank-line separator between headers and body.
  const crlfcrlf = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a])
  const lflf = Buffer.from([0x0a, 0x0a])
  const crlf = buf.indexOf(crlfcrlf, from)
  const lf = buf.indexOf(lflf, from)
  if (crlf === -1 && lf === -1) return -1
  if (crlf === -1) return lf + 2
  if (lf === -1) return crlf + 4
  return crlf < lf ? crlf + 4 : lf + 2
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

function parseBoundary(headers: string): string | null {
  const ct = parseHeader(headers, 'content-type')
  if (!ct) return null
  const m = ct.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)
  return m ? (m[1] ?? m[2]) : null
}

function isTextHtml(headers: string): boolean {
  const ct = parseHeader(headers, 'content-type')
  return !!ct && /^\s*text\/html\b/i.test(ct)
}

function parseCharset(headers: string): string | null {
  const ct = parseHeader(headers, 'content-type')
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
