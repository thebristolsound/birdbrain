import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { EgressSetting, LaunchedBrowserStatus } from '@shared/types'
import { EgressUnavailableError } from '@main/services/egress'
import { createSessionService } from '@main/services/session'
import type { CdpResult } from '@main/services/launchedBrowser/commands'
import {
  prepareEgressChecks,
  type EgressCheckDeps
} from '@main/services/launchedBrowser/egressChecks'
import { launchBrowser, type LauncherDeps } from '@main/services/launchedBrowser/launcher'
import {
  createLaunchedBrowserService,
  type LaunchedBrowserService
} from '@main/services/launchedBrowser/service'
import {
  FAKE_VERSION,
  fakeBrowser,
  settle,
  targetInfo,
  type FakeBrowserOptions,
  type FakeReply,
  type SentCommand
} from '../../../helpers/fakeLaunchedBrowser'

const CHROME = {
  family: 'chrome' as const,
  label: 'Google Chrome',
  executablePath: '/opt/google/chrome/chrome'
}
const DIRECT: EgressSetting = { kind: 'direct' }
const PROXY: EgressSetting = { kind: 'proxy', proxyUrl: 'socks5://10.0.0.2:1080', label: 'Office' }
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'

let sessionData: string

beforeEach(() => {
  sessionData = mkdtempSync(join(tmpdir(), 'birdbrain-launched-service-'))
})

afterEach(() => {
  rmSync(sessionData, { recursive: true, force: true })
})

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown }).code
}

// Answers the WebRTC check on the first tab with `count` candidates, then defers to `next`.
function webRtc(count: number, next?: FakeBrowserOptions['respond']) {
  return (command: SentCommand): FakeReply | undefined => {
    if (command.method === 'Page.createIsolatedWorld') return { result: { executionContextId: 7 } }
    if (command.method === 'Runtime.evaluate') {
      return { result: { result: { type: 'number', value: count } } }
    }
    return next?.(command)
  }
}

function reportsVersion(product: string): FakeBrowserOptions['respond'] {
  return ({ method }) =>
    method === 'Browser.getVersion'
      ? { result: { ...FAKE_VERSION, product } satisfies CdpResult<'Browser.getVersion'> }
      : undefined
}

function responseFrom(remoteIPAddress: string, remotePort: number) {
  return {
    requestId: 'r1',
    loaderId: 'l1',
    timestamp: 1,
    type: 'Document',
    response: { url: 'https://site.example/', status: 200, remoteIPAddress, remotePort }
  }
}

interface HarnessOptions {
  egress?: EgressSetting
  operatorName?: string
  browser?: FakeBrowserOptions
  launcher?: Omit<LauncherDeps, 'spawn'>
  egressChecks?: EgressCheckDeps
  saveVersion?: (executablePath: string, version: string) => void
  now?: () => number
}

function harness(options: HarnessOptions = {}) {
  const { egress = DIRECT, operatorName = 'Matt', launcher, egressChecks } = options
  const settings = { operatorName, egress }
  const statuses: LaunchedBrowserStatus[] = []
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const saveVersion = vi.fn(options.saveVersion ?? (() => {}))
  const egressListeners = new Set<() => void>()
  const fakes: ReturnType<typeof fakeBrowser>[] = []
  const ref: { service?: LaunchedBrowserService } = {}
  const session = createSessionService({
    onSessionEnded: () => ref.service?.sessionEnded(),
    now: options.now
  })
  const browserOptions = options.browser ?? (egress.kind === 'direct' ? {} : { respond: webRtc(0) })
  const service = createLaunchedBrowserService({
    session,
    sessionDataPath: sessionData,
    readSettings: () => settings,
    saveVersion,
    launch: (request) => {
      const fake = fakeBrowser(browserOptions)
      fakes.push(fake)
      return launchBrowser(request, { spawn: fake.spawn, ...launcher })
    },
    prepareEgress: (setting, label) =>
      prepareEgressChecks(setting, label, { connect: async () => {}, ...egressChecks }),
    subscribeEgressChange: (listener) => {
      egressListeners.add(listener)
      return () => egressListeners.delete(listener)
    },
    emitStatus: (status) => statuses.push(status),
    log
  })
  ref.service = service
  const changeEgress = (next: EgressSetting): void => {
    settings.egress = next
    for (const listener of egressListeners) listener()
  }
  const browser = () => {
    const fake = fakes.at(-1)
    if (!fake) throw new Error('no browser was spawned')
    return fake.browser
  }
  return { service, session, settings, statuses, log, saveVersion, fakes, browser, changeEgress }
}

async function until(check: () => boolean, turns = 200): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    if (check()) return
    await settle(1)
  }
  throw new Error('the condition was not met')
}

function sessionFolders(): string[] {
  const root = join(sessionData, 'launched-browsers')
  return existsSync(root) ? readdirSync(root) : []
}

describe('launching a browser', () => {
  it('starts a Capture Session on the Active Case once the browser has answered', async () => {
    const seen: boolean[] = []
    const h = harness({
      browser: {
        respond: ({ method }) => {
          if (method === 'Browser.getVersion') seen.push(h.session.snapshot().sessionActive)
          return undefined
        }
      }
    })
    h.session.activateCase('case-1')
    const status = await h.service.launch(CHROME)

    expect(seen).toEqual([false])
    expect(h.session.snapshot()).toMatchObject({ activeCaseId: 'case-1', sessionActive: true })
    const open: LaunchedBrowserStatus = {
      state: 'open',
      browser: {
        family: 'chrome',
        label: 'Google Chrome',
        caseId: 'case-1',
        version: '149.0.7827.55',
        extensionWarnings: [],
        sessionStartedAt: h.session.snapshot().startedAt,
        tabs: []
      }
    }
    expect(open.browser.sessionStartedAt).toEqual(expect.any(Number))
    expect(status).toEqual(open)
    expect(h.service.status()).toEqual(open)
    expect(h.statuses.map(({ state }) => state)).toEqual(['starting', 'open'])
    const [{ args }] = h.fakes[0].calls
    expect(args).toContain('--remote-debugging-pipe')
    expect(args.find((arg) => arg.startsWith('--user-data-dir='))).toMatch(
      new RegExp(`^--user-data-dir=${sessionData}/launched-browsers/session-[0-9a-f-]{36}/chrome$`)
    )
    await h.service.endCaptureSession()
  })

  it('joins a running Capture Session without starting it again', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    h.session.start()
    h.session.countCapture()
    await h.service.launch(CHROME)
    expect(h.session.snapshot()).toMatchObject({ sessionActive: true, captureCount: 1 })
    await h.service.endCaptureSession()
  })

  it('records the version the browser reported, by executable', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    expect(h.saveVersion).toHaveBeenCalledWith('/opt/google/chrome/chrome', '149.0.7827.55')
    await h.service.endCaptureSession()
  })

  it('still opens when the version cannot be saved, and logs it', async () => {
    const h = harness({
      saveVersion: () => {
        throw new Error('EACCES')
      }
    })
    h.session.activateCase('case-1')
    await expect(h.service.launch(CHROME)).resolves.toMatchObject({ state: 'open' })
    expect(h.log.warn).toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.version_save_failed',
      undefined,
      expect.any(Error)
    )
    await h.service.endCaptureSession()
  })

  it('pins the Active Case while the browser runs', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.session.activateCase('case-2')
    expect(h.session.snapshot().activeCaseId).toBe('case-1')
    await h.service.endCaptureSession()
    h.session.activateCase('case-2')
    expect(h.session.snapshot().activeCaseId).toBe('case-2')
  })
})

describe('refusing a launch before the browser starts', () => {
  it.each([[''], ['   ']])('refuses with no operator name (%j)', async (operatorName) => {
    const h = harness({ operatorName })
    h.session.activateCase('case-1')
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('NO_OPERATOR_NAME')
    expect((error as Error).message).toBe(
      'Operator name required. Configure your name in Birdbrain settings before launching ' +
        'a browser.'
    )
    expect(h.fakes).toEqual([])
    expect(h.session.snapshot().sessionActive).toBe(false)
    expect(h.statuses).toEqual([])
  })

  it('refuses with no Active Case', async () => {
    const h = harness()
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('NO_ACTIVE_CASE')
    expect((error as Error).message).toBe(
      'No active case selected. Open a Case before launching a browser.'
    )
    expect(h.fakes).toEqual([])
    expect(h.session.snapshot().sessionActive).toBe(false)
  })

  it('refuses a second browser while one runs, and the first keeps running', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_ALREADY_RUNNING')
    expect((error as Error).message).toBe(
      'Birdbrain runs one launched browser at a time, and Google Chrome is already open.'
    )
    expect(h.fakes).toHaveLength(1)
    expect(h.browser().exited).toBe(false)
    expect(h.service.status().state).toBe('open')
    await h.service.endCaptureSession()
  })

  it('refuses a second browser while the first is starting', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    const first = h.service.launch(CHROME)
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect((error as Error).message).toBe(
      'Birdbrain runs one launched browser at a time, and Google Chrome is still starting.'
    )
    await first
    expect(h.fakes).toHaveLength(1)
    await h.service.endCaptureSession()
  })

  it('refuses when the proxy accepts no connection, naming it, and spawns nothing', async () => {
    const h = harness({
      egress: PROXY,
      egressChecks: { connect: async () => Promise.reject(new Error('connect ECONNREFUSED')) }
    })
    h.session.activateCase('case-1')
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_PROXY_UNREACHABLE')
    expect((error as Error).message).toContain('socks5://10.0.0.2:1080')
    expect(h.fakes).toEqual([])
    expect(h.session.snapshot().sessionActive).toBe(false)
    expect(h.service.status()).toEqual({ state: 'none' })
    expect(h.log.warn).toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.launch_failed',
      undefined,
      error
    )
    h.session.activateCase('case-2')
    expect(h.session.snapshot().activeCaseId).toBe('case-2')
  })

  it('refuses when the Egress could not be read, and spawns nothing', async () => {
    const h = harness({ egress: { kind: 'unavailable' } })
    h.session.activateCase('case-1')
    await expect(h.service.launch(CHROME)).rejects.toBeInstanceOf(EgressUnavailableError)
    expect(h.fakes).toEqual([])
  })
})

describe('a launch that fails', () => {
  it.each([
    ['an unrecognized product', 'Firefox/150.0.1.2', 'BROWSER_UNRECOGNIZED'],
    ['a version below the floor', 'Chrome/148.0.7778.97', 'BROWSER_BELOW_FLOOR']
  ])('kills a browser reporting %s and starts no Capture Session', async (_, product, code) => {
    const h = harness({ browser: { respond: reportsVersion(product) } })
    h.session.activateCase('case-1')
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe(code)
    expect((error as Error).message).toContain(`Google Chrome reported ${product}`)
    expect(h.browser().signals).toContain('SIGKILL')
    expect(h.session.snapshot().sessionActive).toBe(false)
    expect(h.statuses.map(({ state }) => state)).toEqual(['starting', 'none'])
    expect(sessionFolders()).toEqual([])
    expect(h.saveVersion).not.toHaveBeenCalled()
  })

  it('kills a browser whose first tab gathers a WebRTC candidate', async () => {
    const h = harness({ egress: PROXY, browser: { respond: webRtc(1) } })
    h.session.activateCase('case-1')
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('EGRESS_WEBRTC_CANDIDATE')
    expect(h.browser().signals).toContain('SIGKILL')
    expect(h.session.snapshot().sessionActive).toBe(false)
  })

  it('closes the browser it started when the Active Case is deleted during the launch', async () => {
    const h = harness({
      browser: {
        respond: ({ method }) => {
          if (method === 'Browser.getVersion') h.session.deactivateCase()
          return undefined
        }
      }
    })
    h.session.activateCase('case-1')
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('ACTIVE_CASE_DELETED')
    expect((error as Error).message).toBe(
      'The Active Case was deleted while Google Chrome was starting, so Birdbrain closed the ' +
        'browser.'
    )
    expect(h.browser().exited).toBe(true)
    expect(h.session.snapshot()).toMatchObject({ activeCaseId: null, sessionActive: false })
    expect(h.service.status()).toEqual({ state: 'none' })
    expect(sessionFolders()).toEqual([])
  })

  it('stops a launch whose Capture Session ends while it starts', async () => {
    const h = harness({
      browser: {
        respond: ({ method }) => {
          if (method === 'Browser.getVersion') h.session.stop()
          return undefined
        }
      }
    })
    h.session.activateCase('case-1')
    h.session.start()
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_LAUNCH_CANCELLED')
    expect((error as Error).message).toBe(
      'The Capture Session ended while Google Chrome was starting, so Birdbrain stopped the launch.'
    )
    expect(h.browser().signals).toContain('SIGKILL')
    expect(h.session.snapshot().sessionActive).toBe(false)
    expect(h.log.warn).not.toHaveBeenCalled()
  })

  // The launcher stops watching its signal before it resumes the held tabs.
  it('closes a browser whose Capture Session ended as its held tabs resumed', async () => {
    const popup = targetInfo('popup', 'page', '')
    const h = harness({
      browser: {
        respond: ({ method, sessionId }) => {
          if (method === 'Target.setAutoAttach' && !sessionId) h.browser().attach(popup)
          if (method === 'Runtime.runIfWaitingForDebugger') h.session.stop()
          return undefined
        }
      }
    })
    h.session.activateCase('case-1')
    h.session.start()
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect((error as Error).message).toBe(
      'The Capture Session ended while Google Chrome was starting, so Birdbrain stopped the launch.'
    )
    expect(h.browser().methods()).toContain('Browser.close')
    expect(h.browser().exited).toBe(true)
    expect(h.session.snapshot().sessionActive).toBe(false)
    expect(h.service.status()).toEqual({ state: 'none' })
    expect(sessionFolders()).toEqual([])
  })
})

// The start dialog's checklist (`1e`) reads these steps.
describe('the steps of a launch', () => {
  function steps(statuses: LaunchedBrowserStatus[]): string[] {
    return statuses.map((status) =>
      status.state === 'starting' ? `starting:${status.step}` : status.state
    )
  }

  it('reaches the proxy, starts the browser, then checks its first tab', async () => {
    const h = harness({ egress: PROXY })
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    expect(steps(h.statuses)).toEqual([
      'starting:proxy',
      'starting:browser',
      'starting:first-tab',
      'open'
    ])
    await h.service.endCaptureSession()
  })

  it('has only the browser to start while the Egress is Direct', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    expect(steps(h.statuses)).toEqual(['starting:browser', 'open'])
    await h.service.endCaptureSession()
  })

  it('keeps the step when an extension warning changes the status', async () => {
    const h = harness({
      egress: PROXY,
      browser: {
        respond: webRtc(0, ({ method, sessionId }) => {
          if (method === 'Target.setAutoAttach' && !sessionId) {
            h.browser().event('Target.targetCreated', {
              targetInfo: targetInfo(
                'extension',
                'service_worker',
                `chrome-extension://${EXTENSION_ID}/background.js`
              )
            })
          }
          return undefined
        })
      }
    })
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    const warned = h.statuses.find(
      (status) => status.state === 'starting' && status.browser.extensionWarnings.length > 0
    )
    expect(warned).toMatchObject({ state: 'starting', step: 'browser' })
    await h.service.endCaptureSession()
  })
})

describe('cancelling a launch', () => {
  it('kills a browser that is starting and starts no Capture Session', async () => {
    const h = harness({
      browser: {
        respond: ({ method }) => {
          if (method === 'Browser.getVersion') h.service.cancelLaunch()
          return undefined
        }
      }
    })
    h.session.activateCase('case-1')
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_LAUNCH_CANCELLED')
    expect((error as Error).message).toBe('The launch was cancelled.')
    expect(h.browser().signals).toContain('SIGKILL')
    expect(h.session.snapshot().sessionActive).toBe(false)
    expect(h.service.status()).toEqual({ state: 'none' })
    expect(sessionFolders()).toEqual([])
    expect(h.log.warn).not.toHaveBeenCalled()
  })

  it('spawns nothing when the cancel comes during the proxy check', async () => {
    const h = harness({
      egress: PROXY,
      egressChecks: {
        connect: async () => {
          h.service.cancelLaunch()
        }
      }
    })
    h.session.activateCase('case-1')
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_LAUNCH_CANCELLED')
    expect(h.fakes.flatMap(({ calls }) => calls)).toEqual([])
    expect(h.service.status()).toEqual({ state: 'none' })
  })

  // Unlike endCaptureSession, which a join would end with it.
  it('leaves a running Capture Session running', async () => {
    const h = harness({
      browser: {
        respond: ({ method }) => {
          if (method === 'Browser.getVersion') h.service.cancelLaunch()
          return undefined
        }
      }
    })
    h.session.activateCase('case-1')
    h.session.start()
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_LAUNCH_CANCELLED')
    expect(h.session.snapshot()).toMatchObject({ activeCaseId: 'case-1', sessionActive: true })
    h.session.activateCase('case-2')
    expect(h.session.snapshot().activeCaseId).toBe('case-2')
  })

  it('closes a browser whose cancel came as its held tabs resumed', async () => {
    const popup = targetInfo('popup', 'page', '')
    const h = harness({
      browser: {
        respond: ({ method, sessionId }) => {
          if (method === 'Target.setAutoAttach' && !sessionId) h.browser().attach(popup)
          if (method === 'Runtime.runIfWaitingForDebugger') h.service.cancelLaunch()
          return undefined
        }
      }
    })
    h.session.activateCase('case-1')
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect((error as Error).message).toBe('The launch was cancelled.')
    expect(h.browser().methods()).toContain('Browser.close')
    expect(h.browser().exited).toBe(true)
    expect(h.session.snapshot().sessionActive).toBe(false)
    expect(sessionFolders()).toEqual([])
  })

  it('leaves an open browser open', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.service.cancelLaunch()
    expect(h.service.status().state).toBe('open')
    expect(h.browser().exited).toBe(false)
    await h.service.endCaptureSession()
  })
})

describe('the Capture Session and the browser', () => {
  it.each([
    ['stopping the Capture Session', 'stop'],
    ['deleting its Active Case', 'deactivateCase']
  ] as const)('%s closes the browser and removes its profile', async (_, how) => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    expect(sessionFolders()).toHaveLength(1)
    h.session[how]()
    await until(() => h.service.status().state === 'none')
    expect(h.browser().methods()).toContain('Browser.close')
    expect(h.browser().exited).toBe(true)
    expect(sessionFolders()).toEqual([])
    expect(h.service.status()).toEqual({ state: 'none' })
    expect(h.statuses.map(({ state }) => state)).toEqual(['starting', 'open', 'closing', 'none'])
  })

  it('resolves endCaptureSession once the browser has exited and its profile is gone', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    await h.service.endCaptureSession()
    expect(h.browser().exited).toBe(true)
    expect(sessionFolders()).toEqual([])
    expect(h.session.snapshot().sessionActive).toBe(false)
    expect(h.service.status()).toEqual({ state: 'none' })
  })

  it('keeps the Capture Session running when the browser closes on its own', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.browser().exit(0)
    await until(() => h.service.status().state === 'closed')
    expect(h.session.snapshot().sessionActive).toBe(true)
    expect(h.service.status()).toMatchObject({
      state: 'closed',
      browser: { label: 'Google Chrome', caseId: 'case-1' }
    })
    expect(sessionFolders()).toEqual([])
    h.session.activateCase('case-2')
    expect(h.session.snapshot().activeCaseId).toBe('case-2')
    h.session.stop()
    expect(h.service.status()).toEqual({ state: 'none' })
  })

  it('launches again into the Capture Session a closed browser left running', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.session.countCapture()
    h.browser().exit(0)
    await until(() => h.service.status().state === 'closed')
    await expect(h.service.launch(CHROME)).resolves.toMatchObject({ state: 'open' })
    expect(h.fakes).toHaveLength(2)
    expect(h.session.snapshot()).toMatchObject({ sessionActive: true, captureCount: 1 })
    await h.service.endCaptureSession()
  })
})

describe('the Egress while the browser runs', () => {
  it('ends the Capture Session and closes the browser on a response from outside the proxy', async () => {
    const h = harness({ egress: PROXY })
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.browser().event('Network.responseReceived', responseFrom('198.51.100.1', 443), 'session-1')
    await until(() => h.service.status().state === 'none')
    expect(h.session.snapshot().sessionActive).toBe(false)
    expect(h.browser().exited).toBe(true)
    expect(h.service.status()).toEqual({
      state: 'none',
      notice: {
        code: 'EGRESS_BYPASS',
        message:
          'A response in Google Chrome did not come through the Egress proxy, so Birdbrain ' +
          'ended the Capture Session and closed the browser.'
      }
    })
    expect(h.log.warn).toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.egress_bypass',
      undefined,
      expect.objectContaining({ code: 'EGRESS_BYPASS' })
    )
  })

  it('keeps the browser open for responses through the proxy', async () => {
    const h = harness({ egress: PROXY })
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.browser().event('Network.responseReceived', responseFrom('10.0.0.2', 1080), 'session-1')
    await settle()
    expect(h.service.status().state).toBe('open')
    await h.service.endCaptureSession()
  })

  it('ends the Capture Session and closes the browser when the Egress changes', async () => {
    const h = harness({ egress: PROXY })
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.changeEgress(DIRECT)
    expect(h.session.snapshot().sessionActive).toBe(false)
    await until(() => h.service.status().state === 'none')
    expect(h.browser().exited).toBe(true)
    expect(h.service.status()).toEqual({
      state: 'none',
      notice: {
        code: 'EGRESS_CHANGED',
        message:
          'The Egress changed, so Birdbrain ended the Capture Session and closed Google Chrome.'
      }
    })
    expect(h.log.info).toHaveBeenCalledWith('launchedBrowser', 'launchedBrowser.egress_changed')
  })

  it('stops a launch when the Egress changes while it starts', async () => {
    const h = harness({
      browser: {
        respond: ({ method }) => {
          if (method === 'Browser.getVersion') h.changeEgress(PROXY)
          return undefined
        }
      }
    })
    h.session.activateCase('case-1')
    const error = await h.service.launch(CHROME).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_LAUNCH_CANCELLED')
    expect((error as Error).message).toBe(
      'The Egress changed while Google Chrome was starting, so Birdbrain stopped the launch.'
    )
    expect(h.browser().signals).toContain('SIGKILL')
    expect(h.session.snapshot().sessionActive).toBe(false)
  })

  it('leaves the Capture Session alone when the Egress changes with no browser open', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.browser().exit(0)
    await until(() => h.service.status().state === 'closed')
    h.changeEgress(PROXY)
    expect(h.session.snapshot().sessionActive).toBe(true)
    expect(h.service.status().state).toBe('closed')
  })

  it('stops following the Egress once disposed', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.service.dispose()
    h.changeEgress(PROXY)
    expect(h.session.snapshot().sessionActive).toBe(true)
    await h.service.endCaptureSession()
  })
})

describe('extensions while the Egress is not Direct (D14)', () => {
  const extensionTarget = {
    targetInfo: targetInfo(
      'extension',
      'service_worker',
      `chrome-extension://${EXTENSION_ID}/background.js`
    )
  }

  it('warns in the status and keeps the Capture Session running', async () => {
    const h = harness({ egress: PROXY })
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.browser().event('Target.targetCreated', extensionTarget)
    await until(() => {
      const status = h.service.status()
      return status.state === 'open' && status.browser.extensionWarnings.length > 0
    })
    expect(h.service.status()).toMatchObject({
      state: 'open',
      browser: { extensionWarnings: [EXTENSION_ID] }
    })
    expect(h.session.snapshot().sessionActive).toBe(true)
    await h.service.endCaptureSession()
  })

  it('warns of nothing while the Egress is Direct', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.browser().event('Target.targetCreated', extensionTarget)
    await settle()
    expect(h.service.status()).toMatchObject({ browser: { extensionWarnings: [] } })
    await h.service.endCaptureSession()
  })
})

describe('what the panel shows of the browser', () => {
  function page(targetId: string, title: string, url: string) {
    return { targetInfo: { ...targetInfo(targetId, 'page', url), title } }
  }

  it('carries the tab list in the status, and each change goes out', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    const before = h.statuses.length
    h.browser().event('Target.targetCreated', page('first-tab', '', 'about:blank'))
    h.browser().event('Target.targetCreated', page('t2', 'Harbor notices', 'https://ferry.test/'))
    await until(() => h.statuses.length === before + 2)
    expect(h.service.status()).toMatchObject({
      state: 'open',
      browser: {
        tabs: [
          { targetId: 'first-tab', title: '', url: 'about:blank' },
          { targetId: 't2', title: 'Harbor notices', url: 'https://ferry.test/' }
        ]
      }
    })
    expect(h.statuses.at(-1)).toEqual(h.service.status())
    await h.service.endCaptureSession()
  })

  it('empties the tab list once the browser has closed on its own', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.browser().event('Target.targetCreated', page('first-tab', '', 'about:blank'))
    await until(() => {
      const status = h.service.status()
      return status.state === 'open' && status.browser.tabs.length === 1
    })
    h.browser().exit(0)
    await until(() => h.service.status().state === 'closed')
    expect(h.service.status()).toMatchObject({ state: 'closed', browser: { tabs: [] } })
    h.session.stop()
  })

  it('gives the start of the Capture Session the browser joined, not of the launch', async () => {
    let clock = 1_000
    const h = harness({ now: () => clock })
    h.session.activateCase('case-1')
    h.session.start()
    clock = 61_000
    await h.service.launch(CHROME)
    expect(h.service.status()).toMatchObject({ browser: { sessionStartedAt: 1_000 } })
    await h.service.endCaptureSession()
  })

  it('gives the start of the Capture Session a launch started', async () => {
    let clock = 5_000
    const h = harness({ now: () => clock })
    h.session.activateCase('case-1')
    const starting = h.service.launch(CHROME)
    expect(h.service.status()).toMatchObject({ browser: { sessionStartedAt: null } })
    clock = 7_000
    await starting
    expect(h.service.status()).toMatchObject({ browser: { sessionStartedAt: 7_000 } })
    await h.service.endCaptureSession()
  })
})

describe('a tab whose setup fails', () => {
  it('is logged, and the browser stays open', async () => {
    const h = harness({
      browser: {
        respond: ({ method, sessionId }) =>
          method === 'Network.enable' && sessionId === 'session-2'
            ? { error: { message: 'Target closed' } }
            : undefined
      }
    })
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.browser().attach(targetInfo('popup', 'page', ''))
    await until(() => h.log.warn.mock.calls.length > 0)
    expect(h.log.warn).toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.target_setup_failed',
      undefined,
      expect.objectContaining({ code: 'CDP_COMMAND_FAILED' })
    )
    expect(h.service.status().state).toBe('open')
    await h.service.endCaptureSession()
  })
})

describe('quitting and a browser that will not close', () => {
  it('kills the browser at once on quit', async () => {
    const h = harness()
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    h.service.killForQuit()
    expect(h.browser().signals).toEqual(['SIGKILL'])
  })

  it('kills a browser that is still starting on quit', async () => {
    const h = harness({
      browser: {
        respond: ({ method }) => (method === 'Browser.getVersion' ? 'silent' : undefined)
      }
    })
    h.session.activateCase('case-1')
    const launching = h.service.launch(CHROME)
    launching.catch(() => {})
    await until(() => h.fakes.length === 1)
    h.service.killForQuit()
    expect(h.browser().signals).toEqual(['SIGKILL'])
    expect(codeOf(await launching.catch((err: unknown) => err))).toBe('BROWSER_LAUNCH_CANCELLED')
  })

  it('reports a browser that does not exit after the kill, and frees the slot', async () => {
    const h = harness({
      browser: { exitOnClose: false, exitOnKill: false },
      launcher: { timeouts: { closeMs: 5, killMs: 5 } }
    })
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    await h.service.endCaptureSession()
    expect(h.service.status()).toEqual({
      state: 'none',
      notice: {
        code: 'BROWSER_DID_NOT_EXIT',
        message: 'Google Chrome did not exit after Birdbrain killed it.'
      }
    })
    expect(h.log.error).toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.stop_failed',
      undefined,
      expect.objectContaining({ code: 'BROWSER_DID_NOT_EXIT' })
    )
  })

  it('logs a throwaway profile it could not remove', async () => {
    const h = harness({
      launcher: {
        removeProfile: () => {
          throw new Error('EBUSY')
        }
      }
    })
    h.session.activateCase('case-1')
    await h.service.launch(CHROME)
    await h.service.endCaptureSession()
    expect(h.log.warn).toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.profile_remove_failed',
      undefined,
      expect.any(Error)
    )
    expect(h.service.status()).toEqual({ state: 'none' })
  })
})
