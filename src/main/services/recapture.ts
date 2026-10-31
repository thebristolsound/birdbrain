import { randomUUID } from 'crypto'
import * as captureRepo from '@main/services/db/captureRepo'
import type { CaptureLifecycle, IngestParams } from '@main/services/captureLifecycle'
import { blockedSkipReason, matchCaseExclusion } from '@main/services/exclusionPolicy'
import type { CaptureEgress } from '@main/services/egress'
import { getInstallationId } from '@main/services/installationId'
import { RefusedAddressError, refusedAddressClass } from '@main/services/localAddressPolicy'
import { getSettings } from '@main/services/settings'
import { resolveToolVersion } from '@main/services/toolVersion'
import { logger } from '@main/services/logger'
import type { TransactionRecordOutcome } from '@main/services/transactionRecorder'
import type { CaptureInventory, ScrollToLoadRecord } from '@shared/schemas'
import type { Capture, CaptureEvent, ConsentSuppression } from '@shared/types'
import type { EnqueueResult, RecaptureQueueStatus } from '@shared/ipc'

// What the renderer knows about the screenshot it took: the inventory's
// screenshot part without `present` (D6 of
// docs/plans/2026-10-10-capture-engine-first-slice.md).
export type ScreenshotRecord = Omit<CaptureInventory['screenshot'], 'present'>

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

// `captureId` is the id the Capture is stored under, which the Transaction
// Record's `warcinfo` names; `toolVersion` is the Birdbrain version it names.
export type RenderPage = (
  url: string,
  opts: { timeoutMs: number; captureId: string; toolVersion: string }
) => Promise<RenderedPage>

export interface RecaptureJob {
  url: string
  caseId: string
  supersedesCaptureId?: string
}

export interface RecaptureDeps {
  renderPage: RenderPage
  captureLifecycle: CaptureLifecycle
  emitEvent: (event: CaptureEvent) => void
  emitNewCapture: (capture: Capture) => void
  timeoutMs?: number
}

export interface RecaptureService {
  enqueue: (jobs: RecaptureJob[]) => EnqueueResult
  status: () => RecaptureQueueStatus
  // resolves when the queue drains — used by tests only
  idle: () => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 120_000

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
// docs/plans/2026-10-10-capture-engine-first-slice.md). This build pins no
// image before the save (#1843 adds the pinning), so both MHTML counts are 0.
function backgroundInventory(
  screenshot: ScreenshotRecord,
  transactionRecord: TransactionRecordOutcome,
  pdf: PdfOutcome
): CaptureInventory {
  return {
    mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
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
  const queue: RecaptureJob[] = []
  let activeUrl: string | null = null
  let draining: Promise<void> | null = null

  async function runJob(job: RecaptureJob): Promise<void> {
    const timestamp = new Date().toISOString()
    deps.emitEvent({
      type: 'received',
      source: 'recapture',
      url: job.url,
      timestamp,
      supersedesCaptureId: job.supersedesCaptureId
    })

    let rendered: RenderedPage | undefined
    const started = Date.now()
    const captureId = randomUUID()
    const toolVersion = resolveToolVersion()
    try {
      // The renderer honors timeoutMs itself; race defensively so a hung
      // implementation can never wedge the serial queue.
      let fallbackTimer: NodeJS.Timeout | undefined
      const fallbackTimeout = new Promise<never>((_, reject) => {
        fallbackTimer = setTimeout(
          () => reject(new Error(`Recapture timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      })

      try {
        rendered = await Promise.race([
          deps.renderPage(job.url, { timeoutMs, captureId, toolVersion }),
          fallbackTimeout
        ])
      } finally {
        clearTimeout(fallbackTimer)
      }

      // `enqueue` refused a link that points at a local address; a redirect the renderer
      // did not see as a hop still lands here (#1726). Nothing reaches the database or the
      // manifest. The event names `job.url` so it replaces the job's in-flight entry.
      const refused = refusedAddressClass(rendered.finalUrl)
      if (refused) {
        rendered.mhtmlStream.destroy?.()
        deps.emitEvent({
          type: 'skipped',
          source: 'recapture',
          url: job.url,
          timestamp: new Date().toISOString(),
          skipReason: `Redirects to ${refused}`
        })
        return
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
        deps.emitEvent({
          type: 'skipped',
          source: 'recapture',
          url: rendered.finalUrl,
          timestamp: new Date().toISOString(),
          skipReason: blockedSkipReason(blocked)
        })
        return
      }

      const settings = getSettings()
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
        operatorName: settings.operatorName ?? '',
        toolVersion,
        screenshot: rendered.screenshot,
        method: 'background',
        supersedesCaptureId: job.supersedesCaptureId,
        consentSuppression: rendered.consentSuppression,
        egress: rendered.egress,
        inventory: backgroundInventory(
          rendered.screenshotRecord,
          rendered.transactionRecord,
          rendered.pdf
        ),
        scrollToLoad: rendered.scrollToLoad,
        ...transactionRecordFields(rendered.transactionRecord),
        pdf: rendered.pdf.present ? rendered.pdf.bytes : undefined
      })

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
        logger.error(
          'backgroundRenderer',
          'backgroundRenderer.transaction_record_failed',
          undefined,
          rendered.transactionRecord.error
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
      deps.emitEvent({
        type: 'stored',
        captureId: capture.id,
        source: 'recapture',
        url: job.url,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        warning
      })
    } catch (err) {
      if (err instanceof RefusedAddressError) {
        deps.emitEvent({
          type: 'skipped',
          source: 'recapture',
          url: job.url,
          timestamp: new Date().toISOString(),
          skipReason: err.message
        })
        return
      }
      deps.emitEvent({
        type: 'failed',
        source: 'recapture',
        url: job.url,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      await rendered?.cleanup().catch(() => {})
    }
  }

  function drain(): void {
    if (draining) return
    draining = (async () => {
      while (queue.length > 0) {
        const job = queue.shift()!
        activeUrl = job.url
        await runJob(job)
        activeUrl = null
      }
    })().finally(() => {
      draining = null
    })
  }

  return {
    enqueue(jobs) {
      const rejected: Array<{ url: string; reason: string }> = []
      let accepted = 0
      for (const job of jobs) {
        const reason = validateUrl(job.url)
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
        queue.push(job)
        accepted++
      }
      if (accepted > 0) drain()
      return { accepted, rejected }
    },
    status() {
      return { pending: queue.length + (activeUrl ? 1 : 0), activeUrl }
    },
    async idle() {
      while (draining) await draining
    }
  }
}
