import { BrowserWindow, app } from 'electron'
import type { WebContents, Session } from 'electron'
import type { ElectronBlocker } from '@ghostery/adblocker-electron'
import sharp from 'sharp'
import { createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getConsentBlocker } from '@main/services/consentBlocker'
import { captureEgressOf, knownEgress, proxyConfigFor } from '@main/services/egress'
import { RefusedAddressError, refusedAddressClass } from '@main/services/localAddressPolicy'
import { testCertificateAllowance } from '@main/services/testCertificateAllowance'
import {
  createTransactionRecorder,
  finishTransactionRecord
} from '@main/services/transactionRecorder'
import type {
  TransactionRecordOutcome,
  TransactionRecorder
} from '@main/services/transactionRecorder'
import type { RenderPage, RenderedPage, ScreenshotRecord } from '@main/services/recapture'
import type { ScrollToLoadRecord } from '@shared/schemas'
import type { ConsentSuppression, KnownEgress, ScrollToLoadOutcome } from '@shared/types'
import { logger } from '@main/services/logger'

const VIEWPORT = { width: 1280, height: 900 }
const NETWORK_IDLE_MS = 1200
const INITIAL_NETWORK_IDLE_MAX_MS = 10_000
const POST_SCROLL_NETWORK_IDLE_MAX_MS = 15_000
const SCROLL_PAUSE_MS = 500
const SCROLL_STALL_THRESHOLD = 3
const MAX_SCROLL_PHASE_MS = 75_000
const FINAL_SETTLE_MS = 500
// For screenshot + MHTML + text extraction. Sized for the worst case the scroll
// cap below allows — a page at the full screenshot pixel budget — so the
// artifact phase can't be starved into the outer deadline.
const ARTIFACT_PHASE_MS = 20_000
// The Transaction Record's two end phases, each under its own bound (step 9 of
// docs/plans/2026-10-10-capture-engine-first-slice.md, "Time"): the body
// fetches still out when collection stops, and the writer. A phase that runs
// out records the Transaction Record absent as `failed` and the Capture stores.
const BODY_COLLECT_TIMEOUT_MS = 5_000
const RECORD_WRITE_TIMEOUT_MS = 10_000
// Reserved at the end of the render, so the phases before it can't starve the
// artifacts and the Transaction Record into the outer deadline.
const FINAL_ARTIFACT_RESERVE_MS =
  ARTIFACT_PHASE_MS + BODY_COLLECT_TIMEOUT_MS + RECORD_WRITE_TIMEOUT_MS
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
// CDP Network domain. #180 added it on the reading that enabling a CDP event
// domain from webContents.debugger evicts Playwright's own session in E2E; the
// renderer spike (docs/specs/2026-10-11-capture-engine-renderer-spike.md,
// question 1) found both Recapture specs passing with Network enabled, and the
// Transaction Record now enables it. Idle tracking stays here, apart from it.
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
  // A root already scrolled to its end moves only up, so the probe tries both
  // ways. Probing down alone reads the bottom of a page as nothing to scroll,
  // which ends the loop before the stall detector can.
  const canScroll = (el) => {
    if (!el || el.scrollHeight <= el.clientHeight + 2) return false
    const prev = el.scrollTop
    setScrollTop(el, prev + 1)
    let moved = el.scrollTop !== prev
    if (!moved && prev > 0) {
      setScrollTop(el, prev - 1)
      moved = el.scrollTop !== prev
    }
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

// A height the page reports goes into the signed entry, whose schema admits only
// a non-negative integer. The step script runs in the page's world, where a
// hostile page can redefine `scrollHeight`, so any other value is not recorded.
function recordableHeight(height: unknown): number | undefined {
  return typeof height === 'number' && Number.isSafeInteger(height) && height >= 0
    ? height
    : undefined
}

// Scrolls through the complete document (main-process-driven loop) to trigger
// lazy-loaded/infinite-scroll content before the artifacts are captured. The
// scroll lock lifted by SCROLL_UNLOCK_SCRIPT is always restored — before the
// screenshot and MHTML are taken, so they reflect what the page actually set.
// Returns where the loop ended (D5 of
// docs/plans/2026-10-10-capture-engine-first-slice.md). A step that throws
// fails the render, so no record says the phase failed.
export async function scrollToLoadLazyContent(
  wc: WebContents,
  timeoutMs: number
): Promise<ScrollToLoadRecord> {
  if (timeoutMs <= 0) return { requested: true, ran: false, scrollLockLifted: false }
  const deadlineAt = Date.now() + timeoutMs

  const priorOverflow = (await wc.executeJavaScript(SCROLL_UNLOCK_SCRIPT, true)) as string[] | null
  let outcome: ScrollToLoadOutcome = 'time-budget'
  let endHeight: number | undefined

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
      if (!state) {
        outcome = 'nothing-to-scroll'
        break
      }
      endHeight = recordableHeight(state.height)
      if (state.height >= MAX_SCROLL_CONTENT_HEIGHT_PX) {
        outcome = 'height-cap'
        break
      }

      // OSR composites continuously, so IntersectionObserver/rAF-driven lazy
      // loaders fire on their own between scroll steps — no forced frame needed.
      await sleep(SCROLL_PAUSE_MS)

      const atBottom = state.y + state.viewportHeight >= state.height - 2
      const noHeightGrowth = state.height <= lastHeight
      const noScrollProgress = state.y <= lastY + 1

      if ((atBottom && noHeightGrowth) || (noHeightGrowth && noScrollProgress)) {
        stalls += 1
        if (stalls >= SCROLL_STALL_THRESHOLD) {
          outcome = 'stopped-growing'
          break
        }
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
    // otherwise-complete capture.
    await wc.executeJavaScript(scrollResetScript(priorOverflow), true).catch(() => {})
    await sleep(SCROLL_PAUSE_MS)
  }

  return {
    requested: true,
    ran: true,
    outcome,
    ...(endHeight !== undefined ? { endHeight } : {}),
    scrollLockLifted: priorOverflow !== null
  }
}

// The pixel dimensions a PNG states in its IHDR chunk, which the format puts
// first, straight after the 8-byte signature.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngDimensions(png: Buffer): { width: number; height: number } {
  if (
    png.length < 24 ||
    !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('The screenshot is not a PNG')
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

// Returns the stored PNG with the D6 facts about it
// (docs/plans/2026-10-10-capture-engine-first-slice.md).
export async function captureFullPageScreenshot(
  wc: WebContents
): Promise<{ png: Buffer; record: ScreenshotRecord }> {
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

  // One beyond-viewport shot of the whole content box. This rasterizes the
  // entire content surface in one pass, which hung for minutes on tall pages
  // in the pre-OSR hidden window (never composited) — with OSR compositing
  // continuously it completes in ~1s even at the MAX_CAPTURE_* caps, so no
  // stitched-strip fallback is needed.
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

  const { png, trimmed } = await trimTrailingBackground(Buffer.from(data, 'base64'))
  const stored = pngDimensions(png)
  return {
    png,
    record: {
      scaled: scale < 1,
      truncated: height < fullHeight,
      trimmed,
      contentWidth: width,
      contentHeight: fullHeight,
      width: stored.width,
      height: stored.height
    }
  }
}

// The screenshot clips to the full document height, but ad/embed-heavy and
// lazy-recirculation pages reserve tall containers that never fill in the clean
// background session — leaving the capture with a large band of trailing
// whitespace below the real content (often >75% of a news article's height).
// Scan the captured screenshot from the bottom up and crop off the run of
// trailing rows that are uniformly the page's background colour (sampled from
// the bottom edge, so it adapts to white/grey/dark). Only trailing whitespace —
// below the last row with content — is removed; interior gaps are preserved,
// and a page that fills to its footer (or is all one colour) is left untouched.
// Cosmetic-only and fail-soft: any error returns the original screenshot.
// `trimmed` says whether the returned image is a crop of the input.
const TRIM_TOLERANCE = 8
const TRIM_PADDING_PX = 8

export async function trimTrailingBackground(
  png: Buffer
): Promise<{ png: Buffer; trimmed: boolean }> {
  const untouched = { png, trimmed: false }
  try {
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
    const w = info.width
    const h = info.height
    if (!w || !h) return untouched

    const bg = data[(h - 1) * w + (w >> 1)]
    // A row counts as content when more than this many pixels differ from the
    // background — high enough to ignore JPEG/anti-alias speckle, low enough to
    // keep a thin divider rule or a short line of text.
    const minContentPx = Math.max(4, Math.round(w * 0.004))

    let lastContentRow = -1
    for (let y = h - 1; y >= 0; y--) {
      let diff = 0
      const base = y * w
      for (let x = 0; x < w; x++) {
        if (Math.abs(data[base + x] - bg) > TRIM_TOLERANCE && ++diff > minContentPx) break
      }
      if (diff > minContentPx) {
        lastContentRow = y
        break
      }
    }

    // Entirely background (blank capture) or nothing to trim: leave as-is.
    if (lastContentRow < 0) return untouched
    const cropHeight = Math.min(h, lastContentRow + 1 + TRIM_PADDING_PX)
    if (cropHeight >= h) return untouched

    const cropped = await sharp(png)
      .extract({ left: 0, top: 0, width: w, height: cropHeight })
      .png()
      .toBuffer()
    return { png: cropped, trimmed: true }
  } catch (err) {
    logger.error('backgroundRenderer', 'backgroundRenderer.trim_failed', undefined, err)
    return untouched
  }
}

// A load that failed at the proxy names the proxy, so the Operator can tell a
// stopped Tor from an unreachable site. Chromium reports those failures as
// ERR_PROXY_*, ERR_SOCKS_*, ERR_TUNNEL_* or ERR_NO_SUPPORTED_PROXIES. The address
// appears only in the failure message, never in a stored Capture.
function proxyFailure(err: unknown, egress: KnownEgress): Error | null {
  if (egress.kind === 'direct') return null
  const message = err instanceof Error ? err.message : String(err)
  if (!/ERR_(PROXY_|SOCKS_|TUNNEL_|NO_SUPPORTED_PROXIES)/.test(message)) return null
  return new Error(`Could not go through the Egress proxy ${egress.proxyUrl}: ${message}`)
}

// Renders a URL in a locked-down, invisible BrowserWindow with a fresh
// in-memory session (no persist: prefix = nothing touches disk, nothing is
// shared with the app or previous jobs). A hostile page runs in our process,
// so: sandboxed, isolated, no node, every permission denied, popups denied,
// window destroyed in finally. The only preload is the consent blocker's
// isolated cosmetic-filter bridge (see below).
export const renderPageInHiddenWindow: RenderPage = async (
  url,
  { timeoutMs, captureId, toolVersion }
) => {
  // An Egress that could not be read sends nothing, so no window is made (ADR-0032).
  const egress = knownEgress()

  // Offscreen rendering (OSR), NOT a plain show:false window. A hidden window
  // never composites, so JS/SPA sites (CNN, most news) never lay out or hydrate,
  // and IntersectionObserver/requestAnimationFrame never fire — lazy content
  // stays unloaded. OSR runs the compositor to an offscreen surface: the page
  // renders and IO/rAF fire naturally, while nothing is ever shown on screen
  // (silent background preserved). This also removed the per-scroll-step forced
  // CDP screenshot, which rasterized the whole surface (~6.5s/call on heavy
  // pages) and blew the recapture budget on ad-heavy sites.
  const win = new BrowserWindow({
    show: false,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `recapture-${randomUUID()}`,
      backgroundThrottling: false,
      offscreen: true
    }
  })
  win.webContents.setFrameRate(30)

  const tmpPath = join(app.getPath('temp'), `birdbrain-recapture-${randomUUID()}.mhtml`)

  let deadlineTimer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(
      () => reject(new Error(`Recapture timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  })

  // A public page can send the render to the Operator's own machine or network by a
  // server redirect or by navigating itself (#1726). Chromium asks before each main-frame
  // hop; a refused hop is stopped before any request goes to the address, and ends the
  // render the way the deadline does, so nothing from it is rendered or stored.
  let refuseHop: (err: RefusedAddressError) => void = () => {}
  const refused = new Promise<never>((_, reject) => {
    refuseHop = reject
  })
  const checkHop = (details: { url: string; isMainFrame: boolean; preventDefault: () => void }) => {
    if (!details.isMainFrame) return
    const addressClass = refusedAddressClass(details.url)
    if (!addressClass) return
    details.preventDefault()
    refuseHop(new RefusedAddressError(addressClass))
  }

  const wc = win.webContents
  // Captured up front: cleanup can run after win.destroy() (the timeout path),
  // when wc.session would throw — but the partition session object outlives the
  // window and the blocker/webRequest teardown still needs it.
  const session = wc.session
  let networkTracker: NetworkIdleTracker | undefined
  let blocker: ElectronBlocker | null = null
  let recorder: TransactionRecorder | undefined

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
      logger.error(
        'backgroundRenderer',
        'backgroundRenderer.consent_blocker_disable_failed',
        undefined,
        err
      )
    }
    try {
      networkTracker?.dispose()
    } catch {
      // Session already torn down with the window — listeners went with it.
    }
    networkTracker = undefined
    recorder?.dispose()
    recorder = undefined
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach()
    } catch {
      // webContents already destroyed — its debugger went with it.
    }
  }

  async function render(): Promise<RenderedPage> {
    // The Egress goes on the partition before anything loads (ADR-0032): every
    // request of the render, the first included, leaves through the proxy or fails.
    // WebRTC may then use UDP only through it. Direct leaves the session as it was.
    if (egress.kind !== 'direct') {
      await session.setProxy(proxyConfigFor(egress))
      wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    }

    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    // Without a check handler, permission checks (Notification.permission,
    // navigator.permissions.query) report `granted` while every request above is
    // refused; denying checks makes the page see the policy the render enforces.
    wc.session.setPermissionCheckHandler(() => false)
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.setAudioMuted(true)
    // Test-only: a build that reads the switch accepts the e2e fixture's TLS
    // leaf. A packaged build installs nothing here.
    const certificateAllowance = testCertificateAllowance()
    if (certificateAllowance) session.setCertificateVerifyProc(certificateAllowance)

    const startedAt = Date.now()
    const remainingMs = (reserveMs = 0) =>
      Math.max(0, timeoutMs - (Date.now() - startedAt) - reserveMs)

    wc.on('will-redirect', checkHop)
    wc.on('will-navigate', checkHop)

    let httpStatus = 0
    wc.on('did-navigate', (_event, _navUrl, httpResponseCode) => {
      httpStatus = httpResponseCode
    })

    // The debugger is attached for the whole render, and its Network domain
    // records the Transaction Record. Network idle is still tracked on the
    // session's webRequest API.
    wc.debugger.attach('1.3')

    // `Network.enable` gets no answer on a window that has not navigated, so a
    // blank page loads first (probe spike). The page then reads one more
    // `history.length` entry than a direct load gives it, a known limitation
    // (renderer spike, question 7).
    recorder = createTransactionRecorder(wc.debugger)
    const activeRecorder = recorder
    await wc.loadURL('about:blank')
    const recording = await activeRecorder.start()

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
        logger.error(
          'backgroundRenderer',
          'backgroundRenderer.consent_blocker_enable_failed',
          undefined,
          err
        )
      }
    }

    networkTracker = createNetworkIdleTracker(session)

    try {
      try {
        await wc.loadURL(url)
      } catch (err) {
        throw proxyFailure(err, egress) ?? err
      }
      await waitForDocumentComplete(wc, remainingMs(FINAL_ARTIFACT_RESERVE_MS))
      await networkTracker.waitForIdle(
        NETWORK_IDLE_MS,
        clampPhaseMs(remainingMs(FINAL_ARTIFACT_RESERVE_MS), INITIAL_NETWORK_IDLE_MAX_MS)
      )

      // Scroll through the complete document to trigger lazy-loaded/infinite-scroll
      // content before saving the MHTML. Unlike the original 30-viewport cap, this
      // runs until the page bottom is stable or the recapture budget is exhausted.
      const scrollToLoad = await scrollToLoadLazyContent(
        wc,
        clampPhaseMs(remainingMs(FINAL_ARTIFACT_RESERVE_MS), MAX_SCROLL_PHASE_MS)
      )
      await networkTracker.waitForIdle(
        NETWORK_IDLE_MS,
        clampPhaseMs(remainingMs(FINAL_ARTIFACT_RESERVE_MS), POST_SCROLL_NETWORK_IDLE_MAX_MS)
      )
      await sleep(Math.min(FINAL_SETTLE_MS, remainingMs(FINAL_ARTIFACT_RESERVE_MS)))

      // Collection stops at the moment the screenshot and MHTML are taken (spec,
      // Transaction Record). The renderer spike saw no request and no event during
      // either, so stopping here and after the save recorded the same events.
      activeRecorder.stop()
      const recordedAt = new Date().toISOString()
      const { png: screenshot, record: screenshotRecord } = await captureFullPageScreenshot(wc)

      await wc.savePage(tmpPath, 'MHTML')

      const text = (await wc.executeJavaScript(
        'document.body ? document.body.innerText : ""'
      )) as string

      const userAgent = wc.getUserAgent()
      const browserVersion = `Chrome/${process.versions.chrome}`
      const transactionRecord: TransactionRecordOutcome = recording
        ? await finishTransactionRecord(activeRecorder, {
            collectMs: BODY_COLLECT_TIMEOUT_MS,
            writeMs: RECORD_WRITE_TIMEOUT_MS,
            writer: {
              captureId,
              birdbrainVersion: toolVersion,
              browserVersion,
              userAgent,
              egress: egress.kind,
              date: recordedAt
            }
          })
        : {
            present: false,
            reason: 'failed',
            error: new Error('Network.enable failed or did not answer on the page')
          }
      if (!transactionRecord.present) {
        logger.error(
          'backgroundRenderer',
          'backgroundRenderer.transaction_record_failed',
          undefined,
          transactionRecord.error
        )
      }

      return {
        mhtmlStream: createReadStream(tmpPath) as unknown as AsyncIterable<Uint8Array>,
        screenshot,
        screenshotRecord,
        scrollToLoad,
        text,
        title: wc.getTitle(),
        finalUrl: wc.getURL(),
        httpStatus,
        userAgent,
        browserVersion,
        consentSuppression,
        transactionRecord,
        egress: captureEgressOf(egress),
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
    return await Promise.race([rendering, deadline, refused])
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
