import { writeTransactionRecord } from '../../../packages/transaction-record/writer'
import type {
  WriterInput,
  WrittenTransactionRecord
} from '../../../packages/transaction-record/writer'
import { BoundTlsSchema, CaptureInventorySchema } from '@shared/schemas'
import type { BoundTls, CaptureInventory, ScrollToLoadRecord } from '@shared/schemas'
import { CREDENTIAL_HEADER_NAMES } from '@shared/types'
import type { BoundTlsAbsence, CredentialHeaderName } from '@shared/types'
import { MAX_PDF_CONTENT_HEIGHT_PX, MAX_PDF_SIZE } from '@shared/constants'
import {
  fullPageScreenshotWith,
  INITIAL_NETWORK_IDLE_MAX_MS,
  MAX_SCROLL_PHASE_MS,
  NETWORK_IDLE_MS,
  scrollToLoadWith
} from '@main/services/backgroundRenderer'
import type { ScreenshotRecord } from '@main/services/recapture'
import { boundTlsOf } from '@main/services/transactionRecorder'
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

const CREDENTIAL_NAMES = new Set<string>(CREDENTIAL_HEADER_NAMES)
const isCredentialName = (name: string): name is CredentialHeaderName => CREDENTIAL_NAMES.has(name)

const TransactionRecordPartSchema = CaptureInventorySchema.shape.transactionRecord
const PdfPartSchema = CaptureInventorySchema.shape.pdf

type TransactionRecordPart = CaptureInventory['transactionRecord']

interface RecordOutcome {
  part: TransactionRecordPart
  warcGz?: Buffer
  boundTls?: BoundTls
  boundTlsAbsent: BoundTlsAbsence | undefined
  httpStatus: number
  error?: unknown
}

// The Transaction Record from the frozen recording. A page whose document request the recording
// lacks carries none, with the reason; a write or budget failure records it `failed`.
async function recordOf(
  cut: CutRecording,
  input: TabCaptureInput,
  timings: typeof CAPTURE_TIMINGS,
  date: string
): Promise<RecordOutcome> {
  if (!cut.fromFirstRequest) {
    return {
      part: { present: false, reason: cut.unrecorded ?? 'page-not-recorded' },
      boundTlsAbsent: 'not-recorded',
      httpStatus: 0
    }
  }
  try {
    const collected = await cut.collect(timings.collectMs)
    const { exchanges, counts, mainDocument } = collected
    const write = input.write ?? writeTransactionRecord
    const { bytes, replacedHeaders } = await bounded(
      write({ ...input.writer, exchanges, captureId: input.captureId, date }),
      timings.writeMs,
      'The Transaction Record writer'
    )
    const part = TransactionRecordPartSchema.parse({
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
      budget: {
        totalBytes: input.recordingBudget.totalBytes,
        resourceBytes: input.recordingBudget.resourceBytes
      },
      servedByServiceWorker: collected.servedByServiceWorker,
      requestBodiesWithheld: collected.requestBodiesWithheld,
      httpCacheDisabled: true
    })
    const bound = boundTlsOf(mainDocument, cut.committedUrl)
    return {
      part,
      warcGz: Buffer.from(bytes),
      ...('boundTls' in bound
        ? { boundTls: BoundTlsSchema.parse(bound.boundTls), boundTlsAbsent: undefined }
        : { boundTlsAbsent: bound.boundTlsAbsent }),
      httpStatus: mainDocument?.response?.status ?? 0
    }
  } catch (error) {
    return {
      part: { present: false, reason: 'failed' },
      boundTlsAbsent: 'not-recorded',
      httpStatus: 0,
      error
    }
  }
}

/**
 * Takes one clicked Capture of the tab. Throws `CaptureAbandoned` when a new document committed
 * before every artifact was taken; any other throw means an artifact the Capture cannot do
 * without (the screenshot, MHTML, the text) failed.
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

  const record = await recordOf(cut, input, timings, recordedAt)
  unchanged()

  const pdf = await printLast(send, screenshotRecord, timings.printMs, unchanged)
  unchanged()

  const errors = [record.error, pdf.error].filter((error) => error !== undefined)
  return {
    capturedAt: recordedAt,
    url: cut.committedUrl ?? '',
    title,
    httpStatus: record.httpStatus,
    mhtml: Buffer.from(mhtmlText, 'utf8'),
    screenshot,
    text,
    // A launched Capture runs no Image Source Pinning (ADR-0055 is background renders only), so
    // the MHTML part counts no pinned image.
    inventory: {
      mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
      transactionRecord: record.part,
      screenshot: { present: true, ...screenshotRecord },
      pdf: pdf.part
    },
    ...(scrollToLoad ? { scrollToLoad } : {}),
    ...(record.warcGz ? { transactionRecord: record.warcGz } : {}),
    ...(record.boundTls ? { boundTls: record.boundTls } : {}),
    ...(record.boundTlsAbsent ? { boundTlsAbsent: record.boundTlsAbsent } : {}),
    ...(pdf.bytes ? { pdf: pdf.bytes } : {}),
    errors
  }
}

// `Page.printToPDF`, last, because printing fires `beforeprint` and starts requests. A page taller
// than MAX_PDF_CONTENT_HEIGHT_PX, a print that fails or outlasts its bound, and a PDF over
// MAX_PDF_SIZE record the PDF absent as `failed`, as the background renderer does. A new
// document during the print abandons the whole Capture.
async function printLast(
  send: <M extends CdpMethod>(method: M, params: CdpParams<M>) => Promise<unknown>,
  { contentHeight }: ScreenshotRecord,
  boundMs: number,
  unchanged: () => void
): Promise<{ part: CaptureInventory['pdf']; bytes?: Buffer; error?: unknown }> {
  try {
    if (contentHeight > MAX_PDF_CONTENT_HEIGHT_PX) {
      throw new Error(
        `The page is ${contentHeight} CSS pixels tall, over MAX_PDF_CONTENT_HEIGHT_PX ` +
          `(${MAX_PDF_CONTENT_HEIGHT_PX}), so it was not printed`
      )
    }
    const { data } = (await bounded(send('Page.printToPDF', {}), boundMs, 'Page.printToPDF')) as {
      data: string
    }
    const bytes = Buffer.from(data, 'base64')
    if (bytes.length > MAX_PDF_SIZE) {
      throw new Error(
        `The PDF is ${bytes.length} bytes, over MAX_PDF_SIZE (${MAX_PDF_SIZE}), so it was discarded`
      )
    }
    return { part: PdfPartSchema.parse({ present: true, afterCollection: true }), bytes }
  } catch (error) {
    unchanged()
    return { part: { present: false, reason: 'failed' }, error }
  }
}
