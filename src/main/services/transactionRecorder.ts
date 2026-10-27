import { collectExchanges } from '../../packages/transaction-record/collector'
import type {
  CollectedExchanges,
  Exchange,
  RecordedEvent,
  RequestPostDataResult,
  ResponseBodyResult
} from '../../packages/transaction-record/collector'
import { writeTransactionRecord } from '../../packages/transaction-record/writer'
import type {
  WriterInput,
  WrittenTransactionRecord
} from '../../packages/transaction-record/writer'
import { BoundTlsSchema, CaptureInventorySchema } from '@shared/schemas'
import type { BoundTls, CaptureInventory } from '@shared/schemas'
import { CREDENTIAL_HEADER_NAMES } from '@shared/types'
import type { BoundTlsAbsence, CredentialHeaderName } from '@shared/types'
import {
  TRANSACTION_RECORD_MAX_EVENT_BYTES,
  TRANSACTION_RECORD_MAX_EVENTS,
  TRANSACTION_RECORD_RESOURCE_BYTES,
  TRANSACTION_RECORD_TOTAL_BYTES
} from '@shared/constants'

// Records the Transaction Record of one background render (step 9 of
// docs/plans/2026-10-10-capture-engine-first-slice.md, with D17 for the attach and the charset
// spike's rulings of 2026-10-26 for durable messages). The renderer owns the window and the
// debugger; this module sets up each debugger session, records its Network events, fetches the
// bodies under the budget, and hands the events to the collector and the exchanges to the writer.

/** The part of `wc.debugger` the recorder uses, so a test can stand in for it. */
export interface DebuggerSession {
  sendCommand(method: string, commandParams?: object, sessionId?: string): Promise<unknown>
  on(event: 'message', listener: DebuggerMessageListener): unknown
  removeListener(event: 'message', listener: DebuggerMessageListener): unknown
}

export type DebuggerMessageListener = (
  event: unknown,
  method: string,
  params: unknown,
  sessionId?: string
) => void

export interface RecorderBudget {
  /**
   * Characters of returned body text, response and request bodies together, the recorder holds
   * at most, across every session (D17, item 7).
   */
  totalBytes: number
  /** Bytes of one decoded body; a larger body is not kept (ruling 3 of 2026-10-26). */
  resourceBytes: number
  /** Network events the recorder holds at most; past it the record is `failed`. */
  maxEvents: number
  /** The JSON length of the events the recorder holds, at most; past it the record is `failed`. */
  maxEventBytes: number
}

export interface RecorderTimings {
  /** The wait for each setup command on the page's session. */
  pageSetupMs: number
  /** The wait for a frame's or a worker's setup commands before it is resumed (D17, item 2). */
  childSetupMs: number
}

export const TRANSACTION_RECORD_BUDGET: RecorderBudget = {
  totalBytes: TRANSACTION_RECORD_TOTAL_BYTES,
  resourceBytes: TRANSACTION_RECORD_RESOURCE_BYTES,
  maxEvents: TRANSACTION_RECORD_MAX_EVENTS,
  maxEventBytes: TRANSACTION_RECORD_MAX_EVENT_BYTES
}

// D17 proposes 2 s for a child, the value its scratch script used; the setup answers on a frame
// or a dedicated worker arrived within 50 ms in every measured run.
export const RECORDER_TIMINGS: RecorderTimings = { pageSetupMs: 5_000, childSetupMs: 2_000 }

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }

// The page's own session, as `wc.debugger` reports it and the collector reads it.
const PAGE_SESSION = ''

const RECORDED_CHILD_TYPES = new Set(['iframe', 'worker', 'service_worker'])

// The Network events the collector reads; every other one, `Network.dataReceived` included, is
// used here at most and never held.
const HELD_METHODS = new Set([
  'Network.requestWillBeSent',
  'Network.requestWillBeSentExtraInfo',
  'Network.responseReceived',
  'Network.responseReceivedExtraInfo',
  'Network.requestServedFromCache',
  'Network.loadingFinished',
  'Network.loadingFailed',
  'Network.webSocketCreated'
])

export interface TransactionRecorder {
  /**
   * Sets up the page's session once `about:blank` has loaded and before the target loads.
   * Resolves false, and records nothing, when the page's `Network.enable` failed or did not
   * answer: the Transaction Record is then absent as `failed` (open question E).
   */
  start(): Promise<boolean>
  /** Collection stops: later events are not recorded, and a target that attaches is resumed. */
  stop(): void
  /** Waits for the body fetches still out, up to `ms`, then collects. Throws on the bound. */
  collect(ms: number): Promise<CollectedExchanges>
  /** Removes the message listener. */
  dispose(): void
}

class Bound extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not settle within ${ms}ms`)
    this.name = 'TransactionRecordTimeout'
  }
}

// A bound of zero or less has run out before the phase starts.
function withinMs<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  if (ms <= 0) return Promise.reject(new Bound(what, Math.max(0, ms)))
  let timer: NodeJS.Timeout | undefined
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Bound(what, ms)), ms)
  })
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer))
}

// True when the command answered within the bound; false when it failed or did not answer.
async function answered(command: Promise<unknown>, ms: number): Promise<boolean> {
  try {
    await withinMs(command, ms, 'command')
    return true
  } catch {
    return false
  }
}

// D17, item 7: a body returns as base64 unless the engine can tell in advance it is text, which
// it cannot, so each body is estimated at four thirds of its decoded length, rounded up to four.
const base64Length = (bytes: number): number => Math.ceil(bytes / 3) * 4

const decodedLength = (body: string, base64Encoded: boolean): number =>
  Buffer.byteLength(body, base64Encoded ? 'base64' : 'utf8')

const DECIMAL = /^\d+$/

interface PostedRequest {
  headers?: Record<string, string>
  postDataEntries?: Array<{ bytes?: string }>
}

// What a request body is reserved at before `Network.getRequestPostData` is sent: four thirds of
// a declared `Content-Length`, the base64 the event already carries, or, with neither, four
// thirds of the per-resource limit, the most a kept body can be.
function postDataEstimate({ headers, postDataEntries }: PostedRequest, resourceBytes: number) {
  const declared = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'content-length'
  )?.[1]
  if (declared !== undefined && DECIMAL.test(declared.trim())) {
    return base64Length(Number(declared.trim()))
  }
  if (postDataEntries !== undefined) {
    return postDataEntries.reduce((sum, { bytes }) => sum + (bytes?.length ?? 0), 0)
  }
  return base64Length(resourceBytes)
}

const bodyKey = (sessionId: string, requestId: string): string => `${sessionId}\n${requestId}`

export function createTransactionRecorder(
  debuggerSession: DebuggerSession,
  budget: RecorderBudget = TRANSACTION_RECORD_BUDGET,
  timings: RecorderTimings = RECORDER_TIMINGS
): TransactionRecorder {
  const limits = {
    maxTotalBufferSize: budget.totalBytes,
    maxResourceBufferSize: budget.resourceBytes
  }
  const events: RecordedEvent[] = []
  // Keyed by session and request id, since D17 has a request start on one session and finish on
  // another; `lastFinished` names the session whose body the collector judges.
  const responseBodies = new Map<string, ResponseBodyResult>()
  const lastFinished = new Map<string, string>()
  const requestPostData = new Map<string, RequestPostDataResult>()
  const recordedSessions = new Set<string>()
  const durableSessions = new Set<string>()
  const dataLengths = new Map<string, number>()
  const pending = new Set<Promise<unknown>>()
  let held = 0
  let eventBytes = 0
  let recording = false
  let stopped = false
  // Set once the page sent more events than the budget holds: everything held is let go, and the
  // record is `failed`, since an exchange whose events were dropped could be neither written nor
  // counted.
  let overflow: Error | undefined

  const release = (reason: Error): void => {
    overflow = reason
    events.length = 0
    responseBodies.clear()
    requestPostData.clear()
    lastFinished.clear()
    dataLengths.clear()
    held = 0
  }

  const hold = (event: RecordedEvent): boolean => {
    if (overflow) return false
    const size = JSON.stringify(event.params)?.length ?? 0
    if (events.length >= budget.maxEvents || eventBytes + size > budget.maxEventBytes) {
      release(
        new Error(
          `The page sent more network events than the Transaction Record holds ` +
            `(${budget.maxEvents} events or ${budget.maxEventBytes} bytes)`
        )
      )
      return false
    }
    events.push(event)
    eventBytes += size
    return true
  }

  const send = (method: string, params: object, sessionId: string): Promise<unknown> =>
    sessionId === PAGE_SESSION
      ? debuggerSession.sendCommand(method, params)
      : debuggerSession.sendCommand(method, params, sessionId)

  const track = (work: Promise<unknown>): void => {
    pending.add(work)
    void work.finally(() => pending.delete(work))
  }

  // Each target is resumed once, whatever its commands answered (D17, item 4).
  const resume = (sessionId: string): Promise<unknown> =>
    send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined)

  const setUpChild = (sessionId: string, type: string): void => {
    if (!RECORDED_CHILD_TYPES.has(type)) {
      void resume(sessionId)
      return
    }
    const commands = [
      send('Network.enable', limits, sessionId),
      send('Network.configureDurableMessages', limits, sessionId),
      send('Target.setAutoAttach', AUTO_ATTACH, sessionId)
    ]
    // A service worker left waiting for its answers stayed paused in every measured run, so it
    // is resumed with them; a frame or a dedicated worker is resumed once they answer or the
    // bound runs out, since resuming it with them stalled a cross-site frame (D17, items 2 and 3).
    if (type === 'service_worker') void resume(sessionId)
    void Promise.all(commands.map((command) => answered(command, timings.childSetupMs))).then(
      async ([enabled, durable, autoAttached]) => {
        if (durable) durableSessions.add(sessionId)
        if (enabled && durable && autoAttached) recordedSessions.add(sessionId)
        if (type !== 'service_worker') await resume(sessionId)
      }
    )
  }

  // Sends one body command under a reservation: nothing is sent when the estimate would take the
  // held total past the cap, and a returned body that is over the cap or over the per-resource
  // limit once decoded is let go. `keep` stores what is kept.
  const fetchUnderBudget = (
    method: string,
    sessionId: string,
    requestId: string,
    estimate: number,
    keep: (body: string, base64Encoded: boolean) => void
  ): void => {
    if (held + estimate > budget.totalBytes) return
    held += estimate
    track(
      send(method, { requestId }, sessionId).then(
        (result) => {
          if (overflow) return
          held -= estimate
          const { body, postData, base64Encoded } = result as {
            body?: string
            postData?: string
            base64Encoded: boolean
          }
          const text = body ?? postData ?? ''
          if (
            held + text.length > budget.totalBytes ||
            decodedLength(text, base64Encoded) > budget.resourceBytes
          ) {
            return
          }
          held += text.length
          keep(text, base64Encoded)
        },
        () => {
          if (!overflow) held -= estimate
        }
      )
    )
  }

  // A body over the per-resource limit, or one whose estimate would take the held total past
  // the cap, is not fetched, and its exchange is `body-omitted`.
  const fetchBody = (sessionId: string, requestId: string): void => {
    const length = dataLengths.get(requestId) ?? 0
    if (length > budget.resourceBytes) return
    fetchUnderBudget(
      'Network.getResponseBody',
      sessionId,
      requestId,
      base64Length(length),
      (body, base64Encoded) =>
        responseBodies.set(bodyKey(sessionId, requestId), { body, base64Encoded, sessionId })
    )
  }

  // A request body not fetched keeps what its event carried, and counts as incomplete unless
  // that is all of it (`incompleteRequestBodies`).
  const fetchPostData = (sessionId: string, requestId: string, request: PostedRequest): void => {
    const estimate = postDataEstimate(request, budget.resourceBytes)
    if (estimate > base64Length(budget.resourceBytes)) return
    fetchUnderBudget(
      'Network.getRequestPostData',
      sessionId,
      requestId,
      estimate,
      (postData, base64Encoded) => requestPostData.set(requestId, { postData, base64Encoded })
    )
  }

  const record = (sessionId: string, method: string, params: unknown): void => {
    const { requestId } = params as { requestId?: string }
    if (method === 'Network.dataReceived' && requestId !== undefined) {
      dataLengths.set(
        requestId,
        (dataLengths.get(requestId) ?? 0) + (params as { dataLength: number }).dataLength
      )
      return
    }
    if (!HELD_METHODS.has(method) || !hold({ sessionId, method, params })) return
    if (requestId === undefined) return
    if (method === 'Network.requestWillBeSent') {
      const { request } = params as { request?: PostedRequest & { hasPostData?: boolean } }
      if (request?.hasPostData === true) fetchPostData(sessionId, requestId, request)
    }
    if (method === 'Network.loadingFinished') {
      lastFinished.set(requestId, sessionId)
      fetchBody(sessionId, requestId)
    }
  }

  const onMessage: DebuggerMessageListener = (_event, method, params, sessionId) => {
    const session = sessionId ?? PAGE_SESSION
    if (method === 'Target.attachedToTarget') {
      const { sessionId: child, targetInfo } = params as {
        sessionId: string
        targetInfo: { type: string }
      }
      // A target that attaches after collection stops, or after the record overflowed, is
      // resumed and neither recorded nor counted (D17, item 5).
      if (stopped || !recording || !hold({ sessionId: session, method, params })) {
        void resume(child)
        return
      }
      setUpChild(child, targetInfo.type)
      return
    }
    if (stopped || !recording || overflow || !method.startsWith('Network.')) return
    record(session, method, params)
  }

  debuggerSession.on('message', onMessage)

  return {
    async start() {
      if (!(await answered(send('Network.enable', limits, PAGE_SESSION), timings.pageSetupMs))) {
        return false
      }
      recording = true
      const durable = await answered(
        send('Network.configureDurableMessages', limits, PAGE_SESSION),
        timings.pageSetupMs
      )
      if (durable) durableSessions.add(PAGE_SESSION)
      const autoAttached = await answered(
        send('Target.setAutoAttach', AUTO_ATTACH, PAGE_SESSION),
        timings.pageSetupMs
      )
      if (durable && autoAttached) recordedSessions.add(PAGE_SESSION)
      return true
    },
    stop() {
      stopped = true
    },
    async collect(ms) {
      if (overflow) throw overflow
      await withinMs(Promise.allSettled([...pending]), ms, 'The body fetches')
      if (overflow) throw overflow
      const bodies = new Map<string, ResponseBodyResult>()
      for (const [requestId, sessionId] of lastFinished) {
        const body = responseBodies.get(bodyKey(sessionId, requestId))
        if (body) bodies.set(requestId, body)
      }
      return collectExchanges({
        events,
        responseBodies: bodies,
        requestPostData,
        recordedSessions,
        durableSessions
      })
    },
    dispose() {
      debuggerSession.removeListener('message', onMessage)
    }
  }
}

type PresentTransactionRecord = Extract<CaptureInventory['transactionRecord'], { present: true }>

export type TransactionRecordOutcome =
  | {
      present: true
      warcGz: Buffer
      inventory: PresentTransactionRecord
      boundTls?: BoundTls
      boundTlsAbsent?: Exclude<BoundTlsAbsence, 'not-recorded'>
    }
  // Bound TLS Details are then `not-recorded` (D7).
  | { present: false; reason: 'failed'; error: unknown }

// D7: why the entry carries no Bound TLS Details, or the details of the main document.
export function boundTlsOf(
  mainDocument: Exchange | undefined
): { boundTls: BoundTls } | { boundTlsAbsent: Exclude<BoundTlsAbsence, 'not-recorded'> } {
  if (mainDocument === undefined) return { boundTlsAbsent: 'not-reported' }
  const { response, request, state } = mainDocument
  let protocol: string
  try {
    protocol = new URL(response?.url ?? request.url).protocol
  } catch {
    return { boundTlsAbsent: 'not-reported' }
  }
  if (protocol === 'http:') return { boundTlsAbsent: 'not-https' }
  if (state === 'cached') return { boundTlsAbsent: 'from-cache' }
  return response?.securityDetails
    ? { boundTls: response.securityDetails }
    : { boundTlsAbsent: 'not-reported' }
}

const CREDENTIAL_NAMES = new Set<string>(CREDENTIAL_HEADER_NAMES)
const isCredentialName = (name: string): name is CredentialHeaderName => CREDENTIAL_NAMES.has(name)

export interface FinishOptions {
  /** The most the body fetches still out when collection stopped may take. */
  collectMs: number
  /** The most the writer may take. */
  writeMs: number
  /**
   * The time the render has left; each phase is cut to it, so a phase that would run past the
   * render's deadline records the Transaction Record `failed` instead.
   */
  timeLeftMs?: () => number
  writer: Omit<WriterInput, 'exchanges'>
  budget?: RecorderBudget
  write?: (input: WriterInput) => Promise<WrittenTransactionRecord>
}

// The schema-6 shape of the inventory part, so a value the verifier refuses fails this record
// rather than reaching the signed entry, where it would break the Case's chain.
const TransactionRecordPartSchema = CaptureInventorySchema.shape.transactionRecord

/**
 * The two end phases: the body fetches still out, then the writer, each under its own bound and
 * cut to the time left. Never throws. A phase that fails or runs out, or a field the strict
 * schema refuses, records the Transaction Record absent as `failed`, and the Capture still
 * stores (open question E).
 */
export async function finishTransactionRecord(
  recorder: TransactionRecorder,
  {
    collectMs,
    writeMs,
    timeLeftMs = () => Number.POSITIVE_INFINITY,
    writer,
    budget = TRANSACTION_RECORD_BUDGET,
    write = writeTransactionRecord
  }: FinishOptions
): Promise<TransactionRecordOutcome> {
  try {
    const { exchanges, counts, mainDocument } = await recorder.collect(
      Math.min(collectMs, timeLeftMs())
    )
    const { bytes, replacedHeaders } = await withinMs(
      write({ ...writer, exchanges }),
      Math.min(writeMs, timeLeftMs()),
      'The Transaction Record writer'
    )
    // A part that says `present: true` parses only as the present variant.
    const inventory = TransactionRecordPartSchema.parse({
      present: true,
      exchanges: counts.exchanges,
      cached: counts.cached,
      cancelled: counts.cancelled,
      failed: counts.failed,
      inFlight: counts.inFlight,
      finishedWithoutResponse: counts.finishedWithoutResponse,
      bodiesOmitted: counts.bodiesOmitted,
      incompleteRequestBodies: counts.incompleteRequestBodies,
      webSockets: counts.webSockets,
      recordedTargets: counts.recordedTargets,
      unrecordedTargets: counts.unrecordedTargets,
      replacedHeaders: replacedHeaders.filter(isCredentialName),
      budget: { totalBytes: budget.totalBytes, resourceBytes: budget.resourceBytes }
    }) as PresentTransactionRecord
    const bound = boundTlsOf(mainDocument)
    return {
      present: true,
      warcGz: Buffer.from(bytes),
      inventory,
      ...('boundTls' in bound ? { boundTls: BoundTlsSchema.parse(bound.boundTls) } : bound)
    }
  } catch (error) {
    return { present: false, reason: 'failed', error }
  }
}
