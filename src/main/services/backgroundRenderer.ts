import { BrowserWindow, app } from 'electron'
import type { WebContents, Session } from 'electron'
import type { ElectronBlocker } from '@ghostery/adblocker-electron'
import sharp from 'sharp'
import { createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getConsentBlocker } from '@main/services/consentBlocker'
import type { RenderPage, RenderedPage } from '@main/services/recapture'
import type { ConsentSuppression } from '@shared/types'

const VIEWPORT = { width: 1280, height: 900 }
const NETWORK_IDLE_MS = 1200
const INITIAL_NETWORK_IDLE_MAX_MS = 10_000
const POST_SCROLL_NETWORK_IDLE_MAX_MS = 15_000
const SCROLL_PAUSE_MS = 500
const SCROLL_STALL_THRESHOLD = 3
const MAX_SCROLL_PHASE_MS = 75_000
const FINAL_SETTLE_MS = 500
// Reserved for screenshot + MHTML + text extraction. Sized for the worst case
// the scroll cap below allows — a page at the full screenshot pixel budget —
// so the artifact phase can't be starved into the outer deadline.
const FINAL_ARTIFACT_RESERVE_MS = 20_000
// Chromium's max texture dimension; captures beyond it fail or OOM.
const MAX_CAPTURE_DIMENSION_PX = 16_384
const MAX_CAPTURE_PIXELS = 32_000_000
// Infinite-scroll feeds grow without bound (the render kicks in the scroll
// loop make their IntersectionObservers fire for real), so scroll discovery
// stops once the page reaches the height the screenshot budget can render at
// scale 1 — content past it would only be downscaled away and bloat the MHTML.
const MAX_SCROLL_CONTENT_HEIGHT_PX = Math.floor(MAX_CAPTURE_PIXELS / VIEWPORT.width)

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

  // Requests are observed at onSendHeaders, NOT onBeforeRequest: Electron's
  // webRequest allows a single listener per event, and the consent blocker owns
  // the onBeforeRequest slot for this session. Requests the blocker cancels
  // never reach onSendHeaders, so they never pend; their onErrorOccurred below
  // still marks activity.
  session.webRequest.onSendHeaders((details) => {
    // WebSocket connections never fire onCompleted/onErrorOccurred until they
    // close, so counting them would peg waitForIdle at maxWaitMs on any page
    // holding a live socket. Skip them; short-lived requests still gate idle.
    // (Electron's resourceType enum has no distinct SSE value — EventSource
    // streams surface as 'other', so they can't be excluded without also
    // dropping legitimate short requests.)
    if (details.resourceType !== 'webSocket') pending.add(details.id)
    markActivity()
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
      session.webRequest.onSendHeaders(null)
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

// Shared by the scroll-phase scripts below. canScroll probes actual movement —
// a viewport scroll-locked by overflow: hidden clamps even programmatic
// scrolling. pickRoot prefers the document, falling back to the largest
// scrollable descendant (app-shell layouts scroll an inner container).
const SCROLL_HELPERS = `
  // scrollTo with behavior 'instant' so CSS scroll-behavior: smooth can't turn
  // programmatic scrolls into animations the probes would misread.
  const setScrollTop = (el, y) => {
    if (el.scrollTo) el.scrollTo({ top: y, behavior: 'instant' })
    else el.scrollTop = y
  }
  const canScroll = (el) => {
    if (!el || el.scrollHeight <= el.clientHeight + 2) return false
    const prev = el.scrollTop
    setScrollTop(el, prev + 1)
    const moved = el.scrollTop !== prev
    setScrollTop(el, prev)
    return moved
  }
  const doc = document.scrollingElement || document.documentElement || document.body
  const pickRoot = () => {
    if (canScroll(doc)) return doc
    let best = null
    let bestGain = 0
    const minHeight = Math.max((window.innerHeight || 0) / 2, 150)
    for (const el of document.querySelectorAll('body *')) {
      const gain = el.scrollHeight - el.clientHeight
      if (gain > bestGain && el.clientHeight >= minHeight && canScroll(el)) {
        best = el
        bestGain = gain
      }
    }
    return best
  }
`

// Consent walls scroll-lock the page with overflow: hidden on <html>/<body>.
// When nothing scrolls but content overflows the viewport, lift the lock for
// the scroll phase ONLY. Returns the original inline overflow values
// ([html, body]) for the restore script, or null when no lock was lifted.
const SCROLL_UNLOCK_SCRIPT = `(() => {
  ${SCROLL_HELPERS}
  if (pickRoot()) return null
  if (!doc || doc.scrollHeight <= doc.clientHeight + 2) return null
  const prior = []
  for (const el of [document.documentElement, document.body]) {
    prior.push(el ? el.style.overflow : '')
    if (el) el.style.overflow = 'visible'
  }
  return prior
})()`

// One scroll step: advance the root by one viewport (re-picked each step so a
// layout change mid-phase can't strand the loop) and report position/height
// for the main-process stall detector. null = nothing scrollable.
const SCROLL_STEP_SCRIPT = `(() => {
  ${SCROLL_HELPERS}
  const root = pickRoot()
  if (!root) return null
  const viewportHeight = Math.max(root.clientHeight || 0, window.innerHeight || 0, 1)
  const maxY = Math.max(0, root.scrollHeight - viewportHeight)
  setScrollTop(root, Math.min(maxY, root.scrollTop + viewportHeight))
  return { y: root.scrollTop, height: root.scrollHeight, viewportHeight }
})()`

// Positions the scroll root at an absolute offset for the stitched-screenshot
// fallback below. null = nothing scrollable.
function scrollToOffsetScript(y: number): string {
  return `(() => {
    ${SCROLL_HELPERS}
    const root = pickRoot()
    if (!root) return null
    setScrollTop(root, ${Math.max(0, Math.floor(y))})
    const viewportHeight = Math.max(root.clientHeight || 0, window.innerHeight || 0, 1)
    return { y: root.scrollTop, viewportHeight }
  })()`
}

function scrollResetScript(priorOverflow: string[] | null): string {
  return `(() => {
    ${SCROLL_HELPERS}
    const root = pickRoot()
    if (root) setScrollTop(root, 0)
    window.scrollTo(0, 0)
    const prior = ${JSON.stringify(priorOverflow)}
    if (prior) {
      const els = [document.documentElement, document.body]
      for (let i = 0; i < els.length; i++) {
        if (els[i]) els[i].style.overflow = prior[i] ?? ''
      }
    }
  })()`
}

// A hidden window stops producing compositor frames, so rendering-lifecycle
// work — IntersectionObserver notifications in particular — is not delivered
// while the scroll phase runs, and lazy loaders never fire. A minimal clipped
// CDP screenshot forces one BeginFrame, flushing pending notifications.
async function forceRenderPass(wc: WebContents): Promise<void> {
  try {
    await wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 10,
      fromSurface: true,
      clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 }
    })
  } catch {
    // Best-effort: a failed kick only means lazy content may not load.
  }
}

// Scrolls through the complete document (main-process-driven loop) to trigger
// lazy-loaded/infinite-scroll content before the artifacts are captured. The
// scroll lock lifted by SCROLL_UNLOCK_SCRIPT is always restored — before the
// screenshot and MHTML are taken, so they reflect what the page actually set.
async function scrollToLoadLazyContent(wc: WebContents, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) return
  const deadlineAt = Date.now() + timeoutMs

  const priorOverflow = (await wc.executeJavaScript(SCROLL_UNLOCK_SCRIPT, true)) as
    | string[]
    | null

  try {
    let stalls = 0
    let lastHeight = 0
    let lastY = -1

    while (Date.now() < deadlineAt) {
      const state = (await wc.executeJavaScript(SCROLL_STEP_SCRIPT, true)) as {
        y: number
        height: number
        viewportHeight: number
      } | null
      if (!state) break
      if (state.height >= MAX_SCROLL_CONTENT_HEIGHT_PX) break

      await forceRenderPass(wc)
      await sleep(SCROLL_PAUSE_MS)

      const atBottom = state.y + state.viewportHeight >= state.height - 2
      const noHeightGrowth = state.height <= lastHeight
      const noScrollProgress = state.y <= lastY + 1

      if ((atBottom && noHeightGrowth) || (noHeightGrowth && noScrollProgress)) {
        stalls += 1
        if (stalls >= SCROLL_STALL_THRESHOLD) break
      } else {
        stalls = 0
      }

      lastHeight = state.height
      lastY = state.y
    }
  } finally {
    // Fail-soft: this only restores scroll position and the lifted overflow
    // lock. If the page navigated or the webContents was destroyed mid-teardown
    // the reset throws, but the scroll phase is best-effort and must not fail an
    // otherwise-complete capture (mirrors the stitched-screenshot cleanup).
    await wc.executeJavaScript(scrollResetScript(priorOverflow), true).catch(() => {})
    await forceRenderPass(wc)
    await sleep(SCROLL_PAUSE_MS)
  }
}

// Max content height captured with one captureBeyondViewport shot. Beyond-
// viewport capture rasterizes the ENTIRE content surface at once regardless of
// clip — observed to hang for minutes on heavy pages past ~10k px (an infinite
// feed at the scroll cap). Above this, the stitched fallback below is used.
const MAX_SINGLE_SHOT_HEIGHT_PX = 8_000

async function captureFullPageScreenshot(wc: WebContents): Promise<Buffer> {
  const metrics = (await wc.debugger.sendCommand('Page.getLayoutMetrics')) as {
    cssContentSize?: { x: number; y: number; width: number; height: number }
  }

  // cssContentSize is the CSS-pixel content bounds captureScreenshot's clip
  // expects. The deprecated device-pixel contentSize would mis-scale on non-1 DPR
  // pages, so on the rare page that omits cssContentSize fall back to the known
  // viewport bounds. Capturing with no clip at all would bypass the MAX_CAPTURE_*
  // caps below and risk exceeding GPU texture limits on a large page.
  const contentSize = metrics.cssContentSize ?? { x: 0, y: 0, ...VIEWPORT }

  // getLayoutMetrics can omit dimensions on some pages; coalesce so a missing
  // field yields a valid 1px clip rather than NaN (which fails captureScreenshot).
  const width = Math.max(1, Math.ceil(contentSize.width ?? 0))
  const fullHeight = Math.max(1, Math.ceil(contentSize.height ?? 0))
  // Downscale so the output width fits the texture ceiling, and cap the
  // captured height so the total bitmap stays bounded — scroll discovery grows
  // infinite feeds up to MAX_SCROLL_CONTENT_HEIGHT_PX. The screenshot is
  // truncated at the cap; the MHTML and extracted text keep everything.
  const scale = Math.min(1, MAX_CAPTURE_DIMENSION_PX / width)
  const height = Math.min(
    fullHeight,
    MAX_CAPTURE_DIMENSION_PX,
    Math.max(1, Math.floor(MAX_CAPTURE_PIXELS / (width * scale * scale)))
  )

  // Artifact-free path: one beyond-viewport shot of the whole content box.
  if (height <= MAX_SINGLE_SHOT_HEIGHT_PX) {
    const { data } = (await wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, contentSize.x || 0),
        y: Math.max(0, contentSize.y || 0),
        width,
        height,
        scale
      }
    })) as { data: string }
    return Buffer.from(data, 'base64')
  }

  return captureStitchedScreenshot(wc, { width, height, scale })
}

// Tall-page fallback: scroll the root viewport-by-viewport, capture each
// visible viewport (an ordinary surface shot — cheap at any page height), and
// composite the strips. Position: fixed/sticky chrome repeats at the seams —
// the accepted trade-off for pages whose full surface Chromium can't
// rasterize in one pass. Reuses the scroll-lock lift so locked pages don't
// stitch thirty copies of their top viewport; the lock is restored before the
// MHTML is saved.
export async function captureStitchedScreenshot(
  wc: WebContents,
  dims: { width: number; height: number; scale: number }
): Promise<Buffer> {
  // Each strip depicts the viewport's CSS width, not the content width — a
  // page with horizontal overflow renders only its leftmost VIEWPORT.width px.
  // Sizing the canvas (and the strip resize below) from the content width
  // would stretch each strip's height by width/VIEWPORT.width while `top`
  // spacing stays viewport-based, overpainting every seam.
  const outputWidth = Math.max(1, Math.round(VIEWPORT.width * dims.scale))
  const outputHeight = Math.max(1, Math.round(dims.height * dims.scale))

  const captureViewport = async (): Promise<Buffer> => {
    const { data } = (await wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    })) as { data: string }
    return Buffer.from(data, 'base64')
  }

  const priorOverflow = (await wc.executeJavaScript(SCROLL_UNLOCK_SCRIPT, true)) as
    | string[]
    | null
  const shots: Array<{ png: Buffer; cssY: number }> = []
  try {
    let targetY = 0
    while (targetY < dims.height) {
      const state = (await wc.executeJavaScript(scrollToOffsetScript(targetY), true)) as {
        y: number
        viewportHeight: number
      } | null
      if (!state) break
      shots.push({ png: await captureViewport(), cssY: state.y })
      if (state.y + state.viewportHeight >= dims.height) break
      // Root clamped short of the target — no further progress is possible.
      if (state.y + 1 < targetY) break
      targetY = state.y + state.viewportHeight
    }
  } finally {
    await wc.executeJavaScript(scrollResetScript(priorOverflow), true).catch(() => {})
  }

  if (shots.length === 0) return captureViewport()

  const composites = await Promise.all(
    shots.map(async (shot) => {
      // Normalize each strip to the output width (also folds away the display
      // scale factor baked into viewport surface shots), then crop anything
      // hanging past the canvas bottom so composite() accepts it.
      let strip = sharp(shot.png).resize({ width: outputWidth })
      const top = Math.min(Math.round(shot.cssY * dims.scale), outputHeight - 1)
      const meta = await strip.png().toBuffer()
      const stripHeight = (await sharp(meta).metadata()).height ?? 1
      if (top + stripHeight > outputHeight) {
        strip = sharp(meta).extract({
          left: 0,
          top: 0,
          width: outputWidth,
          height: Math.max(1, outputHeight - top)
        })
        return { input: await strip.png().toBuffer(), left: 0, top }
      }
      return { input: meta, left: 0, top }
    })
  )

  return sharp({
    create: {
      width: outputWidth,
      height: outputHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite(composites)
    .png()
    .toBuffer()
}

// Renders a URL in a locked-down, invisible BrowserWindow with a fresh
// in-memory session (no persist: prefix = nothing touches disk, nothing is
// shared with the app or previous jobs). A hostile page runs in our process,
// so: sandboxed, isolated, no node, every permission denied, popups denied,
// window destroyed in finally. The only preload is the consent blocker's
// isolated cosmetic-filter bridge (see below).
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
  // Captured up front: cleanup can run after win.destroy() (the timeout path),
  // when wc.session would throw — but the partition session object outlives the
  // window and the blocker/webRequest teardown still needs it.
  const session = wc.session
  let networkTracker: NetworkIdleTracker | undefined
  let blocker: ElectronBlocker | null = null

  // Step-level idempotent teardown — NOT a single once-guard. Both the inner
  // finally and the outer timeout path invoke this, and the blocker may only be
  // enabled AFTER the timeout already ran cleanup (render() is still awaiting
  // getConsentBlocker() when the deadline fires). A single guard would skip the
  // blocker teardown in that race and leak its global ipcMain handlers, wedging
  // the next recapture job. Each release re-checks its own state instead, and is
  // wrapped so a post-destroy call can't throw out of cleanup.
  const cleanup = () => {
    try {
      // Must be released per-job: enable() registers global ipcMain handlers
      // that throw if a later job's session enables them while still registered.
      if (blocker?.isBlockingEnabled(session)) blocker.disableBlockingInSession(session)
    } catch (err) {
      console.error('backgroundRenderer: disabling consent blocker failed', err)
    }
    try {
      networkTracker?.dispose()
    } catch {
      // Session already torn down with the window — listeners went with it.
    }
    networkTracker = undefined
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach()
    } catch {
      // webContents already destroyed — its debugger went with it.
    }
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

    // Neutralize consent/cookie-notice overlays before the page loads: the fresh
    // session guarantees every consent wall fires, and walls scroll-lock the page
    // (starving the lazy-load phase) and obscure the screenshot. Fail-soft — a
    // capture without suppression beats no capture. Enabled before the idle
    // tracker so blocked requests never register as pending. Note this DOES add
    // the blocker's isolated preload to this otherwise preload-free window; it
    // only bridges cosmetic-filter lookups over IPC and exposes nothing to the
    // page (contextIsolation holds).
    let consentSuppression: ConsentSuppression | undefined
    blocker = await getConsentBlocker()
    if (blocker) {
      try {
        blocker.enableBlockingInSession(session)
        consentSuppression = 'filter-list'
      } catch (err) {
        console.error('backgroundRenderer: enabling consent blocker failed', err)
      }
    }

    networkTracker = createNetworkIdleTracker(session)

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

      // Whole-page screenshot: one beyond-viewport shot when the page is short
      // enough to rasterize in one pass, stitched viewport strips otherwise.
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
        consentSuppression,
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
