import { toBoundTls } from './boundTls'
import { holdRequestBody } from './requestBody'
import { isoFromEpochSeconds } from './time'
import type {
  AttachedToTarget,
  CdpResponse,
  CollectedExchanges,
  CollectorInput,
  Exchange,
  ExchangeResponse,
  ExchangeState,
  HeaderMap,
  LoadingFailed,
  RecordedEvent,
  RequestWillBeSent,
  ResponseReceived,
  ResponseReceivedExtraInfo,
  TransactionRecordCounts
} from './types'

interface ResponseExtra {
  statusCode: number
  headers: HeaderMap
}

interface Hop {
  sent: RequestWillBeSent
  response?: CdpResponse
  servedFromCache: boolean
  finished: boolean
  /** The session that reported `Network.loadingFinished`, where the body was fetched. */
  finishedOn?: string
  failure?: LoadingFailed
  requestExtra?: HeaderMap
  responseExtra?: ResponseExtra
}

// A frame's or worker's first request starts on the parent's session and ends on the child's
// under one request id (plan D17), so a chain is keyed by request id, whichever session reported
// the event.
interface Chain {
  requestId: string
  hops: Hop[]
  early: RecordedEvent[]
  requestExtras: HeaderMap[]
  responseExtras: ResponseExtra[]
}

// Frames, dedicated workers and service workers are the targets the engine records (plan D17);
// an attached target of any other type always counts as unrecorded.
const RECORDED_TARGET_TYPES = new Set(['iframe', 'worker', 'service_worker'])

// The page's own debugger session, as `wc.debugger` reports it and step 0's streams are read.
const PAGE_SESSION = ''

const applyToHop = (hop: Hop, { sessionId, method, params }: RecordedEvent): void => {
  switch (method) {
    case 'Network.responseReceived':
      hop.response = (params as ResponseReceived).response
      break
    case 'Network.requestServedFromCache':
      hop.servedFromCache = true
      break
    case 'Network.loadingFinished':
      hop.finished = true
      hop.finishedOn = sessionId
      break
    case 'Network.loadingFailed':
      hop.failure = params as LoadingFailed
      break
  }
}

// ExtraInfo events can arrive before the `requestWillBeSent` they belong to (renderer spike,
// "Event order"), so they queue per request id and pair with hops once every event is in. A hop a
// redirect closed takes the next of each queue when that redirect's `redirectHasExtraInfo` says
// the hop had them, and the last hop takes the last of what remains.
const pairExtraInfo = ({ hops, requestExtras, responseExtras }: Chain): void => {
  let nextRequest = 0
  let nextResponse = 0
  hops.forEach((hop, index) => {
    const next = hops[index + 1]
    if (next === undefined) {
      if (nextRequest < requestExtras.length) hop.requestExtra = requestExtras.at(-1)
      if (nextResponse < responseExtras.length) hop.responseExtra = responseExtras.at(-1)
    } else if (next.sent.redirectHasExtraInfo === true) {
      hop.requestExtra = requestExtras[nextRequest++]
      hop.responseExtra = responseExtras[nextResponse++]
    }
  })
}

// The order of these tests is the one stated on `ExchangeState`.
const stateOf = (hop: Hop, next: Hop | undefined, hasBody: boolean): ExchangeState => {
  if (hop.failure) return hop.failure.canceled === true ? 'cancelled' : 'failed'
  const redirect = next?.sent.redirectResponse
  if (hop.servedFromCache || (hop.response ?? redirect)?.fromDiskCache === true) return 'cached'
  if (redirect) return 'redirected'
  if (hop.finished) {
    if (hop.response === undefined) return 'finished-without-response'
    return hasBody ? 'complete' : 'body-omitted'
  }
  return 'in-flight'
}

const toResponse = (
  {
    url,
    status,
    statusText,
    protocol,
    mimeType,
    remoteIPAddress,
    headers,
    securityDetails
  }: CdpResponse,
  extra: ResponseExtra | undefined,
  mainDocument: boolean
): ExchangeResponse => ({
  url,
  status,
  statusText,
  ...(protocol !== undefined ? { protocol } : {}),
  mimeType,
  ...(remoteIPAddress !== undefined ? { remoteIPAddress } : {}),
  headers: { ...headers },
  ...(extra ? { extraInfo: { statusCode: extra.statusCode, headers: { ...extra.headers } } } : {}),
  // Bound TLS Details are the main document response's alone (plan D7), so only that response is
  // converted, and the details on a redirect hop, a frame or a subresource can neither reach the
  // record nor fail the collection.
  ...(mainDocument && securityDetails ? { securityDetails: toBoundTls(securityDetails) } : {})
})

const lastIndex = (hops: Hop[], test: (hop: Hop) => boolean): number =>
  hops.reduce((found, hop, index) => (test(hop) ? index : found), -1)

const toExchanges = (
  chain: Chain,
  input: CollectorInput,
  mainFrameId: string | undefined
): Exchange[] => {
  pairExtraInfo(chain)
  const { requestId, hops } = chain
  // Both commands take only a request id: a body belongs to the hop that finished, and fetched
  // post data to the last hop that reported a body.
  const bodyHop = lastIndex(hops, (hop) => hop.finished)
  const postDataHop = lastIndex(hops, (hop) => hop.sent.request.hasPostData === true)
  const returned = input.responseBodies?.get(requestId)
  // The rulings of 2026-10-26 on the charset spike: a text body is the served bytes only from a
  // session sent `Network.configureDurableMessages`, so from any other it counts as not returned.
  const finishedOn = bodyHop === -1 ? undefined : hops[bodyHop].finishedOn
  // A body fetched on another session than the one that finished the request is not judged by
  // that session's answer: it is not kept.
  const fromFinishingSession =
    returned !== undefined &&
    (returned.sessionId === undefined || returned.sessionId === finishedOn)
  const body =
    returned !== undefined &&
    fromFinishingSession &&
    (returned.base64Encoded ||
      (finishedOn !== undefined && (input.durableSessions?.has(finishedOn) ?? false)))
      ? returned
      : undefined
  return hops.map((hop, index) => {
    const next = hops[index + 1]
    const { sent, failure, requestExtra, responseExtra } = hop
    const { request, frameId, type, wallTime } = sent
    const state = stateOf(hop, next, index === bodyHop && body !== undefined)
    const requestBody = request.hasPostData
      ? holdRequestBody(
          request,
          requestExtra,
          index === postDataHop ? input.requestPostData?.get(requestId) : undefined
        )
      : undefined
    const response = hop.response ?? next?.sent.redirectResponse
    return {
      requestId,
      hop: index,
      state,
      complete: (state === 'complete' || state === 'redirected') && (requestBody?.complete ?? true),
      startedAt: isoFromEpochSeconds(wallTime),
      ...(type !== undefined ? { type } : {}),
      ...(frameId !== undefined ? { frameId } : {}),
      request: {
        method: request.method,
        url: request.url,
        headers: { ...request.headers },
        ...(requestExtra ? { extraInfo: { headers: { ...requestExtra } } } : {})
      },
      ...(requestBody ? { requestBody } : {}),
      ...(response
        ? {
            // The main document response is the last hop of the main frame's document chain; an
            // earlier hop's response is a redirect.
            response: toResponse(
              response,
              responseExtra,
              next === undefined &&
                type === 'Document' &&
                frameId !== undefined &&
                frameId === mainFrameId
            )
          }
        : {}),
      ...(state === 'complete' && body
        ? { responseBody: { data: body.body, base64Encoded: body.base64Encoded } }
        : {}),
      ...(failure
        ? {
            failure: {
              errorText: failure.errorText,
              canceled: failure.canceled === true,
              ...(failure.blockedReason !== undefined
                ? { blockedReason: failure.blockedReason }
                : {})
            }
          }
        : {})
    }
  })
}

// Chains sort by when their first hop started, then by request id, so the order does not depend
// on how events from several sessions interleaved on arrival. Hops keep their order.
const byStart = (a: Chain, b: Chain): number => {
  const delta = a.hops[0].sent.wallTime - b.hops[0].sent.wallTime
  if (delta !== 0) return delta
  return a.requestId < b.requestId ? -1 : 1
}

const countOf = (exchanges: Exchange[], state: ExchangeState): number =>
  exchanges.filter((exchange) => exchange.state === state).length

// Whether a main frame navigation replaced the page, as measured on Electron 45 (validation
// record, step 9, Deviations): a cancelled one, such as a 204 or a download, did not, nor did one
// with neither a response nor a failure yet. One that failed, and one still loading after its
// response, left the window on its own URL.
const replacedThePage = ({ state, response, failure }: Exchange): boolean =>
  state !== 'cancelled' && (response !== undefined || failure !== undefined)

/**
 * Turns the recorded CDP events of one render into its exchanges and the Transaction Record
 * counts. Each `Network.requestWillBeSent` starts an exchange, so each redirect hop is one under
 * the reused request id.
 */
export const collectExchanges = (input: CollectorInput): CollectedExchanges => {
  const chains = new Map<string, Chain>()
  const chainOf = (requestId: string): Chain => {
    let chain = chains.get(requestId)
    if (chain === undefined) {
      chain = { requestId, hops: [], early: [], requestExtras: [], responseExtras: [] }
      chains.set(requestId, chain)
    }
    return chain
  }
  const webSockets = new Set<string>()
  const childTargets = new Map<string, string>()
  // The main frame is the one the page's own session sends the first document request for; a
  // frame's document request also starts there, later, under its own frame id.
  let mainFrameId: string | undefined

  for (const event of input.events) {
    const { method, params } = event
    if (method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = params as AttachedToTarget
      childTargets.set(sessionId, targetInfo.type)
      continue
    }
    if (!method.startsWith('Network.')) continue
    const { requestId } = params as { requestId?: string }
    if (requestId === undefined) continue
    switch (method) {
      case 'Network.webSocketCreated':
        webSockets.add(requestId)
        break
      case 'Network.requestWillBeSent': {
        const { type, frameId } = params as RequestWillBeSent
        if (mainFrameId === undefined && event.sessionId === PAGE_SESSION && type === 'Document') {
          mainFrameId = frameId
        }
        const chain = chainOf(requestId)
        const hop: Hop = {
          sent: params as RequestWillBeSent,
          servedFromCache: false,
          finished: false
        }
        chain.hops.push(hop)
        if (chain.hops.length === 1) chain.early.forEach((early) => applyToHop(hop, early))
        break
      }
      case 'Network.requestWillBeSentExtraInfo':
        chainOf(requestId).requestExtras.push((params as { headers: HeaderMap }).headers)
        break
      case 'Network.responseReceivedExtraInfo': {
        const { statusCode, headers } = params as ResponseReceivedExtraInfo
        chainOf(requestId).responseExtras.push({ statusCode, headers })
        break
      }
      default: {
        const chain = chainOf(requestId)
        const hop = chain.hops.at(-1)
        if (hop) applyToHop(hop, event)
        else chain.early.push(event)
      }
    }
  }

  let mainDocument: Exchange | undefined
  const exchanges = [...chains.values()]
    .filter((chain) => chain.hops.length > 0)
    .sort(byStart)
    .flatMap((chain) => {
      const written = toExchanges(chain, input, mainFrameId)
      const [{ sent }] = chain.hops
      // A page that navigates itself has more than one main frame document; the last one that
      // replaced the page is the last page a request produced. A later navigation that sends no
      // request, such as one to `about:blank`, is not seen here; the recorder checks for it.
      const last = written[written.length - 1]
      if (
        sent.type === 'Document' &&
        sent.frameId !== undefined &&
        sent.frameId === mainFrameId &&
        replacedThePage(last)
      ) {
        mainDocument = last
      }
      return written
    })

  // Each target is in exactly one count (plan D17, "The two counts"). The page is a target too:
  // it counts as recorded only when the caller lists its session, since an auto-attach that
  // failed, did not answer, or was never sent means what runs below the page may not have been seen.
  const recorded = (sessionId: string, type: string): boolean =>
    RECORDED_TARGET_TYPES.has(type) && (input.recordedSessions?.has(sessionId) ?? false)
  let recordedTargets = input.recordedSessions?.has(PAGE_SESSION) ? 1 : 0
  let unrecordedTargets = 1 - recordedTargets
  for (const [sessionId, type] of childTargets) {
    if (recorded(sessionId, type)) recordedTargets += 1
    else unrecordedTargets += 1
  }

  const counts: TransactionRecordCounts = {
    exchanges:
      countOf(exchanges, 'complete') +
      countOf(exchanges, 'redirected') +
      countOf(exchanges, 'body-omitted'),
    cached: countOf(exchanges, 'cached'),
    cancelled: countOf(exchanges, 'cancelled'),
    failed: countOf(exchanges, 'failed'),
    finishedWithoutResponse: countOf(exchanges, 'finished-without-response'),
    inFlight: countOf(exchanges, 'in-flight'),
    bodiesOmitted: countOf(exchanges, 'body-omitted'),
    incompleteRequestBodies: exchanges.filter(
      ({ requestBody }) => requestBody !== undefined && !requestBody.complete
    ).length,
    webSockets: webSockets.size,
    recordedTargets,
    unrecordedTargets
  }
  return { exchanges, counts, ...(mainDocument ? { mainDocument } : {}) }
}
