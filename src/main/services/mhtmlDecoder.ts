// Extracts concatenated HTML from an MHTML (multipart/related) file.
// Parses the top-level MIME boundary, decodes each text/html part according to
// its Content-Transfer-Encoding (quoted-printable, base64, 7bit, 8bit, binary),
// and reinterprets the decoded bytes using the part's charset.
//
// This is intentionally dependency-free: MHTML from Chrome/Edge (the formats we
// ingest) is a simple flat multipart/related with one or more text/html parts.

export function extractHtmlFromMhtml(buffer: Buffer): string {
  // Work in a binary-safe string so per-byte operations (QP hex escapes,
  // boundary scans) stay accurate. We reinterpret per-part bytes later.
  const raw = buffer.toString('binary')

  const topHeaderEnd = findHeaderEnd(raw, 0)
  if (topHeaderEnd === -1) return ''

  const boundary = parseBoundary(raw.slice(0, topHeaderEnd))
  if (!boundary) return ''

  const delimiter = '--' + boundary
  const parts = splitParts(raw, delimiter, topHeaderEnd)

  const chunks: string[] = []
  for (const part of parts) {
    const partHeaderEnd = findHeaderEnd(part, 0)
    if (partHeaderEnd === -1) continue

    const partHeaders = part.slice(0, partHeaderEnd)
    if (!isTextHtml(partHeaders)) continue

    const encoding = (parseHeader(partHeaders, 'content-transfer-encoding') ?? '7bit').toLowerCase()
    const charset = parseCharset(partHeaders)

    const body = stripTrailingNewline(part.slice(partHeaderEnd))

    let decodedBinary: string
    if (encoding === 'quoted-printable') {
      decodedBinary = decodeQuotedPrintable(body)
    } else if (encoding === 'base64') {
      decodedBinary = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('binary')
    } else {
      // 7bit, 8bit, binary: the body bytes are the content verbatim
      decodedBinary = body
    }

    const decodedBytes = Buffer.from(decodedBinary, 'binary')
    chunks.push(decodedBytes.toString(toNodeEncoding(charset)))
  }

  return chunks.join('\n')
}

// --- helpers ---

function findHeaderEnd(s: string, from: number): number {
  const crlf = s.indexOf('\r\n\r\n', from)
  const lf = s.indexOf('\n\n', from)
  if (crlf === -1 && lf === -1) return -1
  if (crlf === -1) return lf + 2
  if (lf === -1) return crlf + 4
  return crlf < lf ? crlf + 4 : lf + 2
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

function stripTrailingNewline(s: string): string {
  if (s.endsWith('\r\n')) return s.slice(0, -2)
  if (s.endsWith('\n')) return s.slice(0, -1)
  return s
}

// Splits the MHTML body into part segments between `--boundary` markers, stopping
// at the terminating `--boundary--` marker. Each returned segment starts at the
// first byte of the part's headers (the CRLF after the boundary is consumed).
function splitParts(raw: string, delimiter: string, searchStart: number): string[] {
  const parts: string[] = []
  let at = raw.indexOf(delimiter, searchStart)

  while (at !== -1) {
    const after = at + delimiter.length
    // Closing boundary marker: `--boundary--`
    if (raw.substr(after, 2) === '--') break

    // Consume the CRLF (or LF) that separates the boundary line from the part
    let partStart = after
    if (raw[partStart] === '\r' && raw[partStart + 1] === '\n') partStart += 2
    else if (raw[partStart] === '\n') partStart += 1

    const nextAt = raw.indexOf(delimiter, partStart)
    const partEnd = nextAt === -1 ? raw.length : nextAt
    parts.push(raw.slice(partStart, partEnd))
    if (nextAt === -1) break
    at = nextAt
  }

  return parts
}
