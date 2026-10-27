import { describe, expect, it } from 'vitest'
import { collectExchanges } from '../collector'
import type { CollectedExchanges, CollectorInput, Exchange, RecordedEvent } from '../collector'
import { SPIKE_RUNS, inventedBodies, spikeStream } from './fixtures/streams'

// Every session these tests name was sent `Network.configureDurableMessages`, unless a test says
// otherwise, so a text body is kept from it.
const everySession = ({ events }: CollectorInput): Set<string> =>
  new Set([
    '',
    ...events.map(({ sessionId }) => sessionId),
    ...events
      .filter(({ method }) => method === 'Target.attachedToTarget')
      .map(({ params }) => (params as { sessionId: string }).sessionId)
  ])

const collect = (input: CollectorInput): CollectedExchanges =>
  collectExchanges({ durableSessions: everySession(input), ...input })

const collectSpike = (name: string): CollectedExchanges => {
  const events = spikeStream(name)
  return collect({ events, responseBodies: inventedBodies(events) })
}

const pathOf = ({ request }: Exchange): string => new URL(request.url).pathname

const on =
  (sessionId: string) =>
  (method: string, params: unknown): RecordedEvent => ({ sessionId, method, params })
const page = on('')

const WALL_TIME = 1791751674.5

const sent = (requestId: string, url: string, extra: Record<string, unknown> = {}) =>
  page('Network.requestWillBeSent', {
    requestId,
    wallTime: WALL_TIME,
    type: 'Fetch',
    request: { url, method: 'GET', headers: {} },
    ...extra
  })

const response = (url: string, extra: Record<string, unknown> = {}) => ({
  url,
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'text/plain' },
  mimeType: 'text/plain',
  ...extra
})

const received = (requestId: string, url: string, extra: Record<string, unknown> = {}) =>
  page('Network.responseReceived', { requestId, response: response(url, extra) })
const finished = (requestId: string) => page('Network.loadingFinished', { requestId })
const failed = (requestId: string, canceled: boolean) =>
  page('Network.loadingFailed', { requestId, errorText: 'net::ERR_FAILED', canceled })
const body = (requestId: string) =>
  new Map([[requestId, { body: `body of ${requestId}`, base64Encoded: false }]])

const walkNumbers = (value: unknown, found: number[] = []): number[] => {
  if (typeof value === 'number') found.push(value)
  else if (Array.isArray(value)) value.forEach((item) => walkNumbers(item, found))
  else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((item) => walkNumbers(item, found))
  }
  return found
}

describe('collectExchanges on the step 0 streams', () => {
  it('makes each redirect hop its own exchange under the reused request id', () => {
    const { exchanges, counts } = collectSpike('q4-cross-port-redirect')
    const [first, second, image] = exchanges
    expect(exchanges.map(({ requestId, hop, state }) => [requestId, hop, state])).toEqual([
      ['E4D807742EE9CC96BB46193A2F46003E', 0, 'redirected'],
      ['E4D807742EE9CC96BB46193A2F46003E', 1, 'complete'],
      ['3129698.2', 0, 'complete']
    ])
    expect(first.request.url).toMatch(/:43902\/redirect-start$/)
    expect(first.response?.status).toBe(302)
    expect(first.responseBody).toBeUndefined()
    expect(second.request.url).toMatch(/:44794\/redirect-end$/)
    expect(second.response?.status).toBe(200)
    expect(second.responseBody?.data).toBe('body of E4D807742EE9CC96BB46193A2F46003E')
    expect(exchanges.every(({ complete }) => complete)).toBe(true)
    expect(counts).toMatchObject({ exchanges: 3, inFlight: 0, bodiesOmitted: 0 })
    // Each hop takes its own ExtraInfo pair, including the image whose pair arrived first.
    expect(first.request.extraInfo?.headers.Host).toBe('127.0.0.1:43902')
    expect(first.response?.extraInfo?.statusCode).toBe(302)
    expect(second.request.extraInfo?.headers.Host).toBe('127.0.0.1:44794')
    expect(second.response?.extraInfo?.statusCode).toBe(200)
    expect(image.request.extraInfo?.headers.Host).toBe('127.0.0.1:44794')
    expect(image.response?.extraInfo?.statusCode).toBe(200)
  })

  it('leaves a cross-site frame read from the page session alone in flight', () => {
    const { exchanges, counts } = collectSpike('q4-cross-site-iframe')
    const frame = exchanges.find((exchange) => pathOf(exchange) === '/frame-child')
    expect(frame).toMatchObject({ state: 'in-flight', complete: false })
    expect(frame?.response?.status).toBe(200)
    expect(counts).toMatchObject({ exchanges: 2, inFlight: 1 })
  })

  it('counts the consent filter blocks as failed, since they arrive with canceled false', () => {
    const { exchanges, counts } = collectSpike('q3-consent-network-rule')
    const blocked = exchanges.filter(({ state }) => state === 'failed')
    expect(blocked.map(pathOf)).toEqual([
      '/spike-cmp-blocked.js',
      '/spike-cmp-blocked.js',
      '/spike-cmp-blocked.js'
    ])
    for (const exchange of blocked) {
      expect(exchange.complete).toBe(false)
      expect(exchange.failure).toEqual({
        errorText: 'net::ERR_BLOCKED_BY_CLIENT',
        canceled: false,
        blockedReason: 'other'
      })
    }
    expect(counts).toMatchObject({ exchanges: 2, failed: 3, cancelled: 0 })
  })

  it('counts both cache shapes as cached and never as complete', () => {
    const { exchanges, counts } = collectSpike('q5-cache')
    const cached = exchanges.filter(({ state }) => state === 'cached')
    expect(cached.map(({ requestId }) => requestId).sort()).toEqual([
      '3129727.15',
      '3129727.17',
      '3129727.21',
      '3129727.23'
    ])
    expect(cached.every(({ complete, responseBody }) => !complete && !responseBody)).toBe(true)
    expect(counts).toMatchObject({ exchanges: 11, cached: 4 })
    // A revalidation keeps both statuses the browser reported; neither is a cache signal (D4).
    const revalidated = exchanges.find(({ requestId }) => requestId === '3129727.25')
    expect(revalidated?.state).toBe('complete')
    expect(revalidated?.response?.status).toBe(200)
    expect(revalidated?.response?.extraInfo?.statusCode).toBe(304)
  })

  it('records every request of the savepage run as complete when each body was returned', () => {
    const { exchanges, counts } = collectSpike('q2-savepage')
    expect(exchanges).toHaveLength(10)
    expect(exchanges.every(({ complete }) => complete)).toBe(true)
    expect(counts).toEqual({
      exchanges: 10,
      cached: 0,
      cancelled: 0,
      failed: 0,
      finishedWithoutResponse: 0,
      inFlight: 0,
      bodiesOmitted: 0,
      incompleteRequestBodies: 0,
      webSockets: 0,
      recordedTargets: 0,
      unrecordedTargets: 1
    })
  })

  it('omits a body the browser did not return, and counts the exchange', () => {
    const { exchanges, counts } = collect({ events: spikeStream('q6-tls13') })
    expect(exchanges.every(({ state, complete }) => state === 'body-omitted' && !complete)).toBe(
      true
    )
    expect(counts).toMatchObject({ exchanges: 2, bodiesOmitted: 2 })
  })

  it('converts the main document securityDetails to Bound TLS Details', () => {
    const [document] = collectSpike('q6-tls12-cbc').exchanges
    expect(document.type).toBe('Document')
    expect(document.response?.securityDetails).toMatchObject({
      protocol: 'TLS 1.2',
      mac: 'HMAC-SHA1',
      validFrom: '2026-10-11T20:47:36.000Z'
    })
    expect(document.response?.securityDetails).not.toHaveProperty('certificateId')
  })

  it('puts every exchange in exactly one of the six state counts, for every stream', () => {
    for (const name of SPIKE_RUNS) {
      for (const result of [collectSpike(name), collect({ events: spikeStream(name) })]) {
        const { exchanges, counts } = result
        const { cached, cancelled, failed, finishedWithoutResponse, inFlight, bodiesOmitted } =
          counts
        expect(
          counts.exchanges + cached + cancelled + failed + finishedWithoutResponse + inFlight,
          name
        ).toBe(exchanges.length)
        expect(bodiesOmitted, name).toBeLessThanOrEqual(counts.exchanges)
      }
    }
  })

  it('writes times as ISO 8601 and no fractional number, for every stream', () => {
    for (const name of SPIKE_RUNS) {
      const result = collectSpike(name)
      expect(walkNumbers(result).every(Number.isInteger), name).toBe(true)
      for (const { startedAt } of result.exchanges) {
        expect(startedAt, name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      }
    }
    const [first] = collectSpike('q4-cross-port-redirect').exchanges
    expect(first.startedAt).toBe('2026-10-11T20:47:54.232Z')
  })
})

// The known answers for each step 0 stream with an invented body for every finished request:
// all eleven counts, so a change that moves any one of them fails here. The spike sent no
// `Target.setAutoAttach`, so the page is the one target and counts as unrecorded (plan D17).
const SPIKE_COUNTS: Record<string, Partial<Record<string, number>>> = {
  'q2-savepage': { exchanges: 10 },
  'q3-consent-network-rule': { exchanges: 2, failed: 3 },
  'q4-cross-site-iframe': { exchanges: 2, inFlight: 1 },
  'q4-cross-port-redirect': { exchanges: 3 },
  'q5-cache': { exchanges: 11, cached: 4 },
  'q6-tls13': { exchanges: 2 },
  'q6-tls12-cbc': { exchanges: 2 },
  'q6-tls12-gcm': { exchanges: 2 }
}

describe('collectExchanges counts on every step 0 stream', () => {
  it('names a known answer for each stream the fixture holds', () => {
    expect(Object.keys(SPIKE_COUNTS).sort()).toEqual([...SPIKE_RUNS].sort())
  })

  it.each(Object.entries(SPIKE_COUNTS))('pins all eleven counts for %s', (name, expected) => {
    expect(collectSpike(name).counts).toEqual({
      exchanges: 0,
      cached: 0,
      cancelled: 0,
      failed: 0,
      finishedWithoutResponse: 0,
      inFlight: 0,
      bodiesOmitted: 0,
      incompleteRequestBodies: 0,
      webSockets: 0,
      recordedTargets: 0,
      unrecordedTargets: 1,
      ...expected
    })
  })

  it('counts the page as recorded on every stream once its session is listed', () => {
    for (const name of SPIKE_RUNS) {
      const events = spikeStream(name)
      const raw = collect({ events, responseBodies: inventedBodies(events) })
      const attached = collect({
        events,
        responseBodies: inventedBodies(events),
        recordedSessions: new Set([''])
      })
      expect(attached.exchanges, name).toEqual(raw.exchanges)
      expect(attached.counts, name).toEqual({
        ...raw.counts,
        recordedTargets: 1,
        unrecordedTargets: 0
      })
    }
  })
})

describe('Bound TLS Details in the collector', () => {
  const details = (extra: Record<string, unknown> = {}) => ({
    protocol: 'TLS 1.3',
    keyExchange: '',
    keyExchangeGroup: 'X25519',
    cipher: 'AES_128_GCM',
    certificateId: 7,
    subjectName: 'example.test',
    sanList: ['example.test'],
    issuer: 'Test CA',
    validFrom: 1790000000,
    validTo: 1800000000,
    signedCertificateTimestampList: [],
    certificateTransparencyCompliance: 'unknown',
    encryptedClientHello: false,
    ...extra
  })

  it('converts the main document only, so a subresource cannot fail the collection', () => {
    const doc = 'https://example.test/'
    const image = 'https://cdn.example.test/a.png'
    const { exchanges } = collect({
      events: [
        sent('doc', doc, { type: 'Document', frameId: 'main' }),
        received('doc', doc, { securityDetails: details() }),
        finished('doc'),
        sent('img', image, { type: 'Image', frameId: 'main' }),
        received('img', image, { securityDetails: details({ serverSignatureAlgorithm: 1.5 }) }),
        finished('img')
      ],
      responseBodies: new Map([...body('doc'), ...body('img')])
    })
    const [document, subresource] = exchanges
    expect(document.response?.securityDetails).toMatchObject({ protocol: 'TLS 1.3' })
    expect(subresource.response).not.toHaveProperty('securityDetails')
  })

  it('leaves a redirect hop of the main document unconverted, so it cannot fail the collection', () => {
    const start = 'https://example.test/start'
    const end = 'https://example.test/end'
    const { exchanges } = collect({
      events: [
        sent('doc', start, { type: 'Document', frameId: 'main' }),
        sent('doc', end, {
          type: 'Document',
          frameId: 'main',
          redirectResponse: response(start, {
            status: 302,
            securityDetails: details({ serverSignatureAlgorithm: 1.5 })
          })
        }),
        received('doc', end, { securityDetails: details() }),
        finished('doc')
      ],
      responseBodies: body('doc')
    })
    const [redirect, document] = exchanges
    expect(redirect).toMatchObject({ hop: 0, state: 'redirected' })
    expect(redirect.response).not.toHaveProperty('securityDetails')
    expect(document).toMatchObject({ hop: 1, state: 'complete' })
    expect(document.response?.securityDetails).toMatchObject({ protocol: 'TLS 1.3' })
  })

  it('takes the main frame from the first document request on the page session', () => {
    const frame = 'https://frame.example/'
    const doc = 'https://example.test/'
    const { exchanges } = collect({
      events: [
        sent('doc', doc, { type: 'Document', frameId: 'main' }),
        received('doc', doc, { securityDetails: details() }),
        sent('frame', frame, { type: 'Document', frameId: 'child' }),
        received('frame', frame, { securityDetails: details() })
      ]
    })
    expect(exchanges.find(({ requestId }) => requestId === 'frame')?.response).not.toHaveProperty(
      'securityDetails'
    )
  })
})

describe('collectExchanges output order', () => {
  // A seeded shuffle that keeps each request id's own events in order, as two sessions or two
  // connections interleaving would.
  const interleave = (events: RecordedEvent[], seed: number): RecordedEvent[] => {
    const queues = new Map<string, RecordedEvent[]>()
    for (const event of events) {
      const key = (event.params as { requestId?: string }).requestId ?? event.method
      queues.set(key, [...(queues.get(key) ?? []), event])
    }
    const pending = [...queues.values()]
    const out: RecordedEvent[] = []
    let state = seed
    while (pending.length > 0) {
      state = (state * 1103515245 + 12345) % 2147483648
      const index = state % pending.length
      out.push(pending[index].shift() as RecordedEvent)
      if (pending[index].length === 0) pending.splice(index, 1)
    }
    return out
  }

  it('is the same however the requests interleaved', () => {
    for (const name of ['q2-savepage', 'q5-cache', 'q4-cross-port-redirect']) {
      const events = spikeStream(name)
      const responseBodies = inventedBodies(events)
      const expected = collect({ events, responseBodies })
      for (const seed of [1, 7, 42]) {
        const shuffled = interleave(events, seed)
        expect(shuffled).not.toEqual(events)
        expect(collect({ events: shuffled, responseBodies }), `${name} ${seed}`).toEqual(expected)
      }
    }
  })

  it('orders exchanges by start time, then request id, keeping each hop order', () => {
    const { exchanges } = collect({
      events: [
        sent('b', 'http://127.0.0.1/b'),
        sent('a', 'http://127.0.0.1/a'),
        sent('early', 'http://127.0.0.1/early', { wallTime: WALL_TIME - 1 }),
        sent('a', 'http://127.0.0.1/a2', {
          wallTime: WALL_TIME - 2,
          redirectResponse: response('http://127.0.0.1/a', { status: 302 })
        })
      ]
    })
    expect(exchanges.map(({ requestId, hop }) => `${requestId}:${hop}`)).toEqual([
      'early:0',
      'a:0',
      'a:1',
      'b:0'
    ])
  })
})

describe('collectExchanges across sessions (plan D17)', () => {
  const frame = on('frame-session')
  const worker = on('worker-session')
  const frameUrl = 'http://localhost:44682/frame-child'

  const frameSequence = (childRequestSession: (m: string, p: unknown) => RecordedEvent) => [
    page('Target.attachedToTarget', {
      sessionId: 'frame-session',
      targetInfo: { type: 'iframe' },
      waitingForDebugger: true
    }),
    sent('frame-doc', frameUrl, { type: 'Document', frameId: 'child-frame' }),
    page('Network.requestWillBeSentExtraInfo', {
      requestId: 'frame-doc',
      headers: { Host: 'localhost:44682' }
    }),
    page('Network.responseReceivedExtraInfo', {
      requestId: 'frame-doc',
      statusCode: 200,
      headers: { 'content-type': 'text/html' }
    }),
    received('frame-doc', frameUrl),
    frame('Network.dataReceived', { requestId: 'frame-doc', dataLength: 10 }),
    frame('Network.loadingFinished', { requestId: 'frame-doc' }),
    childRequestSession('Network.requestWillBeSent', {
      requestId: 'frame.2',
      wallTime: WALL_TIME + 1,
      request: { url: 'http://localhost:44682/frame-child.css', method: 'GET', headers: {} }
    }),
    childRequestSession('Network.responseReceived', {
      requestId: 'frame.2',
      response: response('http://localhost:44682/frame-child.css')
    }),
    childRequestSession('Network.loadingFinished', { requestId: 'frame.2' })
  ]
  const frameBodies = new Map([
    ['frame-doc', { body: '<p>frame</p>', base64Encoded: false }],
    ['frame.2', { body: 'p {}', base64Encoded: false }]
  ])

  it('makes a frame document that starts on the page and ends on the frame one exchange', () => {
    const { exchanges, counts } = collect({
      events: frameSequence(frame),
      responseBodies: frameBodies,
      recordedSessions: new Set(['', 'frame-session'])
    })
    const [document, stylesheet] = exchanges
    expect(document).toMatchObject({
      requestId: 'frame-doc',
      hop: 0,
      state: 'complete',
      complete: true,
      frameId: 'child-frame',
      responseBody: { data: '<p>frame</p>', base64Encoded: false }
    })
    expect(document.request.extraInfo?.headers.Host).toBe('localhost:44682')
    expect(document.response?.extraInfo?.statusCode).toBe(200)
    expect(stylesheet).toMatchObject({ requestId: 'frame.2', state: 'complete' })
    expect(counts).toMatchObject({
      exchanges: 2,
      inFlight: 0,
      recordedTargets: 2,
      unrecordedTargets: 0
    })
  })

  it('counts a request on a child session like one on the page session', () => {
    const recordedSessions = new Set(['', 'frame-session'])
    const onChild = collect({
      events: frameSequence(frame),
      responseBodies: frameBodies,
      recordedSessions
    })
    const onPage = collect({
      events: frameSequence(page),
      responseBodies: frameBodies,
      recordedSessions
    })
    expect(onChild).toEqual(onPage)
  })

  it('counts a frame whose Network.enable failed, and leaves its document in flight', () => {
    const { exchanges, counts } = collect({
      events: [
        page('Target.attachedToTarget', {
          sessionId: 'frame-session',
          targetInfo: { type: 'iframe' }
        }),
        page('Target.attachedToTarget', {
          sessionId: 'worker-session',
          targetInfo: { type: 'worker' }
        }),
        page('Target.attachedToTarget', {
          sessionId: 'service-worker-session',
          targetInfo: { type: 'service_worker' }
        }),
        sent('frame-doc', frameUrl, { type: 'Document' }),
        received('frame-doc', frameUrl),
        worker('Network.requestWillBeSent', {
          requestId: 'worker.1',
          wallTime: WALL_TIME,
          request: { url: 'http://127.0.0.1:43902/worker-data.json', method: 'GET', headers: {} }
        }),
        worker('Network.responseReceived', {
          requestId: 'worker.1',
          response: response('http://127.0.0.1:43902/worker-data.json')
        }),
        worker('Network.loadingFinished', { requestId: 'worker.1' })
      ],
      responseBodies: body('worker.1'),
      recordedSessions: new Set(['', 'worker-session', 'service-worker-session'])
    })
    expect(exchanges.map(({ requestId, state }) => [requestId, state])).toEqual([
      ['frame-doc', 'in-flight'],
      ['worker.1', 'complete']
    ])
    // The page, the dedicated worker and the service worker answered; the frame did not (D17).
    expect(counts).toMatchObject({
      exchanges: 1,
      inFlight: 1,
      recordedTargets: 3,
      unrecordedTargets: 1
    })
  })

  it('counts a service worker whose setup did not answer as unrecorded', () => {
    const { counts } = collect({
      events: [
        page('Target.attachedToTarget', {
          sessionId: 'service-worker-session',
          targetInfo: { type: 'service_worker' }
        })
      ],
      recordedSessions: new Set([''])
    })
    expect(counts).toMatchObject({ recordedTargets: 1, unrecordedTargets: 1 })
  })

  it('treats every target as unrecorded when no session is named as recorded', () => {
    const { counts } = collect({
      events: [
        page('Target.attachedToTarget', {
          sessionId: 'frame-session',
          targetInfo: { type: 'iframe' }
        })
      ]
    })
    expect(counts).toMatchObject({ recordedTargets: 0, unrecordedTargets: 2 })
  })

  it('keeps the record and counts the page as unrecorded when its auto-attach failed', () => {
    // The step 0 cross-site iframe run is this stream: no auto-attach, so the frame's document
    // started on the page's session and never finished there.
    const events = spikeStream('q4-cross-site-iframe')
    const { exchanges, counts } = collect({
      events,
      responseBodies: inventedBodies(events),
      recordedSessions: new Set()
    })
    expect(exchanges.map(pathOf)).toContain('/frame-child')
    expect(counts).toMatchObject({
      exchanges: 2,
      inFlight: 1,
      recordedTargets: 0,
      unrecordedTargets: 1
    })
  })

  it('counts an attached target of another type as unrecorded, listed or not', () => {
    const attached = (sessionId: string, type: string) =>
      page('Target.attachedToTarget', { sessionId, targetInfo: { type } })
    const { counts } = collect({
      events: [
        attached('shared-worker-session', 'shared_worker'),
        attached('browser-session', 'browser'),
        attached('frame-session', 'iframe')
      ],
      recordedSessions: new Set(['', 'shared-worker-session', 'frame-session'])
    })
    expect(counts).toMatchObject({ recordedTargets: 2, unrecordedTargets: 2 })
  })
})

describe('collectExchanges counts, one sequence each', () => {
  const url = 'http://127.0.0.1:43902/r'

  it('cancelled: loadingFailed with canceled true', () => {
    const { exchanges, counts } = collect({ events: [sent('r', url), failed('r', true)] })
    expect(exchanges[0]).toMatchObject({ state: 'cancelled', complete: false })
    expect(exchanges[0].failure).toEqual({ errorText: 'net::ERR_FAILED', canceled: true })
    expect(counts).toMatchObject({ exchanges: 0, cancelled: 1, failed: 0 })
  })

  it('failed: loadingFailed with canceled false, after the response arrived', () => {
    const { exchanges, counts } = collect({
      events: [sent('r', url), received('r', url), failed('r', false)],
      responseBodies: body('r')
    })
    expect(exchanges[0]).toMatchObject({ state: 'failed', complete: false })
    expect(exchanges[0].response?.status).toBe(200)
    expect(exchanges[0].responseBody).toBeUndefined()
    expect(counts).toMatchObject({ exchanges: 0, failed: 1 })
  })

  it('inFlight: neither loadingFinished nor loadingFailed arrived', () => {
    const { exchanges, counts } = collect({ events: [sent('r', url), received('r', url)] })
    expect(exchanges[0]).toMatchObject({ state: 'in-flight', complete: false })
    expect(counts).toMatchObject({ exchanges: 0, inFlight: 1 })
  })

  it('cached: requestServedFromCache, even with no terminal event', () => {
    const { exchanges, counts } = collect({
      events: [sent('r', url), page('Network.requestServedFromCache', { requestId: 'r' })]
    })
    expect(exchanges[0]).toMatchObject({ state: 'cached', complete: false })
    expect(counts).toMatchObject({ exchanges: 0, cached: 1 })
  })

  it('cached: a redirect hop answered from the disk cache', () => {
    const { exchanges, counts } = collect({
      events: [
        sent('r', url),
        sent('r', `${url}/next`, {
          redirectResponse: response(url, { status: 301, fromDiskCache: true })
        }),
        received('r', `${url}/next`),
        finished('r')
      ],
      responseBodies: body('r')
    })
    expect(exchanges.map(({ state, complete }) => [state, complete])).toEqual([
      ['cached', false],
      ['complete', true]
    ])
    expect(counts).toMatchObject({ exchanges: 1, cached: 1 })
  })

  it('bodiesOmitted: a finished response with no body returned', () => {
    const { exchanges, counts } = collect({
      events: [sent('r', url), received('r', url), finished('r')]
    })
    expect(exchanges[0]).toMatchObject({ state: 'body-omitted', complete: false })
    expect(exchanges[0].responseBody).toBeUndefined()
    expect(counts).toMatchObject({ exchanges: 1, bodiesOmitted: 1 })
  })

  it('webSockets: Network.webSocketCreated, which starts no exchange', () => {
    const { exchanges, counts } = collect({
      events: [
        page('Network.webSocketCreated', { requestId: 'ws', url: 'ws://127.0.0.1:43902/socket' })
      ]
    })
    expect(exchanges).toEqual([])
    expect(counts).toMatchObject({ exchanges: 0, webSockets: 1 })
  })

  it('names one state when signals overlap: a failure, then a cache signal, wins', () => {
    const { exchanges, counts } = collect({
      events: [
        sent('a', url),
        page('Network.requestServedFromCache', { requestId: 'a' }),
        failed('a', false),
        sent('c', url),
        page('Network.requestServedFromCache', { requestId: 'c' }),
        received('c', url),
        finished('c')
      ],
      responseBodies: new Map([...body('a'), ...body('c')])
    })
    expect(exchanges.map(({ requestId, state, complete }) => [requestId, state, complete])).toEqual(
      [
        ['a', 'failed', false],
        ['c', 'cached', false]
      ]
    )
    expect(exchanges.some(({ responseBody }) => responseBody !== undefined)).toBe(false)
    expect(counts).toMatchObject({ exchanges: 0, cached: 1, failed: 1 })
  })

  it('applies an event that arrived before its requestWillBeSent to the first hop', () => {
    const { exchanges } = collect({
      events: [page('Network.requestServedFromCache', { requestId: 'r' }), sent('r', url)]
    })
    expect(exchanges[0].state).toBe('cached')
  })

  it('keeps no exchange for events whose request never started', () => {
    const { exchanges, counts } = collect({
      events: [
        page('Network.requestWillBeSentExtraInfo', { requestId: 'r', headers: {} }),
        finished('r'),
        page('Network.policyUpdated', {}),
        page('Page.frameNavigated', { frame: {} })
      ]
    })
    expect(exchanges).toEqual([])
    expect(counts.exchanges).toBe(0)
  })

  it('starts a new exchange for a repeated requestWillBeSent with no redirect', () => {
    const { exchanges } = collect({
      events: [sent('r', url), sent('r', url), received('r', url), finished('r')],
      responseBodies: body('r')
    })
    expect(exchanges.map(({ state }) => state)).toEqual(['in-flight', 'complete'])
  })
})

describe('collectExchanges request bodies', () => {
  const url = 'http://127.0.0.1:43902/upload'
  const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')
  const boundary = '----spike'
  const part = (headers: string[]): string => [`--${boundary}`, ...headers, '', ''].join('\r\n')
  const notePart = `${part(['Content-Disposition: form-data; name="note"'])}hello\r\n`
  const preamble =
    notePart +
    part([
      'Content-Disposition: form-data; name="file"; filename="a.bin"',
      'Content-Type: application/octet-stream'
    ])
  const fileBytes = 'FILE-CONTENTS'
  const trailer = `\r\n--${boundary}--\r\n`

  const post = (requestId: string, request: Record<string, unknown>, extra = {}) =>
    sent(requestId, url, {
      request: {
        url,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        hasPostData: true,
        ...request
      },
      ...extra
    })
  const sentHeaders = (requestId: string, headers: Record<string, string>) =>
    page('Network.requestWillBeSentExtraInfo', { requestId, headers })
  const completed = (requestId: string) => [received(requestId, url), finished(requestId)]

  it('marks a multipart body whose file the browser left out as incomplete', () => {
    // Network.getRequestPostData omits the files of a multipart body; the declared length
    // still counts them.
    const declared = Buffer.byteLength(preamble + fileBytes + trailer, 'utf8')
    const { exchanges, counts } = collect({
      events: [
        post('m', { postDataEntries: [{ bytes: b64(preamble) }, {}, { bytes: b64(trailer) }] }),
        sentHeaders('m', { 'Content-Length': String(declared) }),
        ...completed('m')
      ],
      responseBodies: body('m'),
      requestPostData: new Map([['m', { postData: preamble + trailer, base64Encoded: false }]])
    })
    expect(exchanges[0]).toMatchObject({
      state: 'complete',
      complete: false,
      requestBody: { data: preamble + trailer, base64Encoded: false, complete: false }
    })
    expect(counts).toMatchObject({ exchanges: 1, incompleteRequestBodies: 1 })
  })

  it('keeps what the event carried of a multipart body, and counts it incomplete', () => {
    const declared = Buffer.byteLength(preamble + fileBytes + trailer, 'utf8')
    const { exchanges, counts } = collect({
      events: [
        post('m', { postDataEntries: [{ bytes: b64(preamble) }, {}, { bytes: b64(trailer) }] }),
        sentHeaders('m', { 'Content-Length': String(declared) }),
        failed('m', true)
      ]
    })
    expect(exchanges[0]).toMatchObject({
      state: 'cancelled',
      requestBody: { data: b64(preamble + trailer), base64Encoded: true, complete: false }
    })
    expect(counts).toMatchObject({ cancelled: 1, incompleteRequestBodies: 1 })
  })

  it('holds a multipart body every part of which the event carried as complete', () => {
    const text = `${notePart}--${boundary}--\r\n`
    const { exchanges, counts } = collect({
      events: [
        post('m', {
          postDataEntries: [{ bytes: b64(text.slice(0, 10)) }, { bytes: b64(text.slice(10)) }]
        }),
        sentHeaders('m', { 'content-length': String(Buffer.byteLength(text)) }),
        ...completed('m')
      ],
      responseBodies: body('m')
    })
    expect(exchanges[0]).toMatchObject({
      complete: true,
      requestBody: { data: b64(text), base64Encoded: true, complete: true }
    })
    expect(counts.incompleteRequestBodies).toBe(0)
  })

  it('measures a fetched text body in UTF-8 bytes against the declared length', () => {
    const text = 'name=café'
    const { exchanges } = collect({
      events: [
        post('p', { headers: {} }),
        sentHeaders('p', { 'Content-Length': String(Buffer.byteLength(text, 'utf8')) }),
        ...completed('p')
      ],
      responseBodies: body('p'),
      requestPostData: new Map([['p', { postData: text, base64Encoded: false }]])
    })
    expect(exchanges[0].requestBody).toEqual({ data: text, base64Encoded: false, complete: true })
  })

  it('measures a fetched base64 body in decoded bytes', () => {
    const { exchanges } = collect({
      events: [post('p', {}), sentHeaders('p', { 'Content-Length': '3' }), ...completed('p')],
      responseBodies: body('p'),
      requestPostData: new Map([['p', { postData: b64('abc'), base64Encoded: true }]])
    })
    expect(exchanges[0].requestBody?.complete).toBe(true)
  })

  it('reads the deprecated postData string when the event has no entries', () => {
    const { exchanges } = collect({
      events: [
        post('p', { postData: 'a=1', headers: { 'Content-Length': '3' } }),
        ...completed('p')
      ],
      responseBodies: body('p')
    })
    expect(exchanges[0].requestBody).toEqual({ data: 'a=1', base64Encoded: false, complete: true })
  })

  it('counts a body as incomplete when the request declared no single length', () => {
    const cases: Array<Record<string, string>> = [
      {},
      { 'Content-Length': 'three' },
      { 'Content-Length': '3', 'content-length': '4' },
      { 'Content-Length': '99999999999999999999' }
    ]
    for (const headers of cases) {
      const { exchanges, counts } = collect({
        events: [post('p', { postData: 'a=1' }), sentHeaders('p', headers), ...completed('p')],
        responseBodies: body('p')
      })
      expect(exchanges[0].requestBody?.complete, JSON.stringify(headers)).toBe(false)
      expect(counts.incompleteRequestBodies).toBe(1)
    }
  })

  it('holds nothing, and so nothing complete, when no body reached the collector', () => {
    const { exchanges } = collect({
      events: [post('p', {}), sentHeaders('p', { 'Content-Length': '3' }), failed('p', false)]
    })
    expect(exchanges[0]).toMatchObject({
      state: 'failed',
      requestBody: { data: '', base64Encoded: false, complete: false }
    })
  })

  it('applies fetched post data to the last hop that reported a body', () => {
    const { exchanges } = collect({
      events: [
        post('p', { postData: 'a=1', headers: { 'Content-Length': '3' } }),
        post(
          'p',
          { headers: { 'Content-Length': '3' } },
          { redirectResponse: response(url, { status: 307 }) }
        ),
        ...completed('p')
      ],
      responseBodies: body('p'),
      requestPostData: new Map([['p', { postData: 'b=2', base64Encoded: false }]])
    })
    expect(exchanges.map(({ requestBody }) => requestBody?.data)).toEqual(['a=1', 'b=2'])
    expect(exchanges.every(({ complete }) => complete)).toBe(true)
  })
})

// The maintainer's rulings of 2026-10-26 on the charset spike
// (docs/specs/2026-10-26-transaction-record-charset-spike.md, "Rulings, 2026-10-26").
describe('collectExchanges text bodies and durable sessions', () => {
  const url = 'http://127.0.0.1:8080/w1252'
  const worker = on('worker-session')
  const onWorker = [
    page('Target.attachedToTarget', {
      sessionId: 'worker-session',
      targetInfo: { type: 'worker' }
    }),
    worker('Network.requestWillBeSent', {
      requestId: 'w',
      wallTime: WALL_TIME,
      type: 'Fetch',
      request: { url, method: 'GET', headers: {} }
    }),
    worker('Network.responseReceived', { requestId: 'w', response: response(url) }),
    worker('Network.loadingFinished', { requestId: 'w' })
  ]
  const text = new Map([['w', { body: '<p>café</p>', base64Encoded: false }]])
  const base64 = new Map([['w', { body: 'PHA+Y2Fm6TwvcD4=', base64Encoded: true }]])

  it('keeps a text body from a session whose durable messages answered', () => {
    const { exchanges, counts } = collectExchanges({
      events: onWorker,
      responseBodies: text,
      durableSessions: new Set(['', 'worker-session'])
    })
    expect(exchanges[0]).toMatchObject({
      state: 'complete',
      responseBody: { data: '<p>café</p>', base64Encoded: false }
    })
    expect(counts.bodiesOmitted).toBe(0)
  })

  it('omits a text body from any other session, the page being durable or not', () => {
    for (const durableSessions of [new Set(['']), new Set<string>(), undefined]) {
      const { exchanges, counts } = collectExchanges({
        events: onWorker,
        responseBodies: text,
        durableSessions
      })
      expect(exchanges[0].state).toBe('body-omitted')
      expect(exchanges[0].responseBody).toBeUndefined()
      expect(counts).toMatchObject({ exchanges: 1, bodiesOmitted: 1 })
    }
  })

  it('judges a body by the session that reported its loadingFinished, not where it started', () => {
    const startedOnPage = [
      page('Network.requestWillBeSent', {
        requestId: 'w',
        wallTime: WALL_TIME,
        type: 'Document',
        request: { url, method: 'GET', headers: {} }
      }),
      ...onWorker.slice(2)
    ]
    const durablePageOnly = collectExchanges({
      events: startedOnPage,
      responseBodies: text,
      durableSessions: new Set([''])
    })
    expect(durablePageOnly.exchanges[0].state).toBe('body-omitted')
    const durableChild = collectExchanges({
      events: startedOnPage,
      responseBodies: text,
      durableSessions: new Set(['worker-session'])
    })
    expect(durableChild.exchanges[0].state).toBe('complete')
  })

  it('keeps a base64 body from any session', () => {
    const { exchanges } = collectExchanges({ events: onWorker, responseBodies: base64 })
    expect(exchanges[0]).toMatchObject({
      state: 'complete',
      responseBody: { data: 'PHA+Y2Fm6TwvcD4=', base64Encoded: true }
    })
  })

  it("records the page's copy of a response its service worker answered as body-omitted", () => {
    // The durable store holds no body for that copy, so its fetch returned none (charset spike,
    // Question 2, "Service workers").
    const { exchanges, counts } = collectExchanges({
      events: [sent('sw', url), received('sw', url, { fromServiceWorker: true }), finished('sw')],
      durableSessions: new Set([''])
    })
    expect(exchanges[0].state).toBe('body-omitted')
    expect(counts).toMatchObject({ exchanges: 1, bodiesOmitted: 1 })
  })
})

describe('collectExchanges main document', () => {
  const doc = (requestId: string, docUrl: string, frameId: string, wallTime: number) =>
    page('Network.requestWillBeSent', {
      requestId,
      wallTime,
      type: 'Document',
      frameId,
      request: { url: docUrl, method: 'GET', headers: {} }
    })

  it("names the last hop of the main frame's last document", () => {
    const first = 'https://example.test/start'
    const moved = 'https://example.test/moved'
    const next = 'https://example.test/next'
    const { mainDocument } = collect({
      events: [
        doc('a', first, 'main', WALL_TIME),
        doc('a', moved, 'main', WALL_TIME + 1),
        page('Network.requestWillBeSent', {
          requestId: 'frame',
          wallTime: WALL_TIME + 2,
          type: 'Document',
          frameId: 'child',
          request: { url: 'https://other.test/', method: 'GET', headers: {} }
        }),
        doc('b', next, 'main', WALL_TIME + 3),
        received('b', next),
        finished('b')
      ]
    })
    expect(mainDocument).toMatchObject({ requestId: 'b', hop: 0, state: 'body-omitted' })
    expect(mainDocument?.request.url).toBe(next)
  })

  it('names the final hop of a redirected main document', () => {
    const start = 'http://example.test/'
    const end = 'https://example.test/'
    const { mainDocument } = collect({
      events: [
        doc('a', start, 'main', WALL_TIME),
        doc('a', end, 'main', WALL_TIME + 1),
        received('a', end),
        finished('a')
      ],
      responseBodies: body('a')
    })
    expect(mainDocument).toMatchObject({ requestId: 'a', hop: 1, state: 'complete' })
  })

  it('names none when no main frame document was recorded', () => {
    const { mainDocument } = collect({ events: [sent('r', 'https://example.test/r')] })
    expect(mainDocument).toBeUndefined()
  })
})

describe('collectExchanges, a request finished with no response', () => {
  it('counts it apart from in flight and writes no response for it', () => {
    // What step 9's e2e run saw for a service worker's main script on its own session.
    const script = 'http://127.0.0.1:8080/sw.js'
    const { exchanges, counts } = collect({
      events: [
        sent('sw', script),
        page('Network.dataReceived', { requestId: 'sw', dataLength: 328 }),
        finished('sw')
      ],
      responseBodies: body('sw')
    })
    expect(exchanges[0]).toMatchObject({
      state: 'finished-without-response',
      complete: false
    })
    expect(exchanges[0].response).toBeUndefined()
    expect(exchanges[0].responseBody).toBeUndefined()
    expect(counts).toMatchObject({
      exchanges: 0,
      finishedWithoutResponse: 1,
      inFlight: 0,
      bodiesOmitted: 0
    })
  })
})

describe('collectExchanges, a body fetched on another session', () => {
  const url = 'http://127.0.0.1:8080/twice'
  const worker = on('worker-session')
  const events = [
    sent('r', url),
    received('r', url),
    finished('r'),
    worker('Network.loadingFinished', { requestId: 'r' })
  ]

  it('keeps a body fetched on the session that finished the request last', () => {
    const { exchanges } = collect({
      events,
      responseBodies: new Map([
        ['r', { body: 'from the worker', base64Encoded: false, sessionId: 'worker-session' }]
      ])
    })
    expect(exchanges[0]).toMatchObject({
      state: 'complete',
      responseBody: { data: 'from the worker' }
    })
  })

  it('omits a body fetched on another session, whatever that session answered', () => {
    const { exchanges, counts } = collect({
      events,
      responseBodies: new Map([
        ['r', { body: 'from the page', base64Encoded: true, sessionId: '' }]
      ])
    })
    expect(exchanges[0].state).toBe('body-omitted')
    expect(counts.bodiesOmitted).toBe(1)
  })
})
