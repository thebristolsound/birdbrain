import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import type { Server } from 'http'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import * as db from '@main/services/database'
import { saveCapture } from '@main/services/storage'
import { hashContent } from '@main/services/hash'
import { getSettings } from '@main/services/settings'

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

function isUrlBlacklisted(url: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    try {
      if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        const lastSlash = pattern.lastIndexOf('/')
        const re = new RegExp(pattern.slice(1, lastSlash), pattern.slice(lastSlash + 1))
        if (re.test(url)) return pattern
      } else {
        if (url.includes(pattern)) return pattern
      }
    } catch {
      // Invalid pattern, skip
    }
  }
  return null
}

function createApp(): Hono {
  const app = new Hono()

  // Allow requests from Chrome extension
  app.use(
    '*',
    cors({
      origin: ['chrome-extension://*', 'http://localhost:*', 'http://127.0.0.1:*'],
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
    const activeCase = state.activeCaseId ? db.getCase(state.activeCaseId) : null
    const settings = getSettings()
    const allCases = db.listCases()
    return c.json({
      running: true,
      activeCase: activeCase ? { id: activeCase.id, name: activeCase.name } : null,
      sessionActive: state.sessionActive,
      captureCount: state.captureCount,
      autoCaptureMode: settings.autoCaptureMode,
      cases: allCases.map((cs) => ({ id: cs.id, name: cs.name })),
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

  // Receive capture from extension
  app.post('/api/captures', async (c) => {
    if (!state.activeCaseId) {
      return c.json({ error: 'No active case' }, 400)
    }

    try {
      const body = await c.req.json()
      const { url, title, html, screenshot, timestamp, headers, textContent } = body

      if (!url || !html) {
        return c.json({ error: 'Missing required fields: url, html' }, 400)
      }

      const captureSettings = getSettings()
      const blocked = isUrlBlacklisted(url, captureSettings.ignoredUrlPatterns)
      if (blocked) {
        return c.json({ error: 'URL blocked by ignored pattern', pattern: blocked }, 403)
      }

      const hash = hashContent(html)
      const caseId = state.activeCaseId

      // Save files to disk
      const screenshotBuffer = screenshot ? Buffer.from(screenshot, 'base64') : undefined
      const captureId = crypto.randomUUID()

      const paths = saveCapture(caseId, captureId, html, screenshotBuffer, textContent)

    // Insert into database using the same ID as the files
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

    state.captureCount++

    // Notify renderer of new capture
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.NEW_CAPTURE, capture)
    }

      return c.json({ captureId: capture.id, hash, status: 'ok' })
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
      const { caseId, url, title, html, screenshot, timestamp, headers, textContent } = body

      if (!caseId || !url || !html) {
        return c.json({ error: 'Missing required fields: caseId, url, html' }, 400)
      }

      const selectorSettings = getSettings()
      const selectorBlocked = isUrlBlacklisted(url, selectorSettings.ignoredUrlPatterns)
      if (selectorBlocked) {
        return c.json({ error: 'URL blocked by ignored pattern', pattern: selectorBlocked }, 403)
      }

      const hash = hashContent(html)

      // Save files to disk
      const screenshotBuffer = screenshot ? Buffer.from(screenshot, 'base64') : undefined
      const captureId = crypto.randomUUID()

      const paths = saveCapture(caseId, captureId, html, screenshotBuffer, textContent)

      // Insert into database using the same ID as the files
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

      // Notify renderer of new capture
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.NEW_CAPTURE, capture)
      }

      return c.json({ captureId: capture.id, hash, status: 'ok' })
    } catch (err) {
      console.error('Selector capture error:', err)
      return c.json({ error: 'Failed to process selector capture' }, 500)
    }
  })

  // Manual capture — session-independent
  app.post('/api/captures/manual', async (c) => {
    try {
      const body = await c.req.json()
      const { caseId, url, title, html, screenshot, timestamp, headers, textContent } = body

      if (!caseId || !url || !html) {
        return c.json({ error: 'Missing required fields: caseId, url, html' }, 400)
      }

      // Validate case exists and is not archived
      const caseData = db.getCase(caseId)
      if (!caseData) {
        return c.json({ error: 'Case not found' }, 404)
      }

      const manualSettings = getSettings()
      const manualBlocked = isUrlBlacklisted(url, manualSettings.ignoredUrlPatterns)
      if (manualBlocked) {
        return c.json({ error: 'URL blocked by ignored pattern', pattern: manualBlocked }, 403)
      }

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

      // Notify renderer of new capture
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.NEW_CAPTURE, capture)
      }

      return c.json({ captureId: capture.id, hash, status: 'ok' })
    } catch (err) {
      console.error('Manual capture error:', err)
      return c.json({ error: 'Failed to process manual capture' }, 500)
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
