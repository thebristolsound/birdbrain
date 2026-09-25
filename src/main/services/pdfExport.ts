import { app, BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { pathToFileURL } from 'url'
import type { Capture } from '@shared/types'
import { recordedHttpStatus } from '@shared/httpStatus'
import type { TrustedTimeResult } from '@shared/verify/trustedTime'
import {
  TRUSTED_TIME_UNRECORDED_STAMPED_AT,
  trustedTimeAttestingParty,
  trustedTimeLabel
} from '@shared/trustedTimeDisclosure'

// Total budget for load + inject + print. MHTML resources are all local so the
// load itself is fast; the margin covers legacy .html captures that still fetch
// remote subresources.
const RENDER_TIMEOUT_MS = 45_000
// Brief settle after the cover injection so layout is final before printing.
const POST_INJECT_SETTLE_MS = 300
// Desktop-typical render width (FireShot captures at the live browser window,
// almost always ~1920). Wider than the 1280 capture viewport on purpose: less
// line-wrapping keeps very long pages shorter, which matters because the whole
// document must fit under the 200-inch PDF page ceiling after scaling.
const RENDER_WIDTH_PX = 1920
const RENDER_HEIGHT_PX = 1080
const CSS_PX_PER_INCH = 96
// PDF (and Acrobat) cap page dimensions at 200×200 inches. Content taller than
// that paginates into successive full-height pages instead of being scaled.
const MAX_PAGE_INCHES = 200
// FireShot-parity: output is scaled to fit A4 paper width (its PDFs are 595pt
// wide regardless of capture width). Besides matching the client's expected
// look, the downscale packs ~1.6× more content under the 200-inch page ceiling,
// which keeps very long pages (30k+ px) on a single continuous page.
const PAGE_WIDTH_INCHES = 8.27
// Chromium's Page.printToPDF accepts scale in [0.1, 2].
const MIN_PRINT_SCALE = 0.1
const MAX_PRINT_SCALE = 2
// The trusted-time row leads with the shared axis label (report.html renders
// the same one), then adds this artifact's own one-line explanation. Only the
// label and the token-fallback phrases are shared; the explanation deliberately
// is not, so this comment claims no more than that. 'none' is the honest floor
// — genuinely unstamped and absent-from-the-manifest are indistinguishable from
// the manifest alone, and both mean the printed capture time is the operator's
// local clock — so it is stated, never omitted.
// Never "a token was requested": the manifest records tokens, not requests, and
// an installation can decline trusted timestamping outright (#1169), in which
// case no request was made for any capture it holds.
const TRUSTED_TIME_PENDING_DETAIL =
  'no RFC 3161 token is recorded for this capture, and the manifest does not state whether ' +
  'one was requested'
const TRUSTED_TIME_NONE_DETAIL = 'no RFC 3161 token is retained for this capture'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toISOString()} (${date.toLocaleString()})`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Renders the manifest-resolved trusted-time axis as one plain-string row value.
function formatTrustedTime(resolved: TrustedTimeResult): string {
  const label = trustedTimeLabel(resolved)
  switch (resolved.trustedTime) {
    case 'rfc3161': {
      const who = trustedTimeAttestingParty(resolved)
      const when = resolved.stampedAt
        ? formatTimestamp(resolved.stampedAt)
        : TRUSTED_TIME_UNRECORDED_STAMPED_AT
      return `${label}: ${who} asserts the capture digest existed no later than ${when}`
    }
    case 'pending':
      return `${label}: ${TRUSTED_TIME_PENDING_DETAIL}`
    case 'none':
    default:
      return `${label}: ${TRUSTED_TIME_NONE_DETAIL}`
  }
}

// Label/value pairs for the cover page, in display order. Values are plain
// strings — the injection script renders them via textContent, so a hostile
// page title can't smuggle markup into the cover.
//
// `trustedTime` is resolved from the case manifest by the caller and passed in.
// The captures.trustedTimeStatus mirror is deliberately NOT read here: it is
// rebuildable convenience state that can disagree with the tokens actually
// retained, and this PDF is designed to leave the machine (#509).
export function buildPdfMetadataRows(
  capture: Capture,
  trustedTime: TrustedTimeResult
): [string, string][] {
  const rows: [string, string][] = []
  const add = (label: string, value: string | number | undefined | null): void => {
    if (value === undefined || value === null || value === '') return
    rows.push([label, String(value)])
  }

  add('Title', capture.title)
  add('URL', capture.url)
  add('Captured at', formatTimestamp(capture.timestamp))
  add('Capture ID', capture.id)
  add('Case ID', capture.caseId)
  add('Format', capture.format === 'mhtml' ? 'MHTML archive' : 'HTML page')
  add('Method', capture.method)
  add('HTTP status', recordedHttpStatus(capture.httpStatus))
  add('SHA-256', capture.hash)
  add('Size', capture.sizeBytes !== undefined ? formatBytes(capture.sizeBytes) : undefined)
  add('Browser', capture.browserVersion)
  add('User agent', capture.userAgent)
  add(
    'Operator',
    capture.operatorName && capture.operatorId
      ? `${capture.operatorName} (${capture.operatorId})`
      : capture.operatorName || capture.operatorId
  )
  add('Tool version', capture.toolVersion)
  add('Extension version', capture.extensionVersion)
  if (capture.lastVerifiedStatus) {
    add(
      'Verification',
      capture.lastVerifiedAt
        ? `${capture.lastVerifiedStatus} at ${formatTimestamp(capture.lastVerifiedAt)}`
        : capture.lastVerifiedStatus
    )
  }
  add('Trusted time', formatTrustedTime(trustedTime))
  add('PDF exported at', formatTimestamp(new Date().toISOString()))
  return rows
}

// Builds the metadata-header injection script. Everything is inline-styled so
// the captured page's own CSS can't restyle the header, and every value lands
// via textContent (never innerHTML). The PDF is a single continuous page
// (FireShot-style), so the header sits at the very top of it rather than on a
// separate cover sheet — no forced page break.
function coverInjectionScript(rows: [string, string][]): string {
  return `(() => {
    const rows = ${JSON.stringify(rows)}
    const doc = document
    const cover = doc.createElement('div')
    cover.id = 'birdbrain-pdf-cover'
    cover.setAttribute('style', [
      'all: initial',
      'display: block',
      'box-sizing: border-box',
      'width: 100%',
      'padding: 24px 24px 28px',
      'font-family: Arial, Helvetica, sans-serif',
      'color: #111',
      'background: #fff',
      'border-bottom: 2px solid #111',
      'margin-bottom: 16px'
    ].join('; '))

    const heading = doc.createElement('div')
    heading.setAttribute('style',
      'all: initial; display: block; font-family: Arial, Helvetica, sans-serif; ' +
      'font-size: 32px; font-weight: bold; color: #111; margin-bottom: 3px')
    heading.textContent = 'Capture Report'
    cover.appendChild(heading)

    const rule = doc.createElement('div')
    rule.setAttribute('style',
      'all: initial; display: block; height: 3px; background: #111; margin: 12px 0 20px')
    cover.appendChild(rule)

    for (const [label, value] of rows) {
      const row = doc.createElement('div')
      row.setAttribute('style',
        'all: initial; display: block; margin-bottom: 10px; ' +
        'font-family: Arial, Helvetica, sans-serif')
      const labelEl = doc.createElement('div')
      labelEl.setAttribute('style',
        'all: initial; display: block; font-family: Arial, Helvetica, sans-serif; ' +
        'font-size: 14px; font-weight: bold; color: #666; text-transform: uppercase; ' +
        'letter-spacing: 0.8px')
      labelEl.textContent = label
      const valueEl = doc.createElement('div')
      valueEl.setAttribute('style',
        'all: initial; display: block; font-family: Arial, Helvetica, sans-serif; ' +
        'font-size: 19px; color: #111; overflow-wrap: anywhere; line-height: 1.35')
      valueEl.textContent = value
      row.appendChild(labelEl)
      row.appendChild(valueEl)
      cover.appendChild(row)
    }

    const target = doc.body || doc.documentElement
    target.insertBefore(cover, target.firstChild)
    return true
  })()`
}

// The export window is created once and REUSED for every PDF job, never
// destroyed between jobs. This is deliberate: destroying a window that hosted
// an MHTML document poisons the next MHTML load in a fresh window (ERR_FAILED,
// sometimes a hard renderer crash — reproduced on Electron 39/Windows), while
// repeated loads in the same window work reliably. The window sits on
// about:blank between jobs, and closes itself when the last real app window
// goes away so it can't hold up window-all-closed quit or confuse macOS
// activate.
let sharedWin: BrowserWindow | null = null
let lifecycleHooked = false
const hookedWindows = new WeakSet<BrowserWindow>()
// PDF jobs share one window, so they must run one at a time.
let jobChain: Promise<unknown> = Promise.resolve()

// When the last real app window closes, the hidden export window must go too —
// otherwise it keeps window-all-closed from ever firing (blocking quit on
// Windows/Linux) and makes macOS activate think a window still exists.
function hookWindowClosed(win: BrowserWindow): void {
  if (win === sharedWin || hookedWindows.has(win)) return
  hookedWindows.add(win)
  win.on('closed', () => {
    // Deferred so getAllWindows() reflects the removal of the closing window.
    setImmediate(() => {
      if (!sharedWin || sharedWin.isDestroyed()) return
      const others = BrowserWindow.getAllWindows().filter((w) => w !== sharedWin)
      if (others.length === 0) {
        const doomed = sharedWin
        sharedWin = null
        doomed.destroy()
      }
    })
  })
}

function getExportWindow(): BrowserWindow {
  if (sharedWin && !sharedWin.isDestroyed()) return sharedWin

  const win = new BrowserWindow({
    show: false,
    width: RENDER_WIDTH_PX,
    height: RENDER_HEIGHT_PX,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // In-memory session (no persist: prefix); shared across jobs because the
      // session is fixed at webContents creation and the window is reused.
      partition: 'pdf-export',
      backgroundThrottling: false
    }
  })
  const wc = win.webContents
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.setAudioMuted(true)
  sharedWin = win

  if (!lifecycleHooked) {
    lifecycleHooked = true
    app.on('browser-window-created', (_event, created) => hookWindowClosed(created))
  }
  for (const existing of BrowserWindow.getAllWindows()) hookWindowClosed(existing)

  return win
}

async function runPdfJob(
  capture: Capture,
  artifactAbsPath: string,
  trustedTime: TrustedTimeResult
): Promise<Buffer> {
  const win = getExportWindow()
  const wc: WebContents = win.webContents

  let deadlineTimer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(
      () => reject(new Error(`PDF export timed out after ${RENDER_TIMEOUT_MS}ms`)),
      RENDER_TIMEOUT_MS
    )
  })

  async function render(): Promise<Buffer> {
    await wc.loadURL(pathToFileURL(artifactAbsPath).toString())

    // Chromium loads MHTML documents with page scripting disabled, which also
    // blocks webContents.executeJavaScript. DevTools-protocol evaluation is
    // exempt (same mechanism the DevTools console uses on saved pages), so the
    // cover is injected via CDP for both formats.
    wc.debugger.attach('1.3')
    const evaluated = (await wc.debugger.sendCommand('Runtime.evaluate', {
      expression: coverInjectionScript(buildPdfMetadataRows(capture, trustedTime)),
      returnByValue: true
    })) as { exceptionDetails?: { text?: string; exception?: { description?: string } } }
    if (evaluated.exceptionDetails) {
      const detail =
        evaluated.exceptionDetails.exception?.description ??
        evaluated.exceptionDetails.text ??
        'unknown error'
      throw new Error(`PDF cover injection failed: ${detail}`)
    }

    await sleep(POST_INJECT_SETTLE_MS)

    // FireShot-style output: render with SCREEN styles (not print stylesheets,
    // which many sites use to strip or reflow content) onto one continuous PDF
    // page sized to the full document, so nothing is chopped by Letter-size
    // pagination. The emulated media persists through Chromium's print pipeline
    // (same trick as Puppeteer's emulateMediaType('screen') + pdf()).
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'screen' })

    const metrics = (await wc.debugger.sendCommand('Page.getLayoutMetrics')) as {
      cssContentSize?: { width: number; height: number }
    }
    const contentWidthPx = Math.max(
      RENDER_WIDTH_PX,
      Math.ceil(metrics.cssContentSize?.width ?? 0)
    )
    const contentHeightPx = Math.max(1, Math.ceil(metrics.cssContentSize?.height ?? 0))
    // Fit the full content width onto A4-width paper; height follows the same
    // scale (+0.1in slack so sub-pixel rounding can't spill a trailing page).
    const scale = Math.min(
      MAX_PRINT_SCALE,
      Math.max(MIN_PRINT_SCALE, PAGE_WIDTH_INCHES / (contentWidthPx / CSS_PX_PER_INCH))
    )
    const height = Math.min(
      MAX_PAGE_INCHES,
      (contentHeightPx / CSS_PX_PER_INCH) * scale + 0.1
    )

    return wc.printToPDF({
      printBackground: true,
      preferCSSPageSize: false,
      scale,
      pageSize: { width: PAGE_WIDTH_INCHES, height },
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
  }

  const rendering = render()
  try {
    return await Promise.race([rendering, deadline])
  } catch (err) {
    // Swallow the eventual settlement of a timed-out render so it can't become
    // an unhandled rejection; the loadURL below cancels its in-flight work.
    rendering.catch(() => {})
    throw err
  } finally {
    clearTimeout(deadlineTimer)
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach()
    } catch {
      // webContents already destroyed — its debugger went with it.
    }
    // Park on about:blank between jobs: releases the artifact file handle and
    // drops page content, and cancels a wedged in-flight load after a timeout.
    if (!wc.isDestroyed()) wc.loadURL('about:blank').catch(() => {})
  }
}

// Renders a capture artifact to a PDF buffer with a metadata cover page
// prepended. The artifact loads in a locked-down hidden window with the same
// hostile-page posture as the background renderer: sandboxed, isolated, no
// node, in-memory session, every permission and popup denied.
//
// `trustedTime` is required rather than defaulted: this module renders a Capture
// and imports nothing from @main/services, so the caller owns the manifest read
// and the compiler forbids a call site that silently skips it.
export function renderCapturePdf(
  capture: Capture,
  artifactAbsPath: string,
  trustedTime: TrustedTimeResult
): Promise<Buffer> {
  const run = jobChain.catch(() => {}).then(() => runPdfJob(capture, artifactAbsPath, trustedTime))
  jobChain = run.catch(() => {})
  return run
}
