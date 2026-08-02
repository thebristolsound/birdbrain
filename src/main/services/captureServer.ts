import { Hono } from 'hono'
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
import * as selectorRepo from '@main/services/db/selectorRepo'
import { defaultCaptureStore } from '@main/services/captureStore'
import { getSettings } from '@main/services/settings'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { getInstallationId } from '@main/services/installationId'
import { getServerToken } from '@main/services/serverToken'
import type { CaptureEvent } from '@shared/types'
import {
  CaptureUploadSchema,
  SelectorCreateSchema,
  formatCaptureUploadError,
  formatSelectorCreateError,
  type ActiveSelectorsResult,
  type CaptureServerCase,
  type CaptureServerStatus,
  type CaptureUploadResult,
  type CaptureUploadSource,
  type SelectorCreateResult
} from '@shared/schemas'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { createSessionService, type SessionService } from '@main/services/session'

import {
  CAPTURE_SERVER_PORT,
  MANUAL_DEDUPE_WINDOW_MS,
  MAX_SCREENSHOT_SIZE
} from '@shared/constants'
import { matchIgnoredUrl } from '@shared/urlPatterns'
import { safeRegexTest } from '@main/services/safeRegex'
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

// Regex literals are evaluated in the vm sandbox: the patterns come from
// settings, so a catastrophically backtracking one must not stall the server.
// Containment is fail-open — a pattern that exhausts the 200 ms budget yields
// no match, so the capture is accepted rather than refused. See matchIgnoredUrl.
function isUrlBlacklisted(url: string, patterns: string[]): string | null {
  return matchIgnoredUrl(url, patterns, safeRegexTest)
}

function emitCaptureEvent(event: CaptureEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendEvent(mainWindow.webContents, IPC_CHANNELS.CAPTURE_ACTIVITY, event)
  }
}

// The single source of truth for the pipeline self-test route.
const CAPTURE_TEST_ROUTE = '/api/captures/test'

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

        const blocked = isUrlBlacklisted(url, captureSettings.ignoredUrlPatterns)
        if (blocked) {
          emitCaptureEvent({
            type: 'skipped',
            source,
            url,
            timestamp: new Date().toISOString(),
            skipReason: 'Blacklisted: ' + blocked
          })
          return c.json({ error: 'URL blocked by ignored pattern', pattern: blocked }, 403)
        }

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

        const selector = selectorLifecycle.createSelector({
          caseId,
          pattern,
          isRegex: false,
          label
        })

        return c.json({ selector, status: 'ok' } satisfies SelectorCreateResult)
      } catch (err) {
        logger.error('captureServer', 'captureServer.selector_create_failed', undefined, err)
        return c.json({ error: 'Failed to create selector' }, 500)
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
        try {
          captureRepo.deleteCapture(testCaptureId)
        } catch {
          /* best effort */
        }
      }
      if (testCaseId && testCaptureId) {
        try {
          defaultCaptureStore.deleteArtifacts(testCaseId, testCaptureId)
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
