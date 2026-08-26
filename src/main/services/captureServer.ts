import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import type { Server } from 'http'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { sendEvent } from '@main/ipcWrap'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import { getSettings } from '@main/services/settings'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { getInstallationId } from '@main/services/installationId'
import { getServerToken } from '@main/services/serverToken'
import type { CaptureEvent } from '@shared/types'
import {
  CaptureUploadSchema,
  ExtensionNoteCreateSchema,
  ExtensionTagApplySchema,
  SelectorCreateSchema,
  UrlLookupSchema,
  formatCaptureUploadError,
  formatExtensionAttachError,
  formatSelectorCreateError,
  type ActiveSelectorsResult,
  type CaptureServerCase,
  type CaptureServerStatus,
  type CaptureUploadResult,
  type CaptureUploadSource,
  type ExtensionAttachBase,
  type ExtensionNoteCreateResult,
  type ExtensionTagApplyResult,
  type ScreenshotStatus,
  type SelectorCreateResult,
  type UrlLookupResult
} from '@shared/schemas'
import { canonicalizeUrl, resolveCaptureForUrl } from '@shared/urlCanonicalize'
import { plainTextToNoteDoc } from '@shared/noteDoc'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { createSessionService, type SessionService } from '@main/services/session'

import {
  CAPTURE_SERVER_PORT,
  MANUAL_DEDUPE_WINDOW_MS,
  MAX_SCREENSHOT_SIZE
} from '@shared/constants'
import {
  blockedSkipReason,
  effectiveIgnorePatternsForCase,
  isUrlBlacklisted
} from '@main/services/exclusionPolicy'
import { logger } from '@main/services/logger'
import { tag } from '@main/services/logSafe'
export { CAPTURE_SERVER_PORT }

export interface CaptureServerDeps {
  selectorLifecycle: SelectorLifecycle
  captureLifecycle: CaptureLifecycle
  token?: string
  // Owns the session state machine. Defaults to a module-level instance so
  // existing callers keep working; main supplies the real one.
  sessionService?: SessionService
}

function getToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}

// Manual capture dedup: "caseId:url" -> timestamp of last accepted capture
const manualDedup = new Map<string, number>()

const OPERATOR_NAME_REQUIRED_MSG =
  'Operator name required. Configure your name in Birdbrain settings before capturing.'

let server: Server | null = null
let mainWindow: BrowserWindow | null = null

// Fallback for callers that don't inject one (the test suite). It has no
// notification callbacks: broadcasting session events is the main-process
// wiring's job, so this module's window reference now serves capture events
// only.
let sessionService: SessionService = createSessionService()

// Test seam: the manual-capture dedup window is capture-server state, not
// session state, so it outlives a session service instance.
export function resetManualDedup(): void {
  manualDedup.clear()
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

function emitCaptureEvent(event: CaptureEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendEvent(mainWindow.webContents, IPC_CHANNELS.CAPTURE_ACTIVITY, event)
  }
}

// The single source of truth for the pipeline self-test route.
const CAPTURE_TEST_ROUTE = '/api/captures/test'

// Recorded on the deletion entry the pipeline self-test leaves behind, so a
// chain reader can tell a self-test cleanup from an operator deleting evidence.
const PIPELINE_TEST_DELETION_REASON = 'pipeline-test'

function createApp(deps: CaptureServerDeps): Hono {
  const { selectorLifecycle, captureLifecycle, token } = deps
  const app = new Hono()
  const requiredToken = token ?? getServerToken()

  // DNS-rebinding guard (#D3): the server binds loopback, but a browser page on
  // a hostname the attacker has rebound to 127.0.0.1 still reaches us — carrying
  // that hostname in the Host header. Since a rebound page counts as same-origin
  // to itself, CORS never engages and it could otherwise read the token or drive
  // the pipeline. Reject anything whose Host is not a loopback literal, before
  // any body is read or CORS runs, so no forged origin can talk to us.
  app.use('*', async (c, next) => {
    const hostname = (c.req.header('Host') ?? '').replace(/:\d+$/, '').toLowerCase()
    const isLoopback =
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname === '::1'
    if (!isLoopback) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    await next()
  })

  // Body size limit: 250 MB max to prevent memory exhaustion
  app.use('*', bodyLimit({ maxSize: 250 * 1024 * 1024 }))

  // Allow requests from Chrome extension
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (
          origin.startsWith('chrome-extension://') ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:')
        ) {
          return origin
        }
        return undefined as unknown as string
      },
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Content-Type', 'X-Birdbrain-Token']
    })
  )

  // Require auth token on all state-changing endpoints.
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST') {
      const token = c.req.header('X-Birdbrain-Token')
      if (token !== requiredToken) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
    }
    await next()
  })

  // Status endpoint — also tracks extension connection
  app.get('/api/status', (c) => {
    const origin = c.req.header('Origin') ?? ''
    const fromExtension = origin.startsWith('chrome-extension://')
    if (fromExtension) {
      sessionService.touchExtension()
    }
    const query = c.req.query()
    const includeCasesParam = query.includeCases
    let includeCases: boolean
    if (typeof includeCasesParam === 'undefined') {
      // Backwards-compatible default: include cases when no query param is provided
      includeCases = true
    } else if (typeof includeCasesParam === 'string') {
      const val = includeCasesParam.toLowerCase()
      // Explicitly disable only when clearly false/zero
      includeCases = !(val === '0' || val === 'false')
    } else {
      includeCases = true
    }
    const session = sessionService.snapshot()
    const activeCase = session.activeCaseId ? caseRepo.getCase(session.activeCaseId) : null
    const settings = getSettings()
    const allCases = includeCases ? caseRepo.listCases() : null
    // Token exposure is now extension-only (#228): the renderer talks to main
    // over IPC and never reads this. The two dev-server origins that used to be
    // granted (http://localhost:<port>, http://127.0.0.1:<port>) existed solely
    // to bootstrap the renderer's fetch wrapper, which no longer exists.
    //
    // The origin-less grant stays: Chrome normally sends an Origin on the
    // extension's status poll, but a fetch that omits it would otherwise lose
    // pairing. The DNS-rebinding guard above already rejects rebound hostnames
    // before this runs, and file:// is still not trusted — such a page receives
    // no CORS grant and so cannot read the body.
    const includeToken = !origin || origin.startsWith('chrome-extension://')
    const status: CaptureServerStatus = {
      running: true,
      ...(includeToken ? { serverToken: requiredToken } : {}),
      activeCase: activeCase ? { id: activeCase.id, name: activeCase.name } : null,
      sessionActive: session.sessionActive,
      captureCount: session.captureCount,
      autoCaptureMode: settings.autoCaptureMode,
      cases: includeCases && allCases ? allCases.map((cs) => ({ id: cs.id, name: cs.name })) : [],
      ignoredUrlPatterns: settings.ignoredUrlPatterns,
      // What the extension mirrors (#400): the global list combined with the
      // active case's exclusions, or that case's alone under 'override'. Sent
      // alongside `ignoredUrlPatterns` rather than overwriting it, so that
      // field keeps meaning "the operator's global list" for anything that
      // reads it. With no active case there is no case policy to apply, so this
      // is the global list — the extension only ever captures into the active
      // case, so its mirror and this list describe the same target.
      effectiveIgnoredUrlPatterns: effectiveIgnorePatternsForCase(activeCase?.id ?? null),
      captureScreenshots: settings.captureScreenshots,
      dedupeWindowSeconds: settings.dedupeWindowSeconds,
      theme: settings.theme
    }
    return c.json(status)
  })

  // List cases
  app.get('/api/cases', (c) => {
    const cases = caseRepo.listCases()
    return c.json(
      cases.map(
        (cs) =>
          ({
            id: cs.id,
            name: cs.name,
            captureCount: captureRepo.getCaptureCount(cs.id)
          }) satisfies CaptureServerCase
      )
    )
  })

  // Activate a case
  app.post('/api/cases/:id/activate', (c) => {
    const id = c.req.param('id')
    const caseData = caseRepo.getCase(id)
    if (!caseData) {
      return c.json({ error: 'Case not found' }, 404)
    }
    sessionService.activateCase(id)
    return c.json({ status: 'ok', case: { id: caseData.id, name: caseData.name } })
  })

  // Start session
  app.post('/api/session/start', (c) => {
    if (!sessionService.snapshot().activeCaseId) {
      return c.json({ error: 'No active case selected' }, 400)
    }
    sessionService.start()
    return c.json({ status: 'ok', sessionActive: true })
  })

  // Stop session
  app.post('/api/session/stop', (c) => {
    sessionService.stop()
    return c.json({ status: 'ok', sessionActive: false })
  })

  // Unified capture endpoint (multipart/form-data with MHTML file)
  app.post(
    '/api/captures',
    zValidator('form', CaptureUploadSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatCaptureUploadError(result.error) }, 400)
      }
      return undefined
    }),
    async (c) => {
      const startTime = Date.now()
      const input = c.req.valid('form')
      // The wire union, not the domain one: 'recapture' never arrives here.
      const source: CaptureUploadSource = input.source
      const url = input.url
      const title = input.title || url
      const timestamp = input.timestamp || new Date().toISOString()
      const textContent = input.textContent
      const extensionVersion = input.extensionVersion
      const browserVersion = input.browserVersion
      const userAgent = input.userAgent
      const httpStatus = input.httpStatus
      const caseIdField = input.caseId
      const mhtmlField = input.mhtml
      const capturedUrl = url
      try {
        const captureSettings = getSettings()
        const operatorName = captureSettings.operatorName?.trim() ?? ''

        // Gate: operator name must be set before any capture is stored
        if (!operatorName) {
          emitCaptureEvent({
            type: 'failed',
            source,
            url,
            timestamp: new Date().toISOString(),
            error: 'Operator name required'
          })
          return c.json({ error: OPERATOR_NAME_REQUIRED_MSG }, 400)
        }

        // Case resolution runs BEFORE the exclusion check (#400), where it used
        // to run after. Exclusions are per-case now, and 'override' mode has to
        // be able to bypass the global list, so the mode cannot be known until
        // the case is. Splitting the check in two — global first, case after —
        // is not available for the same reason.
        //
        // Observable consequence: an excluded URL submitted with a missing,
        // unknown or archived caseId now answers 400/404 rather than 403, and
        // emits no 'skipped' event. Nothing is captured either way; what changes
        // is which refusal the operator is told about. Pinned below and in
        // tests/main/services/captureServer.test.ts.
        let caseId = ''
        if (source === 'auto') {
          const session = sessionService.snapshot()
          if (!session.sessionActive) return c.json({ error: 'No active session' }, 400)
          if (!session.activeCaseId) return c.json({ error: 'No active case' }, 400)
          caseId = session.activeCaseId
        } else {
          if (!caseIdField) return c.json({ error: 'Missing required field: caseId' }, 400)
          const caseData = caseRepo.getCase(caseIdField)
          if (!caseData) return c.json({ error: 'Case not found' }, 404)
          if (caseData.archived) return c.json({ error: 'Case is archived' }, 400)
          caseId = caseIdField
        }

        // Ahead of the source branch below, as the global-only check always was:
        // the list blocks every capture route into this case, manual included
        // (ruled 2026-08-21). An operator who excludes a URL from a case means
        // it, and a rule that permits the one route that currently works would
        // be worse than no rule.
        const blocked = isUrlBlacklisted(url, effectiveIgnorePatternsForCase(caseId))
        if (blocked) {
          emitCaptureEvent({
            type: 'skipped',
            source,
            url,
            timestamp: new Date().toISOString(),
            skipReason: blockedSkipReason(blocked)
          })
          return c.json({ error: 'URL blocked by ignored pattern', pattern: blocked }, 403)
        }

        if (source === 'manual') {
          const dedupeKey = caseId + ':' + url
          const lastSeen = manualDedup.get(dedupeKey)
          if (lastSeen && Date.now() - lastSeen < MANUAL_DEDUPE_WINDOW_MS) {
            emitCaptureEvent({
              type: 'skipped',
              source,
              url,
              timestamp: new Date().toISOString(),
              skipReason: 'Duplicate manual capture'
            })
            return c.json({ error: 'Duplicate capture', status: 'skipped' }, 409)
          }
          manualDedup.set(dedupeKey, Date.now())
        }

        emitCaptureEvent({ type: 'received', source, url, timestamp: new Date().toISOString() })

        const screenshotField = input.screenshot
        let screenshotBuffer: Buffer | undefined
        let screenshotDropReason: string | undefined
        if (screenshotField instanceof File || screenshotField instanceof Blob) {
          if (screenshotField.size <= MAX_SCREENSHOT_SIZE) {
            screenshotBuffer = Buffer.from(await screenshotField.arrayBuffer())
          } else {
            screenshotDropReason = `Screenshot too large: ${(screenshotField.size / (1024 * 1024)).toFixed(1)}MB exceeds ${MAX_SCREENSHOT_SIZE / (1024 * 1024)}MB limit`
            logger.warn('captureServer', 'capture.screenshot_dropped', {
              reason: tag('too_large', 'screenshotDropReason'),
              bytes: screenshotField.size
            })
          }
        }

        const operatorId = getInstallationId()
        const toolVersion = getToolVersion()

        const { capture, contentHash } = await captureLifecycle.ingest({
          caseId,
          url,
          title,
          timestamp,
          stream: mhtmlField.stream(),
          textContent,
          headers: input.headers ?? {},
          browserVersion,
          userAgent,
          httpStatus,
          extensionVersion,
          operatorId,
          operatorName,
          toolVersion,
          screenshot: screenshotBuffer
        })

        if (source === 'auto') sessionService.countCapture()

        if (mainWindow && !mainWindow.isDestroyed()) {
          sendEvent(mainWindow.webContents, IPC_CHANNELS.NEW_CAPTURE, capture)
        }

        const durationMs = Date.now() - startTime
        emitCaptureEvent({
          type: 'stored',
          captureId: capture.id,
          source,
          url,
          timestamp: new Date().toISOString(),
          durationMs,
          screenshotWarning: screenshotDropReason
        })

        const screenshotStatus = screenshotDropReason
          ? 'dropped'
          : screenshotBuffer
            ? 'saved'
            : 'none'
        return c.json({
          captureId: capture.id,
          hash: contentHash,
          manifestIndex: capture.manifestIndex,
          status: 'ok',
          source,
          screenshotStatus,
          screenshotWarning: screenshotDropReason
        } satisfies CaptureUploadResult)
      } catch (err) {
        logger.error('captureServer', 'capture.failed', undefined, err)
        emitCaptureEvent({
          type: 'failed',
          source,
          url: capturedUrl,
          timestamp: new Date().toISOString(),
          error: String(err)
        })
        return c.json({ error: 'Failed to process capture' }, 500)
      }
    }
  )

  // List active selectors for the active case only
  app.get('/api/selectors/active', (c) => {
    const { activeCaseId } = sessionService.snapshot()
    if (!activeCaseId) {
      return c.json([] satisfies ActiveSelectorsResult)
    }
    const activeSelectors: ActiveSelectorsResult = selectorRepo.listActiveSelectors(activeCaseId)
    return c.json(activeSelectors)
  })

  // Create a selector from the extension (highlighted text)
  app.post(
    '/api/selectors',
    zValidator('json', SelectorCreateSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatSelectorCreateError(result.error) }, 400)
      }
      return undefined
    }),
    async (c) => {
      try {
        const { caseId, pattern, label } = c.req.valid('json')

        if (!sessionService.snapshot().activeCaseId) {
          return c.json({ error: 'No active case selected' }, 400)
        }
        if (caseId !== sessionService.snapshot().activeCaseId) {
          return c.json({ error: 'caseId does not match active case' }, 400)
        }

        const caseData = caseRepo.getCase(caseId)
        if (!caseData) {
          return c.json({ error: 'Case not found' }, 404)
        }
        if (caseData.archived) {
          return c.json({ error: 'Case is archived' }, 400)
        }

        // Server-stamped, never read from the request body (#395).
        // SelectorCreateSchema has no origin field on purpose: anything that
        // reaches 127.0.0.1:19845 could otherwise assert a false claim about
        // how a selector entered the case.
        const selector = selectorLifecycle.createSelector({
          caseId,
          pattern,
          isRegex: false,
          label,
          origin: 'extension'
        })

        return c.json({ selector, status: 'ok' } satisfies SelectorCreateResult)
      } catch (err) {
        logger.error('captureServer', 'captureServer.selector_create_failed', undefined, err)
        return c.json({ error: 'Failed to create selector' }, 500)
      }
    }
  )

  // Auto-capture-then-attach (#392, R2): resolve the Capture a Tag or Note
  // binds to, ingesting the supplied payload first when the case holds no
  // capture of the canonicalized URL. The attach itself happens in the caller,
  // strictly after this returns ok — that ordering is what makes the
  // no-orphan criterion structural rather than defended: a failed ingest
  // returns a refusal here and no attach code ever runs.
  type AttachTarget =
    | {
        ok: true
        captureId: string
        captured: boolean
        screenshotStatus: ScreenshotStatus
        screenshotWarning?: string
      }
    | { ok: false; response: Response }

  // Concurrent attach requests for one case + canonical URL are chained, not
  // raced: the candidate lookup and the ingest below are separated by awaits,
  // so two simultaneous requests for the same uncaptured URL could each
  // observe "no capture" and acquire twice, splitting their annotations
  // across duplicate captures. The second request runs only after the first
  // settles, and its own lookup then finds that ingest's capture (PR #835
  // review). Different URLs never wait on each other.
  const attachChains = new Map<string, Promise<unknown>>()

  function resolveOrIngestCapture(c: Context, input: ExtensionAttachBase): Promise<AttachTarget> {
    const key = `${input.caseId}\n${canonicalizeUrl(input.url)}`
    const run = (attachChains.get(key) ?? Promise.resolve()).then(() =>
      resolveOrIngestCaptureNow(c, input)
    )
    const tail: Promise<unknown> = run.catch(() => undefined).finally(() => {
      if (attachChains.get(key) === tail) attachChains.delete(key)
    })
    attachChains.set(key, tail)
    return run
  }

  async function resolveOrIngestCaptureNow(
    c: Context,
    input: ExtensionAttachBase
  ): Promise<AttachTarget> {
    const { caseId, url } = input
    const fail = (response: Response): AttachTarget => ({ ok: false, response })

    // Same active-case discipline as POST /api/selectors: these are
    // extension-only surfaces and the extension annotates the active case.
    const { activeCaseId } = sessionService.snapshot()
    if (!activeCaseId) return fail(c.json({ error: 'No active case selected' }, 400))
    if (caseId !== activeCaseId) {
      return fail(c.json({ error: 'caseId does not match active case' }, 400))
    }
    const caseData = caseRepo.getCase(caseId)
    if (!caseData) return fail(c.json({ error: 'Case not found' }, 404))
    if (caseData.archived) return fail(c.json({ error: 'Case is archived' }, 400))

    const existing = resolveCaptureForUrl(url, captureRepo.listCaptureUrlCandidates(caseId))
    if (existing) {
      // Nothing was acquired on this path, so no screenshot could be dropped.
      return { ok: true, captureId: existing.id, captured: false, screenshotStatus: 'none' }
    }

    const mhtmlField = input.mhtml
    if (!mhtmlField) {
      return fail(
        c.json({ error: 'No capture of this URL in the case; retry with an MHTML payload' }, 422)
      )
    }

    const operatorName = getSettings().operatorName?.trim() ?? ''
    if (!operatorName) {
      emitCaptureEvent({
        type: 'failed',
        source: 'manual',
        url,
        timestamp: new Date().toISOString(),
        error: 'Operator name required'
      })
      return fail(c.json({ error: OPERATOR_NAME_REQUIRED_MSG }, 400))
    }

    // Checked on the ingest branch only: attaching to a capture the case
    // already holds acquires nothing, while this branch is a real acquisition
    // route and must refuse what the case excludes (#400).
    const blocked = isUrlBlacklisted(url, effectiveIgnorePatternsForCase(caseId))
    if (blocked) {
      emitCaptureEvent({
        type: 'skipped',
        source: 'manual',
        url,
        timestamp: new Date().toISOString(),
        skipReason: blockedSkipReason(blocked)
      })
      return fail(c.json({ error: 'URL blocked by ignored pattern', pattern: blocked }, 403))
    }

    const startTime = Date.now()
    emitCaptureEvent({
      type: 'received',
      source: 'manual',
      url,
      timestamp: new Date().toISOString()
    })

    const screenshotField = input.screenshot
    let screenshotBuffer: Buffer | undefined
    let screenshotDropReason: string | undefined
    if (screenshotField instanceof File || screenshotField instanceof Blob) {
      if (screenshotField.size <= MAX_SCREENSHOT_SIZE) {
        screenshotBuffer = Buffer.from(await screenshotField.arrayBuffer())
      } else {
        // Same wording as POST /api/captures: a silently missing artifact
        // would let the extension report a clean capture that lost one.
        screenshotDropReason = `Screenshot too large: ${(screenshotField.size / (1024 * 1024)).toFixed(1)}MB exceeds ${MAX_SCREENSHOT_SIZE / (1024 * 1024)}MB limit`
        logger.warn('captureServer', 'capture.screenshot_dropped', {
          reason: tag('too_large', 'screenshotDropReason'),
          bytes: screenshotField.size
        })
      }
    }

    try {
      // No `method` passed, same as POST /api/captures: the row defaults to
      // 'extension', which is honest — the bytes came from the operator's own
      // browser tab (R2), never from a hidden window.
      const { capture } = await captureLifecycle.ingest({
        caseId,
        url,
        title: input.title || url,
        timestamp: input.timestamp || new Date().toISOString(),
        stream: mhtmlField.stream(),
        textContent: input.textContent,
        headers: input.headers ?? {},
        browserVersion: input.browserVersion,
        userAgent: input.userAgent,
        httpStatus: input.httpStatus,
        extensionVersion: input.extensionVersion,
        operatorId: getInstallationId(),
        operatorName,
        toolVersion: getToolVersion(),
        screenshot: screenshotBuffer
      })

      if (mainWindow && !mainWindow.isDestroyed()) {
        sendEvent(mainWindow.webContents, IPC_CHANNELS.NEW_CAPTURE, capture)
      }
      emitCaptureEvent({
        type: 'stored',
        captureId: capture.id,
        source: 'manual',
        url,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        screenshotWarning: screenshotDropReason
      })
      return {
        ok: true,
        captureId: capture.id,
        captured: true,
        screenshotStatus: screenshotDropReason ? 'dropped' : screenshotBuffer ? 'saved' : 'none',
        screenshotWarning: screenshotDropReason
      }
    } catch (err) {
      logger.error('captureServer', 'capture.failed', undefined, err)
      emitCaptureEvent({
        type: 'failed',
        source: 'manual',
        url,
        timestamp: new Date().toISOString(),
        error: String(err)
      })
      return fail(c.json({ error: 'Failed to capture page; nothing was attached' }, 500))
    }
  }

  // Whether a case already holds a Capture of a URL (#392). A read carried as
  // a POST on purpose: the token guard above fires on POST only, so a GET
  // here would answer any local process without a token and leak whether a
  // case holds a URL (R23, #817).
  app.post(
    '/api/captures/lookup',
    zValidator('json', UrlLookupSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatExtensionAttachError(result.error) }, 400)
      }
      return undefined
    }),
    (c) => {
      const { caseId, url } = c.req.valid('json')
      if (!caseRepo.getCase(caseId)) {
        return c.json({ error: 'Case not found' }, 404)
      }
      const hit = resolveCaptureForUrl(url, captureRepo.listCaptureUrlCandidates(caseId))
      return c.json({
        found: hit !== null,
        canonicalUrl: canonicalizeUrl(url),
        capture: hit
      } satisfies UrlLookupResult)
    }
  )

  // Apply a Tag to the Capture of a URL, auto-capturing first when the case
  // holds none (#392). Find-or-create by case-insensitive name, matching the
  // archive importer's merge rule; re-applying is a no-op (INSERT OR IGNORE).
  app.post(
    '/api/tags/apply',
    zValidator('form', ExtensionTagApplySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatExtensionAttachError(result.error) }, 400)
      }
      return undefined
    }),
    async (c) => {
      const input = c.req.valid('form')
      const target = await resolveOrIngestCapture(c, input)
      if (!target.ok) return target.response
      try {
        // Exact name wins before the case-insensitive fallback: `tags.name` is
        // case-sensitive, so `Evidence` and `evidence` can both exist (the IPC
        // path permits it) and the insensitive lookup could return either,
        // attaching a tag with a different identity and colour than the one
        // the request named (PR #835 review).
        const exactId = tagRepo.findTagIdByNameExact(input.tagName)
        const foundId = exactId ?? tagRepo.findTagIdByNameInsensitive(input.tagName)
        const found = foundId ? tagRepo.getTag(foundId) : undefined
        const applied = found ?? tagRepo.createTag({ name: input.tagName })
        tagRepo.addTagToCapture({ captureId: target.captureId, tagId: applied.id })
        return c.json({
          status: 'ok',
          captureId: target.captureId,
          captured: target.captured,
          screenshotStatus: target.screenshotStatus,
          screenshotWarning: target.screenshotWarning,
          tag: { id: applied.id, name: applied.name }
        } satisfies ExtensionTagApplyResult)
      } catch (err) {
        logger.error('captureServer', 'captureServer.tag_apply_failed', undefined, err)
        // The capture (pre-existing or just ingested) is real evidence either
        // way, so name it — the caller must not retry with a fresh payload.
        // `captured` says which of the two it was: the extension records and
        // reports a fresh capture differently from one the case already held.
        return c.json(
          { error: 'Failed to apply tag', captureId: target.captureId, captured: target.captured },
          500
        )
      }
    }
  )

  // Create a Note on the Capture of a URL, auto-capturing first when the case
  // holds none (#392).
  app.post(
    '/api/notes',
    zValidator('form', ExtensionNoteCreateSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: formatExtensionAttachError(result.error) }, 400)
      }
      return undefined
    }),
    async (c) => {
      const input = c.req.valid('form')
      const target = await resolveOrIngestCapture(c, input)
      if (!target.ok) return target.response
      try {
        // Born on the Mention-capable document schema (#389): body_doc is the
        // stored document and the plain body column is derived from it by
        // createNote, never written directly.
        const note = noteRepo.createNote({
          caseId: input.caseId,
          captureId: target.captureId,
          title: input.noteTitle,
          bodyDoc: JSON.stringify(plainTextToNoteDoc(input.noteText)),
          sourceUrl: input.url
        })
        return c.json({
          status: 'ok',
          captureId: target.captureId,
          captured: target.captured,
          screenshotStatus: target.screenshotStatus,
          screenshotWarning: target.screenshotWarning,
          note
        } satisfies ExtensionNoteCreateResult)
      } catch (err) {
        logger.error('captureServer', 'captureServer.note_create_failed', undefined, err)
        return c.json(
          { error: 'Failed to create note', captureId: target.captureId, captured: target.captured },
          500
        )
      }
    }
  )

  // Test pipeline endpoint
  app.post(CAPTURE_TEST_ROUTE, async (c) => {
    const startTime = Date.now()
    let testCaptureId: string | null = null
    let testCaseId: string | null = null
    try {
      const operatorName = getSettings().operatorName?.trim() ?? ''
      if (!operatorName) {
        emitCaptureEvent({
          type: 'failed',
          source: 'manual',
          url: 'birdbrain://pipeline-test',
          timestamp: new Date().toISOString(),
          error: 'Operator name required'
        })
        return c.json({ error: OPERATOR_NAME_REQUIRED_MSG }, 400)
      }
      const cases = caseRepo.listCases()
      if (cases.length === 0) {
        return c.json({
          success: false,
          durationMs: 0,
          error: 'No cases exist - create a case first'
        })
      }
      testCaseId = cases[0].id
      const testBody = Buffer.from('<html><body>test</body></html>')
      const { Readable } = await import('stream')
      const stream = Readable.from([testBody])

      emitCaptureEvent({
        type: 'received',
        source: 'manual',
        url: 'birdbrain://pipeline-test',
        timestamp: new Date().toISOString()
      })

      // The one producer the per-case exclusion list is deliberately not
      // applied to (#400, #766). Every acquisition route is checked — the
      // extension/manual route above, and both recapture enforcement points —
      // but this one acquires nothing: the URL is the fixed sentinel below and
      // the body is a literal, so no page content and no operator-supplied URL
      // enters the case. What a check would buy is the ability for a broad
      // pattern like `/./` to break the operator's only proof that the capture
      // pipeline works, which is the worse failure for a diagnostic. The
      // residue is real and bounded: a capture row and a `capture` manifest
      // entry exist in the case for the duration of the self-test. On the happy
      // path the `finally` below deletes them through the lifecycle, which
      // appends the matching `deletion` entry. That cleanup is best-effort: it
      // discards both a thrown fault and the lifecycle's `false` return, so a
      // failure there leaves the `capture` entry with no `deletion` beside it.
      // A matched pair is the normal case, not a guarantee.
      const { capture } = await ingestMhtmlCapture({
        caseId: testCaseId,
        url: 'birdbrain://pipeline-test',
        title: 'Pipeline Test',
        timestamp: new Date().toISOString(),
        stream: stream as unknown as ReadableStream<Uint8Array>,
        textContent: '',
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: getInstallationId(),
        operatorName,
        toolVersion: getToolVersion()
      })
      testCaptureId = capture.id

      const durationMs = Date.now() - startTime
      emitCaptureEvent({
        type: 'stored',
        captureId: capture.id,
        source: 'manual',
        url: 'birdbrain://pipeline-test',
        timestamp: new Date().toISOString(),
        durationMs
      })
      return c.json({ success: true, durationMs })
    } catch (err) {
      return c.json({ success: false, durationMs: Date.now() - startTime, error: String(err) })
    } finally {
      if (testCaptureId) {
        // Route cleanup through the lifecycle so the manifest gets a matching
        // deletion entry. Deleting the row and the artifacts directly left a
        // signed `capture` entry in a real case's chain with no files and no
        // deletion record, so the chain and the exported package disagreed about
        // how many captures the case has, with nothing to explain the gap (#580).
        try {
          await captureLifecycle.delete(testCaptureId, PIPELINE_TEST_DELETION_REASON)
        } catch {
          /* best effort */
        }
      }
    }
  })

  return app
}

export function startCaptureServer(
  deps: CaptureServerDeps,
  port: number = CAPTURE_SERVER_PORT
): Promise<void> {
  if (deps.sessionService) sessionService = deps.sessionService
  return new Promise((resolve) => {
    const app = createApp(deps)
    server = serve(
      {
        fetch: app.fetch,
        port,
        hostname: '127.0.0.1'
      },
      () => {
        resolve()
      }
    ) as unknown as Server
  })
}

export function stopCaptureServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.closeAllConnections()
      server.close(() => {
        server = null
        resolve()
      })
    } else {
      resolve()
    }
  })
}

export function startExtensionConnectionCheck(): void {
  sessionService.startHeartbeatMonitor()
}

export function stopExtensionConnectionCheck(): void {
  sessionService.stopHeartbeatMonitor()
}
