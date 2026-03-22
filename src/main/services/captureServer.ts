import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import type { Server } from 'http'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import * as db from '@main/services/database'
import { saveCapture, updateCaptureHtml } from '@main/services/storage'
import { hashContent } from '@main/services/hash'
import { getSettings } from '@main/services/settings'
import { extractEntitiesRuleBased } from '@main/services/ruleBasedExtraction'
import type { EntityType } from '@shared/types'

const DEFAULT_PORT = 19845

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

let cachedEnabledEntityTypes: EntityType[] | null = null

export function invalidateEntityTypeCache(): void {
  cachedEnabledEntityTypes = null
}

export function getSessionState(): SessionState {
  return { ...state }
}

export function resetSessionState(): void {
  state.activeCaseId = null
  state.sessionActive = false
  state.captureCount = 0
  state.extensionLastSeen = 0
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

// NOTE: This function is duplicated in extension/src/background.ts.
// Keep both copies in sync — they cannot share code because they run in
// different processes with separate build pipelines.
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
        const re = new RegExp(pattern.slice(1, lastSlash), pattern.slice(lastSlash + 1))
        if (re.test(url)) return pattern
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

function runRuleBasedExtraction(captureId: string, textContent: string | undefined): void {
  if (!textContent?.trim()) return

  try {
    if (!cachedEnabledEntityTypes) {
      const settings = getSettings()
      cachedEnabledEntityTypes = settings.enabledEntityTypes || []
    }

    const enabledTypes: EntityType[] = cachedEnabledEntityTypes
    if (!enabledTypes || enabledTypes.length === 0) return

    const entities = extractEntitiesRuleBased(textContent, enabledTypes)
    if (entities.length === 0) return

    db.insertEntitiesBatch(
      entities.map(e => ({
        captureId,
        type: e.type,
        value: e.value,
        context: e.context,
        confidence: e.confidence,
        source: 'rule'
      }))
    )

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.EXTRACTION_COMPLETE, {
        captureId,
        entityCount: entities.length,
        source: 'rule'
      })
    }

    console.log(`[Rule] Extracted ${entities.length} entities from capture ${captureId}`)
  } catch (err) {
    console.error(`[Rule] Entity extraction failed for capture ${captureId}:`, err)
  }
}

function schedulePostCaptureWork(captureId: string, caseId: string, textContent: string | undefined): void {
  setImmediate(() => {
    try {
      runRuleBasedExtraction(captureId, textContent)
    } catch (err) {
      console.error('Rule-based extraction error for capture', captureId, err)
    }
    try {
      if (textContent) {
        db.matchSelectorsForCapture(captureId, caseId, textContent)
      }
    } catch (err) {
      console.error('Selector matching error for capture', captureId, err)
    }
  })
}

interface ProcessCaptureInput {
  caseId: string
  url: string
  title?: string
  html: string
  screenshot?: string
  timestamp?: string
  headers?: Record<string, string>
  textContent?: string
}

type ProcessCaptureResult =
  | { ok: true; captureId: string; hash: string }
  | { ok: false; error: string; pattern?: string; status: number }

function processCapture(input: ProcessCaptureInput): ProcessCaptureResult {
  const { caseId, url, html, screenshot, timestamp, headers, textContent } = input
  const title = input.title || url

  const settings = getSettings()
  const blocked = isUrlBlacklisted(url, settings.ignoredUrlPatterns)
  if (blocked) {
    return { ok: false, error: 'URL blocked by ignored pattern', pattern: blocked, status: 403 }
  }

  const hash = hashContent(html)
  const screenshotBuffer = screenshot ? Buffer.from(screenshot, 'base64') : undefined
  const captureId = crypto.randomUUID()

  const paths = saveCapture(caseId, captureId, html, screenshotBuffer, textContent)

  const capture = db.insertCapture({
    id: captureId,
    caseId,
    url,
    title,
    hash,
    timestamp: timestamp || new Date().toISOString(),
    htmlPath: paths.htmlPath,
    screenshotPath: paths.screenshotPath,
    headers: headers ? JSON.stringify(headers) : undefined,
    textContent
  })

  schedulePostCaptureWork(capture.id, caseId, textContent)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.NEW_CAPTURE, capture)
  }

  return { ok: true, captureId: capture.id, hash }
}

function createApp(): Hono {
  const app = new Hono()

  // Allow requests from Chrome extension
  app.use(
    '*',
    cors({
      origin: ['chrome-extension://*', 'http://localhost:*', 'http://127.0.0.1:*'],
      allowMethods: ['GET', 'POST', 'PATCH'],
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
      cases: includeCases && allCases
        ? allCases.map((cs) => ({ id: cs.id, name: cs.name }))
        : [],
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

  // Entity summary for a case
  app.get('/api/cases/:id/entities/summary', (c) => {
    const caseId = c.req.param('id')
    const rows = db.getDb().prepare(`
      SELECT type, COUNT(*) as count
      FROM entities
      WHERE capture_id IN (SELECT id FROM captures WHERE case_id = ?)
      GROUP BY type
      ORDER BY count DESC
    `).all(caseId) as { type: string; count: number }[]

    return c.json(rows.map(r => ({
      type: r.type,
      count: r.count,
      color: ''
    })))
  })

  // Activate a case
  app.post('/api/cases/:id/activate', (c) => {
    const id = c.req.param('id')
    const caseData = db.getCase(id)
    if (!caseData) {
      return c.json({ error: 'Case not found' }, 404)
    }
    state.activeCaseId = id
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

  // Receive capture from extension (session-based auto-capture)
  app.post('/api/captures', async (c) => {
    if (!state.activeCaseId) {
      return c.json({ error: 'No active case' }, 400)
    }

    try {
      const body = await c.req.json()
      const { url, html } = body

      if (!url || !html) {
        return c.json({ error: 'Missing required fields: url, html' }, 400)
      }

      const result = processCapture({ ...body, caseId: state.activeCaseId })
      if (!result.ok) {
        return c.json({ error: result.error, pattern: result.pattern }, result.status)
      }

      state.captureCount++
      return c.json({ captureId: result.captureId, hash: result.hash, status: 'ok' })
    } catch (err) {
      console.error('Capture error:', err)
      return c.json({ error: 'Failed to process capture' }, 500)
    }
  })

  // List active selectors across all non-archived cases
  app.get('/api/selectors/active', (c) => {
    const activeSelectors = db.listActiveSelectors()
    return c.json(activeSelectors)
  })

  // Receive selector-triggered capture from extension
  app.post('/api/captures/selector', async (c) => {
    try {
      const body = await c.req.json()
      const { caseId, url, html } = body

      if (!caseId || !url || !html) {
        return c.json({ error: 'Missing required fields: caseId, url, html' }, 400)
      }

      const result = processCapture(body)
      if (!result.ok) {
        return c.json({ error: result.error, pattern: result.pattern }, result.status)
      }

      return c.json({ captureId: result.captureId, hash: result.hash, status: 'ok' })
    } catch (err) {
      console.error('Selector capture error:', err)
      return c.json({ error: 'Failed to process selector capture' }, 500)
    }
  })

  // Manual capture — session-independent
  app.post('/api/captures/manual', async (c) => {
    try {
      const body = await c.req.json()
      const { caseId, url, html } = body

      if (!caseId || !url || !html) {
        return c.json({ error: 'Missing required fields: caseId, url, html' }, 400)
      }

      // Validate case exists and is not archived
      const caseData = db.getCase(caseId)
      if (!caseData) {
        return c.json({ error: 'Case not found' }, 404)
      }
      if (caseData.archived) {
        return c.json({ error: 'Case is archived' }, 400)
      }

      const result = processCapture(body)
      if (!result.ok) {
        return c.json({ error: result.error, pattern: result.pattern }, result.status)
      }

      return c.json({ captureId: result.captureId, hash: result.hash, status: 'ok' })
    } catch (err) {
      console.error('Manual capture error:', err)
      return c.json({ error: 'Failed to process manual capture' }, 500)
    }
  })

  app.patch('/api/captures/:id/html', async (c) => {
    try {
      const captureId = c.req.param('id')
      const body = await c.req.json()
      const { html, caseId: bodyCaseId } = body

      if (!html) {
        return c.json({ error: 'Missing required field: html' }, 400)
      }

      const capture = db.getCapture(captureId)
      if (!capture) {
        return c.json({ error: 'Capture not found' }, 404)
      }

      // Derive caseId from DB — never trust the request body for filesystem paths
      const caseId = capture.caseId
      if (bodyCaseId && bodyCaseId !== caseId) {
        return c.json({ error: 'caseId does not match capture' }, 400)
      }

      // Overwrite HTML file on disk
      updateCaptureHtml(caseId, captureId, html)

      // Update hash in database
      const hash = hashContent(html)
      db.updateCaptureHash(captureId, hash)

      return c.json({ status: 'ok', captureId, hash })
    } catch (err) {
      console.error('HTML update error:', err)
      return c.json({ error: 'Failed to update capture HTML' }, 500)
    }
  })

  return app
}

export function startCaptureServer(port: number = DEFAULT_PORT): Promise<void> {
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
