import { HeadersMultiMap, StatusAndHeaders, WARCRecord, WARCSerializer, WARC_1_1 } from 'warcio'
import type { BodyData, Exchange, HeaderMap, WriterInput, WrittenTransactionRecord } from './types'

/** The value every credential header takes in a Transaction Record (ADR-0036). */
export const CREDENTIAL_MARKER = '[value replaced by Birdbrain]'

/** The headers whose values never enter a Transaction Record (ADR-0036), lower-case. */
export const CREDENTIAL_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie'
]

const CREDENTIAL = new Set(CREDENTIAL_HEADERS)

// Plan D8 and the 2026-10-10 ruling on spec open question 1: the body is stored decoded, so the
// framing the browser reported is kept under these names and `Content-Length` states the stored
// length.
const RENAMED = new Set(['content-encoding', 'transfer-encoding', 'content-length'])

const DECODED_BODIES =
  'Response bodies are stored as the browser decoded them. Each response keeps the ' +
  'Content-Encoding, Transfer-Encoding and Content-Length the browser reported as ' +
  'x-orig-content-encoding, x-orig-transfer-encoding and x-orig-content-length, and its ' +
  'Content-Length is the length of the stored body.'

const CREDENTIALS =
  'The values of the Cookie, Set-Cookie, Authorization and Proxy-Authorization headers are ' +
  `replaced with ${CREDENTIAL_MARKER}. The header names are kept.`

type HeaderLine = [string, string]

// warcio's own map joins repeated names with ",,," and splits on it again when it writes, which
// would cut a reported value that holds those characters. This map writes the lines as given.
class HeaderLines extends HeadersMultiMap {
  constructor(private readonly lines: HeaderLine[]) {
    super()
  }

  override *[Symbol.iterator](): IterableIterator<[string, string]> {
    yield* this.lines
  }
}

const LINE_BREAK = /\r\n|\r|\n/

/**
 * One header map as the lines of a header block. HTTP/2 pseudo-headers are left out, as
 * browsertrix-crawler does (plan D8). A line break in a value would end the header line early and
 * let the rest read as another header, so each line of a value is written as its own header line.
 * Each credential header line takes the marker, and its lower-case name goes into `replaced`.
 */
const headerLines = (headers: HeaderMap, replaced: Set<string>): HeaderLine[] =>
  Object.entries(headers)
    .filter(([name]) => !name.startsWith(':'))
    .flatMap(([name, value]) => {
      const lower = name.toLowerCase()
      return value.split(LINE_BREAK).map((line): HeaderLine => {
        if (!CREDENTIAL.has(lower)) return [name, line]
        replaced.add(lower)
        return [name, CREDENTIAL_MARKER]
      })
    })

const bytesOf = ({ data, base64Encoded }: BodyData): Uint8Array =>
  base64Encoded ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8')

const pathOf = (url: string): string => {
  const { pathname, search } = new URL(url)
  return `${pathname}${search}`
}

const TRUNCATED = { 'WARC-Truncated': 'unspecified' }

const serialize = async (record: WARCRecord): Promise<Uint8Array> =>
  WARCSerializer.serialize(record, { gzip: true })

const httpRecord = (
  type: 'request' | 'response',
  {
    url,
    date,
    statusline,
    lines,
    body,
    warcHeaders
  }: {
    url: string
    date: string
    statusline: string
    lines: HeaderLine[]
    body: Uint8Array
    warcHeaders: Record<string, string>
  }
): WARCRecord => {
  const record = WARCRecord.create(
    { type, url, date, warcVersion: WARC_1_1, warcHeaders },
    body.length > 0 ? [body] : undefined
  )
  record.httpHeaders = new StatusAndHeaders({ statusline, headers: new HeaderLines(lines) })
  return record
}

const requestRecord = (
  { request, requestBody, startedAt }: Exchange,
  replaced: Set<string>
): WARCRecord =>
  httpRecord('request', {
    url: request.url,
    date: startedAt,
    statusline: `${request.method} ${pathOf(request.url)} HTTP/1.1`,
    // Plan D8: the headers the ExtraInfo event reported when it arrived, as for the response.
    lines: headerLines(request.extraInfo?.headers ?? request.headers, replaced),
    body: requestBody ? bytesOf(requestBody) : new Uint8Array(),
    warcHeaders: requestBody && !requestBody.complete ? { ...TRUNCATED } : {}
  })

const responseRecord = (
  { request, response, responseBody, startedAt, state }: Exchange,
  input: WriterInput,
  replaced: Set<string>
): WARCRecord => {
  if (response === undefined) {
    throw new Error(`A ${state} exchange for ${request.url} has no response to write`)
  }
  const body = state === 'complete' && responseBody ? bytesOf(responseBody) : new Uint8Array()
  const status = response.extraInfo?.statusCode ?? response.status
  const lines = headerLines(response.extraInfo?.headers ?? response.headers, replaced).map(
    ([name, value]): HeaderLine => {
      const lower = name.toLowerCase()
      return RENAMED.has(lower) ? [`x-orig-${lower}`, value] : [name, value]
    }
  )
  const warcHeaders: Record<string, string> = state === 'body-omitted' ? { ...TRUNCATED } : {}
  // Plan D8 and ADR-0032 rule 5: through a proxy the reported address can be the proxy's.
  if (input.egress === 'direct' && response.remoteIPAddress !== undefined) {
    warcHeaders['WARC-IP-Address'] = response.remoteIPAddress
  }
  return httpRecord('response', {
    url: request.url,
    date: startedAt,
    statusline: `HTTP/1.1 ${status} ${response.statusText}`,
    lines: [...lines, ['Content-Length', String(body.length)]],
    body,
    warcHeaders
  })
}

// Plan D8, "Partial exchanges": these states get a `response` record, and every other state gets
// its `request` record alone.
const WITH_RESPONSE = new Set<Exchange['state']>(['complete', 'redirected', 'body-omitted'])

/**
 * Writes the exchanges of one render as a Transaction Record: a `.warc.gz` with one gzip member
 * per record, and the lower-case names of the headers whose values it replaced, sorted and unique.
 * Every value of a credential header is replaced before any record is serialized.
 */
export const writeTransactionRecord = async (
  input: WriterInput
): Promise<WrittenTransactionRecord> => {
  const replaced = new Set<string>()
  const records = [
    WARCRecord.createWARCInfo(
      { date: input.date, warcVersion: WARC_1_1 },
      {
        software: `Birdbrain ${input.birdbrainVersion}`,
        format: 'WARC File Format 1.1',
        browser: input.browserVersion,
        'http-header-user-agent': input.userAgent,
        'capture-id': input.captureId,
        'decoded-bodies': DECODED_BODIES,
        'credential-headers': CREDENTIALS
      }
    )
  ]
  for (const exchange of input.exchanges) {
    records.push(requestRecord(exchange, replaced))
    if (WITH_RESPONSE.has(exchange.state)) {
      records.push(responseRecord(exchange, input, replaced))
    }
  }
  const members: Uint8Array[] = []
  for (const record of records) members.push(await serialize(record))
  return { bytes: Buffer.concat(members), replacedHeaders: [...replaced].sort() }
}
