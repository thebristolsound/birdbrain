import { describe, expect, it } from 'vitest'
import { CREDENTIAL_MARKER } from '../../../../src/packages/transaction-record/writer'
import { scrubNetworkEvent } from '@main/services/launchedBrowser/scrub'

// The synthetic-event test of the stage-2 spec ("From a session-long recording", step 4): a marker
// value in every field that can hold a credential header or cookie, in each `Network` event the
// recording reads, and none survives the scrub. Every request body leaves with the flag that
// announced it (ADR-0051).

const MARK = 'SECRET-MARKER-41f2'

const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${MARK}`,
  cookie: `sid=${MARK}`,
  'Set-Cookie': `sid=${MARK}; Path=/`,
  'Proxy-Authorization': `Basic ${MARK}`,
  Accept: 'text/html'
})

const headersText = (): string =>
  `HTTP/1.1 200 OK\r\nAuthorization: Bearer ${MARK}\r\nCookie: sid=${MARK}\r\n` +
  `set-cookie: sid=${MARK}\r\nProxy-Authorization: Basic ${MARK}\r\nAccept: text/html\r\n\r\n`

const cookie = () => ({ name: 'sid', value: MARK, domain: 'example.com', path: '/' })

const response = () => ({
  url: 'https://example.com/',
  status: 200,
  headers: headers(),
  headersText: headersText(),
  requestHeaders: headers(),
  requestHeadersText: headersText()
})

const EVENTS: Array<[string, Record<string, unknown>]> = [
  [
    'Network.requestWillBeSent',
    {
      requestId: '1',
      request: {
        url: 'https://example.com/login',
        method: 'POST',
        headers: headers(),
        hasPostData: true,
        postData: `password=${MARK}`,
        postDataEntries: [{ bytes: Buffer.from(`password=${MARK}`).toString('base64') }]
      },
      redirectResponse: response()
    }
  ],
  ['Network.responseReceived', { requestId: '1', response: response() }],
  [
    'Network.requestWillBeSentExtraInfo',
    {
      requestId: '1',
      headers: headers(),
      associatedCookies: [{ blockedReasons: [], cookie: cookie() }]
    }
  ],
  [
    'Network.responseReceivedExtraInfo',
    {
      requestId: '1',
      statusCode: 200,
      headers: headers(),
      headersText: headersText(),
      blockedCookies: [
        { blockedReasons: ['SecureOnly'], cookieLine: `sid=${MARK}`, cookie: cookie() }
      ],
      exemptedCookies: [{ exemptionReason: 'None', cookieLine: `sid=${MARK}`, cookie: cookie() }]
    }
  ],
  ['Network.responseReceivedEarlyHints', { requestId: '1', headers: headers() }],
  [
    'Network.webSocketWillSendHandshakeRequest',
    { requestId: '2', request: { headers: headers() } }
  ],
  ['Network.webSocketHandshakeResponseReceived', { requestId: '2', response: response() }],
  [
    'Network.signedExchangeReceived',
    {
      requestId: '3',
      info: { outerResponse: response(), header: { responseHeaders: headers() } }
    }
  ]
]

describe('scrubNetworkEvent', () => {
  it.each(EVENTS)('leaves no credential value in %s', (method, params) => {
    expect(JSON.stringify(params)).toContain(MARK)
    const { params: scrubbed } = scrubNetworkEvent(method, params)
    expect(JSON.stringify(scrubbed)).not.toContain(MARK)
  })

  it('keeps every header name and every other value', () => {
    const { params } = scrubNetworkEvent('Network.responseReceived', {
      requestId: '1',
      response: response()
    })
    const scrubbed = params.response as { headers: Record<string, string>; headersText: string }
    expect(scrubbed.headers).toEqual({
      Authorization: CREDENTIAL_MARKER,
      cookie: CREDENTIAL_MARKER,
      'Set-Cookie': CREDENTIAL_MARKER,
      'Proxy-Authorization': CREDENTIAL_MARKER,
      Accept: 'text/html'
    })
    expect(scrubbed.headersText).toBe(
      `HTTP/1.1 200 OK\r\nAuthorization: ${CREDENTIAL_MARKER}\r\nCookie: ${CREDENTIAL_MARKER}\r\n` +
        `set-cookie: ${CREDENTIAL_MARKER}\r\nProxy-Authorization: ${CREDENTIAL_MARKER}\r\n` +
        'Accept: text/html\r\n\r\n'
    )
  })

  it('removes a request body with the flag that announced it, and says so', () => {
    const [method, params] = EVENTS[0]
    const { params: scrubbed, bodyWithheld } = scrubNetworkEvent(method, params)
    expect(bodyWithheld).toBe(true)
    expect(scrubbed.request).not.toHaveProperty('postData')
    expect(scrubbed.request).not.toHaveProperty('postDataEntries')
    expect(scrubbed.request).not.toHaveProperty('hasPostData')
  })

  // The browser can announce a body in any one of three ways; each alone counts it.
  it.each([
    ['hasPostData', { hasPostData: true }],
    ['postData', { postData: 'a=1' }],
    ['postDataEntries', { postDataEntries: [{ bytes: 'YT0x' }] }]
  ])('counts a body announced by %s alone', (_, body) => {
    const { params, bodyWithheld } = scrubNetworkEvent('Network.requestWillBeSent', {
      requestId: '1',
      request: { url: 'https://example.com/', method: 'POST', headers: {}, ...body }
    })
    expect(bodyWithheld).toBe(true)
    for (const field of ['hasPostData', 'postData', 'postDataEntries']) {
      expect(params.request).not.toHaveProperty(field)
    }
  })

  it('withholds nothing from a request that had no body', () => {
    const { bodyWithheld } = scrubNetworkEvent('Network.requestWillBeSent', {
      requestId: '1',
      request: { url: 'https://example.com/', method: 'GET', headers: {} }
    })
    expect(bodyWithheld).toBe(false)
  })

  // What the user guide says stays: a search sent in the address, and a token in an address or in
  // a header outside the four.
  it('keeps the request address, its query included, and every other header', () => {
    const url = `https://example.com/search?q=${MARK}&token=${MARK}`
    const { params } = scrubNetworkEvent('Network.requestWillBeSent', {
      requestId: '1',
      request: { url, method: 'GET', headers: { 'X-Api-Key': MARK } }
    })
    expect(params.request).toMatchObject({ url, headers: { 'X-Api-Key': MARK } })
  })

  it('does not change the event it was given', () => {
    const [method, params] = EVENTS[3]
    const before = JSON.stringify(params)
    scrubNetworkEvent(method, params)
    expect(JSON.stringify(params)).toBe(before)
  })
})
