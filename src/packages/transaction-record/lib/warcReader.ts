import { createHash } from 'crypto'
import { crc32, inflateRawSync } from 'zlib'

// A WARC reader that is not the writer (plan, "The `warcio` licence and the test readers"): it
// imports nothing from `warcio`. It splits the file into gzip members, inflates each with Node's
// zlib, frames the one record each member must hold by its `Content-Length`, and recomputes the
// block and payload digests. Every structural fault throws.

export interface WarcRecord {
  /** The WARC header lines in file order. */
  warcHeaders: Array<[string, string]>
  /** The first value of a WARC header, matched without regard to case. */
  warc: (name: string) => string | undefined
  block: Buffer
  /** Set for an `application/http` block. */
  http?: {
    statusLine: string
    headers: Array<[string, string]>
    payload: Buffer
  }
  /** The inflated bytes of the record's gzip member. */
  inflated: Buffer
}

const FLAG = { FHCRC: 2, FEXTRA: 4, FNAME: 8, FCOMMENT: 16 }

const zeroTerminated = (bytes: Buffer, from: number): number => {
  const end = bytes.indexOf(0, from)
  if (end < 0) throw new Error('gzip header field has no terminator')
  return end + 1
}

// RFC 1952, section 2.3: a fixed ten-byte header, then the optional fields its flags name.
const headerLength = (bytes: Buffer, at: number): number => {
  if (bytes[at] !== 0x1f || bytes[at + 1] !== 0x8b || bytes[at + 2] !== 8) {
    throw new Error(`no gzip member starts at byte ${at}`)
  }
  const flags = bytes[at + 3]
  let offset = at + 10
  if (flags & FLAG.FEXTRA) offset += 2 + bytes.readUInt16LE(offset)
  if (flags & FLAG.FNAME) offset = zeroTerminated(bytes, offset)
  if (flags & FLAG.FCOMMENT) offset = zeroTerminated(bytes, offset)
  if (flags & FLAG.FHCRC) offset += 2
  return offset - at
}

/** Each gzip member of the file, inflated, with its CRC-32 and length checked. */
export const gzipMembers = (file: Uint8Array): Buffer[] => {
  const bytes = Buffer.from(file)
  const members: Buffer[] = []
  let at = 0
  while (at < bytes.length) {
    const start = at + headerLength(bytes, at)
    const { buffer, engine } = inflateRawSync(bytes.subarray(start), { info: true }) as unknown as {
      buffer: Buffer
      engine: { bytesWritten: number }
    }
    const trailer = start + engine.bytesWritten
    if (trailer + 8 > bytes.length) throw new Error('gzip member has no trailer')
    if (bytes.readUInt32LE(trailer) !== crc32(buffer)) throw new Error('gzip CRC-32 mismatch')
    if (bytes.readUInt32LE(trailer + 4) !== buffer.length % 2 ** 32) {
      throw new Error('gzip length mismatch')
    }
    members.push(buffer)
    at = trailer + 8
  }
  return members
}

const CRLFCRLF = Buffer.from('\r\n\r\n')

const headerFields = (text: string): Array<[string, string]> =>
  text.split('\r\n').map((line) => {
    const colon = line.indexOf(':')
    if (colon <= 0) throw new Error(`not a header line: ${JSON.stringify(line)}`)
    return [line.slice(0, colon), line.slice(colon + 1).trim()]
  })

const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

const parseRecord = (inflated: Buffer): WarcRecord => {
  const headEnd = inflated.indexOf(CRLFCRLF)
  if (headEnd < 0) throw new Error('WARC header has no end')
  const [version, ...lines] = inflated.subarray(0, headEnd).toString('utf8').split('\r\n')
  if (version !== 'WARC/1.1') throw new Error(`not a WARC/1.1 record: ${version}`)
  const warcHeaders = headerFields(lines.join('\r\n'))
  const warc = (name: string): string | undefined =>
    warcHeaders.find(([field]) => field.toLowerCase() === name.toLowerCase())?.[1]
  const length = Number(warc('Content-Length'))
  if (!Number.isSafeInteger(length)) throw new Error('WARC record has no Content-Length')
  const blockStart = headEnd + CRLFCRLF.length
  const block = inflated.subarray(blockStart, blockStart + length)
  if (block.length !== length) throw new Error('WARC block is shorter than its Content-Length')
  if (!inflated.subarray(blockStart + length).equals(CRLFCRLF)) {
    throw new Error('a gzip member holds more or less than one WARC record')
  }
  // `warcinfo` carries no digest; every request and response record carries both.
  const digested = ['request', 'response'].includes(warc('WARC-Type') ?? '')
  const blockDigest = warc('WARC-Block-Digest')
  if (digested && blockDigest === undefined) throw new Error('record has no WARC-Block-Digest')
  if (blockDigest !== undefined && blockDigest !== sha256(block)) {
    throw new Error('WARC-Block-Digest does not match the block')
  }
  if (!warc('Content-Type')?.startsWith('application/http')) {
    if (digested) throw new Error('a request or response record holds no HTTP message')
    return { warcHeaders, warc, block, inflated }
  }
  const httpEnd = block.indexOf(CRLFCRLF)
  if (httpEnd < 0) throw new Error('HTTP header block has no end')
  const [statusLine, ...httpLines] = block.subarray(0, httpEnd).toString('utf8').split('\r\n')
  const payload = block.subarray(httpEnd + CRLFCRLF.length)
  const payloadDigest = warc('WARC-Payload-Digest')
  if (digested && payloadDigest === undefined) throw new Error('record has no WARC-Payload-Digest')
  if (payloadDigest !== undefined && payloadDigest !== sha256(payload)) {
    throw new Error('WARC-Payload-Digest does not match the payload')
  }
  const headers = httpLines.length > 0 ? headerFields(httpLines.join('\r\n')) : []
  return { warcHeaders, warc, block, http: { statusLine, headers, payload }, inflated }
}

/** Every record of a `.warc.gz`, one per gzip member, with each digest it carries checked. */
export const readWarc = (file: Uint8Array): WarcRecord[] => gzipMembers(file).map(parseRecord)
