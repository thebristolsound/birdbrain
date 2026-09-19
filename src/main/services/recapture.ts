import { app } from 'electron'
import * as captureRepo from '@main/services/db/captureRepo'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import { blockedSkipReason, matchCaseExclusion } from '@main/services/exclusionPolicy'
import { getInstallationId } from '@main/services/installationId'
import { getSettings } from '@main/services/settings'
import type { Capture, CaptureEvent, ConsentSuppression } from '@shared/types'
import type { EnqueueResult, RecaptureQueueStatus } from '@shared/ipc'

export interface RenderedPage {
  // The live renderer hands over a Node ReadStream on its temp file, so the fd
  // is already open by the time this object exists and `cleanup()` only unlinks
  // the path. `destroy` is optional because the contract is only an async
  // iterable, but any path that abandons the stream has to call it (#766).
  mhtmlStream: AsyncIterable<Uint8Array> & { destroy?: () => void }
  screenshot: Buffer
  text: string
  title: string
  finalUrl: string
  httpStatus: number
  userAgent: string
  browserVersion: string
  // Set when consent/cookie-notice filter lists were active while rendering.
  consentSuppression?: ConsentSuppression
  // Releases renderer-owned resources (tmp file, window). Always called.
  cleanup: () => Promise<void>
}

export type RenderPage = (url: string, opts: { timeoutMs: number }) => Promise<RenderedPage>

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
    return null
  } catch {
    return 'Invalid URL'
  }
}

function getToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
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
        rendered = await Promise.race([deps.renderPage(job.url, { timeoutMs }), fallbackTimeout])
      } finally {
        clearTimeout(fallbackTimer)
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
        toolVersion: getToolVersion(),
        screenshot: rendered.screenshot,
        method: 'background',
        supersedesCaptureId: job.supersedesCaptureId,
        consentSuppression: rendered.consentSuppression
      })

      const warning = looksLikeLoginWall({
        requestedUrl: job.url,
        finalUrl: rendered.finalUrl,
        title: rendered.title
      })
        ? 'Page looks like a login wall — the clean background session is not signed in'
        : undefined

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
