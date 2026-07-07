import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import type { Server } from 'http'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import * as db from '@main/services/database'
import { defaultCaptureStore } from '@main/services/captureStore'
import { getSettings } from '@main/services/settings'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { getInstallationId } from '@main/services/installationId'
import { getServerToken } from '@main/services/serverToken'
import type { CaptureEvent, CaptureSource } from '@shared/types'
import {
  CaptureUploadSchema,
  SelectorCreateSchema,
  formatCaptureUploadError,
  formatSelectorCreateError
} from '@shared/schemas'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'

import { CAPTURE_SERVER_PORT, MAX_SCREENSHOT_SIZE } from '@shared/constants'
import { safeRegexTest } from '@main/services/safeRegex'
export { CAPTURE_SERVER_PORT }

export interface CaptureServerDeps {
  selectorLifecycle: SelectorLifecycle
  captureLifecycle: CaptureLifecycle
  token?: string
}

function getToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}

// Manual capture dedup: "caseId:url" -> timestamp of last accepted capture
const manualDedup = new Map<string, number>()
const MANUAL_DEDUPE_WINDOW_MS = 5_000

const OPERATOR_NAME_REQUIRED_MSG =
  'Operator name required. Configure your name in Birdbrain settings before capturing.'

interface SessionState {
  activeCaseId: string | null
  sessionActive: boolean
  captureCount: number
  extensionLastSeen: number
}

let server: Server | null = null
let mainWindow: BrowserWindow | null = null

const state: SessionState = {
  activeCaseId: null,
  sessionActive: false,
  captureCount: 0,
  extensionLastSeen: 0
}

export function getSessionState(): SessionState {
  return { ...state }
}

export function resetSessionState(): void {
  state.activeCaseId = null
  state.sessionActive = false
  state.captureCount = 0
  state.extensionLastSeen = 0
  manualDedup.clear()
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const withWildcards = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(withWildcards, 'i')
}

function isUrlBlacklisted(url: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    try {
      if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        const lastSlash = pattern.lastIndexOf('/')
        const regexBody = pattern.slice(1, lastSlash)
        const flags = pattern.slice(lastSlash + 1)
        if (safeRegexTest(regexBody, flags, url)) return pattern
      } else if (pattern.includes('*') || pattern.includes('?')) {
        if (globToRegex(pattern).test(url)) return pattern
      } else {
        if (url.includes(pattern)) return pattern
      }
    } catch {
      // Invalid pattern, skip
    }
  }
  return null
}

function emitCaptureEvent(event: CaptureEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.CAPTURE_ACTIVITY, event)
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
      const wasConnected = Date.now() - state.extensionLastSeen < 10000
      state.extensionLastSeen = Date.now()
      if (!wasConnected) {
        notifyExtensionConnection(true)
      }
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
    const activeCase = state.activeCaseId ? db.getCase(state.activeCaseId) : null
    const settings = getSettings()
    const allCases = includeCases ? db.listCases() : null
    // Only expose the auth token to known origins (extension, localhost) or the
    // origin-less same-origin/extension pairing fetch. Omit for any web origin
    // so a page can't read it — and note the DNS-rebinding guard above already
    // rejects rebound hostnames before this runs. file:// is intentionally NOT
    // trusted: such a page receives no CORS grant and so can't read the body.
    const includeToken =
      !origin ||
      origin.startsWith('chrome-extension://') ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:')
    return c.json({
      running: true,
      ...(includeToken ? { serverToken: requiredToken } : {}),
      activeCase: activeCase ? { id: activeCase.id, name: activeCase.name } : null,
      sessionActive: state.sessionActive,
      captureCount: state.captureCount,
      autoCaptureMode: settings.autoCaptureMode,
      cases: includeCases && allCases ? allCases.map((cs) => ({ id: cs.id, name: cs.name })) : [],
      ignoredUrlPatterns: settings.ignoredUrlPatterns,
      captureScreenshots: settings.captureScreenshots,
      dedupeWindowSeconds: settings.dedupeWindowSeconds,
      theme: settings.theme
    })
  })

  // List cases
  app.get('/api/cases', (c) => {
    const cases = db.listCases()
    return c.json(
      cases.map((cs) => ({
        id: cs.id,
        name: cs.name,
        captureCount: db.getCaptureCount(cs.id)
      }))
    )
  })

  // Activate a case
  app.post('/api/cases/:id/activate', (c) => {
    const id = c.req.param('id')
    const caseData = db.getCase(id)
    if (!caseData) {
      return c.json({ error: 'Case not found' }, 404)
    }
    state.activeCaseId = id
    notifySessionChange()
    return c.json({ status: 'ok', case: { id: caseData.id, name: caseData.name } })
  })

  // Start session
  app.post('/api/session/start', (c) => {
    if (!state.activeCaseId) {
      return c.json({ error: 'No active case selected' }, 400)
    }
    state.sessionActive = true
    state.captureCount = 0
    notifySessionChange()
    return c.json({ status: 'ok', sessionActive: true })
  })

  // Stop session
  app.post('/api/session/stop', (c) => {
    state.sessionActive = false
    notifySessionChange()
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
      const source: CaptureSource = input.source
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
          if (!state.sessionActive) return c.json({ error: 'No active session' }, 400)
          if (!state.activeCaseId) return c.json({ error: 'No active case' }, 400)
          caseId = state.activeCaseId
        } else {
          if (!caseIdField) return c.json({ error: 'Missing required field: caseId' }, 400)
          const caseData = db.getCase(caseIdField)
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
            console.warn(`[Birdbrain] ${screenshotDropReason} for ${url}`)
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

        if (source === 'auto') state.captureCount++

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.NEW_CAPTURE, capture)
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
        })
      } catch (err) {
        console.error('Capture error:', err)
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
    if (!state.activeCaseId) {
      return c.json([])
    }
    const activeSelectors = db.listActiveSelectors(state.activeCaseId)
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

        if (!state.activeCaseId) {
          return c.json({ error: 'No active case selected' }, 400)
        }
        if (caseId !== state.activeCaseId) {
          return c.json({ error: 'caseId does not match active case' }, 400)
        }

        const caseData = db.getCase(caseId)
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

        return c.json({ selector, status: 'ok' })
      } catch (err) {
        console.error('Create selector error:', err)
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
      const cases = db.listCases()
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
          db.deleteCapture(testCaptureId)
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
  return new Promise((resolve) => {
    const app = createApp(deps)
    server = serve(
      {
        fetch: app.fetch,
        port,
        hostname: '127.0.0.1'
      },
      () => {
        console.log(`Birdbrain capture server running on http://127.0.0.1:${port}`)
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

function notifySessionChange(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.SESSION_STATE_CHANGED, {
      sessionActive: state.sessionActive,
      activeCaseId: state.activeCaseId,
      captureCount: state.captureCount
    })
  }
}

function notifyExtensionConnection(connected: boolean): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.EXTENSION_CONNECTION, { connected })
  }
}

let extensionCheckInterval: ReturnType<typeof setInterval> | null = null

export function startExtensionConnectionCheck(): void {
  extensionCheckInterval = setInterval(() => {
    const connected = Date.now() - state.extensionLastSeen < 10000
    if (!connected && state.extensionLastSeen > 0) {
      notifyExtensionConnection(false)
      state.extensionLastSeen = 0
    }
  }, 5000)
}

export function stopExtensionConnectionCheck(): void {
  if (extensionCheckInterval) {
    clearInterval(extensionCheckInterval)
    extensionCheckInterval = null
  }
}
