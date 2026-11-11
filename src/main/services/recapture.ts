import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import { finished } from 'stream/promises'
import * as backgroundJobRepo from '@main/services/db/backgroundJobRepo'
import type { JobEnd, RunningAttempt, SettledJobs } from '@main/services/db/backgroundJobRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import { getCase } from '@main/services/db/caseRepo'
import { getExhibit } from '@main/services/db/exhibitRepo'
import {
  entryDescribesRow,
  verifyCapture,
  type CaptureLifecycle,
  type IngestParams,
  type LinkSource
} from '@main/services/captureLifecycle'
import { defaultCaptureStore } from '@main/services/captureStore'
import { blockedSkipReason, matchCaseExclusion } from '@main/services/exclusionPolicy'
import type { CaptureEgress } from '@main/services/egress'
import { getInstallationId } from '@main/services/installationId'
import { RefusedAddressError, refusedAddressClass } from '@main/services/localAddressPolicy'
import { authorChainOf, readCaseChains } from '@main/services/manifest'
import { OperatorNameRequiredError, trimmedOperatorName } from '@main/services/operatorName'
import { resolveToolVersion } from '@main/services/toolVersion'
import { logger } from '@main/services/logger'
import { ident, tag } from '@main/services/logSafe'
import type {
  BackgroundJobFailureKind,
  BackgroundJobStep,
  LogContext
} from '@main/services/logSafe'
import type { TransactionRecordOutcome } from '@main/services/transactionRecorder'
import { ManifestEntrySchema } from '@shared/schemas'
import type { CaptureInventory, ScrollToLoadRecord } from '@shared/schemas'
import type { Capture, CaptureEvent, ConsentSuppression } from '@shared/types'
import type {
  BackgroundJobView,
  EnqueueResult,
  LinkedFrom,
  RecaptureDismissTarget,
  RecaptureEnqueuePayload,
  RecaptureListJobsQuery,
  RecaptureQueueStatus
} from '@shared/ipc'

// What the renderer knows about the screenshot it took: the inventory's
// screenshot part without `present` (D6 of
// docs/plans/2026-10-10-capture-engine-first-slice.md).
export type ScreenshotRecord = Omit<CaptureInventory['screenshot'], 'present'>

// The inventory's MHTML part, with the Image Source Pinning counts (ADR-0055).
export type ImageSourcePinning = CaptureInventory['mhtml']

export type PresentPdf = Extract<CaptureInventory['pdf'], { present: true }>

// The PDF the render printed, with its inventory part, or why it has none
// (step 10 of docs/plans/2026-10-10-capture-engine-first-slice.md).
export type PdfOutcome =
  | { present: true; bytes: Buffer; inventory: PresentPdf }
  | { present: false; reason: 'failed'; error: unknown }

export interface RenderedPage {
  // The live renderer hands over a Node ReadStream on its temp file, so the fd
  // is already open by the time this object exists and `cleanup()` only unlinks
  // the path. `destroy` is optional because the contract is only an async
  // iterable, but any path that abandons the stream has to call it (#766).
  mhtmlStream: AsyncIterable<Uint8Array> & { destroy?: () => void }
  screenshot: Buffer
  screenshotRecord: ScreenshotRecord
  // How the Scroll-to-load phase ended (D5).
  scrollToLoad: ScrollToLoadRecord
  // The images pinned to their displayed source before the save, and how many
  // of them had not loaded when it ran, parsed with the strict schema (D4).
  imageSourcePinning: ImageSourcePinning
  text: string
  title: string
  finalUrl: string
  httpStatus: number
  userAgent: string
  browserVersion: string
  // Set when consent/cookie-notice filter lists were active while rendering.
  consentSuppression?: ConsentSuppression
  // The Egress the render was sent through, when it was not Direct (ADR-0032).
  egress?: CaptureEgress
  // The Transaction Record and Bound TLS Details, or why the record is absent
  // (step 9 of docs/plans/2026-10-10-capture-engine-first-slice.md).
  transactionRecord: TransactionRecordOutcome
  // The PDF, printed last, or why it is absent (step 10).
  pdf: PdfOutcome
  // Releases renderer-owned resources (tmp file, window). Always called.
  cleanup: () => Promise<void>
}

export type RenderStep = Exclude<BackgroundJobStep, 'ingest'>

// `captureId` is the id the Capture is stored under, which the Transaction
// Record's `warcinfo` names; `toolVersion` is the Birdbrain version it names.
// `onStep` hears each step as the render starts it, and nothing after the render
// ends, so the last step it heard is the one a failed render reached.
export type RenderPage = (
  url: string,
  opts: {
    timeoutMs: number
    captureId: string
    toolVersion: string
    onStep?: (step: RenderStep) => void
  }
) => Promise<RenderedPage>

// The renderer's deadline and the queue's fallback both throw it, so a job's log
// line can tell a timeout from a render that threw.
export class RecaptureTimeout extends Error {
  constructor(ms: number) {
    super(`Recapture timed out after ${ms}ms`)
    this.name = 'RecaptureTimeout'
  }
}

export interface RecaptureJob {
  // Set by `enqueue`, on every event the job emits: a new id per job, one Batch id per call.
  jobId: string
  batchId: string
  url: string
  caseId: string
  supersedesCaptureId?: string
  // Set by Capture link (ADR-0040). `runJob` checks the source before it renders.
  linkedFrom?: LinkedFrom
}

export type RecaptureJobRequest = Omit<RecaptureJob, 'jobId' | 'batchId'>

export interface RecaptureDeps {
  renderPage: RenderPage
  captureLifecycle: CaptureLifecycle
  emitEvent: (event: CaptureEvent) => void
  emitNewCapture: (capture: Capture) => void
  // Hears every change of a job's state, with the row as it now reads.
  emitJob?: (job: BackgroundJobView) => void
  timeoutMs?: number
}

export interface RecaptureService {
  enqueue: (jobs: RecaptureJobRequest[]) => EnqueueResult
  // Capture link's route (ADR-0040): one job, whose URL is the link address.
  enqueueLink: (payload: RecaptureEnqueuePayload) => EnqueueResult
  status: () => RecaptureQueueStatus
  // The pass before the queue runs at startup. `finishRestore` runs it after a restore too.
  recoverStoredJobs: () => void
  // Read before a restore closes the database: the jobs this session has queued or is running.
  // None when no database is open, as after a restore that left the file unreadable.
  beginRestore: () => BackgroundJobView[]
  // After a restore re-opens the database: the startup pass, which first writes back the row of
  // the job this process is still running, so it ends as it would have, and a `failed` event for
  // each job read by `beginRestore` that the restored copy does not hold.
  finishRestore: (before: BackgroundJobView[]) => void
  // Starts the queue loop again. The restore handlers call it after a restore that failed and
  // left the session's own database open: the close may have stopped the loop with jobs queued.
  restartQueue: () => void
  listJobs: (query: RecaptureListJobsQuery) => BackgroundJobView[]
  // Sets the Batch's `held` jobs `queued`, behind the jobs already queued at the resume. Refused,
  // with the reason enqueue gives, while no operator name is set; the jobs stay held.
  resume: (batchId: string) => { resumed: number; reason?: string }
  dismiss: (target: RecaptureDismissTarget) => { dismissed: number }
  // resolves when the queue drains — used by tests only
  idle: () => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 120_000

// A `stored` row repeats its Capture's address outside the Manifest, so it goes after a week. A
// row that ended without a Capture stays until the Operator dismisses it or deletes its Case.
export const STORED_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export const INTERRUPTED_JOB_ERROR = 'Birdbrain closed while this job was running'

export const RESTORE_REMOVED_JOB_ERROR = 'A database restore removed this job'
export const RESTORE_REMOVED_CAPTURE_ERROR = "A database restore removed this job's Capture"

export const QUEUE_STOPPED_JOB_ERROR = 'The background queue stopped while this job was running'

// How a job ended, as its row records it. `logStored` writes a stored job's log line.
type JobOutcome = Omit<JobEnd, 'finishedAt'> & { logStored?: () => void }

// The job the worker is running.
interface ActiveJob {
  job: RecaptureJob
  // The row as the claim read it, which a restore writes back.
  claimed: BackgroundJobView
  captureId: string
}

function jobOf({
  jobId,
  batchId,
  url,
  caseId,
  supersedesCaptureId,
  linkedFrom
}: BackgroundJobView): RecaptureJob {
  return { jobId, batchId, url, caseId, supersedesCaptureId, linkedFrom }
}

const LOGIN_TITLE_RE = /\b(log ?in|sign ?in|sign ?up|authenticate|two-factor|verification)\b/i
const LOGIN_PATH_RE = /(^|\/)(login|signin|sign-in|auth|sso|accounts?\/(login|signin))([/?#]|$)/i

// Heuristic only — a clean-session recapture of a gated page usually lands on a
// login wall. The capture is still stored (what the clean session saw is still
// evidence); this only drives a warning on the completion event.
export function looksLikeLoginWall(input: {
  requestedUrl: string
  finalUrl: string
  title: string
}): boolean {
  if (LOGIN_TITLE_RE.test(input.title)) return true
  try {
    const requested = new URL(input.requestedUrl)
    const final = new URL(input.finalUrl)
    if (requested.hostname !== final.hostname) return true
    if (LOGIN_PATH_RE.test(final.pathname)) return true
  } catch {
    // Unparseable URL — no opinion.
  }
  return false
}

// A redirect is a change of destination, not a change of spelling (R7, #797).
// `job.url` is the operator's raw input — AddUrlsBox trims whitespace and
// nothing else — while `rendered.finalUrl` is `wc.getURL()`, Chromium's
// canonical form: it lowercases the host, supplies the empty path, drops a
// default port and percent-encodes non-ASCII. Comparing the two as strings
// reports a redirect for `https://example.com` -> `https://example.com/`, and
// the entry then carries a signed claim that the capture was taken somewhere
// other than where it was aimed. Canonicalizing both sides first means only a
// real change of destination is anchored. An unparseable side falls back to its
// own text, so the comparison still happens and never throws.
export function redirectedFinalUrl(requestedUrl: string, finalUrl: string): string | undefined {
  return canonicalizeUrl(finalUrl) === canonicalizeUrl(requestedUrl) ? undefined : finalUrl
}

// The inventory a background Capture signs (D4 of
// docs/plans/2026-10-10-capture-engine-first-slice.md).
function backgroundInventory(
  imageSourcePinning: ImageSourcePinning,
  screenshot: ScreenshotRecord,
  transactionRecord: TransactionRecordOutcome,
  pdf: PdfOutcome
): CaptureInventory {
  return {
    mhtml: imageSourcePinning,
    transactionRecord: transactionRecord.present
      ? transactionRecord.inventory
      : { present: false, reason: transactionRecord.reason },
    screenshot: { present: true, ...screenshot },
    pdf: pdf.present ? pdf.inventory : { present: false, reason: pdf.reason }
  }
}

// The ingest fields the Transaction Record outcome sets: the file, and Bound
// TLS Details or why they are absent (D7). A Capture with no record has them
// `not-recorded`.
function transactionRecordFields(
  outcome: TransactionRecordOutcome
): Pick<IngestParams, 'transactionRecord' | 'boundTls' | 'boundTlsAbsent'> {
  if (!outcome.present) return { boundTlsAbsent: 'not-recorded' }
  const { warcGz, boundTls, boundTlsAbsent } = outcome
  return { transactionRecord: warcGz, boundTls, boundTlsAbsent }
}

function canonicalizeUrl(raw: string): string {
  try {
    return new URL(raw).href
  } catch {
    return raw
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/

// The link provenance a Capture link job signs (ADR-0040), or why the job is refused. The
// row only finds the source: Settings -> Database can edit it, so the Content Hash comes
// from the source's `capture` entry on the chain that verified, bound to this row as the
// Duplicate path binds its source, and the source's bytes must still hash to it. The
// manifest writer runs no schema check, so a hash the strict schema would refuse in
// `linkedFromContentHash` is refused here instead.
async function readLinkSource(
  job: RecaptureJob,
  { captureId, linkHref }: LinkedFrom
): Promise<{ source: LinkSource } | { refused: string }> {
  if (job.url !== linkHref) return { refused: 'Link address differs from the queued address' }
  const source = captureRepo.getCapture(captureId)
  if (!source) return { refused: 'Link source not found' }
  if (source.caseId !== job.caseId) return { refused: 'Link source is in another case' }
  const { manifestIndex } = source
  if (manifestIndex === undefined) return { refused: 'Link source has no manifest entry' }
  const caseDir = defaultCaptureStore.caseDir(source.caseId)
  const { chain, entries, imports } = authorChainOf(readCaseChains(caseDir), {
    authorInstallationId: getExhibit(captureId)?.authorInstallationId ?? null,
    manifestIndex,
    contentHash: source.hash
  })
  const parsed = ManifestEntrySchema.safeParse(entries.find(({ index }) => index === manifestIndex))
  if (
    !chain.valid ||
    !parsed.success ||
    parsed.data.type !== 'capture' ||
    !entryDescribesRow(
      { caseId: parsed.data.caseId, rowId: parsed.data.captureId },
      source,
      { entries, imports },
      caseDir
    )
  ) {
    return { refused: 'Link source has no verified manifest entry' }
  }
  const { contentHash } = parsed.data
  if (!SHA256_HEX.test(contentHash)) {
    return { refused: 'Link source Content Hash is not lower-case SHA-256 hex' }
  }
  const { status, computedHash } = await verifyCapture(captureId, defaultCaptureStore, {
    record: false
  })
  if (status !== 'verified' || computedHash !== contentHash) {
    return { refused: `Link source does not verify (${status})` }
  }
  // The entry names the source by the id its own entry signs (maintainer ruling, 2026-10-26).
  const signed = { linkedFromCaptureId: parsed.data.captureId, linkedFromContentHash: contentHash }
  return { source: { signed: { ...signed, linkHref }, rowId: captureId } }
}

function validateUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http/https URLs supported'
    const refused = refusedAddressClass(raw)
    return refused ? `Points at ${refused}` : null
  } catch {
    return 'Invalid URL'
  }
}

export function createRecaptureService(deps: RecaptureDeps): RecaptureService {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let active: ActiveJob | null = null
  let draining: Promise<void> | null = null

  // Every event names its job and Batch, so the renderer can tell two jobs for one address apart.
  // A Capture link job also names its source, because the exclusion skip names the final address
  // rather than `job.url` (ADR-0040).
  function emitJobEvent({ jobId, batchId, linkedFrom }: RecaptureJob, event: CaptureEvent): void {
    deps.emitEvent({ ...event, jobId, batchId, ...(linkedFrom ? { linkedFrom } : {}) })
  }

  const emitJob = (view: BackgroundJobView): void => deps.emitJob?.(view)

  function recover(running?: RunningAttempt[]): void {
    const now = Date.now()
    const restored = backgroundJobRepo.recoverJobsAtStartup({
      now: new Date(now).toISOString(),
      storedBefore: new Date(now - STORED_JOB_RETENTION_MS).toISOString(),
      interruptedError: INTERRUPTED_JOB_ERROR,
      running
    })
    for (const job of restored.running) emitJob(job)
    reportSettled(restored)
    for (const job of restored.held) emitJob(job)
  }

  function reportSettled({ stored, interrupted }: SettledJobs): void {
    // Stored, not interrupted: the Capture landed before the job's row was ended, and a second
    // run of the job would take a second observation of the page.
    for (const job of stored) {
      logger.info('backgroundRenderer', 'backgroundRenderer.job_stored', {
        ...(job.captureId ? { captureId: ident(job.captureId) } : {}),
        caseId: ident(job.caseId)
      })
      emitJob(job)
    }
    for (const { job, captureId } of interrupted) {
      logger.warn('backgroundRenderer', 'backgroundRenderer.job_failed', {
        ...(captureId ? { captureId: ident(captureId) } : {}),
        caseId: ident(job.caseId),
        failureKind: tag('interrupted', 'backgroundJobFailureKind')
      })
      emitJob(job)
    }
  }

  // A throw between a job's claim and the write of its end stops the loop and leaves the row
  // `running` with no job behind it. Such rows are settled when the loop stops and again when it
  // next starts, so a database that refused the first write gets a second. `exceptJobIds` is
  // always empty in this loop, which holds no job when it settles; the argument is for the
  // worker pool of #2152, which is to pass the jobs its other slots are running.
  function settleOrphans(): void {
    reportSettled(
      backgroundJobRepo.settleRunningJobs({
        now: new Date().toISOString(),
        interruptedError: QUEUE_STOPPED_JOB_ERROR,
        exceptJobIds: active ? [active.job.jobId] : []
      })
    )
  }

  // `captureId` is the id the attempt's row names, and `timestamp` the Capture's, both taken as
  // the row is claimed.
  async function runJob(
    job: RecaptureJob,
    { captureId, timestamp }: { captureId: string; timestamp: string }
  ): Promise<JobOutcome> {
    const emitEvent = (event: CaptureEvent): void => emitJobEvent(job, event)
    emitEvent({
      type: 'received',
      source: 'recapture',
      url: job.url,
      timestamp,
      supersedesCaptureId: job.supersedesCaptureId
    })

    let rendered: RenderedPage | undefined
    const started = Date.now()
    const toolVersion = resolveToolVersion()
    // The job's log lines name it by the id its render's lines carry, and its Case, never by its
    // address (logSafe.ts), and say how long it ran, as its terminal event does.
    const jobContext = (): LogContext => ({
      captureId: ident(captureId),
      caseId: ident(job.caseId),
      ms: Date.now() - started
    })
    const logSkipped = (failureKind: BackgroundJobFailureKind): void => {
      logger.info('backgroundRenderer', 'backgroundRenderer.job_skipped', {
        ...jobContext(),
        failureKind: tag(failureKind, 'backgroundJobFailureKind')
      })
    }
    // Where a throw would leave the job: the step it reached, and the failure kind it is logged
    // under unless it ran out of time. Everything after the render returns counts as the ingest.
    let step: BackgroundJobStep | undefined
    let stage: 'link-source-error' | 'render' | 'ingest' = 'render'
    try {
      // The list can change while a job waits, held across a restart included, so the check
      // `enqueue` made on the job's own address (#400) is made again before anything is sent.
      const excluded = matchCaseExclusion(job.url, job.caseId)
      if (excluded) {
        const skipReason = blockedSkipReason(excluded)
        emitEvent({
          type: 'skipped',
          source: 'recapture',
          url: job.url,
          timestamp: new Date().toISOString(),
          skipReason
        })
        logSkipped('excluded')
        return { state: 'skipped', failureKind: 'excluded', error: skipReason }
      }

      let linkSource: LinkSource | undefined
      if (job.linkedFrom) {
        stage = 'link-source-error'
        const read = await readLinkSource(job, job.linkedFrom)
        if ('refused' in read) {
          emitEvent({
            type: 'skipped',
            source: 'recapture',
            url: job.url,
            timestamp: new Date().toISOString(),
            skipReason: read.refused
          })
          logSkipped('link-source')
          return { state: 'skipped', failureKind: 'link-source', error: read.refused }
        }
        linkSource = read.source
        stage = 'render'
      }

      // The renderer honors timeoutMs itself; race defensively so a hung
      // implementation can never wedge the serial queue.
      let fallbackTimer: NodeJS.Timeout | undefined
      const fallbackTimeout = new Promise<never>((_, reject) => {
        fallbackTimer = setTimeout(() => reject(new RecaptureTimeout(timeoutMs)), timeoutMs)
      })

      try {
        rendered = await Promise.race([
          deps.renderPage(job.url, {
            timeoutMs,
            captureId,
            toolVersion,
            onStep: (reached) => {
              step = reached
            }
          }),
          fallbackTimeout
        ])
      } finally {
        clearTimeout(fallbackTimer)
      }
      stage = 'ingest'
      step = 'ingest'

      // `enqueue` refused a link that points at a local address; a redirect the renderer
      // did not see as a hop still lands here (#1726). Nothing reaches the database or the
      // manifest. The event names `job.url` so it replaces the job's in-flight entry.
      const refused = refusedAddressClass(rendered.finalUrl)
      if (refused) {
        rendered.mhtmlStream.destroy?.()
        const skipReason = `Redirects to ${refused}`
        emitEvent({
          type: 'skipped',
          source: 'recapture',
          url: job.url,
          timestamp: new Date().toISOString(),
          skipReason
        })
        logSkipped('refused-address')
        return { state: 'skipped', failureKind: 'refused-address', error: skipReason }
      }

      // Second enforcement point (#400). `enqueue` could only judge the URL the
      // operator asked for; what gets persisted is `rendered.finalUrl`, and the
      // capture server checks the URL it stores. A recapture that redirects into
      // an excluded URL is refused here — after the render, before the ingest,
      // so nothing reaches the database or the manifest.
      const blocked = matchCaseExclusion(rendered.finalUrl, job.caseId)
      if (blocked) {
        // Nothing consumes the rendered stream on this path, and the unlink in
        // `cleanup()` removes only the directory entry — the open fd would keep
        // the deleted temp file's blocks pinned for the life of the main
        // process. Batch recapture fans out one job per capture, so that is one
        // fd and one multi-megabyte file per blocked job (#766).
        rendered.mhtmlStream.destroy?.()
        const skipReason = blockedSkipReason(blocked)
        emitEvent({
          type: 'skipped',
          source: 'recapture',
          url: rendered.finalUrl,
          timestamp: new Date().toISOString(),
          skipReason
        })
        logSkipped('excluded')
        return { state: 'skipped', failureKind: 'excluded', error: skipReason }
      }

      const operatorName = trimmedOperatorName()
      if (!operatorName) throw new OperatorNameRequiredError()
      const ingestStartedAt = Date.now()
      const result = await deps.captureLifecycle.ingest({
        captureId,
        caseId: job.caseId,
        url: rendered.finalUrl,
        title: rendered.title || job.url,
        timestamp,
        stream: rendered.mhtmlStream as unknown as ReadableStream<Uint8Array>,
        textContent: rendered.text,
        headers: {},
        browserVersion: rendered.browserVersion,
        userAgent: rendered.userAgent,
        httpStatus: rendered.httpStatus,
        // The renderer is the one acquiring path that knows both URLs, so it is
        // the one that can state a redirect (R7, #797). The capture is stored
        // under the URL the bytes came from — `url` above — which on its own
        // cannot tell a reader whether that is where the operator aimed. When
        // the two differ as destinations, the entry says so; when they agree,
        // nothing is written, because there is no redirect to record.
        finalUrl: redirectedFinalUrl(job.url, rendered.finalUrl),
        operatorId: getInstallationId(),
        operatorName,
        toolVersion,
        screenshot: rendered.screenshot,
        method: 'background',
        supersedesCaptureId: job.supersedesCaptureId,
        consentSuppression: rendered.consentSuppression,
        egress: rendered.egress,
        linkSource,
        inventory: backgroundInventory(
          rendered.imageSourcePinning,
          rendered.screenshotRecord,
          rendered.transactionRecord,
          rendered.pdf
        ),
        scrollToLoad: rendered.scrollToLoad,
        ...transactionRecordFields(rendered.transactionRecord),
        pdf: rendered.pdf.present ? rendered.pdf.bytes : undefined
      })
      const ingestMs = Date.now() - ingestStartedAt

      const warning = looksLikeLoginWall({
        requestedUrl: job.url,
        finalUrl: rendered.finalUrl,
        title: rendered.title
      })
        ? 'Page looks like a login wall — the clean background session is not signed in'
        : undefined

      // Said only once the Capture is stored, so a job that then fails or is skipped
      // never reports a stored Capture.
      if (!rendered.transactionRecord.present) {
        const { error, timeLeftMs } = rendered.transactionRecord
        logger.error(
          'backgroundRenderer',
          'backgroundRenderer.transaction_record_failed',
          { captureId: ident(captureId), ...(timeLeftMs === undefined ? {} : { timeLeftMs }) },
          error
        )
      }
      if (!rendered.pdf.present) {
        logger.error(
          'backgroundRenderer',
          'backgroundRenderer.pdf_failed',
          undefined,
          rendered.pdf.error
        )
      }

      const capture = captureRepo.getCapture(result.capture.id) ?? result.capture
      deps.emitNewCapture(capture)
      emitEvent({
        type: 'stored',
        captureId: capture.id,
        source: 'recapture',
        url: job.url,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        warning
      })
      // The queue loop logs the stored line once the row is written, outside this `try`, so a
      // log call that throws cannot change how a stored job ends.
      const stored = { ...jobContext(), ingestMs }
      return {
        state: 'stored',
        warning,
        logStored: () => {
          logger.info('backgroundRenderer', 'backgroundRenderer.job_stored', stored)
        }
      }
    } catch (err) {
      if (err instanceof RefusedAddressError) {
        emitEvent({
          type: 'skipped',
          source: 'recapture',
          url: job.url,
          timestamp: new Date().toISOString(),
          skipReason: err.message
        })
        logSkipped('refused-address')
        return { state: 'skipped', failureKind: 'refused-address', error: err.message }
      }
      const error = err instanceof Error ? err.message : String(err)
      emitEvent({
        type: 'failed',
        source: 'recapture',
        url: job.url,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        error
      })
      const failureKind = err instanceof RecaptureTimeout ? 'timeout' : stage
      logger.warn(
        'backgroundRenderer',
        'backgroundRenderer.job_failed',
        {
          ...jobContext(),
          failureKind: tag(failureKind, 'backgroundJobFailureKind'),
          ...(step ? { step: tag(step, 'backgroundJobStep') } : {})
        },
        err
      )
      return { state: 'failed', failureKind, error }
    } finally {
      // Ingest can reject before it starts reading, leaving the renderer's file open.
      const stream = rendered?.mhtmlStream
      const closed =
        stream instanceof Readable
          ? finished(stream, { cleanup: true }).catch((err: unknown) => {
              if (
                err instanceof Error &&
                'code' in err &&
                err.code === 'ERR_STREAM_PREMATURE_CLOSE'
              ) {
                return
              }
              logger.error(
                'backgroundRenderer',
                'backgroundRenderer.cleanup_failed',
                undefined,
                err
              )
            })
          : undefined
      stream?.destroy?.()
      await closed
      await rendered?.cleanup().catch((err) => {
        logger.error('backgroundRenderer', 'backgroundRenderer.cleanup_failed', undefined, err)
      })
    }
  }

  // One job at a time, each claimed from its row as the last one ends. Any throw between a claim
  // and the write of the job's end stops the loop, as does one while the loop reports the rows
  // it settled as it starts: a database it cannot read or write (a restore closes it), or an
  // event or log call that throws. The next enqueue, resume or `restartQueue` starts it again.
  function drain(): void {
    if (draining) return
    draining = (async () => {
      settleOrphans()
      for (;;) {
        const attempt = { captureId: randomUUID(), timestamp: new Date().toISOString() }
        const claimed = backgroundJobRepo.claimNextQueued({
          startedAt: attempt.timestamp,
          captureId: attempt.captureId
        })
        if (!claimed) return
        emitJob(claimed)
        active = { job: jobOf(claimed), claimed, captureId: attempt.captureId }
        try {
          let outcome = await runJob(active.job, attempt)
          // A restore can replace the database after the ingest committed and before the job's
          // cleanup returns. The copy then holds no such Capture, and nothing corrects a `stored`
          // row.
          if (
            outcome.state === 'stored' &&
            captureRepo.getCapture(attempt.captureId)?.caseId !== claimed.caseId
          ) {
            logger.warn('backgroundRenderer', 'backgroundRenderer.job_failed', {
              captureId: ident(attempt.captureId),
              caseId: ident(claimed.caseId),
              failureKind: tag('interrupted', 'backgroundJobFailureKind')
            })
            outcome = {
              state: 'failed',
              failureKind: 'interrupted',
              error: RESTORE_REMOVED_CAPTURE_ERROR
            }
          }
          const { logStored, ...end } = outcome
          const ended = backgroundJobRepo.finishJob(claimed.jobId, {
            ...end,
            finishedAt: new Date().toISOString()
          })
          if (ended) emitJob(ended)
          logStored?.()
        } finally {
          active = null
        }
      }
    })()
      .catch((err: unknown) => {
        logger.error('backgroundRenderer', 'backgroundRenderer.job_queue_failed', undefined, err)
        try {
          settleOrphans()
        } catch {
          // The database refused this write as well, or the report of it threw. The stop is
          // logged above, and the loop settles the row when it next starts.
        }
      })
      .finally(() => {
        draining = null
      })
  }

  const service: RecaptureService = {
    enqueue(requests) {
      const batchId = randomUUID()
      // The operator gate (X47), first as at admission: a job that cannot be signed is refused
      // before its render contacts the site. Ingest checks again for a name cleared meanwhile.
      if (!trimmedOperatorName()) {
        const { message: reason } = new OperatorNameRequiredError()
        return {
          batchId,
          accepted: 0,
          jobIds: [],
          rejected: requests.map(({ url }) => ({ url, reason }))
        }
      }
      const rejected: Array<{ url: string; reason: string }> = []
      const accepted: RecaptureJob[] = []
      for (const request of requests) {
        const job = { ...request, jobId: randomUUID(), batchId }
        // A job's row names its Case through a foreign key, so a Case that is gone refuses here.
        const reason = validateUrl(job.url) ?? (getCase(job.caseId) ? null : 'Case not found')
        if (reason) {
          rejected.push({ url: job.url, reason })
          continue
        }
        // The per-case exclusion list blocks every capture route, manual
        // included (#400, ruled 2026-08-21). This is the recapture route's
        // enforcement point, and `enqueue` is its only producer — both IPC
        // handlers funnel through here. A blocked job is reported the way the
        // capture server reports one: a `skipped` event naming the pattern, and
        // nothing written to the database or the manifest. It is returned as a
        // rejection because the four renderer call sites already render
        // `rejected[0].reason` verbatim, so the operator is told which pattern
        // refused the recapture without a new result state.
        const blocked = matchCaseExclusion(job.url, job.caseId)
        if (blocked) {
          deps.emitEvent({
            type: 'skipped',
            source: 'recapture',
            url: job.url,
            timestamp: new Date().toISOString(),
            skipReason: blockedSkipReason(blocked)
          })
          rejected.push({ url: job.url, reason: blockedSkipReason(blocked) })
          continue
        }
        accepted.push(job)
      }
      const queuedAt = new Date().toISOString()
      backgroundJobRepo.insertQueuedJobs(
        accepted.map(({ jobId, batchId, caseId, url, supersedesCaptureId, linkedFrom }) => ({
          id: jobId,
          batchId,
          caseId,
          url,
          supersedesCaptureId,
          linkedFrom,
          queuedAt
        }))
      )
      // Every `queued` event goes out before `drain` starts the first job and emits its `received`.
      for (const job of accepted) {
        emitJobEvent(job, {
          type: 'queued',
          source: 'recapture',
          url: job.url,
          timestamp: queuedAt,
          supersedesCaptureId: job.supersedesCaptureId
        })
      }
      if (accepted.length > 0) {
        for (const view of backgroundJobRepo.listJobs({ batchId })) emitJob(view)
        drain()
      }
      return {
        batchId,
        accepted: accepted.length,
        jobIds: accepted.map(({ jobId }) => jobId),
        rejected
      }
    },
    // The checks the payload alone can answer, so the menu reports them at once. The source's
    // entry and bytes are checked when the job runs, before the render: a source deleted or
    // altered during the render is still named, with the hash its signed entry records.
    enqueueLink({ urls, caseId, supersedesCaptureId, linkedFrom }) {
      const { captureId, linkHref } = linkedFrom ?? {}
      const refuse = (reason: string): EnqueueResult => ({
        batchId: randomUUID(),
        accepted: 0,
        jobIds: [],
        rejected: [{ url: typeof linkHref === 'string' ? linkHref : '', reason }]
      })
      if (typeof captureId !== 'string' || typeof linkHref !== 'string' || !captureId) {
        return refuse('Invalid link source')
      }
      if (supersedesCaptureId !== undefined) return refuse('A link capture supersedes nothing')
      if (urls.length !== 1 || urls[0] !== linkHref) {
        return refuse('Capture link takes exactly the link address')
      }
      const source = captureRepo.getCapture(captureId)
      if (!source) return refuse('Link source not found')
      if (source.caseId !== caseId) return refuse('Link source is in another case')
      return service.enqueue([{ url: linkHref, caseId, linkedFrom: { captureId, linkHref } }])
    },
    status() {
      const { queued, running, held } = backgroundJobRepo.countActiveJobs()
      return {
        pending: queued + running,
        queued,
        running,
        held,
        heldBatches: backgroundJobRepo.listHeldBatches(),
        concurrency: 1,
        activeUrl: active?.job.url ?? null
      }
    },
    recoverStoredJobs: () => recover(),
    beginRestore: () => backgroundJobRepo.listActiveJobs(),
    restartQueue: () => drain(),
    finishRestore(before) {
      const running = active
      recover(running ? [{ job: running.claimed, captureId: running.captureId }] : [])
      const finishedAt = new Date().toISOString()
      for (const view of before) {
        // The running job's row was written back above, so it reports its own end; a job the
        // restored copy holds was handled above.
        if (view.jobId === running?.job.jobId || backgroundJobRepo.getJob(view.jobId)) continue
        emitJobEvent(jobOf(view), {
          type: 'failed',
          source: 'recapture',
          url: view.url,
          timestamp: finishedAt,
          error: RESTORE_REMOVED_JOB_ERROR
        })
        emitJob({ ...view, state: 'failed', error: RESTORE_REMOVED_JOB_ERROR, finishedAt })
      }
    },
    listJobs: (query) => backgroundJobRepo.listJobs(query),
    resume(batchId) {
      // The operator gate (X47), as at enqueue: a held job that cannot be signed is not rendered.
      if (!trimmedOperatorName()) {
        return { resumed: 0, reason: new OperatorNameRequiredError().message }
      }
      const resumed = backgroundJobRepo.resumeBatch(batchId, new Date().toISOString())
      for (const view of resumed) emitJob(view)
      if (resumed.length > 0) drain()
      return { resumed: resumed.length }
    },
    dismiss: (target) => ({ dismissed: backgroundJobRepo.dismissJobs(target) }),
    async idle() {
      while (draining) await draining
    }
  }
  return service
}
