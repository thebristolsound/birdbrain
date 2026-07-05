import { BrowserWindow, app } from 'electron'
import type { WebContents, Session } from 'electron'
import { createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { RenderPage, RenderedPage } from '@main/services/recapture'

const VIEWPORT = { width: 1280, height: 900 }
const NETWORK_IDLE_MS = 1200
const INITIAL_NETWORK_IDLE_MAX_MS = 10_000
const POST_SCROLL_NETWORK_IDLE_MAX_MS = 15_000
const SCROLL_PAUSE_MS = 500
const SCROLL_STALL_THRESHOLD = 3
const MAX_SCROLL_PHASE_MS = 75_000
const FINAL_SETTLE_MS = 500
const FINAL_ARTIFACT_RESERVE_MS = 10_000
// Chromium's max texture dimension; captures beyond it fail or OOM.
const MAX_CAPTURE_DIMENSION_PX = 16_384
const MAX_CAPTURE_PIXELS = 32_000_000

interface NetworkIdleTracker {
  waitForIdle: (idleMs: number, maxWaitMs: number) => Promise<void>
  dispose: () => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampPhaseMs(remainingMs: number, maxMs: number): number {
  return Math.max(0, Math.min(remainingMs, maxMs))
}

// Tracks in-flight requests via Electron's session webRequest API rather than the
// CDP Network domain. Enabling CDP event domains (Page/Network.enable) from
// webContents.debugger evicts any other CDP client attached to the same target —
// which breaks Playwright's own debugger session in E2E (and is fragile in general).
// webRequest carries the same request start/finish signal with no such conflict.
function createNetworkIdleTracker(session: Session): NetworkIdleTracker {
  const pending = new Set<number>()
  let lastActivityAt = Date.now()

  const markActivity = () => {
    lastActivityAt = Date.now()
  }

  session.webRequest.onBeforeRequest((details, callback) => {
    // WebSocket connections never fire onCompleted/onErrorOccurred until they
    // close, so counting them would peg waitForIdle at maxWaitMs on any page
    // holding a live socket. Skip them; short-lived requests still gate idle.
    // (Electron's resourceType enum has no distinct SSE value — EventSource
    // streams surface as 'other', so they can't be excluded without also
    // dropping legitimate short requests.)
    if (details.resourceType !== 'webSocket') pending.add(details.id)
    markActivity()
    callback({})
  })

  const settle = (details: { id: number }): void => {
    pending.delete(details.id)
    markActivity()
  }
  session.webRequest.onCompleted((details) => settle(details))
  session.webRequest.onErrorOccurred((details) => settle(details))

  return {
    waitForIdle(idleMs, maxWaitMs) {
      if (maxWaitMs <= 0) return Promise.resolve()

      const startedAt = Date.now()
      return new Promise((resolve) => {
        const check = () => {
          const now = Date.now()
          const quietForMs = now - lastActivityAt
          if (pending.size === 0 && quietForMs >= idleMs) {
            resolve()
            return
          }
          if (now - startedAt >= maxWaitMs) {
            resolve()
            return
          }
          setTimeout(check, Math.min(250, Math.max(50, idleMs - quietForMs)))
        }
        check()
      })
    },
    dispose() {
      session.webRequest.onBeforeRequest(null)
      session.webRequest.onCompleted(null)
      session.webRequest.onErrorOccurred(null)
    }
  }
}

async function waitForDocumentComplete(wc: WebContents, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) return

  await wc.executeJavaScript(
    `(async () => {
      if (document.readyState === 'complete') return
      await new Promise((resolve) => {
        const done = () => resolve(undefined)
        window.addEventListener('load', done, { once: true })
        setTimeout(done, ${Math.max(0, Math.floor(timeoutMs))})
      })
    })()`,
    true
  )
}

async function scrollToLoadLazyContent(wc: WebContents, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) return

  await wc.executeJavaScript(
    `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const root = document.scrollingElement || document.documentElement || document.body
      if (!root) return

      const getHeight = () => Math.max(
        root.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0
      )

      const pauseMs = ${SCROLL_PAUSE_MS}
      const stallThreshold = ${SCROLL_STALL_THRESHOLD}
      const deadline = Date.now() + ${Math.max(0, Math.floor(timeoutMs))}
      const viewportHeight = Math.max(window.innerHeight || 0, root.clientHeight || 0, 1)
      let stalls = 0
      let lastHeight = getHeight()
      let lastY = window.scrollY

      while (Date.now() < deadline) {
        const beforeHeight = getHeight()
        const maxY = Math.max(0, beforeHeight - viewportHeight)
        const nextY = Math.min(maxY, window.scrollY + viewportHeight)

        window.scrollTo(0, nextY)
        await sleep(pauseMs)

        const currentHeight = getHeight()
        const currentY = window.scrollY
        const atBottom = currentY + viewportHeight >= currentHeight - 2
        const noHeightGrowth = currentHeight <= lastHeight
        const noScrollProgress = currentY <= lastY + 1

        if ((atBottom && noHeightGrowth) || (noHeightGrowth && noScrollProgress)) {
          stalls += 1
          if (stalls >= stallThreshold) break
        } else {
          stalls = 0
        }

        lastHeight = currentHeight
        lastY = currentY
      }

      window.scrollTo(0, 0)
      await sleep(pauseMs)
    })()`,
    true
  )
}

async function captureFullPageScreenshot(wc: WebContents): Promise<Buffer> {
  const metrics = (await wc.debugger.sendCommand('Page.getLayoutMetrics')) as {
    cssContentSize?: { x: number; y: number; width: number; height: number }
  }

  // Only cssContentSize is in CSS pixels, which is what captureScreenshot's clip
  // expects. The deprecated device-pixel contentSize would mis-scale the clip on
  // non-1 DPR pages, so skip the clip entirely when cssContentSize is absent.
  const contentSize = metrics.cssContentSize
  let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined
  if (contentSize) {
    // getLayoutMetrics can omit dimensions on some pages; coalesce so a missing
    // field yields a valid 1px clip rather than NaN (which fails captureScreenshot).
    const width = Math.max(1, Math.ceil(contentSize.width ?? 0))
    const height = Math.max(1, Math.ceil(contentSize.height ?? 0))
    // Downscale so no output side exceeds the texture ceiling and the total
    // bitmap stays bounded — scroll discovery can grow pages without limit.
    const scale = Math.min(
      1,
      MAX_CAPTURE_DIMENSION_PX / width,
      MAX_CAPTURE_DIMENSION_PX / height,
      Math.sqrt(MAX_CAPTURE_PIXELS / (width * height))
    )
    clip = {
      x: Math.max(0, contentSize.x || 0),
      y: Math.max(0, contentSize.y || 0),
      width,
      height,
      scale
    }
  }

  const { data } = (await wc.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    ...(clip ? { clip } : {})
  })) as { data: string }

  return Buffer.from(data, 'base64')
}

// Renders a URL in a locked-down, invisible BrowserWindow with a fresh
// in-memory session (no persist: prefix = nothing touches disk, nothing is
// shared with the app or previous jobs). A hostile page runs in our process,
// so: sandboxed, isolated, no preload, no node, every permission denied,
// popups denied, window destroyed in finally.
export const renderPageInHiddenWindow: RenderPage = async (url, { timeoutMs }) => {
  const win = new BrowserWindow({
    show: false,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `recapture-${randomUUID()}`,
      backgroundThrottling: false
    }
  })

  const tmpPath = join(app.getPath('temp'), `birdbrain-recapture-${randomUUID()}.mhtml`)

  let deadlineTimer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(
      () => reject(new Error(`Recapture timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  })

  const wc = win.webContents
  let networkTracker: NetworkIdleTracker | undefined
  let cleanedUp = false

  // Hoisted cleanup: idempotent so both the inner finally and outer timeout
  // cleanup can safely invoke it.
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    networkTracker?.dispose()
    if (wc.debugger.isAttached()) wc.debugger.detach()
  }

  async function render(): Promise<RenderedPage> {
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.setAudioMuted(true)

    const startedAt = Date.now()
    const remainingMs = (reserveMs = 0) =>
      Math.max(0, timeoutMs - (Date.now() - startedAt) - reserveMs)

    let httpStatus = 0
    wc.on('did-navigate', (_event, _navUrl, httpResponseCode) => {
      httpStatus = httpResponseCode
    })

    // The debugger is attached for the whole render but no CDP event domains are
    // enabled — only the one-shot getLayoutMetrics/captureScreenshot commands use
    // it. Network-idle is tracked out-of-band via the session's webRequest API.
    wc.debugger.attach('1.3')
    networkTracker = createNetworkIdleTracker(wc.session)

    try {
      await wc.loadURL(url)
      await waitForDocumentComplete(wc, remainingMs(FINAL_ARTIFACT_RESERVE_MS))
      await networkTracker.waitForIdle(
        NETWORK_IDLE_MS,
        clampPhaseMs(remainingMs(FINAL_ARTIFACT_RESERVE_MS), INITIAL_NETWORK_IDLE_MAX_MS)
      )

      // Scroll through the complete document to trigger lazy-loaded/infinite-scroll
      // content before saving the MHTML. Unlike the original 30-viewport cap, this
      // runs until the page bottom is stable or the recapture budget is exhausted.
      await scrollToLoadLazyContent(
        wc,
        clampPhaseMs(remainingMs(FINAL_ARTIFACT_RESERVE_MS), MAX_SCROLL_PHASE_MS)
      )
      await networkTracker.waitForIdle(
        NETWORK_IDLE_MS,
        clampPhaseMs(remainingMs(FINAL_ARTIFACT_RESERVE_MS), POST_SCROLL_NETWORK_IDLE_MAX_MS)
      )
      await sleep(Math.min(FINAL_SETTLE_MS, remainingMs(FINAL_ARTIFACT_RESERVE_MS)))

      // Whole-page screenshot via CDP using the document content bounds, not just
      // the visible viewport. captureBeyondViewport avoids stitching artifacts.
      const screenshot = await captureFullPageScreenshot(wc)

      await wc.savePage(tmpPath, 'MHTML')

      const text = (await wc.executeJavaScript(
        'document.body ? document.body.innerText : ""'
      )) as string

      return {
        mhtmlStream: createReadStream(tmpPath) as unknown as AsyncIterable<Uint8Array>,
        screenshot,
        text,
        title: wc.getTitle(),
        finalUrl: wc.getURL(),
        httpStatus,
        userAgent: wc.getUserAgent(),
        browserVersion: `Chrome/${process.versions.chrome}`,
        cleanup: async () => {
          if (!win.isDestroyed()) win.destroy()
          await unlink(tmpPath).catch(() => {})
        }
      }
    } finally {
      cleanup()
    }
  }

  const rendering = render()
  try {
    return await Promise.race([rendering, deadline])
  } catch (err) {
    // Destroying the window cancels the in-flight render: its next webContents
    // call rejects. Wait for it to settle so a mid-flight savePage can't
    // recreate the temp file after we delete it — but bound the wait, since
    // Electron doesn't guarantee an already in-flight webContents promise ever
    // settles after destroy (electron/electron#9102).
    cleanup()
    if (!win.isDestroyed()) win.destroy()
    await Promise.race([rendering.catch(() => {}), sleep(2000)])
    await unlink(tmpPath).catch(() => {})
    throw err
  } finally {
    clearTimeout(deadlineTimer)
  }
}
