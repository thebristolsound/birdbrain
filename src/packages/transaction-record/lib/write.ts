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

// The maintainer's ruling of 2026-10-26 (plan D8): CDP can hand a text body over as a string
// decoded from the page's character set (the review of #1979 measured it; spike #1983 measures it
// for step 9). The original bytes cannot be recovered from the string, so the record stores the
// text as UTF-8 and says so on each record that holds such a body.
const TEXT_BODY = { 'x-birdbrain-decoded-text': 'utf-8' }

const DECODED_BODIES =
  'Response bodies are stored as the browser decoded them. Each response keeps the ' +
  'Content-Encoding, Transfer-Encoding and Content-Length the browser reported as ' +
  'x-orig-content-encoding, x-orig-transfer-encoding and x-orig-content-length, and its ' +
  'Content-Length is the length of the stored body. A body the browser handed over as text is ' +
  'stored as that text encoded in UTF-8, which can differ from the bytes the server sent, for ' +
  'example when the page used another character set; each record holding such a body carries ' +
  'x-birdbrain-decoded-text: utf-8.'

const CREDENTIALS =
  'The values of the Cookie, Set-Cookie, Authorization and Proxy-Authorization headers are ' +
  `replaced with ${CREDENTIAL_MARKER}. The header names are kept.`

const MESSAGE_LINES =
  'Request and status lines read HTTP/1.0 when the browser reported http/1.0 and HTTP/1.1 ' +
  'otherwise, HTTP/2 and HTTP/3 exchanges included. WARC-Protocol on each request and response ' +
  'record names the protocol the browser reported, where it reported one.'

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

interface StoredBody {
  bytes: Uint8Array
  /** The browser handed the body over as text, not as base64 bytes. */
  text: boolean
}

const NO_BODY: StoredBody = { bytes: new Uint8Array(), text: false }

const stored = (body: BodyData | undefined): StoredBody => {
  if (body === undefined) return NO_BODY
  const { data, base64Encoded } = body
  return base64Encoded
    ? { bytes: Buffer.from(data, 'base64'), text: false }
    : { bytes: Buffer.from(data, 'utf8'), text: true }
}

const pathOf = (url: string): string => {
  const { pathname, search } = new URL(url)
  return `${pathname}${search}`
}

const TRUNCATED = { 'WARC-Truncated': 'unspecified' }

// The maintainer's ruling of 2026-10-26 (plan D8) follows browsertrix-crawler, which writes
// HTTP/1.x message lines that WARC readers parse and records the reported protocol in
// `WARC-Protocol` (`src/util/reqresp.ts`, `httpProtocol`, and `src/util/recorder.ts`,
// `createResponse`, at `e582608a`).
const protocolOf = ({ response }: Exchange): string | undefined => response?.protocol?.toLowerCase()

const httpVersion = (protocol: string | undefined): string =>
  protocol === 'http/1.0' ? 'HTTP/1.0' : 'HTTP/1.1'

const protocolField = (protocol: string | undefined): Record<string, string> =>
  protocol === undefined ? {} : { 'WARC-Protocol': protocol }

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
  const record = WARCRecord.create({ type, url, date, warcVersion: WARC_1_1, warcHeaders }, [body])
  record.httpHeaders = new StatusAndHeaders({ statusline, headers: new HeaderLines(lines) })
  return record
}

const requestRecord = (exchange: Exchange, replaced: Set<string>): WARCRecord => {
  const { request, requestBody, startedAt } = exchange
  const protocol = protocolOf(exchange)
  const body = stored(requestBody)
  return httpRecord('request', {
    url: request.url,
    date: startedAt,
    statusline: `${request.method} ${pathOf(request.url)} ${httpVersion(protocol)}`,
    // Plan D8: the headers the ExtraInfo event reported when it arrived, as for the response.
    lines: headerLines(request.extraInfo?.headers ?? request.headers, replaced),
    body: body.bytes,
    warcHeaders: {
      ...protocolField(protocol),
      ...(requestBody && !requestBody.complete ? TRUNCATED : {}),
      ...(body.text ? TEXT_BODY : {})
    }
  })
}

const responseRecord = (
  exchange: Exchange,
  input: WriterInput,
  replaced: Set<string>
): WARCRecord => {
  const { request, response, responseBody, startedAt, state } = exchange
  const protocol = protocolOf(exchange)
  if (response === undefined) {
    throw new Error(`A ${state} exchange for ${request.url} has no response to write`)
  }
  // An empty body here would read as a complete empty response (plan D8, "Partial exchanges").
  if (state === 'complete' && responseBody === undefined) {
    throw new Error(`A complete exchange for ${request.url} has no body to write`)
  }
  const body = state === 'complete' ? stored(responseBody) : NO_BODY
  // The status code and reason phrase come from one event, the response event, because the
  // ExtraInfo event has a status code field and no reason phrase field. An empty reason phrase
  // leaves no trailing space.
  const { status, statusText } = response
  const lines = headerLines(response.extraInfo?.headers ?? response.headers, replaced).map(
    ([name, value]): HeaderLine => {
      const lower = name.toLowerCase()
      return RENAMED.has(lower) ? [`x-orig-${lower}`, value] : [name, value]
    }
  )
  const warcHeaders: Record<string, string> = {
    ...protocolField(protocol),
    ...(state === 'body-omitted' ? TRUNCATED : {}),
    ...(body.text ? TEXT_BODY : {})
  }
  // Plan D8 and ADR-0032 rule 5: through a proxy the reported address can be the proxy's.
  if (input.egress === 'direct' && response.remoteIPAddress !== undefined) {
    warcHeaders['WARC-IP-Address'] = response.remoteIPAddress
  }
  return httpRecord('response', {
    url: request.url,
    date: startedAt,
    statusline: [httpVersion(protocol), status, statusText].filter((part) => part !== '').join(' '),
    lines: [...lines, ['Content-Length', String(body.bytes.length)]],
    body: body.bytes,
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
        'credential-headers': CREDENTIALS,
        'http-message-lines': MESSAGE_LINES
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
