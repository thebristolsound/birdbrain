import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { gunzipSync } from 'zlib'
import sharp from 'sharp'
import type { WebContents } from 'electron'
import { runInNewContext } from 'vm'
import {
  SCROLL_STEP_SCRIPT,
  captureFullPageScreenshot,
  renderPageInHiddenWindow,
  scrollToLoadLazyContent,
  trimTrailingBackground
} from '@main/services/backgroundRenderer'
import { logger } from '@main/services/logger'
import { ManifestEntrySchema, ScrollToLoadRecordSchema } from '@shared/schemas'
import { RefusedAddressError } from '@main/services/localAddressPolicy'
import { EgressUnavailableError } from '@main/services/egress'
import { E2E_TRUSTED_CERT_SWITCH } from '@main/services/testCertificateAllowance'
import { createRecaptureService, type PdfOutcome } from '@main/services/recapture'
import { createCaptureLifecycle, verifyCapture } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture } from '@main/services/db/captureRepo'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { MANIFEST_FILENAME, MAX_PDF_CONTENT_HEIGHT_PX, MAX_PDF_SIZE } from '@shared/constants'
import type { CaptureEvent, EgressSetting } from '@shared/types'

// Mutable harness the fake BrowserWindow/webContents read from, so each test can
// steer the render (network, scroll steps, load failure, consent blocker).
const ctl = vi.hoisted(() => ({
  pngBase64: '',
  loadUrlShouldReject: false,
  loadUrlShouldHang: false,
  blocker: null as unknown,
  lastWindow: null as FakeWindow | null,
  createdWindows: 0,
  // A navigation hop the fake load reports before it settles, as Chromium does for a
  // server redirect (`will-redirect`) or a page that navigates itself (`will-navigate`).
  hop: null as { event: string; url: string; isMainFrame: boolean } | null,
  lastHop: null as { preventDefault: ReturnType<typeof vi.fn> } | null,
  // The Egress the render reads at start, and the order of the session and load
  // calls, so a test can see the proxy go on before the first navigation.
  egress: { kind: 'direct' } as EgressSetting,
  loadUrlError: null as string | null,
  calls: [] as string[],
  // The Transaction Record half (step 9): every load and CDP command in order,
  // the commands that fail, whether a body fetch never answers, whether the
  // writer throws, and whether the build is packaged.
  order: [] as string[],
  failingCommands: new Set<string>(),
  bodyHangs: false,
  writerThrows: false,
  writerHangs: false,
  isPackaged: false,
  securityDetails: {
    protocol: 'TLS 1.3',
    keyExchange: '',
    keyExchangeGroup: 'X25519',
    cipher: 'AES_128_GCM',
    certificateId: 7,
    subjectName: 'example.test',
    sanList: ['example.test'],
    issuer: 'Birdbrain Test CA',
    validFrom: 1767225600,
    validTo: 1798761600,
    signedCertificateTimestampList: [],
    certificateTransparencyCompliance: 'unknown',
    encryptedClientHello: false
  },
  // An event the page sends while the screenshot is taken, after collection stops.
  lateEvent: false,
  // The PDF half (step 10): the content height the layout metrics report, what
  // `printToPDF` returns or whether it never settles or throws, the options it
  // was given, and a request the page starts while it prints, as the probe's
  // print-only image does.
  contentHeight: 100,
  pdfBytes: null as Buffer | null,
  printHangs: false,
  printThrows: false,
  printOptions: [] as unknown[],
  printEvent: false,
  // The page the window holds, and a navigation it makes after the save, once
  // the text is read: to another page, a reload of the same one, or an in-page
  // change of its address (the review of #2000, finding 2).
  currentUrl: 'https://example.test/final',
  currentTitle: 'Mock Title',
  navigateAfterSave: null as null | 'other-page' | 'reload' | 'in-page'
}))

type Handler = (...args: unknown[]) => void

interface FakeWindow {
  destroyed: boolean
  webContents: FakeWebContents
  isDestroyed(): boolean
  destroy(): void
}

type MessageListener = (event: unknown, method: string, params: unknown, sessionId: string) => void

interface FakeWebContents {
  handlers: Map<string, Handler>
  session: unknown
  debugger: {
    attached: boolean
    listeners: Set<MessageListener>
    attach(): void
    isAttached(): boolean
    detach(): void
    on(event: string, listener: MessageListener): void
    removeListener(event: string, listener: MessageListener): void
    emit(method: string, params: unknown): void
    sendCommand(cmd: string, params?: unknown, sessionId?: string): Promise<unknown>
  }
  setFrameRate(): void
  setWebRTCIPHandlingPolicy(policy: string): void
  setWindowOpenHandler(): void
  setAudioMuted(): void
  setPermissionRequestHandler(): void
  on(event: string, cb: Handler): void
  loadURL(url: string): Promise<void>
  executeJavaScript(script: string): Promise<unknown>
  savePage(path: string): Promise<void>
  printToPDF(options: unknown): Promise<Buffer>
  getTitle(): string
  getURL(): string
  getUserAgent(): string
  session_setPermissionRequestHandler?: unknown
}

// Defined via vi.hoisted so the class exists before the hoisted vi.mock factory
// below references it. It closes over `ctl` (also hoisted) for per-test steering.
const { MockBrowserWindow } = vi.hoisted(() => {
  const makeSession = () => ({
    webRequest: {
      onSendHeaders: vi.fn(),
      onCompleted: vi.fn(),
      onErrorOccurred: vi.fn()
    },
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setCertificateVerifyProc: vi.fn(() => {
      ctl.order.push('setCertificateVerifyProc')
    }),
    setProxy: vi.fn(async (config: unknown) => {
      ctl.calls.push(`setProxy ${JSON.stringify(config)}`)
    })
  })

  // The page's navigation after the save, as Chromium reports each kind: a
  // cross-document one emits `did-navigate`, an in-page one changes only the URL.
  const navigateAfterSave = (handlers: Map<string, Handler>): void => {
    if (ctl.navigateAfterSave === 'other-page') {
      ctl.currentUrl = 'https://example.test/elsewhere'
      ctl.currentTitle = 'Elsewhere'
      handlers.get('did-navigate')?.({}, ctl.currentUrl, 404)
    } else if (ctl.navigateAfterSave === 'reload') {
      handlers.get('did-navigate')?.({}, ctl.currentUrl, 200)
    } else if (ctl.navigateAfterSave === 'in-page') {
      ctl.currentUrl = 'https://example.test/final#later'
    }
  }

  // One finished request on the page's own session; the https main document
  // carries the details Bound TLS Details are made from.
  const emitPage = (
    dbg: FakeWebContents['debugger'],
    requestId: string,
    url: string,
    type: string
  ): void => {
    dbg.emit('Network.requestWillBeSent', {
      requestId,
      wallTime: 1791751674.5,
      type,
      frameId: 'main-frame',
      request: { url, method: 'GET', headers: { Cookie: 'session=fixture-secret' } }
    })
    dbg.emit('Network.responseReceived', {
      requestId,
      response: {
        url,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html' },
        mimeType: 'text/html',
        protocol: 'h2',
        ...(url.startsWith('https:') ? { securityDetails: ctl.securityDetails } : {})
      }
    })
    dbg.emit('Network.dataReceived', { requestId, dataLength: 12 })
    dbg.emit('Network.loadingFinished', { requestId })
  }

  class MockBrowserWindow implements FakeWindow {
    destroyed = false
    webContents: FakeWebContents
    constructor() {
      ctl.createdWindows += 1
      const session = makeSession()
      const handlers = new Map<string, Handler>()
      this.webContents = {
        handlers,
        session,
        debugger: {
          attached: false,
          listeners: new Set<MessageListener>(),
          attach() {
            this.attached = true
          },
          isAttached() {
            return this.attached
          },
          detach() {
            this.attached = false
          },
          on(_event: string, listener: MessageListener) {
            this.listeners.add(listener)
          },
          removeListener(_event: string, listener: MessageListener) {
            this.listeners.delete(listener)
          },
          emit(method: string, params: unknown) {
            for (const listener of this.listeners) listener({}, method, params, '')
          },
          async sendCommand(cmd: string, params?: unknown) {
            ctl.order.push(cmd)
            if (ctl.failingCommands.has(cmd)) throw new Error(`${cmd} failed`)
            if (cmd === 'Page.getLayoutMetrics') {
              return { cssContentSize: { x: 0, y: 0, width: 100, height: ctl.contentHeight } }
            }
            if (cmd === 'Page.captureScreenshot') {
              if (ctl.lateEvent) emitPage(this, 'late', 'https://example.test/late.js', 'Script')
              return { data: ctl.pngBase64 }
            }
            if (cmd === 'Network.getResponseBody') {
              if (ctl.bodyHangs) return new Promise(() => {})
              const { requestId } = params as { requestId: string }
              return { body: `<p>${requestId}</p>`, base64Encoded: false }
            }
            return {}
          }
        },
        setFrameRate() {},
        setWebRTCIPHandlingPolicy(policy: string) {
          ctl.calls.push(`webrtc ${policy}`)
        },
        setWindowOpenHandler() {},
        setAudioMuted() {},
        setPermissionRequestHandler() {},
        on(event, cb) {
          handlers.set(event, cb)
        },
        async loadURL(url: string) {
          ctl.calls.push(`loadURL ${url}`)
          ctl.order.push(`loadURL ${url}`)
          if (url === 'about:blank') return
          if (ctl.loadUrlError) throw new Error(ctl.loadUrlError)
          if (ctl.loadUrlShouldReject) throw new Error('navigation failed')
          if (ctl.loadUrlShouldHang) return new Promise<void>(() => {})
          if (ctl.hop) {
            const details = { ...ctl.hop, preventDefault: vi.fn() }
            ctl.lastHop = details
            handlers.get(ctl.hop.event)?.(details)
            // A prevented hop aborts the load, as Chromium does.
            if (details.preventDefault.mock.calls.length > 0) throw new Error('ERR_ABORTED (-3)')
          }
          handlers.get('did-navigate')?.({}, url, 200)
          // The main document, as the debugger reports it once Network is enabled.
          emitPage(this.debugger, 'doc', url, 'Document')
        },
        async executeJavaScript(script: string) {
          if (script.includes('readyState')) return undefined
          if (script.includes("style.overflow = 'visible'")) return null
          if (script.includes('root.scrollTop + viewportHeight')) {
            // height at/above the scroll cap => the loop breaks after one step.
            return { y: 0, height: 25000, viewportHeight: 900 }
          }
          if (script.includes('window.scrollTo(0, 0)')) return undefined
          if (script.includes('innerText')) {
            navigateAfterSave(handlers)
            return 'hello world'
          }
          return undefined
        },
        async savePage(path: string) {
          ctl.order.push('savePage')
          writeFileSync(path, 'From: test\r\n\r\nMHTML body')
        },
        async printToPDF(options: unknown) {
          ctl.order.push('printToPDF')
          ctl.printOptions.push(options)
          if (ctl.printEvent) {
            emitPage(this.debugger, 'print-only', 'https://example.test/print-only.png', 'Image')
          }
          if (ctl.printHangs) return new Promise<Buffer>(() => {})
          if (ctl.printThrows) throw new Error('Printing failed')
          return ctl.pdfBytes ?? Buffer.from('%PDF-1.4 invented print')
        },
        getTitle() {
          return ctl.currentTitle
        },
        getURL() {
          return ctl.currentUrl
        },
        getUserAgent() {
          return 'MockAgent/1.0'
        }
      }
      ctl.lastWindow = this
    }
    isDestroyed() {
      return this.destroyed
    }
    destroy() {
      this.destroyed = true
    }
  }

  return { MockBrowserWindow }
})

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  app: {
    getPath: vi.fn(() => '/tmp'),
    get isPackaged() {
      return ctl.isPackaged
    }
  }
}))

vi.mock('../../../src/packages/transaction-record/writer', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/packages/transaction-record/writer')>()
  return {
    ...actual,
    writeTransactionRecord: vi.fn((input: Parameters<typeof actual.writeTransactionRecord>[0]) => {
      ctl.order.push('writeTransactionRecord')
      return ctl.writerHangs
        ? new Promise<never>(() => {})
        : ctl.writerThrows
          ? Promise.reject(new Error('the writer broke'))
          : actual.writeTransactionRecord(input)
    })
  }
})

vi.mock('@main/services/egress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/egress')>()
  return {
    ...actual,
    currentEgress: () => ctl.egress,
    knownEgress: (egress: EgressSetting = ctl.egress) => actual.knownEgress(egress)
  }
})

vi.mock('@main/services/consentBlocker', () => ({
  getConsentBlocker: vi.fn(async () => ctl.blocker)
}))

// The ingest's TLS Cert Chain re-fetch would open a socket to the fixture's host.
vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

type Rgb = { r: number; g: number; b: number }
const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const DARK: Rgb = { r: 24, g: 24, b: 24 }
const RED: Rgb = { r: 255, g: 0, b: 0 }

// A page-like image: `background` everywhere, with a solid `content` band
// covering rows [0, contentHeight).
async function pageWithTrailingBackground(
  width: number,
  height: number,
  contentHeight: number,
  background: Rgb,
  content: Rgb
): Promise<Buffer> {
  const band = await sharp({
    create: { width, height: contentHeight, channels: 3, background: content }
  })
    .png()
    .toBuffer()
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: band, left: 0, top: 0 }])
    .png()
    .toBuffer()
}

async function heightOf(png: Buffer): Promise<number> {
  return (await sharp(png).metadata()).height ?? -1
}

// Every control back to a page that loads, records and prints.
function resetRender(): void {
  ctl.loadUrlShouldReject = false
  ctl.loadUrlShouldHang = false
  ctl.blocker = null
  ctl.hop = null
  ctl.lastHop = null
  ctl.egress = { kind: 'direct' }
  ctl.loadUrlError = null
  ctl.calls = []
  ctl.order = []
  ctl.failingCommands = new Set()
  ctl.bodyHangs = false
  ctl.writerThrows = false
  ctl.writerHangs = false
  ctl.isPackaged = false
  ctl.lateEvent = false
  resetPrint()
  delete process.env[E2E_TRUSTED_CERT_SWITCH]
}

function resetPrint(): void {
  ctl.contentHeight = 100
  ctl.pdfBytes = null
  ctl.printHangs = false
  ctl.printThrows = false
  ctl.printOptions = []
  ctl.printEvent = false
  ctl.currentUrl = 'https://example.test/final'
  ctl.currentTitle = 'Mock Title'
  ctl.navigateAfterSave = null
}

describe('trimTrailingBackground', () => {
  it('crops the trailing background band below the last content row', async () => {
    const png = await pageWithTrailingBackground(400, 3000, 1000, WHITE, RED)
    const { png: out, trimmed } = await trimTrailingBackground(png)
    // Last content row (999) + 1 + 8px padding.
    expect(await heightOf(out)).toBe(1008)
    expect(trimmed).toBe(true)
  })

  it('adapts to a non-white page background', async () => {
    const png = await pageWithTrailingBackground(400, 3000, 1000, DARK, WHITE)
    const { png: out, trimmed } = await trimTrailingBackground(png)
    expect(await heightOf(out)).toBe(1008)
    expect(trimmed).toBe(true)
  })

  it('leaves a page whose content ends within the padding of its bottom edge untouched', async () => {
    // Content to row 995 on a white page 1000 rows tall: the crop would keep
    // 995 + 1 + 8 rows, no fewer than the image has, so nothing is cut.
    const png = await pageWithTrailingBackground(400, 1000, 996, WHITE, RED)
    const out = await trimTrailingBackground(png)
    expect(out).toEqual({ png, trimmed: false })
    expect(out.png).toBe(png)
  })

  it('trims a page whose content ends one row above the padding', async () => {
    // The boundary beside the case above: 991 + 1 + 8 = 1000 keeps every row,
    // and content ending at row 990 crops to 999.
    const untouched = await pageWithTrailingBackground(400, 1000, 992, WHITE, RED)
    expect((await trimTrailingBackground(untouched)).trimmed).toBe(false)

    const png = await pageWithTrailingBackground(400, 1000, 991, WHITE, RED)
    const { png: out, trimmed } = await trimTrailingBackground(png)
    expect(trimmed).toBe(true)
    expect(await heightOf(out)).toBe(999)
  })

  it('leaves an all-background (blank) capture untouched', async () => {
    const png = await sharp({
      create: { width: 400, height: 2000, channels: 3, background: WHITE }
    })
      .png()
      .toBuffer()
    const out = await trimTrailingBackground(png)
    expect(out).toEqual({ png, trimmed: false })
    expect(out.png).toBe(png)
  })

  it('preserves interior background gaps between content blocks', async () => {
    // Content at top, a big gap, then a second block — only rows past the
    // SECOND block may be cropped.
    const width = 400
    const top = await sharp({
      create: { width, height: 300, channels: 3, background: RED }
    })
      .png()
      .toBuffer()
    const bottom = await sharp({
      create: { width, height: 100, channels: 3, background: RED }
    })
      .png()
      .toBuffer()
    const png = await sharp({ create: { width, height: 4000, channels: 3, background: WHITE } })
      .composite([
        { input: top, left: 0, top: 0 },
        { input: bottom, left: 0, top: 2500 }
      ])
      .png()
      .toBuffer()

    const { png: out } = await trimTrailingBackground(png)
    expect(await heightOf(out)).toBe(2608)
  })

  it('returns the original buffer, untrimmed, on undecodable input (fail-soft)', async () => {
    const junk = Buffer.from('not a png at all')
    const out = await trimTrailingBackground(junk)
    expect(out.png).toBe(junk)
    expect(out.trimmed).toBe(false)
  })

  it('ignores sub-threshold speckle when deciding what counts as content', async () => {
    // A handful of noisy pixels deep in the trailing band must not stop the
    // crop: minContentPx = max(4, 0.4% of width) → 4 for a 400px-wide image.
    const width = 400
    const content = await sharp({
      create: { width, height: 500, channels: 3, background: RED }
    })
      .png()
      .toBuffer()
    const speck = await sharp({
      create: { width: 3, height: 1, channels: 3, background: DARK }
    })
      .png()
      .toBuffer()
    const png = await sharp({ create: { width, height: 3000, channels: 3, background: WHITE } })
      .composite([
        { input: content, left: 0, top: 0 },
        { input: speck, left: 200, top: 2000 }
      ])
      .png()
      .toBuffer()

    const { png: out } = await trimTrailingBackground(png)
    expect(await heightOf(out)).toBe(508)
  })
})

type StepState = { y: number; height: number; viewportHeight: number } | null

// A WebContents that answers only the scroll phase's three scripts: the unlock
// probe, one step per call, and the reset. `step` receives the 0-based call;
// `resetFails` makes the reset reject.
function scrollingContents(opts: {
  unlock?: string[] | null
  step: (call: number) => StepState
  resetFails?: boolean
}): {
  wc: WebContents
  scripts: string[]
} {
  const scripts: string[] = []
  let call = 0
  const wc = {
    async executeJavaScript(script: string) {
      scripts.push(script)
      if (script.includes("style.overflow = 'visible'")) return opts.unlock ?? null
      if (script.includes('root.scrollTop + viewportHeight')) return opts.step(call++)
      if (opts.resetFails) throw new Error('page navigated away during the reset')
      return undefined
    }
  }
  return { wc: wc as unknown as WebContents, scripts }
}

async function scrollUnderFakeTime(wc: WebContents, timeoutMs: number) {
  const pending = scrollToLoadLazyContent(wc, timeoutMs)
  await vi.runAllTimersAsync()
  const record = await pending
  // Each record is what the entry signs, so each must pass the strict schema.
  expect(ScrollToLoadRecordSchema.safeParse(record).success).toBe(true)
  return record
}

// D5 of docs/plans/2026-10-10-capture-engine-first-slice.md: one test per row.
describe('scrollToLoadLazyContent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records a phase that did not run when the budget is zero at the start', async () => {
    const { wc, scripts } = scrollingContents({ step: () => null })

    const record = await scrollUnderFakeTime(wc, 0)

    expect(record).toEqual({ requested: true, ran: false, scrollLockLifted: false })
    expect(scripts).toEqual([])
  })

  it('records nothing-to-scroll when the step script finds no scrollable root', async () => {
    const { wc } = scrollingContents({ step: () => null })

    const record = await scrollUnderFakeTime(wc, 10_000)

    expect(record).toEqual({
      requested: true,
      ran: true,
      outcome: 'nothing-to-scroll',
      scrollLockLifted: false
    })
  })

  it('records height-cap and the height when the page reaches the scroll cap', async () => {
    const { wc } = scrollingContents({
      step: () => ({ y: 0, height: 25_000, viewportHeight: 900 })
    })

    const record = await scrollUnderFakeTime(wc, 10_000)

    expect(record).toEqual({
      requested: true,
      ran: true,
      outcome: 'height-cap',
      endHeight: 25_000,
      scrollLockLifted: false
    })
  })

  it('records stopped-growing and the last height once the page stops growing', async () => {
    // A 3000px page scrolled one 900px viewport per step: at the bottom from
    // the third step, then three steps without growth.
    const { wc, scripts } = scrollingContents({
      step: (call) => ({ y: Math.min(2100, (call + 1) * 900), height: 3000, viewportHeight: 900 })
    })

    const record = await scrollUnderFakeTime(wc, 60_000)

    expect(record).toEqual({
      requested: true,
      ran: true,
      outcome: 'stopped-growing',
      endHeight: 3000,
      scrollLockLifted: false
    })
    expect(scripts.filter((s) => s.includes('root.scrollTop + viewportHeight'))).toHaveLength(5)
  })

  it('records time-budget when a page keeps growing until the phase deadline', async () => {
    const { wc } = scrollingContents({
      step: (call) => ({ y: call * 900, height: 2000 + call * 1000, viewportHeight: 900 })
    })

    // Steps at 0, 500, 1000 and 1500 ms; the deadline stops a fifth.
    const record = await scrollUnderFakeTime(wc, 1600)

    expect(record).toEqual({
      requested: true,
      ran: true,
      outcome: 'time-budget',
      endHeight: 5000,
      scrollLockLifted: false
    })
  })

  it('records that it lifted a scroll lock, and restores the lock it lifted', async () => {
    const { wc, scripts } = scrollingContents({
      unlock: ['hidden', ''],
      step: () => ({ y: 0, height: 25_000, viewportHeight: 900 })
    })

    const record = await scrollUnderFakeTime(wc, 10_000)

    expect(record.scrollLockLifted).toBe(true)
    expect(scripts.at(-1)).toContain('const prior = ["hidden",""]')
  })

  it.each([
    ['a fraction', 1500.5],
    ['a negative number', -1],
    ['text', '3000']
  ])('records no end height when the page reports %s for its height', async (_name, height) => {
    const { wc } = scrollingContents({
      step: (call) =>
        call === 0 ? ({ y: 0, height, viewportHeight: 900 } as unknown as StepState) : null
    })

    const record = await scrollUnderFakeTime(wc, 10_000)

    expect(record).toEqual({
      requested: true,
      ran: true,
      outcome: 'nothing-to-scroll',
      scrollLockLifted: false
    })
  })

  it('fails, rather than records, a scroll step that throws, and still restores the page', async () => {
    const { wc, scripts } = scrollingContents({
      step: () => {
        throw new Error('page navigated away')
      }
    })

    const pending = scrollToLoadLazyContent(wc, 10_000)
    const settled = expect(pending).rejects.toThrow('page navigated away')
    await vi.runAllTimersAsync()
    await settled
    expect(scripts.at(-1)).toContain('window.scrollTo(0, 0)')
  })

  it('fails, rather than records, a phase whose lifted scroll lock cannot be restored', async () => {
    const { wc } = scrollingContents({
      unlock: ['hidden', ''],
      step: () => ({ y: 0, height: 25_000, viewportHeight: 900 }),
      resetFails: true
    })

    const pending = scrollToLoadLazyContent(wc, 10_000)
    const settled = expect(pending).rejects.toThrow(
      "Could not restore the page's scroll lock after Scroll-to-load"
    )
    await vi.runAllTimersAsync()
    await settled
  })

  it('keeps the step error when both a step and the restore fail', async () => {
    const { wc } = scrollingContents({
      unlock: ['hidden', ''],
      step: () => {
        throw new Error('page navigated away')
      },
      resetFails: true
    })

    const pending = scrollToLoadLazyContent(wc, 10_000)
    const settled = expect(pending).rejects.toThrow(/^page navigated away$/)
    await vi.runAllTimersAsync()
    await settled
  })

  it('records the phase and logs a failed reset when no scroll lock was lifted', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => 'log-id')
    const { wc } = scrollingContents({
      step: () => ({ y: 0, height: 25_000, viewportHeight: 900 }),
      resetFails: true
    })

    const record = await scrollUnderFakeTime(wc, 10_000)

    expect(record).toMatchObject({ outcome: 'height-cap', scrollLockLifted: false })
    expect(logged).toHaveBeenCalledWith(
      'backgroundRenderer',
      'backgroundRenderer.scroll_reset_failed',
      undefined,
      expect.any(Error)
    )
    logged.mockRestore()
  })

  it('keeps scrolling past a bottom when the page grows before the stall count ends', async () => {
    // A feed whose next chunk lands two steps after each bottom: 3000px, then
    // 4000px, and so on, until the deadline.
    const { wc } = scrollingContents({
      step: (call) => {
        const height = 3000 + Math.floor(call / 3) * 1000
        return { y: height - 900, height, viewportHeight: 900 }
      }
    })

    const record = await scrollUnderFakeTime(wc, 10_000)

    expect(record).toMatchObject({ outcome: 'time-budget', endHeight: 9000 })
  })

  it('restarts the stall count when a step moves on to a second pane', async () => {
    // Pane A (6000px) at its end for two steps, then pane B (3000px) for two
    // steps that each count as a stall on their own pane, then A again: no
    // three stalls run together until A has three steps to itself.
    const heights = [6000, 6000, 3000, 3000, 6000, 6000, 6000, 6000]
    const { wc, scripts } = scrollingContents({
      step: (call) => {
        const height = heights[Math.min(call, heights.length - 1)]
        return { y: height - 900, height, viewportHeight: 900 }
      }
    })

    const record = await scrollUnderFakeTime(wc, 60_000)

    expect(record).toMatchObject({ outcome: 'stopped-growing', endHeight: 6000 })
    expect(scripts.filter((s) => s.includes('root.scrollTop + viewportHeight'))).toHaveLength(8)
  })
})

// A scrollable box with the browser's clamping: scrollTop stays within
// [0, scrollHeight - clientHeight].
class FakeScroller {
  scrollTop = 0
  constructor(
    readonly name: string,
    public scrollHeight: number,
    readonly clientHeight: number
  ) {}
  scrollTo({ top }: { top: number }) {
    this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight))
  }
}

// Runs the step script against a document root and the inner boxes
// `querySelectorAll('body *')` returns, in a 900px-tall window, and names the
// box each step moved.
function stepRunner(doc: FakeScroller, inner: FakeScroller[]) {
  const context = {
    document: {
      scrollingElement: doc,
      documentElement: doc,
      body: {},
      querySelectorAll: () => inner
    },
    window: { innerHeight: 900 }
  }
  return () => {
    const before = [doc, ...inner].map((box) => box.scrollTop)
    const state = runInNewContext(SCROLL_STEP_SCRIPT, context) as StepState
    const moved = [doc, ...inner].filter((box, i) => box.scrollTop !== before[i])
    return { state, moved: moved.map((box) => box.name) }
  }
}

// Which root the step script scrolls, in the root choice the Electron runs in
// the validation record exercise on real pages.
describe('the Scroll-to-load step script', () => {
  it('scrolls an inner panel once the document, overflowing by its margin, is at its end', () => {
    // body{height:100vh} with the default 8px margin: the document overflows
    // by 16px, and the content scrolls in <main>.
    const doc = new FakeScroller('document', 916, 900)
    const main = new FakeScroller('main', 10_001, 900)
    const step = stepRunner(doc, [main])

    expect(step().moved).toEqual(['document'])
    const rest = Array.from({ length: 12 }, step)

    expect(rest[0].moved).toEqual(['main'])
    expect(main.scrollTop).toBe(9101)
    // With every root at its end, the step reports the panel, not the
    // document, so the stall detector reads the panel's height.
    expect(rest.at(-1)).toEqual({
      state: { y: 9101, height: 10_001, viewportHeight: 900 },
      moved: []
    })
  })

  it('scrolls both panes of a two-pane page, the larger first, and ends on the larger', () => {
    const doc = new FakeScroller('document', 900, 900)
    const nav = new FakeScroller('nav', 3000, 900)
    const main = new FakeScroller('main', 6000, 900)
    const step = stepRunner(doc, [nav, main])

    const moved = Array.from({ length: 12 }, step)

    expect(moved.map((s) => s.moved.join())).toEqual([
      ...Array(6).fill('main'),
      ...Array(3).fill('nav'),
      '',
      '',
      ''
    ])
    expect(nav.scrollTop).toBe(2100)
    expect(main.scrollTop).toBe(5100)
    expect(moved.at(-1)!.state).toEqual({ y: 5100, height: 6000, viewportHeight: 900 })
  })

  it('reports a document at its end rather than nothing to scroll', () => {
    const doc = new FakeScroller('document', 3000, 900)
    doc.scrollTop = 2100

    expect(stepRunner(doc, [])()).toEqual({
      state: { y: 2100, height: 3000, viewportHeight: 900 },
      moved: []
    })
  })

  it('returns to an inner panel that grew after reaching its end', () => {
    const doc = new FakeScroller('document', 916, 900)
    const main = new FakeScroller('main', 2001, 900)
    const step = stepRunner(doc, [main])
    for (let i = 0; i < 4; i++) step()
    expect(main.scrollTop).toBe(1101)

    main.scrollHeight = 4001

    expect(step().moved).toEqual(['main'])
  })

  it('finds nothing to scroll on a page that does not overflow', () => {
    const doc = new FakeScroller('document', 900, 900)
    const short = new FakeScroller('short', 900, 900)

    expect(stepRunner(doc, [short])().state).toBeNull()
  })
})

// A WebContents whose debugger reports `content` as the CSS content size and
// returns `png` as the captured image.
function screenshotContents(
  content: { width: number; height: number },
  png: Buffer
): { wc: WebContents; clips: unknown[] } {
  const clips: unknown[] = []
  const wc = {
    debugger: {
      async sendCommand(cmd: string, params?: { clip?: unknown }) {
        if (cmd === 'Page.getLayoutMetrics') return { cssContentSize: { x: 0, y: 0, ...content } }
        clips.push(params?.clip)
        return { data: png.toString('base64') }
      }
    }
  }
  return { wc: wc as unknown as WebContents, clips }
}

async function solid(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: RED } })
    .png()
    .toBuffer()
}

// D6 of docs/plans/2026-10-10-capture-engine-first-slice.md.
describe('captureFullPageScreenshot', () => {
  it('records a screenshot that was neither scaled, cut short, nor trimmed', async () => {
    const image = await solid(1280, 3000)
    const { wc } = screenshotContents({ width: 1280, height: 3000 }, image)

    const { png, record } = await captureFullPageScreenshot(wc)

    expect(png.equals(image)).toBe(true)
    expect(record).toEqual({
      scaled: false,
      truncated: false,
      trimmed: false,
      contentWidth: 1280,
      contentHeight: 3000,
      width: 1280,
      height: 3000
    })
  })

  it('records a trim and the trimmed PNG dimensions', async () => {
    const image = await pageWithTrailingBackground(400, 3000, 1000, WHITE, RED)
    const { wc } = screenshotContents({ width: 400, height: 3000 }, image)

    const { png, record } = await captureFullPageScreenshot(wc)

    expect(await heightOf(png)).toBe(1008)
    expect(record).toMatchObject({ trimmed: true, contentHeight: 3000, width: 400, height: 1008 })
    expect(record).toMatchObject({ scaled: false, truncated: false })
  })

  it('records a scale below 1 for content wider than the texture ceiling', async () => {
    const { wc, clips } = screenshotContents({ width: 20_000, height: 1000 }, await solid(16, 8))

    const { record } = await captureFullPageScreenshot(wc)

    expect(clips[0]).toMatchObject({ width: 20_000, height: 1000, scale: 16_384 / 20_000 })
    expect(record).toEqual({
      scaled: true,
      truncated: false,
      trimmed: false,
      contentWidth: 20_000,
      contentHeight: 1000,
      width: 16,
      height: 8
    })
  })

  it('records a screenshot cut short of a page taller than the pixel budget', async () => {
    const { wc, clips } = screenshotContents({ width: 1280, height: 40_000 }, await solid(16, 8))

    const { record } = await captureFullPageScreenshot(wc)

    expect(clips[0]).toMatchObject({ height: 16_384, scale: 1 })
    expect(record).toMatchObject({
      scaled: false,
      truncated: true,
      contentWidth: 1280,
      contentHeight: 40_000
    })
  })

  it('records no trim when the trim fails, and keeps the image it was given', async () => {
    // A PNG signature and header with no image data: sharp cannot decode it,
    // and its header still states its dimensions.
    const headerOnly = (await solid(640, 480)).subarray(0, 33)
    const { wc } = screenshotContents({ width: 640, height: 480 }, headerOnly)

    const { png, record } = await captureFullPageScreenshot(wc)

    expect(png.equals(headerOnly)).toBe(true)
    expect(record).toMatchObject({ trimmed: false, width: 640, height: 480 })
  })

  it('fails the render on an image that is not a PNG', async () => {
    const { wc } = screenshotContents({ width: 10, height: 10 }, Buffer.from('not a png at all'))

    await expect(captureFullPageScreenshot(wc)).rejects.toThrow('The screenshot is not a PNG')
  })
})

const IDS = { captureId: 'capture-1929', toolVersion: '1.0.1-test' }

describe('renderPageInHiddenWindow', () => {
  beforeAll(async () => {
    // A tiny valid PNG for the mocked CDP captureScreenshot to return.
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: WHITE } })
      .png()
      .toBuffer()
    ctl.pngBase64 = png.toString('base64')
  })

  beforeEach(() => {
    ctl.loadUrlShouldReject = false
    ctl.loadUrlShouldHang = false
    ctl.blocker = null
    ctl.createdWindows = 0
    ctl.hop = null
    ctl.lastHop = null
    ctl.egress = { kind: 'direct' }
    ctl.loadUrlError = null
    ctl.calls = []
    ctl.order = []
    ctl.failingCommands = new Set()
    ctl.bodyHangs = false
    ctl.writerThrows = false
    ctl.writerHangs = false
    ctl.isPackaged = false
    ctl.lateEvent = false
    resetPrint()
    delete process.env[E2E_TRUSTED_CERT_SWITCH]
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders a page end-to-end and returns forensic artifacts', async () => {
    const consentBlocker = {
      enableBlockingInSession: vi.fn(),
      isBlockingEnabled: vi.fn(() => true),
      disableBlockingInSession: vi.fn()
    }
    ctl.blocker = consentBlocker

    // Past the end reserve, so the scroll phase gets a budget.
    const result = await renderPageInHiddenWindow('https://example.test/', {
      timeoutMs: 60_000,
      ...IDS
    })

    expect(Buffer.isBuffer(result.screenshot)).toBe(true)
    expect(result.text).toBe('hello world')
    expect(result.title).toBe('Mock Title')
    expect(result.finalUrl).toBe('https://example.test/final')
    expect(result.httpStatus).toBe(200)
    expect(result.userAgent).toBe('MockAgent/1.0')
    expect(result.browserVersion).toContain('Chrome/')
    // The fake's first scroll step reports a height at the cap.
    expect(result.scrollToLoad).toEqual({
      requested: true,
      ran: true,
      outcome: 'height-cap',
      endHeight: 25000,
      scrollLockLifted: false
    })
    expect(result.screenshotRecord).toEqual({
      scaled: false,
      truncated: false,
      trimmed: false,
      contentWidth: 100,
      contentHeight: 100,
      width: 100,
      height: 100
    })
    // Consent blocker was present, so it was enabled and its suppression recorded.
    expect(consentBlocker.enableBlockingInSession).toHaveBeenCalled()
    expect(result.consentSuppression).toBe('filter-list')
    // Cleanup released the blocker for this job (avoids leaking global handlers).
    expect(consentBlocker.disableBlockingInSession).toHaveBeenCalled()

    // Drain the MHTML stream (the caller's contract) before cleanup unlinks the
    // temp file, so the lazily-opened read stream doesn't race the delete.
    const chunks: Uint8Array[] = []
    for await (const chunk of result.mhtmlStream) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toContain('MHTML body')

    // The MHTML temp file exists until cleanup() removes it and destroys the window.
    const win = ctl.lastWindow!
    expect(win.isDestroyed()).toBe(false)
    await result.cleanup()
    expect(win.isDestroyed()).toBe(true)
  }, 30_000)

  it('denies every permission check as well as every permission request', async () => {
    const result = await renderPageInHiddenWindow('https://example.test/', {
      timeoutMs: 30_000,
      ...IDS
    })
    const session = ctl.lastWindow!.webContents.session as {
      setPermissionRequestHandler: ReturnType<typeof vi.fn>
      setPermissionCheckHandler: ReturnType<typeof vi.fn>
    }

    expect(session.setPermissionCheckHandler).toHaveBeenCalledTimes(1)
    const [checkHandler] = session.setPermissionCheckHandler.mock.calls[0] as [
      (...args: unknown[]) => boolean
    ]
    for (const permission of ['notifications', 'geolocation', 'media', 'clipboard-read']) {
      expect(checkHandler(null, permission, 'https://example.test', {})).toBe(false)
    }

    const [requestHandler] = session.setPermissionRequestHandler.mock.calls[0] as [
      (wc: unknown, permission: string, callback: (granted: boolean) => void) => void
    ]
    const callback = vi.fn()
    requestHandler(null, 'notifications', callback)
    expect(callback).toHaveBeenCalledWith(false)

    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
  }, 30_000)

  it('records no suppression when the consent blocker is unavailable', async () => {
    ctl.blocker = null
    const result = await renderPageInHiddenWindow('https://example.test/', {
      timeoutMs: 30_000,
      ...IDS
    })
    expect(result.consentSuppression).toBeUndefined()
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
  }, 30_000)

  it('destroys the window and cleans up when the navigation fails', async () => {
    ctl.loadUrlShouldReject = true

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000, ...IDS })
    ).rejects.toThrow(/navigation failed/)

    // The error path destroys the window and removes the temp MHTML file.
    expect(ctl.lastWindow!.isDestroyed()).toBe(true)
  }, 30_000)

  it('rejects when the render exceeds the timeout budget', async () => {
    // A load that never settles lets the deadline timer win the race.
    ctl.loadUrlShouldHang = true

    await expect(
      renderPageInHiddenWindow('https://example.test/hang', { timeoutMs: 50, ...IDS })
    ).rejects.toThrow(/timed out/)

    // The timeout path also tears the window down.
    expect(ctl.lastWindow!.isDestroyed()).toBe(true)
  }, 30_000)

  it.each([
    ['will-redirect', 'http://127.0.0.1:8080/admin', 'Redirects to a loopback address'],
    ['will-redirect', 'http://192.168.1.1/', 'Redirects to a private address'],
    ['will-navigate', 'http://10.0.0.5/', 'Redirects to a private address'],
    ['will-redirect', 'http://localhost/', 'Redirects to this computer']
  ])(
    'refuses a %s hop to %s before following it',
    async (event, url, reason) => {
      ctl.hop = { event, url, isMainFrame: true }

      const render = renderPageInHiddenWindow('https://example.test/', {
        timeoutMs: 30_000,
        ...IDS
      })
      await expect(render).rejects.toThrow(RefusedAddressError)
      await expect(render).rejects.toThrow(reason)

      expect(ctl.lastHop!.preventDefault).toHaveBeenCalledTimes(1)
      expect(ctl.lastWindow!.isDestroyed()).toBe(true)
    },
    30_000
  )

  it('follows a redirect hop to a public address', async () => {
    ctl.hop = { event: 'will-redirect', url: 'https://example.org/next', isMainFrame: true }

    const result = await renderPageInHiddenWindow('https://example.test/', {
      timeoutMs: 30_000,
      ...IDS
    })

    expect(ctl.lastHop!.preventDefault).not.toHaveBeenCalled()
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
  }, 30_000)

  it('puts the Egress proxy and the WebRTC policy on the partition before the first load', async () => {
    ctl.egress = { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9150', label: 'Tor Browser' }

    const result = await renderPageInHiddenWindow('https://example.test/', {
      timeoutMs: 30_000,
      ...IDS
    })

    expect(ctl.calls.slice(0, 4)).toEqual([
      'setProxy {"mode":"fixed_servers","proxyRules":"socks5://127.0.0.1:9150","proxyBypassRules":"<-loopback>"}',
      'webrtc disable_non_proxied_udp',
      'loadURL about:blank',
      'loadURL https://example.test/'
    ])
    expect(result.egress).toEqual({ kind: 'tor', label: 'Tor Browser' })
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
  }, 30_000)

  it('leaves the partition alone and reports no Egress while it is Direct', async () => {
    const result = await renderPageInHiddenWindow('https://example.test/', {
      timeoutMs: 30_000,
      ...IDS
    })

    expect(ctl.calls).toEqual(['loadURL about:blank', 'loadURL https://example.test/'])
    expect(result.egress).toBeUndefined()
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
  }, 30_000)

  it('names the proxy when the load fails at it', async () => {
    ctl.egress = { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: '' }
    ctl.loadUrlError = "ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://example.test/'"

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000, ...IDS })
    ).rejects.toThrow(
      "Could not go through the Egress proxy socks5://127.0.0.1:1080: ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://example.test/'"
    )
    expect(ctl.lastWindow!.isDestroyed()).toBe(true)
  }, 30_000)

  it('names the proxy when Chromium finds no usable proxy in the rules', async () => {
    ctl.egress = { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: '' }
    ctl.loadUrlError = "ERR_NO_SUPPORTED_PROXIES (-336) loading 'https://example.test/'"

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000, ...IDS })
    ).rejects.toThrow('Could not go through the Egress proxy socks5://127.0.0.1:1080')
  }, 30_000)

  it('passes any other load failure through unchanged while a proxy is set', async () => {
    ctl.egress = { kind: 'proxy', proxyUrl: 'http://10.1.2.3:3128', label: '' }
    ctl.loadUrlError = "ERR_NAME_NOT_RESOLVED (-105) loading 'https://example.test/'"

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000, ...IDS })
    ).rejects.toThrow(/^ERR_NAME_NOT_RESOLVED/)
  }, 30_000)
  it('makes no window and sends nothing while the saved Egress cannot be read', async () => {
    ctl.egress = { kind: 'unavailable' }
    const before = ctl.createdWindows

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000, ...IDS })
    ).rejects.toThrow(EgressUnavailableError)

    expect(ctl.createdWindows).toBe(before)
    expect(ctl.calls).toEqual([])
  }, 30_000)
})

// Step 9 of docs/plans/2026-10-10-capture-engine-first-slice.md.
describe('renderPageInHiddenWindow, the Transaction Record', () => {
  beforeAll(async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: WHITE } })
      .png()
      .toBuffer()
    ctl.pngBase64 = png.toString('base64')
  })

  beforeEach(() => {
    ctl.loadUrlShouldReject = false
    ctl.loadUrlShouldHang = false
    ctl.blocker = null
    ctl.hop = null
    ctl.egress = { kind: 'direct' }
    ctl.loadUrlError = null
    ctl.calls = []
    ctl.order = []
    ctl.failingCommands = new Set()
    ctl.bodyHangs = false
    ctl.writerThrows = false
    ctl.writerHangs = false
    ctl.isPackaged = false
    ctl.lateEvent = false
    resetPrint()
    delete process.env[E2E_TRUSTED_CERT_SWITCH]
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    delete process.env[E2E_TRUSTED_CERT_SWITCH]
  })

  async function render(url = 'https://example.test/', timeoutMs = 30_000) {
    const result = await renderPageInHiddenWindow(url, { timeoutMs, ...IDS })
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
    return result
  }

  it('loads a blank page, sets up the page session, then loads the target', async () => {
    await render()
    const target = ctl.order.indexOf('loadURL https://example.test/')
    expect(ctl.order.slice(0, target + 1)).toEqual([
      'loadURL about:blank',
      'Network.enable',
      'Network.configureDurableMessages',
      'Target.setAutoAttach',
      'loadURL https://example.test/'
    ])
  }, 30_000)

  it('records the main document, with Bound TLS Details and its credential header replaced', async () => {
    const { transactionRecord } = await render()
    if (!transactionRecord.present) throw transactionRecord.error
    expect(transactionRecord.inventory).toMatchObject({
      present: true,
      exchanges: 1,
      bodiesOmitted: 0,
      recordedTargets: 1,
      unrecordedTargets: 0,
      replacedHeaders: ['cookie'],
      budget: { totalBytes: 50_000_000, resourceBytes: 10_000_000 }
    })
    expect(transactionRecord.boundTls).toMatchObject({
      subjectName: 'example.test',
      issuer: 'Birdbrain Test CA',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z'
    })
    expect(transactionRecord.boundTlsAbsent).toBeUndefined()
    const warc = gunzipSync(transactionRecord.warcGz).toString()
    expect(warc).toContain('capture-id: capture-1929')
    expect(warc).toContain('software: Birdbrain 1.0.1-test')
    expect(warc).toContain('<p>doc</p>')
    expect(warc).not.toContain('fixture-secret')
  }, 30_000)

  it('states not-https for an http page', async () => {
    const { transactionRecord } = await render('http://example.test/')
    expect(transactionRecord).toMatchObject({ present: true, boundTlsAbsent: 'not-https' })
  }, 30_000)

  it('stops collection before the screenshot, so a later request is not recorded', async () => {
    ctl.lateEvent = true
    const { transactionRecord } = await render()
    expect(transactionRecord).toMatchObject({ present: true, inventory: { exchanges: 1 } })
  }, 30_000)

  it('stores the Capture with the record failed when Network.enable fails', async () => {
    ctl.failingCommands.add('Network.enable')
    const result = await render()
    expect(result.transactionRecord).toMatchObject({ present: false, reason: 'failed' })
    expect(Buffer.isBuffer(result.screenshot)).toBe(true)
    expect(ctl.order).not.toContain('Target.setAutoAttach')
    expect(ctl.order).toContain('loadURL https://example.test/')
  }, 30_000)

  it('keeps the record and counts the page unrecorded when its auto-attach fails', async () => {
    ctl.failingCommands.add('Target.setAutoAttach')
    const { transactionRecord } = await render()
    expect(transactionRecord).toMatchObject({
      present: true,
      inventory: { exchanges: 1, recordedTargets: 0, unrecordedTargets: 1 }
    })
  }, 30_000)

  it('records the Transaction Record failed, inside the Recapture timeout, when a body fetch never settles', async () => {
    ctl.bodyHangs = true
    const startedAt = Date.now()
    const result = await render()
    expect(Date.now() - startedAt).toBeLessThan(30_000)
    expect(result.transactionRecord).toMatchObject({ present: false, reason: 'failed' })
    expect(String(result.transactionRecord.present || result.transactionRecord.error)).toContain(
      'The body fetches did not settle'
    )
  }, 30_000)

  // Ruling (c) of 2026-10-26 on the review of #1999: the end reserve stayed at 35 s for the
  // record phases, and each is cut to the time left, so the render stores before its deadline.
  // Step 10 raises the reserve by the print's 5 s bound, as the plan's step 10 says.
  it('reserves 40 s at the end: no Scroll-to-load budget below it, some above it', async () => {
    const below = await render('https://example.test/', 39_000)
    expect(below.scrollToLoad.ran).toBe(false)
    const above = await render('https://example.test/', 42_500)
    expect(above.scrollToLoad.ran).toBe(true)
  }, 30_000)

  it('cuts the body fetches to the time left, so the render returns before its deadline', async () => {
    ctl.bodyHangs = true
    // Every earlier phase gets nothing under 35 s, so the 5 s collect bound is what is cut.
    const result = await render('https://example.test/', 3_000)
    expect(result.transactionRecord).toMatchObject({ present: false, reason: 'failed' })
    const error = String(result.transactionRecord.present || result.transactionRecord.error)
    expect(error).toMatch(/The body fetches did not settle within (1\d{3}|2000)ms/)
  }, 30_000)

  it('cuts the writer to the time left, so the render returns before its deadline', async () => {
    ctl.writerHangs = true
    const result = await render('https://example.test/', 3_000)
    expect(result.transactionRecord).toMatchObject({ present: false, reason: 'failed' })
    const error = String(result.transactionRecord.present || result.transactionRecord.error)
    expect(error).toMatch(/The Transaction Record writer did not settle within (1\d{3}|2000)ms/)
  }, 30_000)

  it('records the Transaction Record failed when the writer throws', async () => {
    ctl.writerThrows = true
    const result = await render()
    expect(result.transactionRecord).toMatchObject({ present: false, reason: 'failed' })
    expect(Buffer.isBuffer(result.screenshot)).toBe(true)
  }, 30_000)

  it('removes its debugger listener when the render ends', async () => {
    await render()
    expect(ctl.lastWindow!.webContents.debugger.listeners.size).toBe(0)
  }, 30_000)

  describe('the test certificate allowance', () => {
    const LEAF = 'aa'.repeat(32)

    it('installs none without the switch', async () => {
      await render()
      expect(ctl.order).not.toContain('setCertificateVerifyProc')
    }, 30_000)

    it('installs none in a packaged build, even with the switch set', async () => {
      ctl.isPackaged = true
      process.env[E2E_TRUSTED_CERT_SWITCH] = LEAF
      await render()
      expect(ctl.order).not.toContain('setCertificateVerifyProc')
    }, 30_000)

    it('installs it before the first load in an unpackaged build with the switch set', async () => {
      process.env[E2E_TRUSTED_CERT_SWITCH] = LEAF
      await render()
      expect(ctl.order.indexOf('setCertificateVerifyProc')).toBe(0)
    }, 30_000)
  })
})

// Step 10 of docs/plans/2026-10-10-capture-engine-first-slice.md.
describe('renderPageInHiddenWindow, the PDF', () => {
  beforeAll(async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: WHITE } })
      .png()
      .toBuffer()
    ctl.pngBase64 = png.toString('base64')
  })

  beforeEach(() => {
    resetRender()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  async function render(timeoutMs = 30_000) {
    const result = await renderPageInHiddenWindow('https://example.test/', { timeoutMs, ...IDS })
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
    return result
  }

  const errorOf = (pdf: PdfOutcome): string => String(pdf.present || pdf.error)

  it('prints last, after the screenshot, the MHTML and the record, with the print defaults', async () => {
    const { pdf } = await render()
    expect(pdf).toEqual({
      present: true,
      bytes: Buffer.from('%PDF-1.4 invented print'),
      inventory: { present: true, afterCollection: true }
    })
    const at = (step: string) => ctl.order.indexOf(step)
    expect(at('Page.captureScreenshot')).toBeLessThan(at('savePage'))
    expect(at('savePage')).toBeLessThan(at('writeTransactionRecord'))
    expect(at('writeTransactionRecord')).toBeLessThan(at('printToPDF'))
    expect(ctl.order.filter((step) => step === 'printToPDF')).toHaveLength(1)
    expect(ctl.printOptions).toEqual([{}])
  }, 30_000)

  it('leaves a request the page starts while printing out of the Transaction Record', async () => {
    ctl.printEvent = true
    const { transactionRecord, pdf } = await render()
    if (!transactionRecord.present) throw transactionRecord.error
    expect(transactionRecord.inventory.exchanges).toBe(1)
    expect(gunzipSync(transactionRecord.warcGz).toString()).not.toContain('print-only.png')
    expect(pdf.present).toBe(true)
  }, 30_000)

  it('records the PDF failed, inside the Recapture timeout, when printToPDF never settles', async () => {
    ctl.printHangs = true
    const startedAt = Date.now()
    const result = await render()
    expect(Date.now() - startedAt).toBeLessThan(30_000)
    expect(result.pdf).toMatchObject({ present: false, reason: 'failed' })
    expect(errorOf(result.pdf)).toContain('The print did not settle within 5000ms')
    expect(result.transactionRecord.present).toBe(true)
  }, 30_000)

  // The rule of 2026-10-26 for the record phases: the print takes its time from what is left,
  // so a print that runs out records the PDF failed and the render returns before its deadline.
  it('cuts the print to the time left, so the render returns before its deadline', async () => {
    ctl.printHangs = true
    const startedAt = Date.now()
    const result = await render(3_000)
    expect(Date.now() - startedAt).toBeLessThan(3_000)
    expect(result.pdf).toMatchObject({ present: false, reason: 'failed' })
    expect(errorOf(result.pdf)).toMatch(/The print did not settle within (1\d{3}|2000)ms/)
  }, 30_000)

  it('does not start the print when the record phases used the time left', async () => {
    ctl.printHangs = true
    ctl.writerHangs = true
    const result = await render(3_000)
    expect(result.transactionRecord).toMatchObject({ present: false, reason: 'failed' })
    expect(result.pdf).toMatchObject({ present: false, reason: 'failed' })
    expect(errorOf(result.pdf)).toBe('Error: The Recapture timeout left no time for the print')
    expect(ctl.order).not.toContain('printToPDF')
  }, 30_000)

  it('records the PDF failed when printToPDF throws', async () => {
    ctl.printThrows = true
    const result = await render()
    expect(result.pdf).toMatchObject({ present: false, reason: 'failed' })
    expect(errorOf(result.pdf)).toContain('Printing failed')
  }, 30_000)

  it('never calls printToPDF for a page taller than the layout bound', async () => {
    ctl.contentHeight = MAX_PDF_CONTENT_HEIGHT_PX + 1
    const result = await render()
    expect(ctl.order).not.toContain('printToPDF')
    expect(result.pdf).toMatchObject({ present: false, reason: 'failed' })
    expect(errorOf(result.pdf)).toContain(
      `The page is ${MAX_PDF_CONTENT_HEIGHT_PX + 1} CSS pixels tall, over MAX_PDF_CONTENT_HEIGHT_PX`
    )
    expect(result.screenshotRecord.contentHeight).toBe(MAX_PDF_CONTENT_HEIGHT_PX + 1)
  }, 30_000)

  it('prints a page exactly at the layout bound', async () => {
    ctl.contentHeight = MAX_PDF_CONTENT_HEIGHT_PX
    const { pdf } = await render()
    expect(ctl.order).toContain('printToPDF')
    expect(pdf.present).toBe(true)
  }, 30_000)

  it('discards a PDF over MAX_PDF_SIZE and keeps one exactly at it', async () => {
    ctl.pdfBytes = Buffer.allocUnsafe(MAX_PDF_SIZE + 1)
    const over = await render()
    expect(over.pdf).toMatchObject({ present: false, reason: 'failed' })
    expect(errorOf(over.pdf)).toContain(
      `The PDF is ${MAX_PDF_SIZE + 1} bytes, over MAX_PDF_SIZE (${MAX_PDF_SIZE})`
    )

    ctl.pdfBytes = Buffer.allocUnsafe(MAX_PDF_SIZE)
    const at = await render()
    expect(at.pdf.present && at.pdf.bytes.length).toBe(MAX_PDF_SIZE)
  }, 30_000)

  // Finding 2 of the review of #2000: a page that navigates after the save would be printed,
  // and the Capture stored, as the later page.
  it.each([
    ['to another page', 'other-page', 'https://example.test/elsewhere'],
    ['by reloading itself', 'reload', 'https://example.test/final'],
    ['to another address in place', 'in-page', 'https://example.test/final#later']
  ] as const)(
    'keeps the address, title and status of the save, and does not print, when the page navigates %s',
    async (_how, navigation, later) => {
      ctl.navigateAfterSave = navigation
      const result = await render()
      expect(ctl.currentUrl).toBe(later)
      expect(result).toMatchObject({
        finalUrl: 'https://example.test/final',
        title: 'Mock Title',
        httpStatus: 200
      })
      expect(ctl.order).not.toContain('printToPDF')
      expect(result.pdf).toMatchObject({ present: false, reason: 'failed' })
      expect(errorOf(result.pdf)).toContain(
        `The page navigated after it was saved, to ${later}, so it was not printed`
      )
    },
    30_000
  )
})

// The same render handed to the Recapture queue and the Capture's ingest, so each outcome is
// shown stored, as the step's acceptance asks.
describe('a Recapture of a rendered page, through ingest, and its PDF', () => {
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]
  const selectorLifecycle = {
    runActiveSelectorsForCapture: vi.fn()
  } as unknown as SelectorLifecycle

  beforeAll(async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: WHITE } })
      .png()
      .toBuffer()
    ctl.pngBase64 = png.toString('base64')
  })

  beforeEach(async () => {
    resetRender()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-render-pdf-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    updateSettings({ operatorName: 'Op' })
    caseId = createCase({ name: 'Render PDF' }).id
    ensureCaseDir(caseId)
    events = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // One Recapture under a 30 s timeout; resolves with the stored Capture's id and entry.
  async function recaptureOnce(): Promise<{ id: string; entry: Record<string, unknown> }> {
    const service = createRecaptureService({
      renderPage: renderPageInHiddenWindow,
      captureLifecycle: createCaptureLifecycle({ selectorLifecycle }),
      emitEvent: (event) => events.push(event),
      emitNewCapture: () => {},
      timeoutMs: 30_000
    })
    service.enqueue([{ url: 'https://example.test/', caseId }])
    await service.idle()
    expect(events.map(({ type }) => type)).toEqual(['received', 'stored'])
    const stored = events.find((event) => event.type === 'stored') as { captureId: string }
    const entry = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((candidate) => candidate.captureId === stored.captureId)!
    const parsed = ManifestEntrySchema.safeParse(entry)
    expect(parsed.success ? [] : parsed.error.issues).toEqual([])
    return { id: stored.captureId, entry }
  }

  const pdfFile = (id: string): string => join(getStorageRoot(), caseId, `${id}.pdf`)

  it('stores the printed PDF, signs its hash and part, and mirrors the hash on the row', async () => {
    const printed = Buffer.from('%PDF-1.4 the printed page')
    ctl.pdfBytes = printed
    const { id, entry } = await recaptureOnce()
    const hash = createHash('sha256').update(printed).digest('hex')
    expect(entry).toMatchObject({
      pdfHash: hash,
      inventory: { pdf: { present: true, afterCollection: true } },
      schemaVersion: 6
    })
    expect(readFileSync(pdfFile(id)).equals(printed)).toBe(true)
    expect(getCapture(id)!.pdfHash).toBe(hash)
    await expect(verifyCapture(id)).resolves.toMatchObject({ status: 'verified' })

    writeFileSync(pdfFile(id), Buffer.from('%PDF-1.4 the printed pagE'))
    await expect(verifyCapture(id)).resolves.toMatchObject({ status: 'tampered' })
  }, 30_000)

  it('stores a page that navigated after the save under the address and title it saved', async () => {
    ctl.navigateAfterSave = 'other-page'
    const { id, entry } = await recaptureOnce()
    expect(entry).toMatchObject({
      url: 'https://example.test/final',
      finalUrl: 'https://example.test/final',
      httpStatus: 200,
      inventory: { pdf: { present: false, reason: 'failed' } }
    })
    expect(entry).not.toHaveProperty('pdfHash')
    expect(getCapture(id)).toMatchObject({ url: 'https://example.test/final', title: 'Mock Title' })
    expect(existsSync(pdfFile(id))).toBe(false)
    await expect(verifyCapture(id)).resolves.toMatchObject({ status: 'verified' })
  }, 30_000)

  it.each([
    {
      name: 'printToPDF never settles',
      arrange: () => {
        ctl.printHangs = true
      },
      bound: 'The print did not settle within 5000ms',
      prints: true
    },
    {
      name: 'the page is taller than the layout bound',
      arrange: () => {
        ctl.contentHeight = MAX_PDF_CONTENT_HEIGHT_PX + 1
      },
      bound: 'over MAX_PDF_CONTENT_HEIGHT_PX',
      prints: false
    },
    {
      name: 'printToPDF returns a PDF over MAX_PDF_SIZE',
      arrange: () => {
        ctl.pdfBytes = Buffer.allocUnsafe(MAX_PDF_SIZE + 1)
      },
      bound: 'over MAX_PDF_SIZE',
      prints: true
    }
  ])(
    'stores the Capture with the PDF absent as failed, and no .pdf file, when $name',
    async ({ arrange, bound, prints }) => {
      arrange()
      const logged = vi.spyOn(logger, 'error')
      const startedAt = Date.now()
      const { id, entry } = await recaptureOnce()
      expect(Date.now() - startedAt).toBeLessThan(30_000)
      expect(ctl.order.includes('printToPDF')).toBe(prints)
      expect(entry).toMatchObject({ inventory: { pdf: { present: false, reason: 'failed' } } })
      expect(entry).not.toHaveProperty('pdfHash')
      expect(existsSync(pdfFile(id))).toBe(false)
      expect(getCapture(id)!.pdfHash).toBeUndefined()
      await expect(verifyCapture(id)).resolves.toMatchObject({ status: 'verified' })
      // Logged once the Capture is stored, naming the bound.
      const notices = logged.mock.calls.filter(
        ([, code]) => code === 'backgroundRenderer.pdf_failed'
      )
      expect(notices).toHaveLength(1)
      expect(String(notices[0][3])).toContain(bound)
    },
    30_000
  )
})
