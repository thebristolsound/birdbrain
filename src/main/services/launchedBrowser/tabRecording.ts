import { collectExchanges } from '../../../packages/transaction-record/collector'
import type {
  CollectedExchanges,
  RecordedEvent,
  ResponseBodyResult
} from '../../../packages/transaction-record/collector'
import {
  TRANSACTION_RECORD_MAX_EVENT_BYTES,
  TRANSACTION_RECORD_MAX_EVENTS,
  TRANSACTION_RECORD_RESOURCE_BYTES,
  TRANSACTION_RECORD_TOTAL_BYTES
} from '@shared/constants'
import type { CdpSession } from '@main/services/launchedBrowser/cdpClient'
import {
  RECORDED_NETWORK_EVENTS,
  type CdpEventMap,
  type FrameInfo
} from '@main/services/launchedBrowser/commands'
import { scrubNetworkEvent } from '@main/services/launchedBrowser/scrub'

// One tab's recording in a launched browser (spec, "From a session-long recording to one
// Transaction Record per Capture"). It holds the tab's current navigation only: it opens at a
// main-frame document request, a main-frame commit rolls it over, a same-document navigation does
// not but moves the page's address, and a navigation that never commits leaves it in place. Every
// event is scrubbed of credential values and request bodies before it is held (scrub.ts). Bodies
// are fetched at `Network.loadingFinished` from the session that reported the exchange, under the
// first slice's budget, and held in memory only. A Capture freezes the cut, the point in the message stream
// where its first artifact command goes out, and collects the exchanges that began before it.

export interface RecordingBudget {
  totalBytes: number
  resourceBytes: number
  maxEvents: number
  maxEventBytes: number
}

export const TAB_RECORDING_BUDGET: RecordingBudget = {
  totalBytes: TRANSACTION_RECORD_TOTAL_BYTES,
  resourceBytes: TRANSACTION_RECORD_RESOURCE_BYTES,
  maxEvents: TRANSACTION_RECORD_MAX_EVENTS,
  maxEventBytes: TRANSACTION_RECORD_MAX_EVENT_BYTES
}

// Why a committed page has no Transaction Record: its document request reached no recorded
// session, or the back-forward cache restored it and nothing loaded it (schema 7 reasons).
export type UnrecordedReason = 'page-not-recorded' | 'back-forward-cache'

// The collector reads the page's own session under the empty id, as `wc.debugger` reports it.
const PAGE = ''

// The session types recorded under a tab, as the first slice records them.
const RECORDED_CHILD_TYPES: ReadonlySet<string> = new Set(['iframe', 'worker', 'service_worker'])

interface Navigation {
  id: number
  // The committed document's URL, fragment included; undefined before the first commit.
  committedUrl: string | undefined
  // The page's address: the committed URL, moved by each same-document navigation since.
  pageUrl: string | undefined
  // False when the recording lacks the committed document's request.
  fromFirstRequest: boolean
  unrecorded: UnrecordedReason | undefined
  log: RecordedEvent[]
  logBytes: number
  // Where each request id's first `requestWillBeSent` sits in `log`.
  firstSeen: Map<string, number>
  // Request ids whose `requestWillBeSent` carried a body the scrub removed, one entry per hop.
  withheld: Array<{ requestId: string; index: number }>
  // Request ids a service worker served, from `Network.responseReceived` on the page's session.
  servedByServiceWorker: Set<string>
  bodies: Map<string, ResponseBodyResult>
  lastFinished: Map<string, string>
  dataLengths: Map<string, number>
  pending: Set<Promise<unknown>>
  held: number
  overflow: Error | undefined
  // Request ids started and not yet finished or failed, for network quiet.
  open: Set<string>
  lastActivityAt: number
}

interface Child {
  type: string
  setupAnswered: boolean
}

interface AttachedChild {
  sessionId: string
  type: string
}

export interface CutRecording {
  navigationId: number
  committedUrl: string | undefined
  pageUrl: string | undefined
  fromFirstRequest: boolean
  unrecorded: UnrecordedReason | undefined
  /**
   * Waits up to `ms` for the body fetches still out, then collects the exchanges that began before
   * the cut, with whatever followed them until now. Throws when the navigation overflowed the
   * budget or the wait ran out.
   */
  collect: (ms: number) => Promise<CollectedCut>
}

export interface CollectedCut extends CollectedExchanges {
  requestBodiesWithheld: number
  servedByServiceWorker: number
}

export interface TabRecording {
  readonly tabId: string
  /** A session under this tab, the page's own included, before it is resumed. */
  addSession: (session: CdpSession, type: string, setup: Promise<unknown>) => void
  /** Commits by the tab's main frame (`Page.frameNavigated`). */
  committed: (frame: FrameInfo, type: string | undefined) => void
  navigationId: () => number
  committedUrl: () => string | undefined
  /** The address of the page the tab holds, which a same-document navigation moves. */
  pageUrl: () => string | undefined
  fromFirstRequest: () => boolean
  /** Requests started and not yet ended, and when the last network event arrived. */
  activity: () => { open: number; lastActivityAt: number }
  cut: () => CutRecording
  /**
   * The tab's renderer crashed (`Target.targetCrashed`): its recording is let go, and the tab has
   * no committed page until it loads again.
   */
  crashed: () => void
  isCrashed: () => boolean
  /** A closed tab: everything held is let go and nothing more is recorded. */
  discard: () => void
}

const bodyKey = (sessionId: string, requestId: string): string => `${sessionId}\n${requestId}`

// Every body returns as base64 unless the browser decides it is text, so each is reserved at four
// thirds of its decoded length (first slice, D17 item 7).
const base64Length = (bytes: number): number => Math.ceil(bytes / 3) * 4

function emptyNavigation(id: number, at: number): Navigation {
  return {
    id,
    committedUrl: undefined,
    pageUrl: undefined,
    fromFirstRequest: false,
    unrecorded: undefined,
    log: [],
    logBytes: 0,
    firstSeen: new Map(),
    withheld: [],
    servedByServiceWorker: new Set(),
    bodies: new Map(),
    lastFinished: new Map(),
    dataLengths: new Map(),
    pending: new Set(),
    held: 0,
    overflow: undefined,
    open: new Set(),
    lastActivityAt: at
  }
}

function withinMs<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  if (ms <= 0) return Promise.reject(new Error(`${what} did not settle within 0ms`))
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms`)), ms)
  })
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer))
}

export interface TabRecordingOptions {
  // The page target's id, which is also its main frame's id.
  tabId: string
  budget?: RecordingBudget
  now?: () => number
  // After each main-frame commit and crash, so the panel's flags follow.
  onChange?: () => void
}

export function createTabRecording({
  tabId,
  budget = TAB_RECORDING_BUDGET,
  now = Date.now,
  onChange
}: TabRecordingOptions): TabRecording {
  let current = emptyNavigation(0, now())
  let crashedNow = false
  let pageSessionId: string | undefined
  let pageSetupAnswered = false
  // Every child session the tab has had, for its setup; `attached` holds the ones still attached.
  const children = new Map<string, Child>()
  const attached = new Set<string>()
  // Main-frame document requests not yet committed, by loader id: where each began in `log`.
  const candidates = new Map<string, { navigation: Navigation; start: number }>()
  let discarded = false
  const unsubscribes: Array<() => void> = []

  const keyOf = (sessionId: string): string => (sessionId === pageSessionId ? PAGE : sessionId)

  function overflowed(nav: Navigation): void {
    nav.overflow = new Error(
      'The page sent more network events than the Transaction Record holds ' +
        `(${budget.maxEvents} events or ${budget.maxEventBytes} bytes)`
    )
    nav.log = []
    nav.bodies.clear()
    nav.held = 0
  }

  function hold(nav: Navigation, event: RecordedEvent): boolean {
    if (nav.overflow) return false
    const size = JSON.stringify(event.params)?.length ?? 0
    if (nav.log.length >= budget.maxEvents || nav.logBytes + size > budget.maxEventBytes) {
      overflowed(nav)
      return false
    }
    nav.log.push(event)
    nav.logBytes += size
    return true
  }

  function fetchBody(nav: Navigation, session: CdpSession, key: string, requestId: string): void {
    const length = nav.dataLengths.get(requestId) ?? 0
    if (length > budget.resourceBytes) return
    const estimate = base64Length(length)
    if (nav.held + estimate > budget.totalBytes) return
    nav.held += estimate
    const work = session.send('Network.getResponseBody', { requestId }).then(
      ({ body, base64Encoded }) => {
        if (nav.overflow) return
        nav.held -= estimate
        const decoded = Buffer.byteLength(body, base64Encoded ? 'base64' : 'utf8')
        if (nav.held + body.length > budget.totalBytes || decoded > budget.resourceBytes) return
        nav.held += body.length
        nav.bodies.set(bodyKey(key, requestId), { body, base64Encoded, sessionId: key })
      },
      () => {
        if (!nav.overflow) nav.held -= estimate
      }
    )
    nav.pending.add(work)
    void work.finally(() => nav.pending.delete(work))
  }

  function onNetwork(session: CdpSession, method: string, raw: unknown): void {
    if (discarded) return
    const nav = current
    const key = keyOf(session.sessionId)
    const { requestId } = (raw ?? {}) as { requestId?: string }
    nav.lastActivityAt = now()
    if (method === 'Network.dataReceived') {
      // An overflowed navigation fetches no body, so its byte counts would only grow.
      if (requestId === undefined || nav.overflow) return
      const { dataLength } = raw as { dataLength?: number }
      nav.dataLengths.set(requestId, (nav.dataLengths.get(requestId) ?? 0) + (dataLength ?? 0))
      return
    }
    const { params, bodyWithheld } = scrubNetworkEvent(method, raw)
    if (method === 'Network.requestWillBeSent' && requestId !== undefined) {
      const { type, frameId, loaderId } = params as {
        type?: string
        frameId?: string
        loaderId?: string
      }
      const index = nav.log.length
      if (!hold(nav, { sessionId: key, method, params })) return
      if (!nav.firstSeen.has(requestId)) nav.firstSeen.set(requestId, index)
      if (bodyWithheld) nav.withheld.push({ requestId, index })
      nav.open.add(requestId)
      if (key === PAGE && type === 'Document' && frameId === tabId && loaderId !== undefined) {
        if (!candidates.has(loaderId)) candidates.set(loaderId, { navigation: nav, start: index })
      }
      return
    }
    if (!hold(nav, { sessionId: key, method, params })) return
    if (requestId === undefined) return
    if (method === 'Network.responseReceived' && key === PAGE) {
      const { response } = params as { response?: { fromServiceWorker?: boolean } }
      if (response?.fromServiceWorker === true) nav.servedByServiceWorker.add(requestId)
    }
    if (method === 'Network.loadingFinished') {
      nav.open.delete(requestId)
      nav.lastFinished.set(requestId, key)
      fetchBody(nav, session, key, requestId)
    } else if (method === 'Network.loadingFailed') {
      nav.open.delete(requestId)
    }
  }

  function addSession(session: CdpSession, type: string, setup: Promise<unknown>): void {
    if (discarded) return
    const isPage = pageSessionId === undefined && type === 'page'
    if (isPage) {
      pageSessionId = session.sessionId
    } else if (RECORDED_CHILD_TYPES.has(type)) {
      const child: Child = { type, setupAnswered: false }
      children.set(session.sessionId, child)
      attached.add(session.sessionId)
      // The collector counts each child from the attach event in the stream (plan D17).
      hold(current, {
        sessionId: PAGE,
        method: 'Target.attachedToTarget',
        params: { sessionId: session.sessionId, targetInfo: { type } }
      })
    } else {
      return
    }
    setup.then(
      () => {
        if (isPage) pageSetupAnswered = true
        else {
          const child = children.get(session.sessionId)
          if (child) child.setupAnswered = true
        }
      },
      () => {}
    )
    for (const method of RECORDED_NETWORK_EVENTS) {
      unsubscribes.push(
        session.on(method as keyof CdpEventMap, (params: unknown) =>
          onNetwork(session, method, params)
        )
      )
    }
    // A child's detach arrives on the session it attached under.
    unsubscribes.push(
      session.on('Target.detachedFromTarget', ({ sessionId }) => void attached.delete(sessionId))
    )
    if (isPage) {
      unsubscribes.push(
        session.on('Page.frameNavigated', ({ frame, type: kind }) => committed(frame, kind)),
        session.on('Page.navigatedWithinDocument', ({ frameId, url }) => {
          if (!discarded && frameId === tabId && current.committedUrl !== undefined) {
            current.pageUrl = url
          }
        })
      )
    }
  }

  function committed(frame: FrameInfo, type: string | undefined): void {
    if (discarded || frame.parentId !== undefined) return
    const previous = current
    const url = `${frame.url}${frame.urlFragment ?? ''}`
    const candidate = candidates.get(frame.loaderId)
    candidates.clear()
    const next = emptyNavigation(previous.id + 1, now())
    next.committedUrl = url
    next.pageUrl = url
    if (type === 'BackForwardCacheRestore') {
      next.unrecorded = 'back-forward-cache'
    } else if (candidate && candidate.navigation === previous && !previous.overflow) {
      const { start } = candidate
      next.fromFirstRequest = true
      // The new document's exchanges, and every request started after its document request;
      // their early header events belong too. Previous-page exchanges stay with that page.
      const retainedIndexes = new Map<number, number>()
      for (let i = 0; i < previous.log.length; i++) {
        const event = previous.log[i]
        const { requestId } = (event.params ?? {}) as { requestId?: string }
        if (requestId !== undefined) {
          const first = previous.firstSeen.get(requestId)
          if (first === undefined || first < start) continue
          if (!next.firstSeen.has(requestId)) next.firstSeen.set(requestId, next.log.length)
          if (previous.open.has(requestId)) next.open.add(requestId)
        }
        if (requestId !== undefined || i >= start) {
          const index = next.log.length
          if (hold(next, event)) retainedIndexes.set(i, index)
        }
      }
      for (const { requestId, index } of previous.withheld) {
        const keptIndex = retainedIndexes.get(index)
        if (keptIndex !== undefined) next.withheld.push({ requestId, index: keptIndex })
      }
      for (const requestId of previous.servedByServiceWorker) {
        if ((previous.firstSeen.get(requestId) ?? -1) >= start)
          next.servedByServiceWorker.add(requestId)
      }
      for (const [requestId, length] of previous.dataLengths) {
        if ((previous.firstSeen.get(requestId) ?? -1) >= start)
          next.dataLengths.set(requestId, length)
      }
      for (const [requestId, key] of previous.lastFinished) {
        if ((previous.firstSeen.get(requestId) ?? -1) < start) continue
        next.lastFinished.set(requestId, key)
        const body = previous.bodies.get(bodyKey(key, requestId))
        if (body) {
          next.bodies.set(bodyKey(key, requestId), body)
          next.held += body.body.length
        }
      }
      // A fetch still out lands in the navigation it was sent for; the new one waits on it too.
      for (const work of previous.pending) {
        next.pending.add(work)
        void work.finally(() => next.pending.delete(work))
      }
      carryLateBodies(previous, next, start)
    } else {
      next.unrecorded = 'page-not-recorded'
    }
    current = next
    crashedNow = false
    onChange?.()
  }

  // Bodies whose fetch was sent before the commit and answers after it are copied across once
  // they land, so the new navigation does not lose its own document's body.
  function carryLateBodies(previous: Navigation, next: Navigation, start: number): void {
    for (const work of previous.pending) {
      void work.finally(() => {
        for (const [requestId, key] of previous.lastFinished) {
          if ((previous.firstSeen.get(requestId) ?? -1) < start) continue
          const k = bodyKey(key, requestId)
          const body = previous.bodies.get(k)
          if (body && !next.bodies.has(k)) {
            next.bodies.set(k, body)
            next.held += body.body.length
          }
        }
      })
    }
  }

  function cut(): CutRecording {
    const nav = current
    const cutIndex = nav.log.length
    const { id, committedUrl, pageUrl, unrecorded } = nav
    const fromFirstRequest = nav.fromFirstRequest && pageSetupAnswered
    // The children attached at the cut, with those that attached during this navigation and have
    // gone (their attach events are in the log), are the ones recorded for this page.
    const attachedAtCut: AttachedChild[] = [...attached].map((sessionId) => ({
      sessionId,
      type: children.get(sessionId)?.type ?? ''
    }))
    return {
      navigationId: id,
      committedUrl,
      pageUrl,
      fromFirstRequest,
      unrecorded,
      collect: async (ms) => {
        if (nav.overflow) throw nav.overflow
        await withinMs(Promise.allSettled([...nav.pending]), ms, 'The body fetches')
        if (nav.overflow) throw nav.overflow
        const began = (requestId: string): boolean =>
          (nav.firstSeen.get(requestId) ?? cutIndex) < cutIndex
        const events = nav.log.filter((event, index) => {
          const { requestId } = (event.params ?? {}) as { requestId?: string }
          return requestId === undefined ? index < cutIndex : began(requestId)
        })
        const requestCutIndex = nav.log.slice(0, cutIndex).filter((event) => {
          const { requestId } = (event.params ?? {}) as { requestId?: string }
          return requestId === undefined || began(requestId)
        }).length
        for (const { sessionId, type } of attachedAtCut) {
          events.push({
            sessionId: PAGE,
            method: 'Target.attachedToTarget',
            params: { sessionId, targetInfo: { type } }
          })
        }
        const responseBodies = new Map<string, ResponseBodyResult>()
        for (const [requestId, key] of nav.lastFinished) {
          if (!began(requestId)) continue
          const body = nav.bodies.get(bodyKey(key, requestId))
          if (body) responseBodies.set(requestId, body)
        }
        const recordedSessions = new Set<string>()
        if (pageSetupAnswered) recordedSessions.add(PAGE)
        for (const [sessionId, child] of children) {
          if (child.setupAnswered) recordedSessions.add(sessionId)
        }
        // No session was sent `Network.configureDurableMessages`, which the 2026-10-17 ruling rules
        // out, so the collector keeps a body only when the browser returned it as base64.
        const collected = collectExchanges({
          events,
          requestCutIndex,
          responseBodies,
          recordedSessions
        })
        return {
          ...collected,
          requestBodiesWithheld: nav.withheld.filter(({ index }) => index < cutIndex).length,
          servedByServiceWorker: [...nav.servedByServiceWorker].filter(began).length
        }
      }
    }
  }

  return {
    tabId,
    addSession,
    committed,
    navigationId: () => current.id,
    committedUrl: () => current.committedUrl,
    pageUrl: () => current.pageUrl,
    fromFirstRequest: () => current.fromFirstRequest && pageSetupAnswered,
    activity: () => ({ open: current.open.size, lastActivityAt: current.lastActivityAt }),
    cut,
    crashed: () => {
      if (discarded) return
      overflowed(current)
      candidates.clear()
      current = emptyNavigation(current.id + 1, now())
      crashedNow = true
      onChange?.()
    },
    isCrashed: () => crashedNow,
    discard: () => {
      discarded = true
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
      overflowed(current)
      candidates.clear()
      children.clear()
      attached.clear()
    }
  }
}
