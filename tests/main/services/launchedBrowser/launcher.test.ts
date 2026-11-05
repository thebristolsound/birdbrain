import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  TRANSACTION_RECORD_RESOURCE_BYTES,
  TRANSACTION_RECORD_TOTAL_BYTES
} from '@shared/constants'
import type { KnownEgress, LaunchedBrowserTab } from '@shared/types'
import type { CdpSession } from '@main/services/launchedBrowser/cdpClient'
import type { TargetInfo } from '@main/services/launchedBrowser/commands'
import { buildLaunchArgs } from '@main/services/launchedBrowser/launchArgs'
import {
  COMPONENT_EXTENSION_IDS,
  LAUNCHER_TIMEOUTS,
  TAB_TEXT_LIMIT,
  launchBrowser,
  type LaunchHooks,
  type LauncherDeps
} from '@main/services/launchedBrowser/launcher'
import { removeSessionProfile, type SessionProfile } from '@main/services/launchedBrowser/profiles'
import {
  FAKE_VERSION,
  fakeBrowser,
  settle,
  targetInfo,
  type FakeBrowserOptions
} from '../../../helpers/fakeLaunchedBrowser'
import { buildSuiteLaunchArgs } from '../../../helpers/launchedBrowserSuite'

const CHROME = {
  family: 'chrome' as const,
  label: 'Google Chrome',
  executablePath: '/opt/google/chrome/chrome'
}
const DIRECT: KnownEgress = { kind: 'direct' }
const TOR: KnownEgress = { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9050', label: 'Tor' }
const INSTALLED_EXTENSION = 'abcdefghijklmnopabcdefghijklmnop'
const OTHER_EXTENSION = 'ponmlkjihgfedcbaponmlkjihgfedcba'

let sessionData: string

beforeEach(() => {
  sessionData = mkdtempSync(join(tmpdir(), 'birdbrain-launcher-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(sessionData, { recursive: true, force: true })
})

interface Setup {
  options?: FakeBrowserOptions
  egress?: KnownEgress
  hooks?: LaunchHooks
  deps?: Omit<LauncherDeps, 'spawn'>
  signal?: AbortSignal
}

function start({ options, egress = DIRECT, hooks, deps, signal }: Setup = {}) {
  const fake = fakeBrowser(options)
  // The tab refresh is a timer; a test that wants it asks for it, so no other test's command
  // list depends on how long it ran.
  const launching = launchBrowser(
    { browser: CHROME, egress, sessionDataPath: sessionData, signal, hooks },
    { spawn: fake.spawn, ...deps, timeouts: { tabRefreshMs: 3_600_000, ...deps?.timeouts } }
  )
  // Asserted later; marked handled so an early rejection is not reported before then.
  launching.catch(() => {})
  return { ...fake, launching }
}

function profileDirOf(args: readonly string[]): string {
  const arg = args.find((value) => value.startsWith('--user-data-dir='))
  if (!arg) throw new Error('no --user-data-dir')
  return arg.slice('--user-data-dir='.length)
}

function sessionDirOf(args: readonly string[]): string {
  return join(profileDirOf(args), '..')
}

function paramsOf(commands: { method: string; sessionId?: string; params: object }[], at: string) {
  const found = commands.find(({ method, sessionId }) =>
    sessionId ? `${method}@${sessionId}` === at : method === at
  )
  if (!found) throw new Error(`${at} was not sent`)
  return found.params
}

async function launched(setup: Setup = {}) {
  const started = start(setup)
  const browser = await started.launching
  return { ...started, launched: browser }
}

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown }).code
}

describe('launchBrowser: starting', () => {
  it('spawns the executable on a fresh session profile with the owned list, not detached', async () => {
    const { calls, launched: handle } = await launched()
    expect(calls).toHaveLength(1)
    const [{ command, args, options }] = calls
    const profileDir = profileDirOf(args)
    expect(command).toBe(CHROME.executablePath)
    expect(profileDir).toMatch(
      new RegExp(`^${sessionData}/launched-browsers/session-[0-9a-f-]{36}/chrome$`)
    )
    expect(args).toEqual(buildLaunchArgs({ profileDir, egress: DIRECT }))
    expect(options).toEqual({
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
      detached: false
    })
    expect(handle.profile.profileDir).toBe(profileDir)
    expect(existsSync(profileDir)).toBe(true)
  })

  it('denies geolocation, discovers and auto-attaches, then sets up the start tab', async () => {
    const { browser, launched: handle } = await launched()
    expect(browser.methods()).toEqual([
      'Browser.getVersion',
      'Browser.setPermission',
      'Target.setDiscoverTargets',
      'Target.setAutoAttach',
      'Network.enable@session-1',
      'Network.setCacheDisabled@session-1',
      'Page.enable@session-1',
      'Target.setAutoAttach@session-1'
    ])
    const { commands } = browser
    expect(paramsOf(commands, 'Browser.setPermission')).toEqual({
      permission: { name: 'geolocation' },
      setting: 'denied'
    })
    expect(paramsOf(commands, 'Target.setDiscoverTargets')).toEqual({ discover: true })
    const autoAttach = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }
    expect(paramsOf(commands, 'Target.setAutoAttach')).toEqual(autoAttach)
    expect(paramsOf(commands, 'Target.setAutoAttach@session-1')).toEqual(autoAttach)
    expect(paramsOf(commands, 'Network.enable@session-1')).toEqual({
      maxTotalBufferSize: TRANSACTION_RECORD_TOTAL_BYTES,
      maxResourceBufferSize: TRANSACTION_RECORD_RESOURCE_BYTES
    })
    expect(paramsOf(commands, 'Network.setCacheDisabled@session-1')).toEqual({
      cacheDisabled: true
    })
    expect(handle.identity).toEqual({
      family: 'chrome',
      product: 'Chrome',
      version: '149.0.7827.55',
      userAgent: FAKE_VERSION.userAgent
    })
    expect(handle.firstTab.targetId).toBe('first-tab')
    expect(handle.firstTab.session.sessionId).toBe('session-1')
    expect(handle.pid).toBe(4242)
  })

  it('checks the start tab while every other tab waits, and resumes them once it passes', async () => {
    let duringCheck: string[] = []
    let checked: { targetId: string; sessionId: string } | undefined
    const fake = fakeBrowser()
    const checkFirstTab = async ({
      targetId,
      session
    }: {
      targetId: string
      session: CdpSession
    }) => {
      checked = { targetId, sessionId: session.sessionId }
      fake.browser.attach(targetInfo('popup', 'page', ''))
      fake.browser.attach(targetInfo('component', 'service_worker', 'chrome-extension://x/sw.js'))
      await settle()
      duringCheck = fake.browser.methods()
    }
    const handle = await launchBrowser(
      { browser: CHROME, egress: TOR, sessionDataPath: sessionData, hooks: { checkFirstTab } },
      { spawn: fake.spawn }
    )
    await settle()
    expect(checked).toEqual({ targetId: 'first-tab', sessionId: 'session-1' })
    expect(duringCheck).toContain('Network.enable@session-2')
    expect(duringCheck).toContain('Target.setAutoAttach@session-2')
    expect(duringCheck.filter((m) => m.startsWith('Runtime.runIfWaitingForDebugger'))).toEqual([])
    expect(fake.browser.methods().slice(duringCheck.length)).toEqual([
      'Runtime.runIfWaitingForDebugger@session-2',
      'Runtime.runIfWaitingForDebugger@session-3'
    ])
    await handle.stop()
  })

  it('kills the browser without resuming any tab when the start tab check fails', async () => {
    const refused = Object.assign(new Error('A WebRTC candidate was found'), { code: 'X' })
    const fake = fakeBrowser()
    const checkFirstTab = async () => {
      fake.browser.attach(targetInfo('popup', 'page', ''))
      await settle()
      throw refused
    }
    const launching = launchBrowser(
      { browser: CHROME, egress: TOR, sessionDataPath: sessionData, hooks: { checkFirstTab } },
      { spawn: fake.spawn }
    )
    await expect(launching).rejects.toBe(refused)
    expect(fake.browser.signals).toEqual(['SIGKILL'])
    expect(fake.browser.methods().some((m) => m.startsWith('Runtime.runIfWaiting'))).toBe(false)
    expect(existsSync(sessionDirOf(fake.calls[0].args))).toBe(false)
  })

  it('waits for the start tab behind a startup page of the browser, checking only the start tab', async () => {
    const startup = targetInfo('startup', 'page', 'chrome://brave-origin-startup/')
    const checkFirstTab = vi.fn(async () => {})
    const { browser, launching } = start({
      options: { initialTargets: [startup] },
      hooks: { checkFirstTab }
    })
    await settle()
    expect(checkFirstTab).not.toHaveBeenCalled()
    expect(browser.methods()).toContain('Network.enable@session-1')
    browser.attach(targetInfo('start-tab', 'page', 'about:blank'), { waiting: true })
    const handle = await launching
    expect(handle.firstTab.targetId).toBe('start-tab')
    expect(checkFirstTab).toHaveBeenCalledTimes(1)
    const methods = browser.methods()
    expect(methods.indexOf('Runtime.runIfWaitingForDebugger@session-2')).toBeGreaterThan(
      methods.indexOf('Network.enable@session-2')
    )
  })

  it('passes the argument list the caller builds, so the suite can add its own switches', async () => {
    const { calls } = await launched({ egress: TOR, deps: { buildArgs: buildSuiteLaunchArgs } })
    const { args } = calls[0]
    expect(args).toEqual(buildSuiteLaunchArgs({ profileDir: profileDirOf(args), egress: TOR }))
    expect(args).toContain('--proxy-bypass-list=<-loopback>')
  })

  it('removes the profile and spawns nothing when the argument list cannot be built', async () => {
    const invalid = new Error('The Egress proxy address is not usable')
    let profile: SessionProfile | undefined
    const { calls, launching } = start({
      deps: {
        buildArgs: ({ profileDir }) => {
          profile = { sessionDir: join(profileDir, '..'), profileDir }
          throw invalid
        }
      }
    })
    await expect(launching).rejects.toBe(invalid)
    expect(calls).toEqual([])
    expect(profile && existsSync(profile.sessionDir)).toBe(false)
  })

  it('reports an executable that cannot be started and removes its profile', async () => {
    const missing = Object.assign(new Error('spawn /opt/google/chrome/chrome ENOENT'), {
      code: 'ENOENT'
    })
    const { browser, calls, launching } = start({ options: { spawnError: missing } })
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_SPAWN_FAILED')
    expect((error as Error).message).toBe(
      'Google Chrome could not be started: spawn /opt/google/chrome/chrome ENOENT'
    )
    expect(browser.commands).toEqual([])
    expect(existsSync(sessionDirOf(calls[0].args))).toBe(false)
  })
  it('kills a process that came up without the debugging pipe', async () => {
    const { browser } = fakeBrowser()
    const noPipe = Object.assign(browser, { stdio: [null, null, null, null, null] })
    const error = await launchBrowser(
      { browser: CHROME, egress: DIRECT, sessionDataPath: sessionData },
      { spawn: () => noPipe }
    ).catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_SPAWN_FAILED')
    expect((error as Error).message).toBe('Google Chrome could not be started: no debugging pipe.')
    expect(browser.signals).toEqual(['SIGKILL'])
  })
})

describe('launchBrowser: refusing a browser', () => {
  it('kills a browser that does not answer within the start timeout, and only then', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { browser, calls, launching } = start({
      options: {
        respond: ({ method }) => (method === 'Browser.getVersion' ? 'silent' : undefined)
      }
    })
    browser.writeStderr('x'.repeat(10_000))
    browser.writeStderr('[ERROR:remote_debugging_server.cc] disabled by policy\n')
    await settle()
    vi.advanceTimersByTime(LAUNCHER_TIMEOUTS.connectMs - 1)
    await settle()
    expect(browser.signals).toEqual([])
    vi.advanceTimersByTime(1)
    const error = await launching.catch((err: unknown) => err)
    expect(browser.signals).toEqual(['SIGKILL'])
    expect(codeOf(error)).toBe('BROWSER_NO_CONNECTION')
    expect((error as Error).message).toBe(
      'Google Chrome did not open its debugging connection within 20 seconds, ' +
        'so Birdbrain closed it.'
    )
    const { diagnostic } = error as { diagnostic: string }
    expect(diagnostic).toContain('disabled by policy')
    expect(diagnostic.length).toBeLessThanOrEqual(4_200)
    expect(browser.methods()).toEqual(['Browser.getVersion'])
    expect(existsSync(sessionDirOf(calls[0].args))).toBe(false)
  })

  it('says the same of a browser that exits before it answers, giving the exit code', async () => {
    const { browser, calls, launching } = start({
      options: {
        respond: ({ method }) => (method === 'Browser.getVersion' ? 'silent' : undefined)
      }
    })
    await settle()
    browser.exit(21)
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_NO_CONNECTION')
    expect((error as Error).message).toBe(
      'Google Chrome did not open its debugging connection: it exited before answering.'
    )
    expect((error as { diagnostic: string }).diagnostic).toContain('exit code 21')
    expect(existsSync(sessionDirOf(calls[0].args))).toBe(false)
  })

  it.each([
    ['an unrecognized product', 'HeadlessChrome/149.0.7827.55', 'BROWSER_UNRECOGNIZED'],
    ['a version below the floor', 'Chrome/149.0.7827.54', 'BROWSER_BELOW_FLOOR']
  ])('kills a browser reporting %s and names what it reported', async (_, product, code) => {
    const { browser, calls, launching } = start({
      options: {
        respond: ({ method }) =>
          method === 'Browser.getVersion' ? { result: { ...FAKE_VERSION, product } } : undefined
      }
    })
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe(code)
    expect((error as Error).message).toContain(`Google Chrome reported ${product}`)
    expect(browser.signals).toEqual(['SIGKILL'])
    expect(browser.methods()).toEqual(['Browser.getVersion'])
    expect(existsSync(sessionDirOf(calls[0].args))).toBe(false)
  })

  it('gives up on a start tab that never opens', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { browser, launching } = start({ options: { initialTargets: [] } })
    await settle()
    vi.advanceTimersByTime(LAUNCHER_TIMEOUTS.firstTabMs - 1)
    await settle()
    expect(browser.signals).toEqual([])
    vi.advanceTimersByTime(1)
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_NO_FIRST_TAB')
    expect((error as Error).message).toBe(
      'Google Chrome did not open its first tab at about:blank within 120 seconds, ' +
        'so Birdbrain closed it.'
    )
    expect(browser.signals).toEqual(['SIGKILL'])
  })

  it('stops waiting for the start tab when the browser closes first', async () => {
    const { browser, calls, launching } = start({ options: { initialTargets: [] } })
    await settle()
    browser.exit(0)
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_NO_FIRST_TAB')
    expect((error as Error).message).toBe('Google Chrome closed before it opened its first tab.')
    expect(existsSync(sessionDirOf(calls[0].args))).toBe(false)
  })

  it('fails the launch when the start tab cannot be set up', async () => {
    const { browser, launching } = start({
      options: {
        respond: ({ method, sessionId }) =>
          method === 'Network.enable' && sessionId === 'session-1'
            ? { error: { message: 'Not allowed' } }
            : undefined
      }
    })
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_SETUP_FAILED')
    expect((error as Error).message).toBe(
      'Birdbrain could not set up Google Chrome: Network.enable failed: Not allowed'
    )
    expect(browser.signals).toEqual(['SIGKILL'])
  })

  it('fails the launch when a setup command fails', async () => {
    const { browser, launching } = start({
      options: {
        respond: ({ method }) =>
          method === 'Browser.setPermission'
            ? { error: { message: 'No such permission' } }
            : undefined
      }
    })
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_SETUP_FAILED')
    expect(browser.signals).toEqual(['SIGKILL'])
  })

  it('kills the browser and removes its profile when the launch is cancelled', async () => {
    const controller = new AbortController()
    const { browser, calls, launching } = start({
      signal: controller.signal,
      options: {
        respond: ({ method }) => (method === 'Browser.getVersion' ? 'silent' : undefined)
      }
    })
    await settle()
    controller.abort()
    // Before any await, for quitting: Electron does not await before-quit.
    expect(browser.signals).toEqual(['SIGKILL'])
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_LAUNCH_CANCELLED')
    expect(new Set(browser.signals)).toEqual(new Set(['SIGKILL']))
    expect(existsSync(sessionDirOf(calls[0].args))).toBe(false)
  })

  it('spawns nothing for a launch cancelled before it starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const { calls, launching } = start({ signal: controller.signal })
    const error = await launching.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_LAUNCH_CANCELLED')
    expect(calls).toEqual([])
  })
})

describe('launchBrowser: attaching', () => {
  it('sets up a popup and a new tab before resuming each, without waiting for answers', async () => {
    const seen: string[] = []
    // An answer that never comes: the resume must not wait for it (probe P4).
    const { browser, spawn } = fakeBrowser({
      respond: ({ method, sessionId }) =>
        method === 'Network.enable' && sessionId === 'session-2' ? 'silent' : undefined
    })
    const onRecordedSession = (session: CdpSession, { targetId }: TargetInfo): void => {
      seen.push(`${targetId}@${session.sessionId}`)
      expect(browser.methods()).not.toContain(`Network.enable@${session.sessionId}`)
    }
    await launchBrowser(
      {
        browser: CHROME,
        egress: DIRECT,
        sessionDataPath: sessionData,
        hooks: { onRecordedSession }
      },
      { spawn }
    )
    browser.attach(targetInfo('popup', 'page', ''))
    browser.attach(targetInfo('new-tab', 'page', 'chrome://newtab/'))
    await settle()
    for (const sessionId of ['session-2', 'session-3']) {
      expect(browser.methods().filter((m) => m.endsWith(`@${sessionId}`))).toEqual([
        `Network.enable@${sessionId}`,
        `Network.setCacheDisabled@${sessionId}`,
        `Page.enable@${sessionId}`,
        `Target.setAutoAttach@${sessionId}`,
        `Runtime.runIfWaitingForDebugger@${sessionId}`
      ])
    }
    expect(seen).toEqual(['first-tab@session-1', 'popup@session-2', 'new-tab@session-3'])
  })

  it('resumes every target that is not a page without recording it', async () => {
    const recorded: string[] = []
    const { browser } = await launched({
      hooks: { onRecordedSession: (_, { targetId }) => recorded.push(targetId) }
    })
    const component = 'chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome/thunk.js'
    browser.attach(targetInfo('sw', 'service_worker', component))
    browser.attach(targetInfo('shared', 'shared_worker', 'https://a.test/shared.js'))
    browser.attach(targetInfo('bg', 'background_page', component), { waiting: false })
    browser.attach(targetInfo('omnibox', 'browser_ui', 'chrome://omnibox-popup.top-chrome/'), {
      waiting: false
    })
    await settle()
    expect(browser.methods().slice(8)).toEqual([
      'Runtime.runIfWaitingForDebugger@session-2',
      'Runtime.runIfWaitingForDebugger@session-3'
    ])
    expect(recorded).toEqual(['first-tab'])
  })

  it("records a recorded page's iframes, dedicated workers and service workers on their own sessions", async () => {
    const recorded: string[] = []
    const { browser } = await launched({
      hooks: { onRecordedSession: (_, { targetId }) => recorded.push(targetId) }
    })
    const frame = browser.attach(targetInfo('frame', 'iframe', 'https://b.test/'), {
      parentSessionId: 'session-1'
    })
    browser.attach(targetInfo('worker', 'worker', 'https://a.test/w.js'), {
      parentSessionId: 'session-1'
    })
    browser.attach(targetInfo('sw', 'service_worker', 'https://a.test/sw.js'), {
      parentSessionId: 'session-1'
    })
    browser.attach(targetInfo('nested', 'iframe', 'https://c.test/'), { parentSessionId: frame })
    await settle()
    // Spec, "Attach before request", step 2: each recorded session gets the same setup, with
    // auto-attach on frames and workers too, and `Page.enable` on the page only.
    const setupOf = (sessionId: string): string[] => [
      `Network.enable@${sessionId}`,
      `Network.setCacheDisabled@${sessionId}`,
      `Target.setAutoAttach@${sessionId}`,
      `Runtime.runIfWaitingForDebugger@${sessionId}`
    ]
    expect(browser.methods().slice(8)).toEqual([
      ...setupOf('session-2'),
      ...setupOf('session-3'),
      ...setupOf('session-4'),
      ...setupOf('session-5')
    ])
    expect(recorded).toEqual(['first-tab', 'frame', 'worker', 'sw', 'nested'])
  })

  it('reports a target whose setup fails and still resumes it', async () => {
    const failures: Array<[string, string]> = []
    const { browser } = await launched({
      options: {
        respond: ({ method, sessionId }) =>
          method === 'Network.enable' && sessionId === 'session-2'
            ? { error: { message: 'Target closed' } }
            : undefined
      },
      hooks: {
        onTargetSetupFailed: ({ targetId }: TargetInfo, error: Error) =>
          failures.push([targetId, error.message])
      }
    })
    browser.attach(targetInfo('popup', 'page', ''))
    await settle()
    expect(failures).toEqual([['popup', 'Network.enable failed: Target closed']])
    expect(browser.methods()).toContain('Runtime.runIfWaitingForDebugger@session-2')
    expect(browser.methods()).not.toContain('Target.getTargets')
  })

  // The browser's target list tells a tab that failed its setup and browses on from one that
  // closed; a list that cannot be read counts the tab as open.
  function listing(open: string[], fail?: Record<string, string>): FakeBrowserOptions['respond'] {
    return ({ method, sessionId }) => {
      const message = fail?.[sessionId ? `${method}@${sessionId}` : method]
      if (message !== undefined) return { error: { message } }
      if (method === 'Target.getTargets') {
        return { result: { targetInfos: open.map((id) => targetInfo(id)) } }
      }
      return undefined
    }
  }

  async function unwatchedAfter(respond: FakeBrowserOptions['respond']) {
    const unwatched: Array<[string, string]> = []
    const failures: string[] = []
    const { browser } = await launched({
      options: { respond },
      hooks: {
        onTargetSetupFailed: ({ targetId }: TargetInfo) => failures.push(targetId),
        onTargetUnwatched: ({ targetId }: TargetInfo, error: Error) =>
          unwatched.push([targetId, error.message])
      }
    })
    return { browser, unwatched, failures }
  }

  it('reports a tab that stays open after its setup failed as unwatched', async () => {
    const { browser, unwatched, failures } = await unwatchedAfter(
      listing(['first-tab', 'popup'], { 'Network.enable@session-2': 'Not allowed' })
    )
    browser.attach(targetInfo('popup', 'page', ''))
    await settle()
    expect(unwatched).toEqual([['popup', 'Network.enable failed: Not allowed']])
    expect(failures).toEqual(['popup'])
    expect(browser.methods()).toContain('Runtime.runIfWaitingForDebugger@session-2')
  })

  it('reports a tab whose auto-attach failed as unwatched, since its frames go unseen', async () => {
    const { browser, unwatched } = await unwatchedAfter(
      listing(['first-tab', 'popup'], { 'Target.setAutoAttach@session-2': 'Not allowed' })
    )
    browser.attach(targetInfo('popup', 'page', ''))
    await settle()
    expect(unwatched).toEqual([['popup', 'Target.setAutoAttach failed: Not allowed']])
  })

  it('does not report a tab the browser no longer lists', async () => {
    const { browser, unwatched, failures } = await unwatchedAfter(
      listing(['first-tab'], { 'Network.enable@session-2': 'Target closed' })
    )
    browser.attach(targetInfo('popup', 'page', ''))
    await settle()
    expect(unwatched).toEqual([])
    expect(failures).toEqual(['popup'])
    expect(browser.methods()).toContain('Target.getTargets')
  })

  it('does not report a tab that detached before it answered, and asks for no list', async () => {
    const { browser, unwatched, failures } = await unwatchedAfter(({ method, sessionId }) =>
      method === 'Network.enable' && sessionId === 'session-2' ? 'silent' : undefined
    )
    browser.attach(targetInfo('popup', 'page', ''))
    await settle()
    browser.event('Target.detachedFromTarget', { sessionId: 'session-2', targetId: 'popup' })
    await settle()
    expect(failures).toEqual(['popup'])
    expect(unwatched).toEqual([])
    expect(browser.methods()).not.toContain('Target.getTargets')
  })

  it('counts a tab as open when the target list cannot be read', async () => {
    const { browser, unwatched } = await unwatchedAfter(
      listing([], { 'Network.enable@session-2': 'Not allowed', 'Target.getTargets': 'Busy' })
    )
    browser.attach(targetInfo('popup', 'page', ''))
    await settle()
    expect(unwatched).toEqual([['popup', 'Network.enable failed: Not allowed']])
  })

  it('reports a resume that fails as a setup failure only', async () => {
    const { browser, unwatched, failures } = await unwatchedAfter(
      listing(['first-tab', 'popup'], { 'Runtime.runIfWaitingForDebugger@session-2': 'Gone' })
    )
    browser.attach(targetInfo('popup', 'page', ''))
    await settle()
    expect(failures).toEqual(['popup'])
    expect(unwatched).toEqual([])
    expect(browser.methods()).not.toContain('Target.getTargets')
  })
  it('reports a target whose resume fails, recorded or not', async () => {
    const failures: Array<[string, string]> = []
    const { browser } = await launched({
      options: {
        respond: ({ method, sessionId }) =>
          method === 'Runtime.runIfWaitingForDebugger' && sessionId === 'session-2'
            ? { error: { message: 'Target closed' } }
            : undefined
      },
      hooks: {
        onTargetSetupFailed: ({ targetId }: TargetInfo, error: Error) =>
          failures.push([targetId, error.message])
      }
    })
    browser.attach(targetInfo('sw', 'service_worker', 'https://a.test/sw.js'))
    await settle()
    expect(failures).toEqual([['sw', 'Runtime.runIfWaitingForDebugger failed: Target closed']])
  })

  it('reports a held tab whose resume fails once the checks pass', async () => {
    const failures: string[] = []
    const fake = fakeBrowser({
      respond: ({ method, sessionId }) =>
        method === 'Runtime.runIfWaitingForDebugger' && sessionId === 'session-2'
          ? { error: { message: 'Target closed' } }
          : undefined
    })
    const checkFirstTab = async (): Promise<void> => {
      fake.browser.attach(targetInfo('component', 'service_worker', 'https://a.test/sw.js'))
      await settle()
    }
    await launchBrowser(
      {
        browser: CHROME,
        egress: DIRECT,
        sessionDataPath: sessionData,
        hooks: { checkFirstTab, onTargetSetupFailed: ({ targetId }) => failures.push(targetId) }
      },
      { spawn: fake.spawn }
    )
    await settle()
    expect(failures).toEqual(['component'])
  })
})

describe('launchBrowser: extension targets (D14)', () => {
  function extensionUrl(id: string, path = 'background.html'): string {
    return `chrome-extension://${id}/${path}`
  }

  it('warns once per extension that is not one of the browser components, under a proxy', async () => {
    const warned: string[] = []
    const { browser } = await launched({
      egress: TOR,
      hooks: { onExtensionWarning: (id) => warned.push(id) }
    })
    const [component] = COMPONENT_EXTENSION_IDS
    browser.event('Target.targetCreated', {
      targetInfo: targetInfo('c', 'service_worker', extensionUrl(component, 'thunk.js'))
    })
    browser.event('Target.targetCreated', {
      targetInfo: targetInfo('e', 'background_page', extensionUrl(INSTALLED_EXTENSION))
    })
    browser.event('Target.targetInfoChanged', {
      targetInfo: targetInfo('e', 'background_page', extensionUrl(INSTALLED_EXTENSION))
    })
    browser.event('Target.targetInfoChanged', {
      targetInfo: targetInfo('first-tab', 'page', extensionUrl(OTHER_EXTENSION, 'options.html'))
    })
    browser.event('Target.targetCreated', {
      targetInfo: targetInfo('p', 'page', 'https://a.test/chrome-extension://x')
    })
    await settle()
    expect(warned).toEqual([INSTALLED_EXTENSION, OTHER_EXTENSION])
  })

  it('does not warn while the Egress is Direct', async () => {
    const warned: string[] = []
    const { browser } = await launched({
      egress: DIRECT,
      hooks: { onExtensionWarning: (id) => warned.push(id) }
    })
    browser.event('Target.targetCreated', {
      targetInfo: targetInfo('e', 'background_page', extensionUrl(INSTALLED_EXTENSION))
    })
    await settle()
    expect(warned).toEqual([])
  })
})

describe('launchBrowser: the tab list', () => {
  function titled(targetId: string, title: string, url: string, type = 'page'): TargetInfo {
    return { ...targetInfo(targetId, type, url), title }
  }

  function tabLists(hooks: { onTabsChanged?: (tabs: LaunchedBrowserTab[]) => void } = {}) {
    const lists: LaunchedBrowserTab[][] = []
    return {
      lists,
      hooks: { ...hooks, onTabsChanged: (tabs: LaunchedBrowserTab[]) => lists.push(tabs) }
    }
  }

  it('reports each tab with its title and URL, in the order the browser opened them', async () => {
    const { lists, hooks } = tabLists()
    const { browser } = await launched({ hooks })
    browser.event('Target.targetCreated', { targetInfo: titled('first-tab', '', 'about:blank') })
    browser.event('Target.targetCreated', {
      targetInfo: titled('p2', 'Harbor notices', 'https://ferry.test/notices')
    })
    browser.event('Target.targetInfoChanged', {
      targetInfo: titled('first-tab', 'Tuesday sailings', 'https://ferry.test/tue')
    })
    await settle()
    expect(lists.at(-1)).toEqual([
      { targetId: 'first-tab', title: 'Tuesday sailings', url: 'https://ferry.test/tue' },
      { targetId: 'p2', title: 'Harbor notices', url: 'https://ferry.test/notices' }
    ])
  })

  it('reports tabs under a proxy Egress too', async () => {
    const { lists, hooks } = tabLists()
    const { browser } = await launched({ egress: TOR, hooks })
    browser.event('Target.targetCreated', { targetInfo: titled('first-tab', '', 'about:blank') })
    await settle()
    expect(lists.at(-1)).toEqual([{ targetId: 'first-tab', title: '', url: 'about:blank' }])
  })

  it('drops a tab once its target is destroyed', async () => {
    const { lists, hooks } = tabLists()
    const { browser } = await launched({ hooks })
    browser.event('Target.targetCreated', { targetInfo: titled('first-tab', '', 'about:blank') })
    browser.event('Target.targetCreated', { targetInfo: titled('p2', 'B', 'https://b.test/') })
    browser.event('Target.targetDestroyed', { targetId: 'first-tab' })
    browser.event('Target.targetDestroyed', { targetId: 'never-a-tab' })
    await settle()
    expect(lists.at(-1)).toEqual([{ targetId: 'p2', title: 'B', url: 'https://b.test/' }])
    expect(lists).toHaveLength(3)
  })

  it('leaves out frames, workers, extension pages and prerendered pages', async () => {
    const { lists, hooks } = tabLists()
    const { browser } = await launched({ hooks })
    browser.event('Target.targetCreated', {
      targetInfo: titled('f', 'F', 'https://f.test/', 'iframe')
    })
    browser.event('Target.targetCreated', {
      targetInfo: titled('w', 'W', 'https://f.test/w.js', 'worker')
    })
    browser.event('Target.targetCreated', {
      targetInfo: titled('s', 'S', 'https://f.test/sw.js', 'service_worker')
    })
    browser.event('Target.targetCreated', {
      targetInfo: titled(
        'b',
        'B',
        `chrome-extension://${INSTALLED_EXTENSION}/bg.html`,
        'background_page'
      )
    })
    browser.event('Target.targetCreated', {
      targetInfo: { ...titled('r', 'R', 'https://f.test/next'), subtype: 'prerender' }
    })
    await settle()
    expect(lists).toEqual([])
  })

  it('reports nothing for a change that leaves the title and URL as they were', async () => {
    const { lists, hooks } = tabLists()
    const { browser } = await launched({ hooks })
    browser.event('Target.targetCreated', { targetInfo: titled('first-tab', '', 'about:blank') })
    browser.event('Target.targetInfoChanged', {
      targetInfo: { ...titled('first-tab', '', 'about:blank'), attached: false }
    })
    await settle()
    expect(lists).toHaveLength(1)
  })

  it("leaves out the browser's own pages for its toolbar", async () => {
    const { lists, hooks } = tabLists()
    const { browser } = await launched({ hooks })
    browser.event('Target.targetCreated', {
      targetInfo: titled('o', 'Omnibox Popup', 'chrome://omnibox-popup.top-chrome/')
    })
    browser.event('Target.targetCreated', {
      targetInfo: titled('n', 'New Tab', 'chrome://newtab/')
    })
    await settle()
    expect(lists).toEqual([[{ targetId: 'n', title: 'New Tab', url: 'chrome://newtab/' }]])
  })

  it('reads the tabs again on a timer, for the titles a page sets after it loads', async () => {
    const { lists, hooks } = tabLists()
    const listed: TargetInfo[] = [
      titled('first-tab', 'Tuesday sailings', 'https://ferry.test/tue'),
      titled('p3', 'Port timetable', 'https://ferry.test/port'),
      titled('o', 'Omnibox Popup', 'chrome://omnibox-popup.top-chrome/'),
      titled('w', 'Worker', 'https://ferry.test/w.js', 'service_worker')
    ]
    const { browser, launched: handle } = await launched({
      hooks,
      deps: { timeouts: { tabRefreshMs: 5 } },
      options: {
        respond: ({ method }) =>
          method === 'Target.getTargets' ? { result: { targetInfos: listed } } : undefined
      }
    })
    browser.event('Target.targetCreated', {
      targetInfo: titled('p2', 'ferry.test/notices', 'https://ferry.test/notices')
    })
    browser.event('Target.targetCreated', {
      targetInfo: titled('first-tab', 'ferry.test/tue', 'https://ferry.test/tue')
    })
    await vi.waitFor(() =>
      expect(lists.at(-1)).toEqual([
        { targetId: 'first-tab', title: 'Tuesday sailings', url: 'https://ferry.test/tue' },
        { targetId: 'p3', title: 'Port timetable', url: 'https://ferry.test/port' }
      ])
    )
    const reported = lists.length
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(lists).toHaveLength(reported)
    await handle.stop()
    const asked = browser.methods().filter((m) => m === 'Target.getTargets').length
    expect(asked).toBeGreaterThan(1)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(browser.methods().filter((m) => m === 'Target.getTargets')).toHaveLength(asked)
  })

  it('does not read the tabs before the launch has passed its checks', async () => {
    const { browser } = start({ deps: { timeouts: { tabRefreshMs: 1 } } })
    await settle()
    expect(browser.methods()).not.toContain('Target.getTargets')
    browser.kill('SIGKILL')
  })

  it('cuts a title or URL past the limit the panel shows', async () => {
    const { lists, hooks } = tabLists()
    const { browser } = await launched({ hooks })
    const long = 'x'.repeat(TAB_TEXT_LIMIT + 500)
    browser.event('Target.targetCreated', {
      targetInfo: titled('first-tab', long, `data:text/html,${long}`)
    })
    await settle()
    const [tab] = lists.at(-1) ?? []
    expect(tab.title).toHaveLength(TAB_TEXT_LIMIT)
    expect(tab.url).toHaveLength(TAB_TEXT_LIMIT)
    expect(tab.url.startsWith('data:text/html,x')).toBe(true)
  })
})

describe('launchBrowser: stopping', () => {
  it('sends Browser.close, waits for the exit, and only then removes the throwaway profile', async () => {
    let exitedAtRemoval: boolean | undefined
    const { browser, launched: handle } = await launched({
      deps: {
        removeProfile: (path, profile) => {
          exitedAtRemoval = browser.exited
          removeSessionProfile(path, profile)
        }
      }
    })
    const { sessionDir } = handle.profile
    expect(existsSync(sessionDir)).toBe(true)
    const exit = await handle.stop()
    expect(exit).toEqual({ code: 0, signal: null })
    expect(browser.methods().at(-1)).toBe('Browser.close')
    expect(browser.signals).toEqual([])
    expect(exitedAtRemoval).toBe(true)
    expect(existsSync(sessionDir)).toBe(false)
  })

  it('sends one Browser.close however often stop is called', async () => {
    const { browser, launched: handle } = await launched()
    const [first, second] = await Promise.all([handle.stop(), handle.stop()])
    expect(first).toBe(second)
    expect(browser.methods().filter((m) => m === 'Browser.close')).toHaveLength(1)
  })

  it('kills a browser that does not exit within the close timeout', async () => {
    const { browser, launched: handle } = await launched({ options: { exitOnClose: false } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stopping = handle.stop()
    await settle()
    vi.advanceTimersByTime(LAUNCHER_TIMEOUTS.closeMs - 1)
    await settle()
    expect(browser.signals).toEqual([])
    vi.advanceTimersByTime(1)
    expect(await stopping).toEqual({ code: null, signal: 'SIGKILL' })
    expect(browser.signals).toEqual(['SIGKILL'])
    expect(existsSync(handle.profile.sessionDir)).toBe(false)
  })

  it('rejects when even the kill does not end it, leaving the profile to the startup sweep', async () => {
    const { launched: handle } = await launched({
      options: { exitOnClose: false, exitOnKill: false }
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stopping = handle.stop()
    stopping.catch(() => {})
    await settle()
    vi.advanceTimersByTime(LAUNCHER_TIMEOUTS.closeMs)
    await settle()
    vi.advanceTimersByTime(LAUNCHER_TIMEOUTS.killMs)
    const error = await stopping.catch((err: unknown) => err)
    expect(codeOf(error)).toBe('BROWSER_DID_NOT_EXIT')
    expect((error as Error).message).toBe('Google Chrome did not exit after Birdbrain killed it.')
    expect(existsSync(handle.profile.sessionDir)).toBe(true)
  })

  it('removes the profile of a browser the Operator closed, and stop then sends nothing', async () => {
    const { browser, launched: handle } = await launched()
    browser.exit(0)
    expect(await handle.exited).toEqual({ code: 0, signal: null })
    expect(existsSync(handle.profile.sessionDir)).toBe(false)
    expect(await handle.stop()).toEqual({ code: 0, signal: null })
    expect(browser.methods()).not.toContain('Browser.close')
  })

  it('kills a browser that closes its debugging connection but keeps running', async () => {
    const { browser, launched: handle } = await launched({ options: { exitOnKill: true } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    browser.fromBrowser.push(null)
    await settle()
    vi.advanceTimersByTime(LAUNCHER_TIMEOUTS.closeMs - 1)
    await settle()
    expect(browser.signals).toEqual([])
    vi.advanceTimersByTime(1)
    await settle()
    expect(browser.signals).toEqual(['SIGKILL'])
    expect(await handle.exited).toEqual({ code: null, signal: 'SIGKILL' })
  })

  it('reports a profile it could not remove with the exit instead of throwing', async () => {
    const locked = new Error('EBUSY: resource busy or locked')
    const { launched: handle } = await launched({
      deps: {
        removeProfile: () => {
          throw locked
        }
      }
    })
    expect(await handle.stop()).toEqual({ code: 0, signal: null, profileError: locked })
  })

  it('kills the process at once for quitting, where nothing can be awaited', async () => {
    const { browser, launched: handle } = await launched()
    handle.kill()
    expect(browser.signals).toEqual(['SIGKILL'])
    await handle.exited
  })
})
