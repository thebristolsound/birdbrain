import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { writeFileSync } from 'fs'
import sharp from 'sharp'
import { trimTrailingBackground, renderPageInHiddenWindow } from '@main/services/backgroundRenderer'
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
    const out = await trimTrailingBackground(png)
    // Last content row (999) + 1 + 8px padding.
    expect(await heightOf(out)).toBe(1008)
  })

  it('adapts to a non-white page background', async () => {
    const png = await pageWithTrailingBackground(400, 3000, 1000, DARK, WHITE)
    const out = await trimTrailingBackground(png)
    expect(await heightOf(out)).toBe(1008)
  })

  it('leaves a page that fills to the bottom untouched', async () => {
    const png = await pageWithTrailingBackground(400, 1000, 1000, WHITE, RED)
    const out = await trimTrailingBackground(png)
    expect(out).toBe(png)
  })

  it('leaves an all-background (blank) capture untouched', async () => {
    const png = await sharp({
      create: { width: 400, height: 2000, channels: 3, background: WHITE }
    })
      .png()
      .toBuffer()
    const out = await trimTrailingBackground(png)
    expect(out).toBe(png)
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

    const out = await trimTrailingBackground(png)
    expect(await heightOf(out)).toBe(2608)
  })

  it('returns the original buffer on undecodable input (fail-soft)', async () => {
    const junk = Buffer.from('not a png at all')
    const out = await trimTrailingBackground(junk)
    expect(out).toBe(junk)
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

    const out = await trimTrailingBackground(png)
    expect(await heightOf(out)).toBe(508)
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
    ['will-redirect', 'http://localhost/', 'Redirects to this computer'],
    ['will-redirect', 'http://intranet/', 'Redirects to a private network']
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
