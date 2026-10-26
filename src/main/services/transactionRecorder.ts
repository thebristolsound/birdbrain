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
import type { BoundTls, CaptureInventory } from '@shared/schemas'
import { CREDENTIAL_HEADER_NAMES } from '@shared/types'
import type { BoundTlsAbsence, CredentialHeaderName } from '@shared/types'
import {
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
  /** Bytes of returned body text the recorder holds at most, across every session (D17, item 7). */
  totalBytes: number
  /** Bytes of one decoded body; a larger body is not kept (ruling 3 of 2026-10-26). */
  resourceBytes: number
}

export interface RecorderTimings {
  /** The wait for each setup command on the page's session. */
  pageSetupMs: number
  /** The wait for a frame's or a worker's setup commands before it is resumed (D17, item 2). */
  childSetupMs: number
}

export const TRANSACTION_RECORD_BUDGET: RecorderBudget = {
  totalBytes: TRANSACTION_RECORD_TOTAL_BYTES,
  resourceBytes: TRANSACTION_RECORD_RESOURCE_BYTES
}

// D17 proposes 2 s for a child, the value its scratch script used; the setup answers on a frame
// or a dedicated worker arrived within 50 ms in every measured run.
export const RECORDER_TIMINGS: RecorderTimings = { pageSetupMs: 5_000, childSetupMs: 2_000 }

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }

// The page's own session, as `wc.debugger` reports it and the collector reads it.
const PAGE_SESSION = ''

const RECORDED_CHILD_TYPES = new Set(['iframe', 'worker', 'service_worker'])

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

function withinMs<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
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

const decodedLength = ({ body, base64Encoded }: ResponseBodyResult): number =>
  Buffer.byteLength(body, base64Encoded ? 'base64' : 'utf8')

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
  const responseBodies = new Map<string, ResponseBodyResult>()
  const requestPostData = new Map<string, RequestPostDataResult>()
  const recordedSessions = new Set<string>()
  const durableSessions = new Set<string>()
  const dataLengths = new Map<string, number>()
  const pending = new Set<Promise<unknown>>()
  let held = 0
  let recording = false
  let stopped = false

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

  // A body over the per-resource limit, or one whose estimate would take the held total past
  // the cap, is not fetched, and its exchange is `body-omitted`.
  const fetchBody = (sessionId: string, requestId: string): void => {
    const length = dataLengths.get(requestId) ?? 0
    if (length > budget.resourceBytes) return
    const estimate = base64Length(length)
    if (held + estimate > budget.totalBytes) return
    held += estimate
    track(
      send('Network.getResponseBody', { requestId }, sessionId).then(
        (result) => {
          const returned = result as ResponseBodyResult
          held -= estimate
          // The returned string replaces the estimate. A body that would take the total past
          // the cap, or whose decoded bytes exceed the per-resource limit, is not kept.
          const size = returned.body.length
          if (held + size > budget.totalBytes || decodedLength(returned) > budget.resourceBytes) {
            return
          }
          held += size
          responseBodies.set(requestId, {
            body: returned.body,
            base64Encoded: returned.base64Encoded
          })
        },
        () => {
          held -= estimate
        }
      )
    )
  }

  const fetchPostData = (sessionId: string, requestId: string): void => {
    track(
      send('Network.getRequestPostData', { requestId }, sessionId).then(
        (result) => {
          const { postData, base64Encoded } = result as RequestPostDataResult
          if (held + postData.length > budget.totalBytes) return
          held += postData.length
          requestPostData.set(requestId, { postData, base64Encoded })
        },
        () => undefined
      )
    )
  }

  const record = (sessionId: string, method: string, params: unknown): void => {
    events.push({ sessionId, method, params })
    const { requestId } = params as { requestId?: string }
    if (requestId === undefined) return
    switch (method) {
      case 'Network.requestWillBeSent':
        if ((params as { request?: { hasPostData?: boolean } }).request?.hasPostData === true) {
          fetchPostData(sessionId, requestId)
        }
        break
      case 'Network.dataReceived':
        dataLengths.set(
          requestId,
          (dataLengths.get(requestId) ?? 0) + (params as { dataLength: number }).dataLength
        )
        break
      case 'Network.loadingFinished':
        fetchBody(sessionId, requestId)
        break
    }
  }

  const onMessage: DebuggerMessageListener = (_event, method, params, sessionId) => {
    const session = sessionId ?? PAGE_SESSION
    if (method === 'Target.attachedToTarget') {
      const { sessionId: child, targetInfo } = params as {
        sessionId: string
        targetInfo: { type: string }
      }
      // A target that attaches after collection stops is resumed and neither recorded nor
      // counted (D17, item 5).
      if (stopped || !recording) {
        void resume(child)
        return
      }
      events.push({ sessionId: session, method, params })
      setUpChild(child, targetInfo.type)
      return
    }
    if (stopped || !recording || !method.startsWith('Network.')) return
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
      await withinMs(Promise.allSettled([...pending]), ms, 'The body fetches')
      return collectExchanges({
        events,
        responseBodies,
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
  /** The bound on the body fetches still out when collection stopped. */
  collectMs: number
  /** The bound on the writer. */
  writeMs: number
  writer: Omit<WriterInput, 'exchanges'>
  budget?: RecorderBudget
  write?: (input: WriterInput) => Promise<WrittenTransactionRecord>
}

/**
 * The two end phases: the body fetches still out, then the writer, each under its own bound.
 * Never throws. A phase that fails or runs out records the Transaction Record absent as `failed`
 * and the Capture still stores (open question E).
 */
export async function finishTransactionRecord(
  recorder: TransactionRecorder,
  {
    collectMs,
    writeMs,
    writer,
    budget = TRANSACTION_RECORD_BUDGET,
    write = writeTransactionRecord
  }: FinishOptions
): Promise<TransactionRecordOutcome> {
  try {
    const { exchanges, counts, mainDocument } = await recorder.collect(collectMs)
    const { bytes, replacedHeaders } = await withinMs(
      write({ ...writer, exchanges }),
      writeMs,
      'The Transaction Record writer'
    )
    return {
      present: true,
      warcGz: Buffer.from(bytes),
      inventory: {
        present: true,
        ...counts,
        replacedHeaders: replacedHeaders.filter(isCredentialName),
        budget: { totalBytes: budget.totalBytes, resourceBytes: budget.resourceBytes }
      },
      ...boundTlsOf(mainDocument)
    }
  } catch (error) {
    return { present: false, reason: 'failed', error }
  }
}
