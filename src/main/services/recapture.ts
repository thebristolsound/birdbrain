import { randomUUID } from 'crypto'
import * as captureRepo from '@main/services/db/captureRepo'
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
import { getSettings } from '@main/services/settings'
import { resolveToolVersion } from '@main/services/toolVersion'
import { logger } from '@main/services/logger'
import type { TransactionRecordOutcome } from '@main/services/transactionRecorder'
import { ManifestEntrySchema } from '@shared/schemas'
import type { CaptureInventory, ScrollToLoadRecord } from '@shared/schemas'
import type { Capture, CaptureEvent, ConsentSuppression } from '@shared/types'
import type {
  EnqueueResult,
  LinkedFrom,
  RecaptureEnqueuePayload,
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
  // Set by Capture link (ADR-0040). `runJob` checks the source before it renders.
  linkedFrom?: LinkedFrom
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
  // Capture link's route (ADR-0040): one job, whose URL is the link address.
  enqueueLink: (payload: RecaptureEnqueuePayload) => EnqueueResult
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
  const queue: RecaptureJob[] = []
  let activeUrl: string | null = null
  let draining: Promise<void> | null = null

  async function runJob(job: RecaptureJob): Promise<void> {
    // A Capture link job names itself on every event, because the exclusion skip names the final
    // address rather than `job.url`, and another job can share the address (ADR-0040).
    const { linkedFrom } = job
    const emitEvent = (event: CaptureEvent): void =>
      deps.emitEvent(linkedFrom ? { ...event, linkedFrom } : event)
    const timestamp = new Date().toISOString()
    emitEvent({
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
      let linkSource: LinkSource | undefined
      if (job.linkedFrom) {
        const read = await readLinkSource(job, job.linkedFrom)
        if ('refused' in read) {
          emitEvent({
            type: 'skipped',
            source: 'recapture',
            url: job.url,
            timestamp: new Date().toISOString(),
            skipReason: read.refused
          })
          return
        }
        linkSource = read.source
      }

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
        emitEvent({
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
        emitEvent({
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
      emitEvent({
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
        emitEvent({
          type: 'skipped',
          source: 'recapture',
          url: job.url,
          timestamp: new Date().toISOString(),
          skipReason: err.message
        })
        return
      }
      emitEvent({
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

  const service: RecaptureService = {
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
    // The checks the payload alone can answer, so the menu reports them at once. The source's
    // entry and bytes are checked when the job runs, before the render: a source deleted or
    // altered during the render is still named, with the hash its signed entry records.
    enqueueLink({ urls, caseId, supersedesCaptureId, linkedFrom }) {
      const { captureId, linkHref } = linkedFrom ?? {}
      const refuse = (reason: string): EnqueueResult => ({
        accepted: 0,
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
      return { pending: queue.length + (activeUrl ? 1 : 0), activeUrl }
    },
    async idle() {
      while (draining) await draining
    }
  }
  return service
}
