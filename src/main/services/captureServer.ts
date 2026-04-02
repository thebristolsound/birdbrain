import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import type { Server } from 'http'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import * as db from '@main/services/database'
import { saveCapture, deleteCaptureFiles, readCaptureFile } from '@main/services/storage'
import { hashContent } from '@main/services/hash'
import { getSettings } from '@main/services/settings'
import type { CaptureEvent, CaptureSource } from '@shared/types'

import { CAPTURE_SERVER_PORT } from '@shared/constants'
import { safeRegexTest } from '@main/services/safeRegex'
export { CAPTURE_SERVER_PORT }
const VALID_CAPTURE_SOURCES: CaptureSource[] = ['auto', 'manual', 'selector']

// Manual capture dedup: "caseId:url" -> timestamp of last accepted capture
const manualDedup = new Map<string, number>()
const MANUAL_DEDUPE_WINDOW_MS = 5_000

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

function schedulePostCaptureWork(
  captureId: string,
  caseId: string,
  _source: CaptureSource,
  _url: string,
  textContent: string | undefined
): void {
  setImmediate(() => {
    try {
      if (textContent) {
        db.matchSelectorsForCapture(captureId, caseId, textContent)
      }
    } catch (err) {
      console.error('Selector matching error for capture', captureId, err)
    }
  })
}

function emitCaptureEvent(event: CaptureEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.CAPTURE_ACTIVITY, event)
  }
}

function createApp(): Hono {
  const app = new Hono()

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
      allowHeaders: ['Content-Type']
    })
  )

  // Status endpoint — also tracks extension connection
  app.get('/api/status', (c) => {
    const wasConnected = Date.now() - state.extensionLastSeen < 10000
    state.extensionLastSeen = Date.now()
    if (!wasConnected) {
      notifyExtensionConnection(true)
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
    return c.json({
      running: true,
      activeCase: activeCase ? { id: activeCase.id, name: activeCase.name } : null,
      sessionActive: state.sessionActive,
      captureCount: state.captureCount,
      autoCaptureMode: settings.autoCaptureMode,
      cases: includeCases && allCases ? allCases.map((cs) => ({ id: cs.id, name: cs.name })) : [],
      ignoredUrlPatterns: settings.ignoredUrlPatterns
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

  // Unified capture endpoint
  app.post('/api/captures', async (c) => {
    const startTime = Date.now()
    let source: CaptureSource = 'auto'
    let capturedUrl = ''
    try {
      const body = await c.req.json()
      // Validate that the request body is a non-null object
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return c.json({ error: 'Invalid request body: expected JSON object' }, 400)
      }

      const rawSource = (body as Record<string, unknown>).source
      if (rawSource === undefined || rawSource === null) {
        source = 'auto'
      } else if (VALID_CAPTURE_SOURCES.includes(rawSource)) {
        source = rawSource as CaptureSource
      } else {
        return c.json({ error: `Invalid source: ${rawSource}` }, 400)
      }
      const { url, title, html, screenshot, timestamp, headers, textContent, matchedSelectors } =
        body as {
          url?: string
          title?: string
          html?: string
          screenshot?: string
          timestamp?: string
          headers?: Record<string, unknown>
          textContent?: string
          matchedSelectors?: unknown
        }
      capturedUrl = url || ''

      // 1. Common validation
      if (!url || !html) {
        return c.json({ error: 'Missing required fields: url, html' }, 400)
      }

      // 2. URL blacklist
      const captureSettings = getSettings()
      const blocked = isUrlBlacklisted(url, captureSettings.ignoredUrlPatterns)
      if (blocked) {
        emitCaptureEvent({
          type: 'skipped',
          source,
          url,
          timestamp: new Date().toISOString(),
          skipReason: `Blacklisted: ${blocked}`
        })
        return c.json({ error: 'URL blocked by ignored pattern', pattern: blocked }, 403)
      }

      // 3. Source-specific validation
      let caseId: string

      if (source === 'auto') {
        if (!state.sessionActive) {
          return c.json({ error: 'No active session' }, 400)
        }
        if (!state.activeCaseId) {
          return c.json({ error: 'No active case' }, 400)
        }
        caseId = state.activeCaseId
      } else if (source === 'manual') {
        if (!body.caseId) {
          return c.json({ error: 'Missing required field: caseId' }, 400)
        }
        const caseData = db.getCase(body.caseId)
        if (!caseData) {
          return c.json({ error: 'Case not found' }, 404)
        }
        if (caseData.archived) {
          return c.json({ error: 'Case is archived' }, 400)
        }
        caseId = body.caseId
      } else if (source === 'selector') {
        if (!body.caseId) {
          return c.json({ error: 'Missing required field: caseId' }, 400)
        }
        if (!matchedSelectors) {
          return c.json({ error: 'Missing required field: matchedSelectors' }, 400)
        }
        const caseData = db.getCase(body.caseId)
        if (!caseData) {
          return c.json({ error: 'Case not found' }, 404)
        }
        if (caseData.archived) {
          return c.json({ error: 'Case is archived' }, 400)
        }
        caseId = body.caseId
      }

      // Dedup check for manual captures
      if (source === 'manual') {
        const dedupeKey = `${caseId}:${url}`
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

      // 4. Shared pipeline
      const hash = hashContent(html)
      const screenshotBuffer = screenshot ? Buffer.from(screenshot, 'base64') : undefined
      const captureId = crypto.randomUUID()

      const paths = saveCapture(caseId, captureId, html, screenshotBuffer, textContent)

      const capture = db.insertCapture({
        id: captureId,
        caseId,
        url,
        title: title || url,
        hash,
        timestamp: timestamp || new Date().toISOString(),
        htmlPath: paths.htmlPath,
        screenshotPath: paths.screenshotPath,
        headers: headers ? JSON.stringify(headers) : undefined,
        textContent
      })

      if (source === 'auto') {
        state.captureCount++
      }

      schedulePostCaptureWork(capture.id, caseId, source, url, textContent)

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
        durationMs
      })

      return c.json({ captureId: capture.id, hash, status: 'ok', source })
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
  })

  // List active selectors across all non-archived cases
  app.get('/api/selectors/active', (c) => {
    const activeSelectors = db.listActiveSelectors()
    return c.json(activeSelectors)
  })

  // Create a selector from the extension (highlighted text)
  app.post('/api/selectors', async (c) => {
    try {
      const body = await c.req.json()
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return c.json({ error: 'Invalid request body: expected JSON object' }, 400)
      }

      const { caseId, pattern, label } = body as {
        caseId?: string
        pattern?: string
        label?: string
      }

      if (!state.sessionActive) {
        return c.json({ error: 'No active session' }, 400)
      }
      if (!caseId) {
        return c.json({ error: 'Missing required field: caseId' }, 400)
      }
      if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
        return c.json({ error: 'Missing or empty required field: pattern' }, 400)
      }

      const caseData = db.getCase(caseId)
      if (!caseData) {
        return c.json({ error: 'Case not found' }, 404)
      }

      const selector = db.createSelector({
        caseId,
        pattern: pattern.trim(),
        isRegex: false,
        label: label || undefined
      })

      // Schedule retroactive matching asynchronously
      setImmediate(() => {
        try {
          const captures = db.listCaptures(caseId)
          const captureTexts: Array<{ captureId: string; text: string }> = []
          for (const cap of captures) {
            const buffer = readCaptureFile(caseId, cap.id, 'txt')
            if (buffer) {
              captureTexts.push({ captureId: cap.id, text: buffer.toString('utf-8') })
            }
          }
          if (captureTexts.length > 0) {
            db.matchSelectorAgainstCaptures(selector.id, captureTexts)
          }
        } catch (err) {
          console.error('Retroactive selector matching error:', err)
        }
      })

      return c.json({ selector, status: 'ok' })
    } catch (err) {
      console.error('Create selector error:', err)
      return c.json({ error: 'Failed to create selector' }, 500)
    }
  })

  // Test pipeline endpoint
  app.get('/api/captures/test', async (c) => {
    const startTime = Date.now()
    let testCaptureId: string | null = null
    let testCaseId: string | null = null

    try {
      // Find any case to use for test
      const cases = db.listCases()
      if (cases.length === 0) {
        return c.json({
          success: false,
          durationMs: 0,
          error: 'No cases exist — create a case first'
        })
      }
      testCaseId = cases[0].id

      // Create test capture
      const testHtml = `<html><body>Birdbrain pipeline test ${Date.now()}</body></html>`
      const hash = hashContent(testHtml)
      testCaptureId = crypto.randomUUID()

      emitCaptureEvent({
        type: 'received',
        source: 'manual',
        url: 'birdbrain://pipeline-test',
        timestamp: new Date().toISOString()
      })

      const paths = saveCapture(testCaseId, testCaptureId, testHtml, undefined, undefined)

      db.insertCapture({
        id: testCaptureId,
        caseId: testCaseId,
        url: 'birdbrain://pipeline-test',
        title: 'Pipeline Test',
        hash,
        timestamp: new Date().toISOString(),
        htmlPath: paths.htmlPath,
        screenshotPath: undefined,
        headers: undefined,
        textContent: undefined
      })

      // Verify by reading back
      const capture = db.getCapture(testCaptureId)
      if (!capture) {
        return c.json({
          success: false,
          durationMs: Date.now() - startTime,
          error: 'Test capture not found in DB after insert'
        })
      }
      if (capture.hash !== hash) {
        return c.json({
          success: false,
          durationMs: Date.now() - startTime,
          error: 'Hash mismatch after insert'
        })
      }

      const durationMs = Date.now() - startTime
      emitCaptureEvent({
        type: 'stored',
        captureId: testCaptureId!,
        source: 'manual',
        url: 'birdbrain://pipeline-test',
        timestamp: new Date().toISOString(),
        durationMs
      })

      return c.json({ success: true, durationMs })
    } catch (err) {
      return c.json({ success: false, durationMs: Date.now() - startTime, error: String(err) })
    } finally {
      // Cleanup
      if (testCaptureId) {
        try {
          db.deleteCapture(testCaptureId)
        } catch {
          /* best effort */
        }
      }
      if (testCaseId && testCaptureId) {
        try {
          deleteCaptureFiles(testCaseId, testCaptureId)
        } catch {
          /* best effort */
        }
      }
    }
  })

  return app
}

export function startCaptureServer(port: number = CAPTURE_SERVER_PORT): Promise<void> {
  return new Promise((resolve) => {
    const app = createApp()
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
    )
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
