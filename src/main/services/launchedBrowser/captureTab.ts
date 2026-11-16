import type {
  WriterInput,
  WrittenTransactionRecord
} from '../../../packages/transaction-record/writer'
import { finishFields } from '../../../packages/capture-finish/inventory'
import { printPdf } from '../../../packages/capture-finish/pdf'
import { finishRecord } from '../../../packages/capture-finish/record'
import type { RecordOutcome } from '../../../packages/capture-finish/record'
import type { BoundTls, CaptureInventory, ScrollToLoadRecord } from '@shared/schemas'
import type { BoundTlsAbsence } from '@shared/types'
import {
  fullPageScreenshotWith,
  INITIAL_NETWORK_IDLE_MAX_MS,
  MAX_SCROLL_PHASE_MS,
  NETWORK_IDLE_MS,
  scrollToLoadWith
} from '@main/services/backgroundRenderer'
import type { CdpSession } from '@main/services/launchedBrowser/cdpClient'
import type { CdpMethod, CdpParams } from '@main/services/launchedBrowser/commands'
import type { CutRecording, TabRecording } from '@main/services/launchedBrowser/tabRecording'

// The Capture sequence for a clicked Capture of one tab (spec, "The Capture sequence"), in its
// order: Scroll-to-load when the Operator asked, bounded network quiet, the cut, the screenshot,
// MHTML, the page text, the Transaction Record, the PDF last. Every page read runs in an isolated
// world. A new document committing before every artifact is taken abandons the Capture.

export const CAPTURE_TIMINGS = {
  networkIdleMs: NETWORK_IDLE_MS,
  networkIdleMaxMs: INITIAL_NETWORK_IDLE_MAX_MS,
  scrollMaxMs: MAX_SCROLL_PHASE_MS,
  // The first slice's two end phases of the Transaction Record.
  collectMs: 5_000,
  writeMs: 10_000,
  printMs: 5_000,
  artifactMs: 20_000
}

const QUIET_POLL_MS = 100
const NAVIGATION_POLL_MS = 50
const WORLD_NAME = 'birdbrain-capture'
// The browser's own fallback when the page reports no content size.
const FALLBACK_VIEWPORT = { width: 1280, height: 900 }

export class CaptureAbandoned extends Error {
  readonly code = 'CAPTURE_ABANDONED'
  constructor() {
    super('The page changed while Birdbrain was capturing it, so the Capture was abandoned.')
    this.name = 'CaptureAbandoned'
  }
}

// A tab behind another in its window (`document.visibilityState` is `hidden`). The full-page
// screenshot of such a tab did not answer on Chromium 154 in the probe (P2), nor on Chrome for
// Testing 149 in this step's suite, so the Capture is refused before anything is taken. Whether
// the engine should bring the tab to the front instead is a question for the maintainer.
export class TabNotInFront extends Error {
  readonly code = 'TAB_NOT_IN_FRONT'
  constructor() {
    super('This tab is behind another in its window. Bring it to the front, then capture.')
    this.name = 'TabNotInFront'
  }
}

export interface TabCaptureInput {
  session: CdpSession
  recording: TabRecording
  tabId: string
  scrollToLoad: boolean
  captureId: string
  writer: Omit<WriterInput, 'exchanges' | 'captureId' | 'date'>
  // The limits the recording held the tab's bodies under, which the inventory states.
  recordingBudget: { totalBytes: number; resourceBytes: number }
  timings?: Partial<typeof CAPTURE_TIMINGS>
  // The PDF's and the record's writers, for a test to stand in.
  write?: (input: WriterInput) => Promise<WrittenTransactionRecord>
}

export interface TabCaptureArtifacts {
  // The cut, as ISO 8601: the moment of Capture the record runs up to.
  capturedAt: string
  url: string
  // The URL the page's document committed at, which exclusion screens alongside `url`.
  committedUrl?: string
  title: string
  httpStatus: number
  mhtml: Buffer
  screenshot: Buffer
  text: string
  inventory: CaptureInventory
  scrollToLoad?: ScrollToLoadRecord
  transactionRecord?: Buffer
  boundTls?: BoundTls
  boundTlsAbsent?: BoundTlsAbsence
  pdf?: Buffer
  // Why the Transaction Record or the PDF failed, for the diagnostic log; never signed.
  errors: unknown[]
}

function bounded<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms`)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForQuiet(recording: TabRecording, idleMs: number, maxMs: number) {
  const startedAt = Date.now()
  for (;;) {
    const { open, lastActivityAt } = recording.activity()
    const now = Date.now()
    if (open === 0 && now - lastActivityAt >= idleMs) return
    if (now - startedAt >= maxMs) return
    await sleep(QUIET_POLL_MS)
  }
}

// The Transaction Record from the frozen recording, with the status of the page's document. A
// page whose document request the recording lacks carries none, with the reason; a write or
// budget failure records it `failed`. Either way the status is 0.
async function recordOf(
  cut: CutRecording,
  input: TabCaptureInput,
  timings: typeof CAPTURE_TIMINGS,
  date: string
): Promise<{ record: RecordOutcome; httpStatus: number }> {
  if (!cut.fromFirstRequest) {
    return {
      record: { present: false, reason: cut.unrecorded ?? 'page-not-recorded' },
      httpStatus: 0
    }
  }
  let documentStatus = 0
  const record = await finishRecord({
    // What only a launched record signs: the exchanges a service worker served, the request
    // bodies withheld (ADR-0051), and that the browser ran with its HTTP cache disabled.
    collect: async () => {
      const { servedByServiceWorker, requestBodiesWithheld, ...collected } = await cut.collect(
        timings.collectMs
      )
      documentStatus = collected.mainDocument?.response?.status ?? 0
      return {
        ...collected,
        methodFacts: { servedByServiceWorker, requestBodiesWithheld, httpCacheDisabled: true }
      }
    },
    boundWrite: (writing) => bounded(writing, timings.writeMs, 'The Transaction Record writer'),
    writer: { ...input.writer, captureId: input.captureId, date },
    committedUrl: cut.committedUrl,
    budget: input.recordingBudget,
    write: input.write
  })
  return { record, httpStatus: record.present ? documentStatus : 0 }
}

/**
 * Takes one clicked Capture of the tab. Throws `TabNotInFront`, before anything is taken, for a
 * tab behind another; `CaptureAbandoned` when a new document committed before every artifact was
 * taken; any other throw means an artifact the Capture cannot do without (the screenshot, MHTML,
 * the text) failed.
 */
export async function captureTab(input: TabCaptureInput): Promise<TabCaptureArtifacts> {
  const { session, recording, tabId } = input
  const timings = { ...CAPTURE_TIMINGS, ...input.timings }
  const startedOn = recording.navigationId()
  const unchanged = (): void => {
    if (recording.navigationId() !== startedOn) throw new CaptureAbandoned()
  }
  // A command the browser cannot answer for a page that has gone, such as a snapshot during a
  // navigation, abandons the Capture at once instead of running out its bound, and a command that
  // fails because the page changed is an abandoned Capture, not a failed one.
  const send = <M extends CdpMethod>(method: M, params: CdpParams<M>) => {
    let poll: ReturnType<typeof setInterval> | undefined
    const left = new Promise<never>((_, reject) => {
      poll = setInterval(() => {
        if (recording.navigationId() !== startedOn) reject(new CaptureAbandoned())
      }, NAVIGATION_POLL_MS)
    })
    return Promise.race([bounded(session.send(method, params), timings.artifactMs, method), left])
      .catch((error: unknown) => {
        unchanged()
        throw error
      })
      .finally(() => clearInterval(poll))
  }

  const { executionContextId } = await send('Page.createIsolatedWorld', {
    frameId: tabId,
    worldName: WORLD_NAME
  })
  const evaluate = async (expression: string): Promise<unknown> => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      contextId: executionContextId,
      returnByValue: true
    })
    if (exceptionDetails) {
      throw new Error(`A script in the isolated world failed: ${exceptionDetails.text}`)
    }
    return result.value
  }

  if ((await evaluate('document.visibilityState')) === 'hidden') throw new TabNotInFront()

  const scrollToLoad = input.scrollToLoad
    ? await scrollToLoadWith(evaluate, timings.scrollMaxMs, { unlock: false })
    : undefined
  unchanged()
  await waitForQuiet(recording, timings.networkIdleMs, timings.networkIdleMaxMs)
  unchanged()

  // The cut: nothing is sent between it and the first artifact command.
  const cut = recording.cut()
  const recordedAt = new Date().toISOString()
  const { png: screenshot, record: screenshotRecord } = await fullPageScreenshotWith(
    (method, params) => send(method as CdpMethod, (params ?? {}) as never),
    FALLBACK_VIEWPORT
  )
  unchanged()
  const { data: mhtmlText } = await send('Page.captureSnapshot', { format: 'mhtml' })
  unchanged()
  const read = (await evaluate(
    '({ text: document.body ? document.body.innerText : "", title: document.title })'
  )) as { text?: unknown; title?: unknown } | null
  const text = typeof read?.text === 'string' ? read.text : ''
  const title = typeof read?.title === 'string' ? read.title : ''
  unchanged()

  const { record, httpStatus } = await recordOf(cut, input, timings, recordedAt)
  unchanged()

  // `Page.printToPDF`, last, because printing fires `beforeprint` and starts requests. A print
  // that fails records the PDF absent as `failed`, as the background renderer's does, unless a
  // new document committed during it, which abandons the whole Capture.
  const pdf = await printPdf(screenshotRecord.contentHeight, {
    print: async () => {
      const { data } = await bounded(
        send('Page.printToPDF', {}),
        timings.printMs,
        'Page.printToPDF'
      )
      return Buffer.from(data, 'base64')
    }
  })
  unchanged()

  const errors = [record, pdf]
    .map((part) => (part.present ? undefined : part.error))
    .filter((error) => error !== undefined)
  // A launched Capture runs no Image Source Pinning (ADR-0055 is background renders only), so
  // the MHTML part counts no pinned image.
  const { inventory, ...finished } = finishFields({
    mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
    screenshot: screenshotRecord,
    transactionRecord: record,
    pdf
  })
  return {
    capturedAt: recordedAt,
    url: cut.pageUrl ?? '',
    ...(cut.committedUrl ? { committedUrl: cut.committedUrl } : {}),
    title,
    httpStatus,
    mhtml: Buffer.from(mhtmlText, 'utf8'),
    screenshot,
    text,
    inventory,
    ...(scrollToLoad ? { scrollToLoad } : {}),
    ...finished,
    errors
  }
}
