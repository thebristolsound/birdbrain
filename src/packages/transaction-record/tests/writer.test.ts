import { createHash } from 'crypto'
import { hostname } from 'os'
import { gzipSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { collectExchanges } from '../collector'
import type { Exchange, ExchangeState, RecordedEvent } from '../collector'
import { CREDENTIAL_HEADERS, CREDENTIAL_MARKER, writeTransactionRecord } from '../writer'
import type { WriterInput } from '../writer'
import { SPIKE_RUNS, inventedBodies, spikeStream } from './fixtures/streams'
import { gzipMembers, readWarc } from './fixtures/warcReader'
import type { WarcRecord } from './fixtures/warcReader'

const STARTED = '2026-10-11T20:47:45.500Z'
const REMOTE_IP = '203.0.113.7'

const exchange = (url: string, state: ExchangeState, extra: Partial<Exchange> = {}): Exchange => ({
  requestId: url,
  hop: 0,
  state,
  complete: state === 'complete' || state === 'redirected',
  startedAt: STARTED,
  request: { method: 'GET', url, headers: { Accept: '*/*' } },
  response: {
    url,
    status: 200,
    statusText: 'OK',
    mimeType: 'text/plain',
    remoteIPAddress: REMOTE_IP,
    headers: { 'Content-Type': 'text/plain' }
  },
  ...(state === 'complete'
    ? { responseBody: { data: `body of ${url}`, base64Encoded: false } }
    : {}),
  ...extra
})

const input = (exchanges: Exchange[], extra: Partial<WriterInput> = {}): WriterInput => ({
  exchanges,
  captureId: 'capture-1906',
  birdbrainVersion: '1.0.1-beta.23',
  browserVersion: 'Chrome/146.0.7680.65',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/146.0.0.0 Safari/537.36',
  egress: 'direct',
  date: '2026-10-11T20:47:46.000Z',
  ...extra
})

const writeAndRead = async (
  exchanges: Exchange[],
  extra: Partial<WriterInput> = {}
): Promise<{ records: WarcRecord[]; replacedHeaders: string[]; bytes: Uint8Array }> => {
  const { bytes, replacedHeaders } = await writeTransactionRecord(input(exchanges, extra))
  return { records: readWarc(bytes), replacedHeaders, bytes }
}

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

const header = ({ http }: WarcRecord, name: string): string[] =>
  (http?.headers ?? [])
    .filter(([field]) => field.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value)

const named = (records: WarcRecord[], type: string, url: string): WarcRecord | undefined =>
  records.find(
    (record) => record.warc('WARC-Type') === type && record.warc('WARC-Target-URI') === url
  )

const shape = (records: WarcRecord[]): string[] =>
  records.map((record) => `${record.warc('WARC-Type')} ${record.warc('WARC-Target-URI') ?? ''}`)

const inflatedText = (bytes: Uint8Array): Buffer => Buffer.concat(gzipMembers(bytes))

describe('writeTransactionRecord payloads and digests', () => {
  // The probe's gzip response: 70 bytes on the wire, 4,200 decoded (spec, What the record is).
  const DECODED = 'decoded gzip body line, forty-two bytes!!\n'.repeat(100)
  const PLAIN = 'plain body'
  const BINARY = Buffer.from([0, 1, 2, 253, 254, 255])
  const gzipServed = exchange('https://example.test/gzip', 'complete', {
    response: {
      url: 'https://example.test/gzip',
      status: 200,
      statusText: 'OK',
      mimeType: 'text/plain',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Encoding': 'gzip',
        'Transfer-Encoding': 'chunked',
        'Content-Length': '70'
      }
    },
    responseBody: { data: DECODED, base64Encoded: false }
  })
  const plain = exchange('https://example.test/plain', 'complete', {
    response: {
      url: 'https://example.test/plain',
      status: 200,
      statusText: 'OK',
      mimeType: 'text/plain',
      headers: { 'content-type': 'text/plain', 'content-length': String(PLAIN.length) }
    },
    responseBody: { data: PLAIN, base64Encoded: false }
  })
  const binary = exchange('https://example.test/binary', 'complete', {
    responseBody: { data: BINARY.toString('base64'), base64Encoded: true }
  })

  it('holds every digest, and each payload digest is the SHA-256 of the decoded payload', async () => {
    const { records } = await writeAndRead([gzipServed, plain, binary])
    expect(DECODED.length).toBe(4200)
    const expected: Array<[string, Buffer]> = [
      ['https://example.test/gzip', Buffer.from(DECODED)],
      ['https://example.test/plain', Buffer.from(PLAIN)],
      ['https://example.test/binary', BINARY]
    ]
    for (const [url, payload] of expected) {
      const response = named(records, 'response', url)
      expect(response?.http?.payload.equals(payload)).toBe(true)
      expect(response?.warc('WARC-Payload-Digest')).toBe(sha256(payload))
      expect(response?.warc('WARC-Block-Digest')).toBe(sha256(response?.block ?? Buffer.alloc(0)))
    }
  })

  it('writes one gzip member per record', async () => {
    const { bytes, records } = await writeAndRead([gzipServed, plain, binary])
    expect(gzipMembers(bytes)).toHaveLength(7)
    expect(shape(records)).toEqual([
      'warcinfo ',
      'request https://example.test/gzip',
      'response https://example.test/gzip',
      'request https://example.test/plain',
      'response https://example.test/plain',
      'request https://example.test/binary',
      'response https://example.test/binary'
    ])
  })

  it('keeps the reported framing under x-orig- names and states the stored length', async () => {
    const { records } = await writeAndRead([gzipServed, plain])
    const gzip = named(records, 'response', 'https://example.test/gzip')
    expect(gzip?.http?.headers).toEqual([
      ['Content-Type', 'text/plain'],
      ['x-orig-content-encoding', 'gzip'],
      ['x-orig-transfer-encoding', 'chunked'],
      ['x-orig-content-length', '70'],
      ['Content-Length', String(Buffer.byteLength(DECODED))]
    ])
    const plainResponse = named(records, 'response', 'https://example.test/plain')
    expect(header(plainResponse!, 'x-orig-content-length')).toEqual([String(PLAIN.length)])
    expect(header(plainResponse!, 'Content-Length')).toEqual([String(PLAIN.length)])
    expect(header(plainResponse!, 'Content-Encoding')).toEqual([])
  })

  it('writes the request line, target, date and status as reported', async () => {
    const posted = exchange('https://example.test/form?step=2', 'complete', {
      request: { method: 'POST', url: 'https://example.test/form?step=2', headers: {} },
      requestBody: { data: 'field=value', base64Encoded: false, complete: true }
    })
    const withExtra = exchange('https://example.test/extra', 'complete', {
      response: {
        url: 'https://example.test/extra',
        status: 200,
        statusText: 'OK',
        mimeType: 'text/plain',
        headers: { 'X-From': 'responseReceived' },
        extraInfo: { statusCode: 203, headers: { 'X-From': 'ExtraInfo' } }
      }
    })
    const { records } = await writeAndRead([posted, withExtra])
    const request = named(records, 'request', 'https://example.test/form?step=2')
    expect(request?.http?.statusLine).toBe('POST /form?step=2 HTTP/1.1')
    expect(request?.http?.payload.toString()).toBe('field=value')
    expect(request?.warc('WARC-Truncated')).toBeUndefined()
    expect(request?.warc('WARC-Date')).toBe(STARTED)
    const response = named(records, 'response', 'https://example.test/extra')
    expect(response?.http?.statusLine).toBe('HTTP/1.1 200 OK')
    expect(header(response!, 'X-From')).toEqual(['ExtraInfo'])
    expect(response?.warc('WARC-Date')).toBe(STARTED)
  })
})

describe('writeTransactionRecord text bodies (rulings of 2026-10-26)', () => {
  // A windows-1252 page as the server sent it. With durable messages on its session the browser
  // returns bytes that are not valid UTF-8 as base64 (the charset spike, Question 1).
  const SERVED = Buffer.from('3c703e636166e93c2f703e', 'hex')
  const w1252 = exchange('https://example.test/w1252', 'complete', {
    response: {
      url: 'https://example.test/w1252',
      status: 200,
      statusText: 'OK',
      mimeType: 'text/html',
      headers: { 'Content-Type': 'text/html; charset=windows-1252', 'Content-Length': '11' }
    },
    responseBody: { data: SERVED.toString('base64'), base64Encoded: true }
  })
  // A UTF-8 page with a byte-order mark, which the durable path returns as text.
  const BOM_SERVED = Buffer.from('efbbbf3c703e61623c2f703e', 'hex')
  const bom = exchange('https://example.test/bom', 'complete', {
    responseBody: { data: BOM_SERVED.toString('utf8'), base64Encoded: false }
  })

  it('stores the served bytes of a windows-1252 page (known answer)', async () => {
    const { records } = await writeAndRead([w1252])
    const response = named(records, 'response', 'https://example.test/w1252')!
    expect(response.http?.payload.equals(SERVED)).toBe(true)
    expect(response.warc('WARC-Payload-Digest')).toBe(
      'sha256:f92b1f90c50a0068a6c9dfce9c853e9333a8337b6475fab8a4393f1b1fccd319'
    )
    expect(sha256(SERVED)).toBe(response.warc('WARC-Payload-Digest'))
    expect(header(response, 'x-orig-content-length')).toEqual(['11'])
    expect(header(response, 'Content-Length')).toEqual(['11'])
    expect(header(response, 'Content-Type')).toEqual(['text/html; charset=windows-1252'])
  })

  it('stores a body returned as text as its UTF-8 bytes, byte-order mark included', async () => {
    const { records } = await writeAndRead([bom])
    const response = named(records, 'response', 'https://example.test/bom')!
    expect(response.http?.payload.equals(BOM_SERVED)).toBe(true)
    expect(response.warc('WARC-Payload-Digest')).toBe(sha256(BOM_SERVED))
  })

  it('marks no record as re-encoded text, and states no re-encoding in warcinfo', async () => {
    const posted = exchange('https://example.test/form', 'redirected', {
      request: { method: 'POST', url: 'https://example.test/form', headers: {} },
      requestBody: { data: 'q=caf\u00e9', base64Encoded: false, complete: true }
    })
    const { records } = await writeAndRead([w1252, bom, posted])
    for (const record of records) {
      expect(record.warc('x-birdbrain-decoded-text')).toBeUndefined()
      expect(record.inflated.toString('latin1')).not.toContain('x-birdbrain-decoded-text')
    }
    expect(records[0].block.toString()).not.toContain('UTF-8')
  })
})

describe('writeTransactionRecord partial exchanges (plan D8)', () => {
  const redirect = exchange('https://example.test/redirect', 'redirected', {
    response: {
      url: 'https://example.test/redirect',
      status: 302,
      statusText: 'Found',
      mimeType: '',
      headers: { Location: '/target' }
    }
  })
  const omitted = exchange('https://example.test/omitted', 'body-omitted')
  const shortBody = exchange('https://example.test/upload', 'complete', {
    complete: false,
    request: { method: 'POST', url: 'https://example.test/upload', headers: {} },
    requestBody: { data: 'part of the body', base64Encoded: false, complete: false }
  })
  const failed = exchange('https://example.test/failed', 'failed')
  const cancelled = exchange('https://example.test/cancelled', 'cancelled')
  const inFlight = exchange('https://example.test/in-flight', 'in-flight')
  const cached = exchange('https://example.test/cached', 'cached')
  const complete = exchange('https://example.test/complete', 'complete')
  const all = [complete, redirect, omitted, shortBody, failed, cancelled, inFlight, cached]

  it('writes the records each row of the table names', async () => {
    const { records } = await writeAndRead(all)
    expect(shape(records)).toEqual([
      'warcinfo ',
      'request https://example.test/complete',
      'response https://example.test/complete',
      'request https://example.test/redirect',
      'response https://example.test/redirect',
      'request https://example.test/omitted',
      'response https://example.test/omitted',
      'request https://example.test/upload',
      'response https://example.test/upload',
      'request https://example.test/failed',
      'request https://example.test/cancelled',
      'request https://example.test/in-flight',
      'request https://example.test/cached'
    ])
  })

  it('gives a redirect a response with headers and no body', async () => {
    const { records } = await writeAndRead([redirect])
    const response = named(records, 'response', 'https://example.test/redirect')
    expect(response?.http?.statusLine).toBe('HTTP/1.1 302 Found')
    expect(header(response!, 'Location')).toEqual(['/target'])
    expect(header(response!, 'Content-Length')).toEqual(['0'])
    expect(response?.http?.payload).toHaveLength(0)
    expect(response?.warc('WARC-Truncated')).toBeUndefined()
  })

  it('marks an omitted body and an incomplete request body truncated', async () => {
    const { records } = await writeAndRead([omitted, shortBody])
    const omittedResponse = named(records, 'response', 'https://example.test/omitted')
    expect(omittedResponse?.http?.payload).toHaveLength(0)
    expect(header(omittedResponse!, 'Content-Type')).toEqual(['text/plain'])
    expect(omittedResponse?.warc('WARC-Truncated')).toBe('unspecified')
    const upload = named(records, 'request', 'https://example.test/upload')
    expect(upload?.http?.payload.toString()).toBe('part of the body')
    expect(upload?.warc('WARC-Truncated')).toBe('unspecified')
    expect(named(records, 'response', 'https://example.test/upload')?.warc('WARC-Truncated')).toBe(
      undefined
    )
  })

  it('writes no partial exchange as a complete response or a complete empty one', async () => {
    const { records } = await writeAndRead(all)
    const partial = records.filter(
      (record) =>
        record.warc('WARC-Type') === 'response' &&
        record.warc('WARC-Target-URI') !== 'https://example.test/complete' &&
        record.warc('WARC-Target-URI') !== 'https://example.test/upload'
    )
    expect(partial).toHaveLength(2)
    for (const record of partial) {
      const redirected = /^HTTP\/1\.1 3\d\d /.test(record.http?.statusLine ?? '')
      expect(record.http?.payload).toHaveLength(0)
      expect(redirected || record.warc('WARC-Truncated') === 'unspecified').toBe(true)
    }
    const whole = named(records, 'response', 'https://example.test/complete')
    expect(whole?.warc('WARC-Truncated')).toBeUndefined()
    expect(whole?.http?.payload.toString()).toBe('body of https://example.test/complete')
  })

  it('writes no body on a redirect or an omitted body, even when one is handed in', async () => {
    const responseBody = { data: 'a body the state does not admit', base64Encoded: false }
    const { records } = await writeAndRead([
      { ...redirect, responseBody },
      { ...omitted, responseBody }
    ])
    const responses = records.filter((record) => record.warc('WARC-Type') === 'response')
    expect(responses).toHaveLength(2)
    expect(responses.every((record) => record.http?.payload.length === 0)).toBe(true)
  })

  it('refuses a complete exchange with no body', async () => {
    const bodiless = exchange('https://example.test/bodiless', 'complete', {
      responseBody: undefined
    })
    await expect(writeTransactionRecord(input([bodiless]))).rejects.toThrow(/has no body to write/)
  })

  it('refuses an exchange whose response it should write but does not have', async () => {
    const bare = exchange('https://example.test/bare', 'complete', { response: undefined })
    await expect(writeTransactionRecord(input([bare]))).rejects.toThrow(/has no response/)
  })
})

describe('writeTransactionRecord credential headers (ADR-0036)', () => {
  const SECRETS = {
    requestCookie: 'request-cookie-secret-1',
    extraCookie: 'extra-cookie-secret-2',
    authorization: 'Bearer authorization-secret-3',
    proxyAuthorization: 'Basic proxy-secret-4',
    setCookie: 'set-cookie-secret-5',
    extraSetCookie: 'extra-set-cookie-secret-6',
    secondSetCookie: 'second-set-cookie-secret-7',
    redirectSetCookie: 'redirect-set-cookie-secret-8',
    associated: 'associated-cookie-secret-9',
    blocked: 'blocked-cookie-secret-10',
    exempted: 'exempted-cookie-secret-11',
    headersText: 'headers-text-secret-12',
    requestHeadersText: 'request-headers-text-secret-13',
    legacyRequestHeaders: 'legacy-request-headers-secret-14',
    plainAuthorization: 'plain-authorization-secret-15'
  }
  const cookie = (value: string) => ({ name: 'sid', value, domain: 'example.test', path: '/' })
  const event = (method: string, params: unknown): RecordedEvent => ({
    sessionId: '',
    method,
    params
  })
  const WALL_TIME = 1791751674.5
  const page = 'https://example.test/account'
  const redirected = 'https://example.test/login'

  // Every header source CDP offers for one redirect and one page load, with mixed-case names.
  const events: RecordedEvent[] = [
    event('Network.requestWillBeSent', {
      requestId: 'doc',
      frameId: 'main',
      type: 'Document',
      wallTime: WALL_TIME,
      request: {
        url: redirected,
        method: 'GET',
        headers: { cOOkie: `sid=${SECRETS.requestCookie}`, AUTHORIZATION: SECRETS.authorization }
      }
    }),
    event('Network.requestWillBeSentExtraInfo', {
      requestId: 'doc',
      headers: {
        Cookie: `sid=${SECRETS.extraCookie}`,
        'Proxy-Authorization': SECRETS.proxyAuthorization
      },
      associatedCookies: [{ blockedReasons: [], cookie: cookie(SECRETS.associated) }]
    }),
    event('Network.responseReceivedExtraInfo', {
      requestId: 'doc',
      statusCode: 302,
      headers: { 'set-COOKIE': `sid=${SECRETS.redirectSetCookie}`, location: page },
      headersText: `HTTP/1.1 302 Found\r\nSet-Cookie: sid=${SECRETS.headersText}\r\n\r\n`,
      blockedCookies: [{ blockedReasons: ['SecureOnly'], cookie: cookie(SECRETS.blocked) }],
      exemptedCookies: [{ exemptionReason: 'None', cookie: cookie(SECRETS.exempted) }]
    }),
    event('Network.requestWillBeSent', {
      requestId: 'doc',
      frameId: 'main',
      type: 'Document',
      wallTime: WALL_TIME + 0.1,
      redirectHasExtraInfo: true,
      redirectResponse: {
        url: redirected,
        status: 302,
        statusText: 'Found',
        mimeType: 'text/html',
        headers: { 'Set-Cookie': `sid=${SECRETS.redirectSetCookie}`, Location: page },
        requestHeaders: { Cookie: `sid=${SECRETS.legacyRequestHeaders}` },
        requestHeadersText: `GET /login HTTP/1.1\r\nCookie: sid=${SECRETS.requestHeadersText}`
      },
      request: { url: page, method: 'GET', headers: { Authorization: SECRETS.plainAuthorization } }
    }),
    event('Network.responseReceived', {
      requestId: 'doc',
      response: {
        url: page,
        status: 200,
        statusText: 'OK',
        mimeType: 'text/html',
        headers: { 'Set-Cookie': `a=${SECRETS.setCookie}\nb=${SECRETS.secondSetCookie}` },
        requestHeaders: { Cookie: `sid=${SECRETS.legacyRequestHeaders}` },
        headersText: `HTTP/1.1 200 OK\r\nSet-Cookie: a=${SECRETS.headersText}\r\n\r\n`
      }
    }),
    event('Network.responseReceivedExtraInfo', {
      requestId: 'doc',
      statusCode: 200,
      headers: {
        'SET-cookie': `a=${SECRETS.extraSetCookie}\nb=${SECRETS.secondSetCookie}`,
        'Content-Type': 'text/html'
      },
      headersText: `HTTP/1.1 200 OK\r\nSet-Cookie: a=${SECRETS.headersText}\r\n\r\n`,
      blockedCookies: [],
      exemptedCookies: [{ exemptionReason: 'None', cookie: cookie(SECRETS.exempted) }]
    }),
    event('Network.loadingFinished', { requestId: 'doc' }),
    // A request with no ExtraInfo, whose own headers are the only ones written.
    event('Network.requestWillBeSent', {
      requestId: 'plain',
      type: 'Fetch',
      wallTime: WALL_TIME + 0.2,
      request: {
        url: 'https://example.test/api',
        method: 'GET',
        headers: {
          authorization: SECRETS.plainAuthorization,
          'proxy-AUTHORIZATION': SECRETS.proxyAuthorization
        }
      }
    }),
    event('Network.responseReceived', {
      requestId: 'plain',
      response: {
        url: 'https://example.test/api',
        status: 200,
        statusText: 'OK',
        mimeType: 'application/json',
        headers: { 'set-cookie': `c=${SECRETS.setCookie}` }
      }
    }),
    event('Network.loadingFinished', { requestId: 'plain' })
  ]
  const collected = collectExchanges({
    events,
    responseBodies: new Map([
      ['doc', { body: '<p>signed in</p>', base64Encoded: false }],
      ['plain', { body: '{}', base64Encoded: false }]
    ]),
    durableSessions: new Set([''])
  })

  it('collects the fixture as three complete exchanges', () => {
    expect(collected.exchanges.map(({ state }) => state)).toEqual([
      'redirected',
      'complete',
      'complete'
    ])
  })

  it('leaves no credential value in any byte of the inflated output', async () => {
    const { bytes } = await writeTransactionRecord(input(collected.exchanges))
    const inflated = inflatedText(bytes)
    for (const secret of Object.values(SECRETS)) {
      expect(inflated.includes(secret), secret).toBe(false)
    }
    expect(Buffer.from(bytes).includes(SECRETS.extraCookie)).toBe(false)
  })

  it('keeps each credential header name with the marker as its value', async () => {
    const { records, replacedHeaders } = await writeAndRead(collected.exchanges)
    expect(replacedHeaders).toEqual(CREDENTIAL_HEADERS)
    expect(replacedHeaders).toEqual([
      'authorization',
      'cookie',
      'proxy-authorization',
      'set-cookie'
    ])
    const [
      ,
      redirectRequest,
      redirectResponse,
      pageRequest,
      pageResponse,
      apiRequest,
      apiResponse
    ] = records
    expect(header(redirectRequest, 'cookie')).toEqual([CREDENTIAL_MARKER])
    expect(header(redirectRequest, 'proxy-authorization')).toEqual([CREDENTIAL_MARKER])
    expect(header(redirectResponse, 'set-cookie')).toEqual([CREDENTIAL_MARKER])
    expect(header(pageRequest, 'authorization')).toEqual([CREDENTIAL_MARKER])
    // Each line of a value is its own header line, so the two cookies set stay two lines.
    expect(header(pageResponse, 'set-cookie')).toEqual([CREDENTIAL_MARKER, CREDENTIAL_MARKER])
    expect(header(apiRequest, 'authorization')).toEqual([CREDENTIAL_MARKER])
    expect(header(apiRequest, 'proxy-authorization')).toEqual([CREDENTIAL_MARKER])
    expect(header(apiResponse, 'set-cookie')).toEqual([CREDENTIAL_MARKER])
    expect(redirectRequest.http?.headers.map(([name]) => name)).toEqual([
      'Cookie',
      'Proxy-Authorization'
    ])
  })

  it('states the marker in warcinfo and names no header it did not replace', async () => {
    const { records, replacedHeaders } = await writeAndRead([
      exchange('https://example.test/anonymous', 'complete')
    ])
    expect(replacedHeaders).toEqual([])
    expect(records[0].block.toString()).toContain(CREDENTIAL_MARKER)
  })
})

describe('writeTransactionRecord header blocks', () => {
  it('leaves out HTTP/2 pseudo-headers', async () => {
    const h2 = exchange('https://example.test/h2', 'complete', {
      request: {
        method: 'GET',
        url: 'https://example.test/h2',
        headers: { accept: '*/*' },
        extraInfo: {
          headers: {
            ':authority': 'example.test',
            ':method': 'GET',
            ':path': '/h2',
            ':scheme': 'https',
            accept: '*/*'
          }
        }
      },
      response: {
        url: 'https://example.test/h2',
        status: 200,
        statusText: '',
        protocol: 'h2',
        mimeType: 'text/plain',
        headers: { 'content-type': 'text/plain' },
        extraInfo: { statusCode: 200, headers: { ':status': '200', 'content-type': 'text/plain' } }
      }
    })
    const { records, bytes } = await writeAndRead([h2])
    const [, request, response] = records
    expect(request.http?.headers).toEqual([['accept', '*/*']])
    expect(response.http?.headers.map(([name]) => name)).toEqual(['content-type', 'Content-Length'])
    // HTTP/2 has no reason phrase, and the line ends at the status code.
    expect(response.http?.statusLine).toBe('HTTP/1.1 200')
    expect(inflatedText(bytes).includes(':authority')).toBe(false)
  })

  it('writes each line of a value as its own header line, and keeps ",,," inside a value', async () => {
    const multi = exchange('https://example.test/multi', 'complete', {
      response: {
        url: 'https://example.test/multi',
        status: 200,
        statusText: 'OK',
        mimeType: 'text/plain',
        headers: { Link: '</a>; rel=preload\r\n</b>; rel=preload', 'X-Odd': 'one,,,two' }
      }
    })
    const { records } = await writeAndRead([multi])
    const response = named(records, 'response', 'https://example.test/multi')
    expect(header(response!, 'Link')).toEqual(['</a>; rel=preload', '</b>; rel=preload'])
    expect(header(response!, 'X-Odd')).toEqual(['one,,,two'])
  })
})

describe('writeTransactionRecord protocol (ruling of 2026-10-26)', () => {
  const over = (protocol: string | undefined, path: string): Exchange =>
    exchange(`https://example.test/${path}`, 'complete', {
      response: {
        url: `https://example.test/${path}`,
        status: 200,
        statusText: 'OK',
        mimeType: 'text/plain',
        ...(protocol !== undefined ? { protocol } : {}),
        headers: { 'content-type': 'text/plain' }
      }
    })

  it.each([
    ['h2', 'h2'],
    ['h3', 'h3']
  ])(
    'writes HTTP/1.1 lines and WARC-Protocol %s for an exchange the browser reported as %s',
    async (protocol) => {
      const { records } = await writeAndRead([over(protocol, protocol)])
      const [, request, response] = records
      expect(request.http?.statusLine).toBe(`GET /${protocol} HTTP/1.1`)
      expect(response.http?.statusLine).toBe('HTTP/1.1 200 OK')
      expect(request.warc('WARC-Protocol')).toBe(protocol)
      expect(response.warc('WARC-Protocol')).toBe(protocol)
      expect(response.http?.headers).toEqual([
        ['content-type', 'text/plain'],
        ['Content-Length', String(Buffer.byteLength(`body of https://example.test/${protocol}`))]
      ])
    }
  )

  it('writes HTTP/1.0 lines for http/1.0, in any case, and lower-cases the protocol', async () => {
    const { records } = await writeAndRead([over('HTTP/1.0', 'old')])
    const [, request, response] = records
    expect(request.http?.statusLine).toBe('GET /old HTTP/1.0')
    expect(response.http?.statusLine).toBe('HTTP/1.0 200 OK')
    expect(request.warc('WARC-Protocol')).toBe('http/1.0')
    expect(response.warc('WARC-Protocol')).toBe('http/1.0')
  })

  it('writes no WARC-Protocol where the browser reported none', async () => {
    const { records } = await writeAndRead([
      over(undefined, 'unknown'),
      exchange('https://example.test/failed', 'failed', { response: undefined })
    ])
    expect(records.slice(1).map((record) => record.warc('WARC-Protocol'))).toEqual([
      undefined,
      undefined,
      undefined
    ])
    expect(records[1].http?.statusLine).toBe('GET /unknown HTTP/1.1')
  })
})

describe('writeTransactionRecord warcinfo and addresses', () => {
  it('names the four facts and the fixed statements, and no host, address or proxy', async () => {
    const { records } = await writeAndRead([exchange('https://example.test/', 'complete')])
    const [info] = records
    expect(info.warc('WARC-Type')).toBe('warcinfo')
    expect(info.warc('Content-Type')).toBe('application/warc-fields')
    expect(info.warc('WARC-Date')).toBe('2026-10-11T20:47:46.000Z')
    const fields = info.block
      .toString()
      .trimEnd()
      .split('\r\n')
      .map((line) => line.slice(0, line.indexOf(':')))
    expect(fields).toEqual([
      'software',
      'format',
      'browser',
      'http-header-user-agent',
      'capture-id',
      'decoded-bodies',
      'credential-headers',
      'http-message-lines'
    ])
    const text = info.block.toString()
    expect(text).toContain('software: Birdbrain 1.0.1-beta.23\r\n')
    expect(text).toContain('browser: Chrome/146.0.7680.65\r\n')
    expect(text).toContain(
      'http-header-user-agent: Mozilla/5.0 (X11; Linux x86_64) Chrome/146.0.0.0 Safari/537.36\r\n'
    )
    expect(text).toContain('capture-id: capture-1906\r\n')
    expect(text).toContain(
      'x-orig-content-encoding, x-orig-transfer-encoding and x-orig-content-length'
    )
    expect(text).toContain(`replaced with ${CREDENTIAL_MARKER}.`)
    expect(text).toContain(
      'http-message-lines: Request and status lines read HTTP/1.0 when the browser reported ' +
        'http/1.0 and HTTP/1.1 otherwise'
    )
    const whole = info.inflated.toString()
    expect(whole).not.toContain(hostname())
    expect(whole).not.toContain(REMOTE_IP)
    expect(info.warcHeaders.map(([name]) => name)).toEqual([
      'WARC-Date',
      'WARC-Type',
      'WARC-Record-ID',
      'Content-Type',
      'Content-Length'
    ])
  })

  it('records the remote address while the Egress is Direct', async () => {
    const { records } = await writeAndRead([exchange('https://example.test/', 'complete')])
    expect(named(records, 'response', 'https://example.test/')?.warc('WARC-IP-Address')).toBe(
      REMOTE_IP
    )
    expect(named(records, 'request', 'https://example.test/')?.warc('WARC-IP-Address')).toBe(
      undefined
    )
  })

  it.each(['proxy', 'tor'] as const)('writes no address when the Egress is %s', async (egress) => {
    const exchanges = [
      exchange('https://example.test/', 'complete'),
      exchange('https://example.test/redirect', 'redirected'),
      exchange('https://example.test/omitted', 'body-omitted')
    ]
    const { records, bytes } = await writeAndRead(exchanges, { egress })
    expect(records.every((record) => record.warc('WARC-IP-Address') === undefined)).toBe(true)
    expect(inflatedText(bytes).includes(REMOTE_IP)).toBe(false)
  })
})

describe('writeTransactionRecord on the step 0 streams', () => {
  it.each(SPIKE_RUNS)('writes a record pair for each counted exchange of %s', async (name) => {
    const events = spikeStream(name)
    const { exchanges, counts } = collectExchanges({
      events,
      responseBodies: inventedBodies(events),
      durableSessions: new Set([''])
    })
    const { records } = await writeAndRead(exchanges)
    const types = records.map((record) => record.warc('WARC-Type'))
    expect(types.filter((type) => type === 'warcinfo')).toHaveLength(1)
    expect(types.filter((type) => type === 'request')).toHaveLength(exchanges.length)
    expect(types.filter((type) => type === 'response')).toHaveLength(counts.exchanges)
  })
})

describe('the test reader', () => {
  const regzip = (members: Buffer[]): Buffer =>
    Buffer.concat(members.map((member) => gzipSync(member)))
  const written = async (): Promise<Buffer[]> => {
    const { bytes } = await writeTransactionRecord(
      input([exchange('https://example.test/', 'complete')])
    )
    return gzipMembers(bytes)
  }

  it('rejects a record whose payload changed after the digests were written', async () => {
    const members = await written()
    expect(() => readWarc(regzip(members))).not.toThrow()
    const response = Buffer.from(members[2])
    response[response.indexOf('body of')] = 'B'.charCodeAt(0)
    expect(() => readWarc(regzip([members[0], members[1], response]))).toThrow(
      /Block-Digest does not match/
    )
  })

  it('rejects a gzip member that holds two records', async () => {
    const [info, request, response] = await written()
    expect(() => readWarc(regzip([info, Buffer.concat([request, response])]))).toThrow(
      /more or less than one WARC record/
    )
  })
})
