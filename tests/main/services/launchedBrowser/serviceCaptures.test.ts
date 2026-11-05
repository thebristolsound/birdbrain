import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { LaunchedBrowserStatus } from '@shared/types'
import type { LaunchedAdmissionRequest } from '@main/services/captureLifecycle'
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
  MACOS_CAPTURE_UNAVAILABLE
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
  const capture = vi.fn(
    options.capture ?? (async (input) => artifacts(`https://a.test/${input.tabId}`))
  )
  const fakes: ReturnType<typeof fakeBrowser>[] = []
  const ref: { stop?: () => void } = {}
  const session = createSessionService({ onSessionEnded: () => ref.stop?.() })
  const service = createLaunchedBrowserService({
    session,
    sessionDataPath: sessionData,
    readSettings: () => ({ operatorName: 'Matt', egress: { kind: 'direct' } }),
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
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    platform: options.platform ?? 'linux',
    shortcut: { register, unregister },
    emitPickTab,
    captures: {
      sink: {
        screenLaunched: () => null,
        abandonedLaunched: vi.fn(),
        admit: async (request) => {
          admitted.push(request)
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

  it('lists a tab in a private window with the reason and never captures it', async () => {
    const h = harness()
    await h.open()
    const priv = {
      ...targetInfo('private-tab', 'page', 'https://a.test/'),
      browserContextId: 'other'
    }
    h.browser().attach(priv)
    h.browser().event('Target.targetCreated', { targetInfo: priv })
    await settle()
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
    expect(h.admitted).toEqual([])
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

  it('captures the one visible, focused tab', async () => {
    const h = harness({ browser: { respond: focus(true, true) } })
    await h.open()
    await h.loadFirstTab()
    await h.service.shortcutPressed()
    expect(h.capture).toHaveBeenCalledTimes(1)
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
})

// The maintainer's ruling of 2026-11-05 on P7.
describe('on macOS', () => {
  it('offers no launched Capture and registers no shortcut', async () => {
    const h = harness({ platform: 'darwin' })
    await h.open()
    await h.loadFirstTab()
    const status = h.service.status()
    expect(status.state === 'open' && status.browser.captureUnavailable).toBe(
      MACOS_CAPTURE_UNAVAILABLE
    )
    expect(status.state === 'open' && status.browser.shortcut).toBeUndefined()
    expect(h.register).not.toHaveBeenCalled()
    await expect(h.service.capture('first-tab', { scrollToLoad: false })).rejects.toMatchObject({
      code: 'LAUNCHED_CAPTURE_UNAVAILABLE'
    })
    await h.service.shortcutPressed()
    expect(h.capture).not.toHaveBeenCalled()
    expect(h.admitted).toEqual([])
  })
})
