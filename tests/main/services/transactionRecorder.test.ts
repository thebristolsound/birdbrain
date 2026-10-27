import { describe, it, expect } from 'vitest'
import { gunzipSync } from 'zlib'
import {
  boundTlsOf,
  createTransactionRecorder,
  finishTransactionRecord
} from '@main/services/transactionRecorder'
import type {
  DebuggerMessageListener,
  DebuggerSession,
  RecorderBudget
} from '@main/services/transactionRecorder'
import { CaptureInventorySchema } from '@shared/schemas'
import type { Exchange } from '../../../src/packages/transaction-record/collector'

// What the fake answers a command with: a value, a failure, a later answer, or none at all.
type Answer = { value: unknown } | { fail: string } | { later: Promise<unknown> } | 'hang'

interface Sent {
  method: string
  params: unknown
  sessionId?: string
}

class FakeDebugger implements DebuggerSession {
  readonly sent: Sent[] = []
  private readonly listeners = new Set<DebuggerMessageListener>()
  // Keyed by `method` or `method@sessionId`; anything else answers `{}`.
  answers = new Map<string, Answer>()

  sendCommand(method: string, params?: object, sessionId?: string): Promise<unknown> {
    this.sent.push({ method, params, ...(sessionId !== undefined ? { sessionId } : {}) })
    const answer = this.answers.get(`${method}@${sessionId ?? ''}`) ?? this.answers.get(method)
    if (answer === 'hang') return new Promise(() => {})
    if (answer && 'fail' in answer) return Promise.reject(new Error(answer.fail))
    if (answer && 'later' in answer) return answer.later
    return Promise.resolve(answer ? answer.value : {})
  }

  on(_event: 'message', listener: DebuggerMessageListener): void {
    this.listeners.add(listener)
  }

  removeListener(_event: 'message', listener: DebuggerMessageListener): void {
    this.listeners.delete(listener)
  }

  get listening(): number {
    return this.listeners.size
  }

  emit(method: string, params: unknown, sessionId = ''): void {
    for (const listener of this.listeners) listener({}, method, params, sessionId)
  }

  methods(sessionId?: string): string[] {
    return this.sent.filter((s) => s.sessionId === sessionId).map((s) => s.method)
  }
}

const TIMINGS = { pageSetupMs: 40, childSetupMs: 40 }
const BUDGET: RecorderBudget = {
  totalBytes: 1_000,
  resourceBytes: 300,
  maxEvents: 1_000,
  maxEventBytes: 1_000_000
}
const LIMITS = { maxTotalBufferSize: 1_000, maxResourceBufferSize: 300 }
const WALL_TIME = 1791751674.5

const WRITER = {
  captureId: 'capture-1929',
  birdbrainVersion: '1.0.1-test',
  browserVersion: 'Chrome/152.0.0.0',
  userAgent: 'Test/1.0',
  egress: 'direct' as const,
  date: '2026-10-26T12:00:00.000Z'
}

const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function page(fake: FakeDebugger) {
  const emit =
    (sessionId: string) =>
    (method: string, params: Record<string, unknown>): void =>
      fake.emit(method, params, sessionId)
  return {
    on: emit,
    // A request that sends, answers 200, reports `dataLength` bytes, and finishes.
    exchange(
      requestId: string,
      url: string,
      dataLength: number,
      sessionId = '',
      extra: Record<string, unknown> = {}
    ): void {
      const on = emit(sessionId)
      on('Network.requestWillBeSent', {
        requestId,
        wallTime: WALL_TIME,
        type: 'Document',
        frameId: 'main',
        request: { url, method: 'GET', headers: {} },
        ...extra
      })
      on('Network.responseReceived', {
        requestId,
        response: {
          url,
          status: 200,
          statusText: 'OK',
          headers: {},
          mimeType: 'text/html',
          protocol: 'http/1.1'
        }
      })
      on('Network.dataReceived', { requestId, dataLength })
      on('Network.loadingFinished', { requestId })
    }
  }
}

const body = (text: string, base64Encoded = false) => ({
  value: base64Encoded
    ? { body: Buffer.from(text).toString('base64'), base64Encoded }
    : { body: text, base64Encoded }
})

async function started(fake = new FakeDebugger(), budget: RecorderBudget = BUDGET) {
  const recorder = createTransactionRecorder(fake, budget, TIMINGS)
  const ok = await recorder.start()
  return { fake, recorder, ok }
}

describe('the page session', () => {
  it('enables the domain, then durable messages, then auto-attach, with the budget', async () => {
    const { fake, ok } = await started()
    expect(ok).toBe(true)
    expect(fake.sent).toEqual([
      { method: 'Network.enable', params: LIMITS },
      { method: 'Network.configureDurableMessages', params: LIMITS },
      {
        method: 'Target.setAutoAttach',
        params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }
      }
    ])
  })

  it.each([
    ['fails', { fail: 'Network.enable failed' } as Answer],
    ['does not answer', 'hang' as Answer]
  ])('records nothing when Network.enable %s', async (_label, answer) => {
    const fake = new FakeDebugger()
    fake.answers.set('Network.enable', answer)
    const { recorder, ok } = await started(fake)
    expect(ok).toBe(false)
    expect(fake.methods()).toEqual(['Network.enable'])

    // No event is recorded, and a target that attaches anyway is only resumed.
    page(fake).exchange('doc', 'http://127.0.0.1/', 10)
    fake.emit('Target.attachedToTarget', { sessionId: 'f', targetInfo: { type: 'iframe' } })
    await settle()
    expect(fake.methods('f')).toEqual(['Runtime.runIfWaitingForDebugger'])
    const { exchanges, counts } = await recorder.collect(100)
    expect(exchanges).toEqual([])
    expect(counts.unrecordedTargets).toBe(1)
  })

  it('counts the page unrecorded when its auto-attach fails, and keeps the record', async () => {
    const fake = new FakeDebugger()
    fake.answers.set('Target.setAutoAttach@', { fail: 'stubbed auto-attach failure' })
    fake.answers.set('Network.getResponseBody', body('<p>page</p>'))
    const { recorder, ok } = await started(fake)
    expect(ok).toBe(true)
    page(fake).exchange('doc', 'http://127.0.0.1/', 11)
    const { exchanges, counts } = await recorder.collect(100)
    expect(exchanges.map(({ state }) => state)).toEqual(['complete'])
    expect(counts).toMatchObject({ recordedTargets: 0, unrecordedTargets: 1 })
  })

  it('counts the page unrecorded and keeps no text body when durable messages fail', async () => {
    const fake = new FakeDebugger()
    fake.answers.set('Network.configureDurableMessages@', { fail: 'not supported' })
    fake.answers.set('Network.getResponseBody', body('<p>café</p>'))
    const { recorder } = await started(fake)
    page(fake).exchange('doc', 'http://127.0.0.1/', 11)
    const { exchanges, counts } = await recorder.collect(100)
    expect(exchanges[0].state).toBe('body-omitted')
    expect(counts).toMatchObject({ recordedTargets: 0, unrecordedTargets: 1, bodiesOmitted: 1 })
  })
})

describe('attached targets (plan D17)', () => {
  const attach = (fake: FakeDebugger, sessionId: string, type: string, parent = '') =>
    fake.emit('Target.attachedToTarget', { sessionId, targetInfo: { type } }, parent)

  it('sets up a frame with three commands together and resumes it once they answer', async () => {
    const { fake, recorder } = await started()
    let release: (value: unknown) => void = () => {}
    const later = new Promise((resolve) => {
      release = resolve
    })
    fake.answers.set('Network.enable@frame', { later })

    attach(fake, 'frame', 'iframe')
    await settle()
    expect(fake.methods('frame')).toEqual([
      'Network.enable',
      'Network.configureDurableMessages',
      'Target.setAutoAttach'
    ])
    release({})
    await settle()
    expect(fake.methods('frame')).toEqual([
      'Network.enable',
      'Network.configureDurableMessages',
      'Target.setAutoAttach',
      'Runtime.runIfWaitingForDebugger'
    ])
    expect(fake.sent.find((s) => s.sessionId === 'frame')?.params).toEqual(LIMITS)
    const { counts } = await recorder.collect(100)
    expect(counts).toMatchObject({ recordedTargets: 2, unrecordedTargets: 0 })
  })

  it('resumes a worker whose setup never answers once the bound runs out, and counts it', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.enable@worker', 'hang')
    attach(fake, 'worker', 'worker')
    await settle(5)
    expect(fake.methods('worker')).not.toContain('Runtime.runIfWaitingForDebugger')
    await settle(TIMINGS.childSetupMs + 20)
    expect(fake.methods('worker').filter((m) => m === 'Runtime.runIfWaitingForDebugger')).toEqual([
      'Runtime.runIfWaitingForDebugger'
    ])
    const { counts } = await recorder.collect(100)
    expect(counts).toMatchObject({ recordedTargets: 1, unrecordedTargets: 1 })
  })

  it.each(['Network.enable', 'Network.configureDurableMessages', 'Target.setAutoAttach'])(
    'counts a frame unrecorded when its %s fails, and resumes it once',
    async (method) => {
      const { fake, recorder } = await started()
      fake.answers.set(`${method}@frame`, { fail: 'stubbed child setup failure' })
      attach(fake, 'frame', 'iframe')
      await settle()
      expect(fake.methods('frame').filter((m) => m.startsWith('Runtime.'))).toHaveLength(1)
      const { counts } = await recorder.collect(100)
      expect(counts).toMatchObject({ recordedTargets: 1, unrecordedTargets: 1 })
    }
  )

  it('resumes a service worker with its setup commands, without waiting for them', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.enable@sw', 'hang')
    attach(fake, 'sw', 'service_worker')
    expect(fake.methods('sw')).toEqual([
      'Network.enable',
      'Network.configureDurableMessages',
      'Target.setAutoAttach',
      'Runtime.runIfWaitingForDebugger'
    ])
    await settle(TIMINGS.childSetupMs + 20)
    expect(fake.methods('sw')).toHaveLength(4)
    const { counts } = await recorder.collect(100)
    expect(counts).toMatchObject({ recordedTargets: 1, unrecordedTargets: 1 })
  })

  it('resumes a target of another type at once and counts it unrecorded', async () => {
    const { fake, recorder } = await started()
    attach(fake, 'shared', 'shared_worker')
    expect(fake.methods('shared')).toEqual(['Runtime.runIfWaitingForDebugger'])
    const { counts } = await recorder.collect(100)
    expect(counts).toMatchObject({ recordedTargets: 1, unrecordedTargets: 1 })
  })

  it('resumes a target that attaches after collection stops, and neither records nor counts it', async () => {
    const { fake, recorder } = await started()
    recorder.stop()
    attach(fake, 'late', 'iframe')
    page(fake).exchange('late-doc', 'http://127.0.0.1/late', 5)
    expect(fake.methods('late')).toEqual(['Runtime.runIfWaitingForDebugger'])
    const { exchanges, counts } = await recorder.collect(100)
    expect(exchanges).toEqual([])
    expect(counts).toMatchObject({ recordedTargets: 1, unrecordedTargets: 0 })
  })

  it('fetches a body on the session that reported its loadingFinished', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', body('<p>frame</p>'))
    attach(fake, 'frame', 'iframe')
    await settle()
    const { on } = page(fake)
    on('')('Network.requestWillBeSent', {
      requestId: 'frame-doc',
      wallTime: WALL_TIME,
      type: 'Document',
      frameId: 'child',
      request: { url: 'http://localhost/frame', method: 'GET', headers: {} }
    })
    on('frame')('Network.responseReceived', {
      requestId: 'frame-doc',
      response: { url: 'http://localhost/frame', status: 200, statusText: 'OK', headers: {} }
    })
    on('frame')('Network.dataReceived', { requestId: 'frame-doc', dataLength: 12 })
    on('frame')('Network.loadingFinished', { requestId: 'frame-doc' })
    const { exchanges } = await recorder.collect(100)
    expect(fake.sent.find((s) => s.method === 'Network.getResponseBody')).toEqual({
      method: 'Network.getResponseBody',
      params: { requestId: 'frame-doc' },
      sessionId: 'frame'
    })
    expect(exchanges[0]).toMatchObject({
      state: 'complete',
      responseBody: { data: '<p>frame</p>' }
    })
  })

  it('hands the collector the body fetched on the session that finished the request last', async () => {
    const { fake, recorder } = await started()
    attach(fake, 'worker', 'worker')
    await settle()
    fake.answers.set('Network.getResponseBody@', body('from the page'))
    fake.answers.set('Network.getResponseBody@worker', body('from the worker'))
    const { on } = page(fake)
    on('')('Network.requestWillBeSent', {
      requestId: 'shared',
      wallTime: WALL_TIME,
      request: { url: 'http://127.0.0.1/shared', method: 'GET', headers: {} }
    })
    on('')('Network.responseReceived', {
      requestId: 'shared',
      response: { url: 'http://127.0.0.1/shared', status: 200, statusText: 'OK', headers: {} }
    })
    on('')('Network.loadingFinished', { requestId: 'shared' })
    on('worker')('Network.loadingFinished', { requestId: 'shared' })
    const { exchanges } = await recorder.collect(100)
    expect(exchanges[0]).toMatchObject({
      state: 'complete',
      responseBody: { data: 'from the worker' }
    })
  })

  it('leaves a body omitted when its target detaches before the body returns', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', { fail: 'Session with given id not found' })
    page(fake).exchange('doc', 'http://127.0.0.1/', 10)
    const { counts } = await recorder.collect(100)
    expect(counts).toMatchObject({ exchanges: 1, bodiesOmitted: 1 })
  })
})

describe('the body budget (D17, item 7, and ruling 3 of 2026-10-26)', () => {
  it('fetches no body whose decoded length is over the per-resource limit', async () => {
    const { fake, recorder } = await started()
    page(fake).exchange('big', 'http://127.0.0.1/big', BUDGET.resourceBytes + 1)
    const { counts } = await recorder.collect(100)
    expect(fake.methods()).not.toContain('Network.getResponseBody')
    expect(counts).toMatchObject({ exchanges: 1, bodiesOmitted: 1 })
  })

  it('keeps no returned body whose decoded bytes are over the per-resource limit', async () => {
    const { fake, recorder } = await started()
    // The events under-reported the length; the returned bytes are what count.
    fake.answers.set('Network.getResponseBody', body('x'.repeat(BUDGET.resourceBytes + 1), true))
    page(fake).exchange('liar', 'http://127.0.0.1/liar', 10)
    const { counts } = await recorder.collect(100)
    expect(fake.methods()).toContain('Network.getResponseBody')
    expect(counts).toMatchObject({ exchanges: 1, bodiesOmitted: 1 })
  })

  it('estimates each body at four thirds before fetching and fetches none past the cap', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', 'hang')
    // 300 bytes estimate at 400 each: two fit in 1,000, the third would take the total to 1,200.
    for (const id of ['a', 'b', 'c']) page(fake).exchange(id, `http://127.0.0.1/${id}`, 300)
    expect(
      fake.sent.filter((s) => s.method === 'Network.getResponseBody').map((s) => s.params)
    ).toEqual([{ requestId: 'a' }, { requestId: 'b' }])
    await expect(recorder.collect(20)).rejects.toThrow('The body fetches did not settle')
  })

  it('replaces the estimate with the returned length, so later bodies fit', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', body('tiny'))
    for (const id of ['a', 'b', 'c']) {
      page(fake).exchange(id, `http://127.0.0.1/${id}`, 300)
      await settle()
    }
    const { counts } = await recorder.collect(100)
    expect(counts).toMatchObject({ exchanges: 3, bodiesOmitted: 0 })
  })

  it('keeps no returned body that would take the held total past the cap', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', body('y'.repeat(280), true))
    // Each reports 10 bytes (estimate 16) but returns 376 base64 characters.
    for (const id of ['a', 'b', 'c']) {
      page(fake).exchange(id, `http://127.0.0.1/${id}`, 10)
      await settle()
    }
    const { exchanges, counts } = await recorder.collect(100)
    expect(exchanges.map(({ state }) => state)).toEqual(['complete', 'complete', 'body-omitted'])
    expect(counts.bodiesOmitted).toBe(1)
  })

  it('fetches the post data of a request that reports a body', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getRequestPostData', {
      value: { postData: 'a=1', base64Encoded: false }
    })
    fake.answers.set('Network.getResponseBody', body('ok'))
    page(fake).exchange('post', 'http://127.0.0.1/form', 2, '', {
      request: {
        url: 'http://127.0.0.1/form',
        method: 'POST',
        headers: { 'Content-Length': '3' },
        hasPostData: true
      }
    })
    const { exchanges, counts } = await recorder.collect(100)
    expect(exchanges[0].requestBody).toEqual({ data: 'a=1', base64Encoded: false, complete: true })
    expect(counts.incompleteRequestBodies).toBe(0)
  })

  it('keeps a returned body that fills the cap exactly, and none a character past it', async () => {
    for (const [length, kept] of [
      [BUDGET.totalBytes, true],
      [BUDGET.totalBytes + 4, false]
    ] as const) {
      const fake = new FakeDebugger()
      // Base64 of `length` characters, under the per-resource limit once decoded.
      fake.answers.set('Network.getResponseBody', {
        value: { body: 'QUFB'.repeat(length / 4), base64Encoded: true }
      })
      const { recorder } = await started(fake, { ...BUDGET, resourceBytes: 1_000 })
      page(fake).exchange('doc', 'http://127.0.0.1/', 1)
      const { exchanges } = await recorder.collect(100)
      expect(exchanges[0].state, String(length)).toBe(kept ? 'complete' : 'body-omitted')
    }
  })

  it('keeps a body of exactly the per-resource limit once decoded', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', body('z'.repeat(BUDGET.resourceBytes)))
    page(fake).exchange('doc', 'http://127.0.0.1/', BUDGET.resourceBytes)
    const { exchanges } = await recorder.collect(100)
    expect(exchanges[0].state).toBe('complete')
  })
})

// Finding 2 of the review of #1999: a request body is reserved before it is fetched.
describe('request bodies under the budget', () => {
  const post = (fake: FakeDebugger, requestId: string, request: Record<string, unknown>) =>
    page(fake).exchange(requestId, `http://127.0.0.1/${requestId}`, 2, '', {
      request: {
        url: `http://127.0.0.1/${requestId}`,
        method: 'POST',
        hasPostData: true,
        ...request
      }
    })
  const postDataRequests = (fake: FakeDebugger) =>
    fake.sent.filter((s) => s.method === 'Network.getRequestPostData').map((s) => s.params)

  it('reserves an unknown length at the per-resource limit and sends nothing past the cap', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getRequestPostData', 'hang')
    // 300 bytes reserve 400 each: two fit in 1,000, a third would take the total to 1,200.
    for (const id of ['a', 'b', 'c']) post(fake, id, { headers: {} })
    expect(postDataRequests(fake)).toEqual([{ requestId: 'a' }, { requestId: 'b' }])
    await expect(recorder.collect(20)).rejects.toThrow('did not settle')
  })

  it('reserves a declared length, and fetches none over the per-resource limit', async () => {
    const { fake } = await started()
    fake.answers.set('Network.getRequestPostData', 'hang')
    post(fake, 'small', { headers: { 'content-length': '30' } })
    post(fake, 'large', { headers: { 'Content-Length': String(BUDGET.resourceBytes + 1) } })
    expect(postDataRequests(fake)).toEqual([{ requestId: 'small' }])
  })

  it('reserves what the event already carries when no length is declared', async () => {
    const { fake } = await started()
    fake.answers.set('Network.getRequestPostData', 'hang')
    // 400 base64 characters the event carries, then one 400-character reservation, fill 800 of
    // the 1,000; a third would take the total to 1,200.
    post(fake, 'carried', { postDataEntries: [{ bytes: 'A'.repeat(400) }] })
    post(fake, 'unknown', { headers: {} })
    post(fake, 'past', { headers: {} })
    expect(postDataRequests(fake)).toEqual([{ requestId: 'carried' }, { requestId: 'unknown' }])
  })

  it('keeps returned post data that fills the cap exactly, and none past it', async () => {
    // The request declares 3 bytes, so 4 characters are reserved, and the response body holds 4
    // more until it returns. The post data returns first, against 4 held characters.
    for (const [length, kept] of [
      [BUDGET.totalBytes - 4, true],
      [BUDGET.totalBytes - 3, false]
    ] as const) {
      const fake = new FakeDebugger()
      fake.answers.set('Network.getRequestPostData', {
        value: { postData: 'p'.repeat(length), base64Encoded: false }
      })
      fake.answers.set('Network.getResponseBody', body('ok'))
      const { recorder } = await started(fake, { ...BUDGET, resourceBytes: 1_000 })
      post(fake, 'form', { headers: { 'Content-Length': '3' } })
      const { exchanges } = await recorder.collect(100)
      expect(exchanges[0].requestBody?.data.length, String(length)).toBe(kept ? length : 0)
    }
  })

  it('keeps no returned post data over the per-resource limit once decoded', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getRequestPostData', {
      value: { postData: 'q'.repeat(BUDGET.resourceBytes + 1), base64Encoded: false }
    })
    fake.answers.set('Network.getResponseBody', body('ok'))
    post(fake, 'form', { headers: {} })
    const { exchanges, counts } = await recorder.collect(100)
    expect(exchanges[0].requestBody?.complete).toBe(false)
    expect(counts.incompleteRequestBodies).toBe(1)
  })

  it('counts a request body incomplete when its fetch fails', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getRequestPostData', { fail: 'No post data available' })
    fake.answers.set('Network.getResponseBody', body('ok'))
    post(fake, 'form', { headers: { 'Content-Length': '3' } })
    const { exchanges, counts } = await recorder.collect(100)
    expect(exchanges[0].requestBody).toEqual({ data: '', base64Encoded: false, complete: false })
    expect(counts.incompleteRequestBodies).toBe(1)
  })
})

// Finding 1 of the review of #1999: the events a page can make the recorder hold are bounded.
describe('the event budget', () => {
  // A page that fetches in a loop: each round trip is three held events, since
  // `Network.dataReceived` is not held.
  const loop = (fake: FakeDebugger, rounds: number) => {
    for (let i = 0; i < rounds; i++) page(fake).exchange(`r${i}`, `http://127.0.0.1/x?${i}`, 1)
  }

  it('lets everything go past the event count, and records the Transaction Record failed', async () => {
    const { fake, recorder } = await started(new FakeDebugger(), { ...BUDGET, maxEvents: 30 })
    fake.answers.set('Network.getResponseBody', body('x'))
    loop(fake, 10)
    const fetchesAtBound = fake.methods().filter((m) => m === 'Network.getResponseBody').length
    expect(fetchesAtBound).toBe(10)
    loop(fake, 50)
    // Nothing more is fetched once the bound is reached.
    expect(fake.methods().filter((m) => m === 'Network.getResponseBody')).toHaveLength(10)
    await expect(recorder.collect(100)).rejects.toThrow(
      'The page sent more network events than the Transaction Record holds'
    )
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 100,
      writeMs: 100,
      writer: WRITER
    })
    expect(outcome).toMatchObject({ present: false, reason: 'failed' })
  })

  it('holds exactly the event count, and fails on the next event', async () => {
    const { fake, recorder } = await started(new FakeDebugger(), { ...BUDGET, maxEvents: 3 })
    fake.answers.set('Network.getResponseBody', body('x'))
    loop(fake, 1)
    const { exchanges } = await recorder.collect(100)
    expect(exchanges.map(({ state }) => state)).toEqual(['complete'])
    page(fake).on('')('Network.requestServedFromCache', { requestId: 'r0' })
    await expect(recorder.collect(100)).rejects.toThrow('network events')
  })

  it('records the Transaction Record failed past the byte estimate', async () => {
    const { fake, recorder } = await started(new FakeDebugger(), {
      ...BUDGET,
      maxEventBytes: 2_000
    })
    loop(fake, 20)
    await expect(recorder.collect(100)).rejects.toThrow('network events')
  })

  it('holds no Network.dataReceived event, so data chunks do not count against the bound', async () => {
    const { fake, recorder } = await started(new FakeDebugger(), { ...BUDGET, maxEvents: 4 })
    fake.answers.set('Network.getResponseBody', body('x'))
    const { on } = page(fake)
    on('')('Network.requestWillBeSent', {
      requestId: 'r',
      wallTime: WALL_TIME,
      request: { url: 'http://127.0.0.1/r', method: 'GET', headers: {} }
    })
    on('')('Network.responseReceived', {
      requestId: 'r',
      response: { url: 'http://127.0.0.1/r', status: 200, statusText: 'OK', headers: {} }
    })
    for (let i = 0; i < 100; i++) on('')('Network.dataReceived', { requestId: 'r', dataLength: 0 })
    on('')('Network.loadingFinished', { requestId: 'r' })
    const { exchanges } = await recorder.collect(100)
    expect(exchanges.map(({ state }) => state)).toEqual(['complete'])
  })

  it('resumes a target that attaches after the bound, and does not set it up', async () => {
    const { fake, recorder } = await started(new FakeDebugger(), { ...BUDGET, maxEvents: 4 })
    loop(fake, 2)
    fake.emit('Target.attachedToTarget', { sessionId: 'late', targetInfo: { type: 'iframe' } })
    expect(fake.methods('late')).toEqual(['Runtime.runIfWaitingForDebugger'])
    await expect(recorder.collect(100)).rejects.toThrow('network events')
  })
})

describe('finishTransactionRecord', () => {
  it('writes the record and states its inventory part, which the strict schema accepts', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', body('<p>known</p>'))
    page(fake).exchange('doc', 'http://127.0.0.1/', 12)
    recorder.stop()
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 100,
      writeMs: 5_000,
      writer: WRITER,
      budget: BUDGET
    })
    if (!outcome.present) throw outcome.error
    expect(outcome.inventory).toEqual({
      present: true,
      exchanges: 1,
      cached: 0,
      cancelled: 0,
      failed: 0,
      inFlight: 0,
      finishedWithoutResponse: 0,
      bodiesOmitted: 0,
      incompleteRequestBodies: 0,
      webSockets: 0,
      recordedTargets: 1,
      unrecordedTargets: 0,
      replacedHeaders: [],
      budget: { totalBytes: 1_000, resourceBytes: 300 }
    })
    expect(outcome.boundTlsAbsent).toBe('not-https')
    expect(outcome.boundTls).toBeUndefined()
    expect(gunzipSync(outcome.warcGz).toString()).toContain('<p>known</p>')
    const parsed = CaptureInventorySchema.safeParse({
      mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
      transactionRecord: outcome.inventory,
      screenshot: {
        present: true,
        scaled: false,
        truncated: false,
        trimmed: false,
        contentWidth: 1,
        contentHeight: 1,
        width: 1,
        height: 1
      },
      pdf: { present: false, reason: 'not-taken' }
    })
    expect(parsed.success ? [] : parsed.error.issues).toEqual([])
  })

  it('records the Transaction Record failed, within its bound, when a body fetch never settles', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', 'hang')
    page(fake).exchange('doc', 'http://127.0.0.1/', 12)
    recorder.stop()
    const startedAt = Date.now()
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 50,
      writeMs: 5_000,
      writer: WRITER
    })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(outcome).toMatchObject({ present: false, reason: 'failed' })
  })

  it('records the Transaction Record failed when the writer throws', async () => {
    const { recorder } = await started()
    recorder.stop()
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 50,
      writeMs: 5_000,
      writer: WRITER,
      write: () => Promise.reject(new Error('writer broke'))
    })
    expect(outcome).toMatchObject({ present: false, reason: 'failed' })
    expect(outcome.present ? undefined : String(outcome.error)).toContain('writer broke')
  })

  it('records the Transaction Record failed when the writer runs out of time', async () => {
    const { recorder } = await started()
    recorder.stop()
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 50,
      writeMs: 30,
      writer: WRITER,
      write: () => new Promise(() => {})
    })
    expect(outcome).toMatchObject({ present: false, reason: 'failed' })
  })

  // Ruling (c) of 2026-10-26 on the review of #1999: each phase is cut to the time left.
  it('cuts the body fetches to the time left and records the record failed', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', 'hang')
    page(fake).exchange('doc', 'http://127.0.0.1/', 12)
    recorder.stop()
    const startedAt = Date.now()
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 5_000,
      writeMs: 10_000,
      timeLeftMs: () => 30,
      writer: WRITER
    })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(outcome).toMatchObject({ present: false, reason: 'failed' })
    expect(String(outcome.present || outcome.error)).toContain('within 30ms')
  })

  it('cuts the writer to the time left', async () => {
    const { recorder } = await started()
    recorder.stop()
    let left = 5_000
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 5_000,
      writeMs: 10_000,
      timeLeftMs: () => {
        const now = left
        left = 30
        return now
      },
      writer: WRITER,
      write: () => new Promise(() => {})
    })
    expect(outcome).toMatchObject({ present: false, reason: 'failed' })
    expect(String(outcome.present || outcome.error)).toContain('writer did not settle within 30ms')
  })

  it('records the record failed at once when no time is left', async () => {
    const { recorder } = await started()
    recorder.stop()
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 5_000,
      writeMs: 10_000,
      timeLeftMs: () => 0,
      writer: WRITER
    })
    expect(outcome).toMatchObject({ present: false, reason: 'failed' })
  })

  // Finding 5 of the review of #1999: a value the strict schema refuses never reaches the entry.
  it('records the record failed when the main document reports an SCT the schema refuses', async () => {
    const { fake, recorder } = await started()
    fake.answers.set('Network.getResponseBody', body('<p>tls</p>'))
    const url = 'https://127.0.0.1/'
    const { on } = page(fake)
    on('')('Network.requestWillBeSent', {
      requestId: 'doc',
      wallTime: WALL_TIME,
      type: 'Document',
      frameId: 'main',
      request: { url, method: 'GET', headers: {} }
    })
    on('')('Network.responseReceived', {
      requestId: 'doc',
      response: {
        url,
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/html',
        securityDetails: {
          protocol: 'TLS 1.3',
          keyExchange: '',
          cipher: 'AES_128_GCM',
          certificateId: 0,
          subjectName: '127.0.0.1',
          sanList: ['127.0.0.1'],
          issuer: 'Test CA',
          validFrom: 1767225600,
          validTo: 1798761600,
          // Year 33658: `toISOString` writes a six-digit year, which ISO 8601 parsing refuses.
          signedCertificateTimestampList: [
            {
              status: 'Verified',
              origin: 'Embedded in certificate',
              logDescription: 'Test log',
              logId: 'AA',
              timestamp: 1e15,
              hashAlgorithm: 'SHA-256',
              signatureAlgorithm: 'ECDSA',
              signatureData: 'BB'
            }
          ],
          certificateTransparencyCompliance: 'unknown',
          encryptedClientHello: false
        }
      }
    })
    on('')('Network.dataReceived', { requestId: 'doc', dataLength: 10 })
    on('')('Network.loadingFinished', { requestId: 'doc' })
    recorder.stop()
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 100,
      writeMs: 5_000,
      writer: WRITER
    })
    expect(outcome).toMatchObject({ present: false, reason: 'failed' })
  })

  it('signs the count of requests finished with no response apart from those in flight', async () => {
    const { fake, recorder } = await started()
    const { on } = page(fake)
    on('sw')('Network.requestWillBeSent', {
      requestId: 'script',
      wallTime: WALL_TIME,
      type: 'Other',
      request: { url: 'http://127.0.0.1/sw.js', method: 'GET', headers: {} }
    })
    on('sw')('Network.loadingFinished', { requestId: 'script' })
    recorder.stop()
    const outcome = await finishTransactionRecord(recorder, {
      collectMs: 100,
      writeMs: 5_000,
      writer: WRITER
    })
    if (!outcome.present) throw outcome.error
    expect(outcome.inventory).toMatchObject({
      exchanges: 0,
      inFlight: 0,
      finishedWithoutResponse: 1
    })
  })

  it('stops listening once disposed', async () => {
    const { fake, recorder } = await started()
    expect(fake.listening).toBe(1)
    recorder.dispose()
    expect(fake.listening).toBe(0)
  })
})

describe('boundTlsOf (plan D7)', () => {
  const details = {
    protocol: 'TLS 1.3',
    keyExchange: '',
    keyExchangeGroup: 'X25519',
    cipher: 'AES_128_GCM',
    subjectName: '127.0.0.1',
    sanList: ['127.0.0.1'],
    issuer: 'Birdbrain Test CA',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2027-01-01T00:00:00.000Z',
    signedCertificateTimestampList: [],
    certificateTransparencyCompliance: 'unknown' as const,
    encryptedClientHello: false
  }
  const main = (url: string, state: Exchange['state'], secure = true): Exchange => ({
    requestId: 'doc',
    hop: 0,
    state,
    complete: state === 'complete',
    startedAt: '2026-10-26T12:00:00.000Z',
    request: { method: 'GET', url, headers: {} },
    response: {
      url,
      status: 200,
      statusText: 'OK',
      mimeType: 'text/html',
      headers: {},
      ...(secure ? { securityDetails: details } : {})
    }
  })

  it('states the main document details over https', () => {
    expect(boundTlsOf(main('https://127.0.0.1/', 'complete'))).toEqual({ boundTls: details })
  })

  it('states not-https for an http main document', () => {
    expect(boundTlsOf(main('http://127.0.0.1/', 'complete', false))).toEqual({
      boundTlsAbsent: 'not-https'
    })
  })

  it('states from-cache for a cached https main document, whatever it reported', () => {
    expect(boundTlsOf(main('https://127.0.0.1/', 'cached'))).toEqual({
      boundTlsAbsent: 'from-cache'
    })
  })

  it('states not-reported for a main document whose URL does not parse', () => {
    expect(boundTlsOf(main('not a url', 'complete'))).toEqual({ boundTlsAbsent: 'not-reported' })
  })

  it('states not-reported with no details or no main document', () => {
    expect(boundTlsOf(main('https://127.0.0.1/', 'complete', false))).toEqual({
      boundTlsAbsent: 'not-reported'
    })
    expect(boundTlsOf(undefined)).toEqual({ boundTlsAbsent: 'not-reported' })
  })
})
