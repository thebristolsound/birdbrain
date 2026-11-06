import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { EgressSetting, LaunchedBrowserStatus } from '@shared/types'
import type {
  AdmissionOutcome,
  AdmissionRefusal,
  LaunchedAdmissionRequest
} from '@main/services/captureLifecycle'
import { createSessionService } from '@main/services/session'
import type {
  TabCaptureArtifacts,
  TabCaptureInput
} from '@main/services/launchedBrowser/captureTab'
import { prepareEgressChecks } from '@main/services/launchedBrowser/egressChecks'
import { launchBrowser } from '@main/services/launchedBrowser/launcher'
import {
  CAPTURE_SHORTCUT,
  createLaunchedBrowserService,
  MACOS_UNAVAILABLE
} from '@main/services/launchedBrowser/service'
import {
  fakeBrowser,
  settle,
  targetInfo,
  type FakeBrowserOptions
} from '../../../helpers/fakeLaunchedBrowser'

// Clicked Captures through the launched-browser service (#1832): the tab flags, the refusals,
// the shortcut and the macOS gate, on the fake browser with the Capture sequence stood in for.

const CHROME = {
  family: 'chrome' as const,
  label: 'Google Chrome',
  executablePath: '/opt/google/chrome/chrome'
}
const FIRST = { ...targetInfo('first-tab'), browserContextId: 'default-context' }

let sessionData: string

beforeEach(() => {
  sessionData = mkdtempSync(join(tmpdir(), 'birdbrain-launched-captures-'))
})

afterEach(() => {
  rmSync(sessionData, { recursive: true, force: true })
})

function artifacts(url: string): TabCaptureArtifacts {
  return {
    capturedAt: '2026-11-05T12:00:00.000Z',
    url,
    title: 'Page',
    httpStatus: 200,
    mhtml: Buffer.from('mhtml'),
    screenshot: Buffer.from('png'),
    text: 'text',
    inventory: {
      mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
      transactionRecord: { present: false, reason: 'page-not-recorded' },
      screenshot: {
        present: true,
        scaled: false,
        truncated: false,
        trimmed: false,
        contentWidth: 1,
        contentHeight: 1,
        width: 1,
        height: 1
      },
      pdf: { present: false, reason: 'failed' }
    },
    boundTlsAbsent: 'not-recorded',
    errors: []
  }
}

interface Options {
  egress?: EgressSetting
  screen?: (caseId: string, url: string, committedUrl?: string) => AdmissionRefusal | null
  admit?: (request: LaunchedAdmissionRequest) => Promise<AdmissionOutcome>
  platform?: NodeJS.Platform
  registers?: boolean
  browser?: FakeBrowserOptions
  capture?: (input: TabCaptureInput) => Promise<TabCaptureArtifacts>
}

function harness(options: Options = {}) {
  const statuses: LaunchedBrowserStatus[] = []
  const admitted: LaunchedAdmissionRequest[] = []
  const register = vi.fn(() => options.registers ?? true)
  const unregister = vi.fn()
  const emitPickTab = vi.fn()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const abandonedLaunched = vi.fn()
  const capture = vi.fn(
    options.capture ?? (async (input) => artifacts(`https://a.test/${input.tabId}`))
  )
  const fakes: ReturnType<typeof fakeBrowser>[] = []
  const ref: { stop?: () => void } = {}
  const session = createSessionService({ onSessionEnded: () => ref.stop?.() })
  const service = createLaunchedBrowserService({
    session,
    sessionDataPath: sessionData,
    readSettings: () => ({ operatorName: 'Matt', egress: options.egress ?? { kind: 'direct' } }),
    saveVersion: () => {},
    launch: (request) => {
      const fake = fakeBrowser({ initialTargets: [FIRST], ...options.browser })
      fakes.push(fake)
      return launchBrowser(request, { spawn: fake.spawn, timeouts: { tabRefreshMs: 3_600_000 } })
    },
    prepareEgress: (setting, label) =>
      prepareEgressChecks(setting, label, { connect: async () => {} }),
    subscribeEgressChange: () => () => {},
    emitStatus: (status) => statuses.push(status),
    log,
    platform: options.platform ?? 'linux',
    shortcut: { register, unregister },
    emitPickTab,
    captures: {
      sink: {
        screenLaunched: options.screen ?? (() => null),
        abandonedLaunched,
        admit: async (request) => {
          admitted.push(request)
          if (options.admit) return options.admit(request)
          return {
            ok: true,
            capture: { id: 'capture-1', exhibitNumber: 12 } as never,
            contentHash: 'h',
            screenshotStatus: 'saved'
          }
        }
      },
      birdbrainVersion: 'test',
      citationOf: (_id, exhibitNumber) => `NK-${exhibitNumber}`,
      capture
    }
  })
  ref.stop = () => service.sessionEnded()
  const browser = () => {
    const fake = fakes.at(-1)
    if (!fake) throw new Error('no browser was spawned')
    return fake.browser
  }
  // The first tab commits an http page whose document request its session reported.
  const loadFirstTab = async (url = 'https://a.test/'): Promise<void> => {
    browser().event(
      'Network.requestWillBeSent',
      {
        requestId: 'D1',
        loaderId: 'D1',
        frameId: 'first-tab',
        type: 'Document',
        wallTime: 1,
        request: { url, method: 'GET', headers: {} }
      },
      'session-1'
    )
    browser().event(
      'Page.frameNavigated',
      { frame: { id: 'first-tab', loaderId: 'D1', url } },
      'session-1'
    )
    browser().event('Target.targetInfoChanged', { targetInfo: { ...FIRST, url, title: 'A' } })
    await settle()
  }
  const open = async () => {
    session.activateCase('case-1')
    await service.launch(CHROME)
  }
  const tabs = () => {
    const status = service.status()
    return status.state === 'open' ? status.browser.tabs : []
  }
  return {
    service,
    statuses,
    admitted,
    register,
    unregister,
    emitPickTab,
    capture,
    log,
    abandonedLaunched,
    browser,
    loadFirstTab,
    open,
    tabs
  }
}

describe('clicked Captures in the launched browser', () => {
  it('captures a recorded tab through the launched route and shows its Exhibit Number', async () => {
    const h = harness()
    await h.open()
    await h.loadFirstTab()
    expect(h.tabs()).toEqual([
      expect.objectContaining({ targetId: 'first-tab', firstRequest: true })
    ])
    expect(h.tabs()[0]).not.toHaveProperty('refusal')
    const status = await h.service.capture('first-tab', { scrollToLoad: true })
    expect(h.capture).toHaveBeenCalledWith(expect.objectContaining({ scrollToLoad: true }))
    expect(h.admitted).toEqual([
      expect.objectContaining({
        route: 'launched',
        caseId: 'case-1',
        url: 'https://a.test/first-tab',
        browser: { product: 'Chrome', version: '149.0.7827.55', family: 'chrome' }
      })
    ])
    expect(h.admitted[0]).not.toHaveProperty('egress')
    expect(status.state === 'open' && status.browser.capture).toEqual({
      state: 'captured',
      targetId: 'first-tab',
      captureId: 'capture-1',
      citation: 'NK-12'
    })
  })

  it('screens the address a same-document navigation moved the tab to', async () => {
    const screened: [string, string | undefined][] = []
    const h = harness({
      screen: (_caseId, url, committedUrl) => {
        screened.push([url, committedUrl])
        return { kind: 'excluded', pattern: 'a.test/private/*' }
      }
    })
    await h.open()
    await h.loadFirstTab('https://a.test/home')
    h.browser().event(
      'Page.navigatedWithinDocument',
      { frameId: 'first-tab', url: 'https://a.test/private/x' },
      'session-1'
    )
    await settle()
    await h.service.capture('first-tab', { scrollToLoad: false })
    expect(screened).toEqual([['https://a.test/private/x', 'https://a.test/home']])
    expect(h.capture).not.toHaveBeenCalled()
  })

  it('hands admission the committed URL the capture read, so exclusion screens it too', async () => {
    const h = harness({
      capture: async () => ({
        ...artifacts('https://a.test/settings'),
        committedUrl: 'https://a.test/inbox'
      })
    })
    await h.open()
    await h.loadFirstTab()
    await h.service.capture('first-tab', { scrollToLoad: false })
    expect(h.admitted).toEqual([
      expect.objectContaining({
        url: 'https://a.test/settings',
        committedUrl: 'https://a.test/inbox'
      })
    ])
  })

  it('refuses a tab whose address is not http or https, and takes nothing from it', async () => {
    const h = harness()
    await h.open()
    h.browser().event('Target.targetCreated', { targetInfo: FIRST })
    await settle()
    expect(h.tabs()[0]).toMatchObject({ targetId: 'first-tab', refusal: 'not-http' })
    const status = await h.service.capture('first-tab', { scrollToLoad: false })
    expect(status.state === 'open' && status.browser.capture).toMatchObject({ state: 'refused' })
    expect(h.capture).not.toHaveBeenCalled()
  })

  // A finished exchange on a session: a recorded tab fetches its body, an unrecorded one does not.
  const finishOn = (h: ReturnType<typeof harness>, sessionId: string, requestId: string) => {
    const url = 'https://a.test/x'
    h.browser().event(
      'Network.requestWillBeSent',
      { requestId, loaderId: requestId, type: 'Other', wallTime: 2, request: { url } },
      sessionId
    )
    h.browser().event('Network.responseReceived', { requestId, response: { url } }, sessionId)
    h.browser().event('Network.loadingFinished', { requestId }, sessionId)
  }
  const respond: FakeBrowserOptions['respond'] = ({ method }) =>
    method === 'Network.getResponseBody'
      ? { result: { body: Buffer.from('x').toString('base64'), base64Encoded: true } }
      : undefined
  const bodyFetches = (h: ReturnType<typeof harness>): string[] =>
    h
      .browser()
      .methods()
      .filter((method) => method.startsWith('Network.getResponseBody'))

  it.each(['file:///etc/hosts', 'chrome://settings/', 'data:text/html,x'])(
    'refuses a tab that committed %s, and takes nothing from it',
    async (url) => {
      const h = harness()
      await h.open()
      await h.loadFirstTab(url)
      expect(h.tabs()[0]).toMatchObject({ targetId: 'first-tab', refusal: 'not-http' })
      await h.service.capture('first-tab', { scrollToLoad: false })
      expect(h.capture).not.toHaveBeenCalled()
    }
  )

  it('lists a tab in a private window with the reason, and never records or captures it', async () => {
    const h = harness({ browser: { respond } })
    await h.open()
    await h.loadFirstTab()
    const priv = {
      ...targetInfo('private-tab', 'page', 'https://a.test/'),
      browserContextId: 'other'
    }
    const privateSession = h.browser().attach(priv)
    h.browser().event('Target.targetCreated', { targetInfo: priv })
    await settle()
    finishOn(h, privateSession, 'P1')
    finishOn(h, 'session-1', 'R1')
    await settle()
    expect(bodyFetches(h)).toEqual(['Network.getResponseBody@session-1'])
    expect(h.tabs().find(({ targetId }) => targetId === 'private-tab')).toMatchObject({
      refusal: 'private'
    })
    const status = await h.service.capture('private-tab', { scrollToLoad: false })
    expect(status.state === 'open' && status.browser.capture).toMatchObject({
      state: 'refused',
      message: expect.stringMatching(/private window/)
    })
    expect(h.capture).not.toHaveBeenCalled()
  })

  it("records and captures no tab when the browser does not name the first tab's context", async () => {
    const h = harness({ browser: { initialTargets: [targetInfo('first-tab')], respond } })
    await h.open()
    await h.loadFirstTab()
    finishOn(h, 'session-1', 'R1')
    await settle()
    expect(bodyFetches(h)).toEqual([])
    expect(h.tabs()[0]).toMatchObject({ targetId: 'first-tab', refusal: 'private' })
    await h.service.capture('first-tab', { scrollToLoad: false })
    expect(h.capture).not.toHaveBeenCalled()
  })

  it('records and captures no tab whose own context the browser does not name', async () => {
    const h = harness({ browser: { respond } })
    await h.open()
    const unnamed = targetInfo('unnamed-tab', 'page', 'https://a.test/')
    const unnamedSession = h.browser().attach(unnamed)
    h.browser().event('Target.targetCreated', { targetInfo: unnamed })
    await settle()
    finishOn(h, unnamedSession, 'U1')
    await settle()
    expect(bodyFetches(h)).toEqual([])
    expect(h.tabs().find(({ targetId }) => targetId === 'unnamed-tab')).toMatchObject({
      refusal: 'private'
    })
    await h.service.capture('unnamed-tab', { scrollToLoad: false })
    expect(h.capture).not.toHaveBeenCalled()
  })

  it('refuses a crashed tab until it loads again', async () => {
    const h = harness()
    await h.open()
    await h.loadFirstTab()
    h.browser().event('Target.targetCrashed', {
      targetId: 'first-tab',
      status: 'crashed',
      errorCode: 1
    })
    await settle()
    expect(h.tabs()[0]).toMatchObject({ refusal: 'crashed' })
    await h.service.capture('first-tab', { scrollToLoad: false })
    expect(h.capture).not.toHaveBeenCalled()
    await h.loadFirstTab()
    expect(h.tabs()[0]).not.toHaveProperty('refusal')
  })

  it('refuses a second Capture while the first is running', async () => {
    let finish: () => void = () => {}
    const h = harness({
      capture: (input) =>
        new Promise((resolve) => {
          finish = () => resolve(artifacts(`https://a.test/${input.tabId}`))
        })
    })
    await h.open()
    await h.loadFirstTab()
    const first = h.service.capture('first-tab', { scrollToLoad: false })
    await settle()
    expect(h.service.status()).toMatchObject({ browser: { capture: { state: 'capturing' } } })
    const second = await h.service.capture('first-tab', { scrollToLoad: false })
    expect(second.state === 'open' && second.browser.capture).toMatchObject({
      state: 'refused',
      message: expect.stringMatching(/already running/)
    })
    finish()
    await first
    expect(h.admitted).toHaveLength(1)
  })

  it('refuses a tab behind another in its window, storing nothing', async () => {
    const { TabNotInFront } = await import('@main/services/launchedBrowser/captureTab')
    const h = harness({ capture: async () => Promise.reject(new TabNotInFront()) })
    await h.open()
    await h.loadFirstTab()
    const status = await h.service.capture('first-tab', { scrollToLoad: false })
    expect(status.state === 'open' && status.browser.capture).toEqual({
      state: 'refused',
      targetId: 'first-tab',
      message: 'This tab is behind another in its window. Bring it to the front, then capture.'
    })
    expect(h.admitted).toEqual([])
  })

  it('shows an abandoned Capture and reports it, storing nothing', async () => {
    const { CaptureAbandoned } = await import('@main/services/launchedBrowser/captureTab')
    const h = harness({ capture: async () => Promise.reject(new CaptureAbandoned()) })
    await h.open()
    await h.loadFirstTab()
    const status = await h.service.capture('first-tab', { scrollToLoad: false })
    expect(status.state === 'open' && status.browser.capture).toEqual({
      state: 'abandoned',
      targetId: 'first-tab'
    })
    expect(h.abandonedLaunched).toHaveBeenCalledWith('https://a.test/')
    expect(h.admitted).toEqual([])
  })
})

describe('the Egress checks with Captures on', () => {
  const PROXY: EgressSetting = {
    kind: 'proxy',
    proxyUrl: 'socks5://10.0.0.2:1080',
    label: 'Office'
  }
  const responseFrom = (remoteIPAddress: string) => ({
    requestId: 'r1',
    loaderId: 'l1',
    timestamp: 1,
    type: 'Document',
    response: { url: 'https://a.test/', status: 200, remoteIPAddress, remotePort: 443 }
  })

  it('closes the browser on a response from outside the proxy, as the app runs it', async () => {
    // The WebRTC check at launch finds no peer connection.
    const h = harness({
      egress: PROXY,
      browser: {
        respond: ({ method }) => {
          if (method === 'Page.createIsolatedWorld') return { result: { executionContextId: 7 } }
          if (method === 'Runtime.evaluate') {
            return { result: { result: { type: 'number', value: 0 } } }
          }
          return undefined
        }
      }
    })
    await h.open()
    h.browser().event('Network.responseReceived', responseFrom('198.51.100.1'), 'session-1')
    await vi.waitFor(() => expect(h.service.status().state).toBe('none'))
    expect(h.service.status()).toMatchObject({ notice: { code: 'EGRESS_BYPASS' } })
    expect(h.browser().exited).toBe(true)
  })
})

describe('why a clicked Capture stored nothing', () => {
  const progressOf = (status: LaunchedBrowserStatus) =>
    status.state === 'open' ? status.browser.capture : undefined

  it('names the exclusion pattern that refused the page, before anything is taken', async () => {
    const h = harness({ screen: () => ({ kind: 'excluded', pattern: 'a.test' }) })
    await h.open()
    await h.loadFirstTab()
    expect(progressOf(await h.service.capture('first-tab', { scrollToLoad: false }))).toEqual({
      state: 'refused',
      targetId: 'first-tab',
      message: 'This Case excludes the page (a.test), so nothing was captured.'
    })
    expect(h.capture).not.toHaveBeenCalled()
  })

  it.each([
    [{ kind: 'operator_name_required' } as const, /Operator name required/],
    [{ kind: 'case_not_found' } as const, /no longer exists/],
    [{ kind: 'case_archived' } as const, /archived/],
    [
      { kind: 'failed', error: new Error('disk full') } as const,
      /could not be stored: Error: disk full/
    ],
    [{ kind: 'duplicate' } as const, /was refused/]
  ])('says why admission refused it (%o)', async (refusal, message) => {
    const h = harness({ admit: async () => ({ ok: false, refusal }) })
    await h.open()
    await h.loadFirstTab()
    expect(progressOf(await h.service.capture('first-tab', { scrollToLoad: false }))).toMatchObject(
      {
        state: 'refused',
        message: expect.stringMatching(message)
      }
    )
  })

  it('reports an artifact that failed, and the tab that has closed', async () => {
    const h = harness({ capture: async () => Promise.reject(new Error('screenshot failed')) })
    await h.open()
    await h.loadFirstTab()
    expect(progressOf(await h.service.capture('first-tab', { scrollToLoad: false }))).toEqual({
      state: 'failed',
      targetId: 'first-tab',
      message: 'screenshot failed'
    })
    h.browser().event('Target.targetDestroyed', { targetId: 'first-tab' })
    await settle()
    expect(progressOf(await h.service.capture('first-tab', { scrollToLoad: false }))).toMatchObject(
      {
        state: 'refused',
        message: 'That tab has closed.'
      }
    )
  })

  it('logs a Transaction Record or PDF that failed while the Capture stored', async () => {
    const part = new Error('print failed')
    const h = harness({
      capture: async (input) => ({ ...artifacts(`https://a.test/${input.tabId}`), errors: [part] })
    })
    await h.open()
    await h.loadFirstTab()
    expect(progressOf(await h.service.capture('first-tab', { scrollToLoad: false }))).toMatchObject(
      {
        state: 'captured'
      }
    )
    expect(h.log.warn).toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.capture_part_failed',
      undefined,
      part
    )
  })

  it('logs no stored Capture with a failed part when admission refuses it', async () => {
    const h = harness({
      capture: async (input) => ({
        ...artifacts(`https://a.test/${input.tabId}`),
        errors: [new Error('print failed')]
      }),
      admit: async () => ({ ok: false, refusal: { kind: 'excluded', pattern: 'a.test' } })
    })
    await h.open()
    await h.loadFirstTab()
    expect(progressOf(await h.service.capture('first-tab', { scrollToLoad: false }))).toMatchObject(
      { state: 'refused' }
    )
    expect(h.log.warn).not.toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.capture_part_failed',
      undefined,
      expect.anything()
    )
  })

  it('records the frames of a tab in the tab’s recording', async () => {
    const h = harness()
    await h.open()
    h.browser().attach(targetInfo('frame', 'iframe', 'https://b.test/'), {
      parentSessionId: 'session-1'
    })
    await settle()
    await h.loadFirstTab()
    expect(h.tabs()[0]).toMatchObject({ firstRequest: true })
  })
})

describe('the capture shortcut', () => {
  function focus(visible: boolean, focused: boolean): FakeBrowserOptions['respond'] {
    return ({ method }) => {
      if (method === 'Page.createIsolatedWorld') return { result: { executionContextId: 3 } }
      if (method === 'Runtime.evaluate') {
        return { result: { result: { type: 'object', value: { visible, focused } } } }
      }
      return undefined
    }
  }

  it('registers once the browser is open, never reports it as working, and unregisters at close', async () => {
    const h = harness()
    await h.open()
    expect(h.register).toHaveBeenCalledWith(CAPTURE_SHORTCUT, expect.any(Function))
    const status = h.service.status()
    expect(status.state === 'open' && status.browser.shortcut).toEqual({
      accelerator: CAPTURE_SHORTCUT,
      state: 'unknown'
    })
    await h.service.endCaptureSession()
    expect(h.unregister).toHaveBeenCalledWith(CAPTURE_SHORTCUT)
  })

  it('says so when Electron refuses the shortcut', async () => {
    const h = harness({ registers: false })
    await h.open()
    const status = h.service.status()
    expect(status.state === 'open' && status.browser.shortcut).toMatchObject({ state: 'failed' })
  })

  it('captures the one visible, focused tab, without Scroll-to-load', async () => {
    const h = harness({ browser: { respond: focus(true, true) } })
    await h.open()
    await h.loadFirstTab()
    await h.service.shortcutPressed()
    expect(h.capture).toHaveBeenCalledTimes(1)
    expect(h.capture).toHaveBeenCalledWith(expect.objectContaining({ scrollToLoad: false }))
    expect(h.emitPickTab).not.toHaveBeenCalled()
  })

  it('opens the tab picker and captures nothing when no tab qualifies', async () => {
    const h = harness({ browser: { respond: focus(true, false) } })
    await h.open()
    await h.loadFirstTab()
    await h.service.shortcutPressed()
    expect(h.capture).not.toHaveBeenCalled()
    expect(h.emitPickTab).toHaveBeenCalledTimes(1)
  })

  it('counts a tab whose focus cannot be read as not in front, and opens the tab picker', async () => {
    const h = harness({
      browser: {
        respond: ({ method }) =>
          method === 'Page.createIsolatedWorld' ? { error: { message: 'no frame' } } : undefined
      }
    })
    await h.open()
    await h.loadFirstTab()
    await expect(h.service.shortcutPressed()).resolves.toBeUndefined()
    expect(h.capture).not.toHaveBeenCalled()
    expect(h.emitPickTab).toHaveBeenCalledTimes(1)
  })
})

// The maintainer's ruling of 2026-11-05 on P7.
describe('on macOS', () => {
  it('refuses the launch before anything starts, and the status says why', async () => {
    const h = harness({ platform: 'darwin' })
    const none = { state: 'none', launchUnavailable: MACOS_UNAVAILABLE }
    expect(h.service.status()).toEqual(none)
    await expect(h.open()).rejects.toMatchObject({
      code: 'LAUNCHED_BROWSER_UNAVAILABLE',
      message: MACOS_UNAVAILABLE
    })
    expect(h.browser).toThrow('no browser was spawned')
    expect(h.statuses).toEqual([])
    expect(h.service.status()).toEqual(none)
  })

  it('refuses a Capture with the same reason, and the shortcut captures nothing', async () => {
    const h = harness({ platform: 'darwin' })
    await expect(h.open()).rejects.toThrow(MACOS_UNAVAILABLE)
    await expect(h.service.capture('first-tab', { scrollToLoad: false })).rejects.toMatchObject({
      code: 'LAUNCHED_CAPTURE_UNAVAILABLE',
      message: MACOS_UNAVAILABLE
    })
    await h.service.shortcutPressed()
    expect(h.capture).not.toHaveBeenCalled()
    expect(h.admitted).toEqual([])
  })
})
