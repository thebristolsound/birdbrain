import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { writeFileSync } from 'fs'
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
import { ScrollToLoadRecordSchema } from '@shared/schemas'
import { RefusedAddressError } from '@main/services/localAddressPolicy'
import { EgressUnavailableError } from '@main/services/egress'
import type { EgressSetting } from '@shared/types'

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
  calls: [] as string[]
}))

type Handler = (...args: unknown[]) => void

interface FakeWindow {
  destroyed: boolean
  webContents: FakeWebContents
  isDestroyed(): boolean
  destroy(): void
}

interface FakeWebContents {
  handlers: Map<string, Handler>
  session: unknown
  debugger: {
    attached: boolean
    attach(): void
    isAttached(): boolean
    detach(): void
    sendCommand(cmd: string): Promise<unknown>
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
    setProxy: vi.fn(async (config: unknown) => {
      ctl.calls.push(`setProxy ${JSON.stringify(config)}`)
    })
  })

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
          attach() {
            this.attached = true
          },
          isAttached() {
            return this.attached
          },
          detach() {
            this.attached = false
          },
          async sendCommand(cmd: string) {
            if (cmd === 'Page.getLayoutMetrics') {
              return { cssContentSize: { x: 0, y: 0, width: 100, height: 100 } }
            }
            if (cmd === 'Page.captureScreenshot') return { data: ctl.pngBase64 }
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
        },
        async executeJavaScript(script: string) {
          if (script.includes('readyState')) return undefined
          if (script.includes("style.overflow = 'visible'")) return null
          if (script.includes('root.scrollTop + viewportHeight')) {
            // height at/above the scroll cap => the loop breaks after one step.
            return { y: 0, height: 25000, viewportHeight: 900 }
          }
          if (script.includes('window.scrollTo(0, 0)')) return undefined
          if (script.includes('innerText')) return 'hello world'
          return undefined
        },
        async savePage(path: string) {
          writeFileSync(path, 'From: test\r\n\r\nMHTML body')
        },
        getTitle() {
          return 'Mock Title'
        },
        getURL() {
          return 'https://example.test/final'
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
  app: { getPath: vi.fn(() => '/tmp') }
}))

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

  it('trims a page whose only content is its first row', async () => {
    const png = await pageWithTrailingBackground(400, 1000, 1, WHITE, RED)
    const { png: out, trimmed } = await trimTrailingBackground(png)
    expect(trimmed).toBe(true)
    expect(await heightOf(out)).toBe(9)
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

  it('records an end height of 0 when the page reports 0 for its height', async () => {
    const { wc } = scrollingContents({
      step: (call) => (call === 0 ? { y: 0, height: 0, viewportHeight: 900 } : null)
    })

    const record = await scrollUnderFakeTime(wc, 10_000)

    expect(record).toMatchObject({ outcome: 'nothing-to-scroll', endHeight: 0 })
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

  it.each([
    ['falls at every step', (call: number) => 20_000 - call * 100],
    ['moves down and up at every step', (call: number) => (call % 2 === 0 ? 3000 : 2900)]
  ])('runs to the deadline at the bottom of a page whose height %s', async (_name, heightAt) => {
    const { wc } = scrollingContents({
      step: (call) => {
        const height = heightAt(call)
        return { y: height - 900, height, viewportHeight: 900 }
      }
    })

    const record = await scrollUnderFakeTime(wc, 10_000)

    expect(record).toMatchObject({ outcome: 'time-budget' })
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
// [0, scrollHeight - clientHeight]. With overflow: hidden it does not move,
// which models a document that cannot move from script, as in a Chromium page
// with no doctype. A standards-mode document with overflow: hidden still moves.
class FakeScroller {
  scrollTop = 0
  style = { overflow: '' }
  constructor(
    readonly name: string,
    public scrollHeight: number,
    readonly clientHeight: number
  ) {}
  scrollTo({ top }: { top: number }) {
    if (this.style.overflow === 'hidden') return
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

// A WebContents that runs every script of the phase, the unlock, the steps and
// the reset, against a document root with no inner boxes, in a 900px-tall window.
function pageContents(doc: FakeScroller, body: { style: { overflow: string } }): WebContents {
  const context = {
    document: { scrollingElement: doc, documentElement: doc, body, querySelectorAll: () => [] },
    window: { innerHeight: 900, scrollTo: () => {} }
  }
  const wc = {
    async executeJavaScript(script: string) {
      return runInNewContext(script, context)
    }
  }
  return wc as unknown as WebContents
}

// Whether the phase lifts a scroll lock, decided by the page's own scripts
// rather than a canned unlock result.
describe('the Scroll-to-load scroll lock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lifts no lock on a page that starts at its end', async () => {
    // A page loaded at a fragment near its bottom.
    const doc = new FakeScroller('document', 5000, 900)
    doc.scrollTop = 4100
    const body = { style: { overflow: '' } }

    const record = await scrollUnderFakeTime(pageContents(doc, body), 60_000)

    expect(record).toEqual({
      requested: true,
      ran: true,
      outcome: 'stopped-growing',
      endHeight: 5000,
      scrollLockLifted: false
    })
    expect([doc.style.overflow, body.style.overflow]).toEqual(['', ''])
  })

  it.each([
    ['at its top', 0],
    ['after it scrolled itself to its end', 4100]
  ])('lifts and restores the lock of a page locked %s', async (_name, startTop) => {
    const doc = new FakeScroller('document', 5000, 900)
    doc.scrollTop = startTop
    doc.style.overflow = 'hidden'
    const body = { style: { overflow: 'hidden' } }

    const record = await scrollUnderFakeTime(pageContents(doc, body), 60_000)

    expect(record).toEqual({
      requested: true,
      ran: true,
      outcome: 'stopped-growing',
      endHeight: 5000,
      scrollLockLifted: true
    })
    expect([doc.style.overflow, body.style.overflow]).toEqual(['hidden', 'hidden'])
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

  // Each check on its own: the rest of the image is a real PNG's.
  it.each([
    ['is cut off before the end of its header', (png: Buffer) => png.subarray(0, 23)],
    [
      'has a wrong signature byte',
      (png: Buffer) => Buffer.concat([Buffer.from([0]), png.subarray(1)])
    ],
    [
      'does not start with an IHDR chunk',
      (png: Buffer) => Buffer.concat([png.subarray(0, 12), Buffer.from('IDAT'), png.subarray(16)])
    ]
  ])('fails the render on an image that %s', async (_name, damage) => {
    const { wc } = screenshotContents({ width: 16, height: 8 }, damage(await solid(16, 8)))

    await expect(captureFullPageScreenshot(wc)).rejects.toThrow('The screenshot is not a PNG')
  })
})

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
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders a page end-to-end and returns forensic artifacts', async () => {
    const consentBlocker = {
      enableBlockingInSession: vi.fn(),
      isBlockingEnabled: vi.fn(() => true),
      disableBlockingInSession: vi.fn()
    }
    ctl.blocker = consentBlocker

    const result = await renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })

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
    const result = await renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })
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
    const result = await renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })
    expect(result.consentSuppression).toBeUndefined()
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
  }, 30_000)

  it('destroys the window and cleans up when the navigation fails', async () => {
    ctl.loadUrlShouldReject = true

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })
    ).rejects.toThrow(/navigation failed/)

    // The error path destroys the window and removes the temp MHTML file.
    expect(ctl.lastWindow!.isDestroyed()).toBe(true)
  }, 30_000)

  it('rejects when the render exceeds the timeout budget', async () => {
    // A load that never settles lets the deadline timer win the race.
    ctl.loadUrlShouldHang = true

    await expect(
      renderPageInHiddenWindow('https://example.test/hang', { timeoutMs: 50 })
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

      const render = renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })
      await expect(render).rejects.toThrow(RefusedAddressError)
      await expect(render).rejects.toThrow(reason)

      expect(ctl.lastHop!.preventDefault).toHaveBeenCalledTimes(1)
      expect(ctl.lastWindow!.isDestroyed()).toBe(true)
    },
    30_000
  )

  it('follows a redirect hop to a public address', async () => {
    ctl.hop = { event: 'will-redirect', url: 'https://example.org/next', isMainFrame: true }

    const result = await renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })

    expect(ctl.lastHop!.preventDefault).not.toHaveBeenCalled()
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
  }, 30_000)

  it('puts the Egress proxy and the WebRTC policy on the partition before the first load', async () => {
    ctl.egress = { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9150', label: 'Tor Browser' }

    const result = await renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })

    expect(ctl.calls.slice(0, 3)).toEqual([
      'setProxy {"mode":"fixed_servers","proxyRules":"socks5://127.0.0.1:9150","proxyBypassRules":"<-loopback>"}',
      'webrtc disable_non_proxied_udp',
      'loadURL https://example.test/'
    ])
    expect(result.egress).toEqual({ kind: 'tor', label: 'Tor Browser' })
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
  }, 30_000)

  it('leaves the partition alone and reports no Egress while it is Direct', async () => {
    const result = await renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })

    expect(ctl.calls).toEqual(['loadURL https://example.test/'])
    expect(result.egress).toBeUndefined()
    for await (const _chunk of result.mhtmlStream) void _chunk
    await result.cleanup()
  }, 30_000)

  it('names the proxy when the load fails at it', async () => {
    ctl.egress = { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: '' }
    ctl.loadUrlError = "ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://example.test/'"

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })
    ).rejects.toThrow(
      "Could not go through the Egress proxy socks5://127.0.0.1:1080: ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://example.test/'"
    )
    expect(ctl.lastWindow!.isDestroyed()).toBe(true)
  }, 30_000)

  it('names the proxy when Chromium finds no usable proxy in the rules', async () => {
    ctl.egress = { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: '' }
    ctl.loadUrlError = "ERR_NO_SUPPORTED_PROXIES (-336) loading 'https://example.test/'"

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })
    ).rejects.toThrow('Could not go through the Egress proxy socks5://127.0.0.1:1080')
  }, 30_000)

  it('passes any other load failure through unchanged while a proxy is set', async () => {
    ctl.egress = { kind: 'proxy', proxyUrl: 'http://10.1.2.3:3128', label: '' }
    ctl.loadUrlError = "ERR_NAME_NOT_RESOLVED (-105) loading 'https://example.test/'"

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })
    ).rejects.toThrow(/^ERR_NAME_NOT_RESOLVED/)
  }, 30_000)
  it('makes no window and sends nothing while the saved Egress cannot be read', async () => {
    ctl.egress = { kind: 'unavailable' }
    const before = ctl.createdWindows

    await expect(
      renderPageInHiddenWindow('https://example.test/', { timeoutMs: 30_000 })
    ).rejects.toThrow(EgressUnavailableError)

    expect(ctl.createdWindows).toBe(before)
    expect(ctl.calls).toEqual([])
  }, 30_000)
})
