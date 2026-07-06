import { app } from 'electron'
import * as db from '@main/services/database'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import { getInstallationId } from '@main/services/installationId'
import { getSettings } from '@main/services/settings'
import type { Capture, CaptureEvent, ConsentSuppression } from '@shared/types'
import type { EnqueueResult, RecaptureQueueStatus } from '@shared/ipc'

export interface RenderedPage {
  mhtmlStream: AsyncIterable<Uint8Array>
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

      const capture = db.getCapture(result.capture.id) ?? result.capture
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
        } else {
          queue.push(job)
          accepted++
        }
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
