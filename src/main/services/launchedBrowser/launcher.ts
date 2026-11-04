import { spawn as nodeSpawn, type SpawnOptions } from 'child_process'
import type { Readable, Writable } from 'stream'
import {
  TRANSACTION_RECORD_RESOURCE_BYTES,
  TRANSACTION_RECORD_TOTAL_BYTES
} from '@shared/constants'
import type { BrowserFamily, KnownEgress, LaunchedBrowserTab } from '@shared/types'
import {
  createCdpClient,
  DEFAULT_COMMAND_TIMEOUT_MS,
  type CdpClient,
  type CdpSession
} from '@main/services/launchedBrowser/cdpClient'
import type { CdpEventMap, CdpResult, TargetInfo } from '@main/services/launchedBrowser/commands'
import type { FoundBrowser } from '@main/services/launchedBrowser/discovery'
import { identifyBrowser, type BrowserIdentity } from '@main/services/launchedBrowser/identify'
import {
  buildLaunchArgs,
  START_URL,
  type LaunchArgsInput
} from '@main/services/launchedBrowser/launchArgs'
import {
  createSessionProfile,
  removeSessionProfile,
  type SessionProfile
} from '@main/services/launchedBrowser/profiles'

// Starting and stopping one launched browser (spec, "Browser discovery and launch" and "Attach
// before request"). The start order: spawn, `Browser.getVersion` within a timeout, geolocation
// denied, auto-attach, then the Egress checks on the first tab while every other tab waits
// paused. The window is on screen from the spawn: minimizing it changed nothing under Xvfb, and
// on Wayland Chromium has no request that undoes a minimize. Every page target is recorded,
// since a popup attaches with no URL and a new tab at `chrome://newtab/`, before either loads.

export const LAUNCHER_TIMEOUTS = {
  connectMs: DEFAULT_COMMAND_TIMEOUT_MS,
  // Brave Origin shows its own startup page in a fresh profile and opens the first tab only once
  // the Operator has answered it.
  firstTabMs: 120_000,
  // After Browser.close, or after the browser closes its end of the pipe, before the kill.
  closeMs: 5_000,
  killMs: 5_000,
  // Chrome for Testing 149 and Chromium 154 send no Target.targetInfoChanged when a page sets its
  // title, so once the browser is open the tab list is read again this often.
  tabRefreshMs: 2_000
}

// Extensions the browser builds in, measured in a fresh profile: Chrome for Testing 149 and
// Chromium 154 start this one. Any other extension target warns (D14).
export const COMPONENT_EXTENSION_IDS: readonly string[] = ['nkeimhogjdpnpccoofpliimaahmaaome']

// The panel shows one line of each; a page sets its own title and a data: URL can run to megabytes,
// and each change goes to every Birdbrain window.
export const TAB_TEXT_LIMIT = 2_048

const STDERR_TAIL_BYTES = 4_096
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true } as const
const NETWORK_LIMITS = {
  maxTotalBufferSize: TRANSACTION_RECORD_TOTAL_BYTES,
  maxResourceBufferSize: TRANSACTION_RECORD_RESOURCE_BYTES
}
const EXTENSION_URL = /^chrome-extension:\/\/([a-p]{32})\//
// The browser's own toolbar pages, such as Chromium 154's omnibox popup, which it reports as pages.
const TOOLBAR_URL = /^chrome:\/\/[^/]+\.top-chrome\//
const COMPONENTS: ReadonlySet<string> = new Set(COMPONENT_EXTENSION_IDS)

export interface BrowserChild {
  readonly pid?: number
  readonly stdio: readonly (Readable | Writable | null | undefined)[]
  kill: (signal?: NodeJS.Signals) => boolean
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type SpawnBrowser = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => BrowserChild

export interface FirstTab {
  targetId: string
  session: CdpSession
}

export interface LaunchHooks {
  // The Egress checks on the first tab. A throw refuses the launch and kills the browser.
  checkFirstTab?: (tab: FirstTab) => Promise<void>
  // A recorded target's session, before it is resumed, so its first response can be read.
  onRecordedSession?: (session: CdpSession, target: TargetInfo) => void
  onTargetSetupFailed?: (target: TargetInfo, error: Error) => void
  // An extension other than the browser's own components, while the Egress is not Direct.
  onExtensionWarning?: (extensionId: string) => void
  // The tab list, each time a tab opens, closes, or changes its title or URL.
  onTabsChanged?: (tabs: LaunchedBrowserTab[]) => void
}

export interface LaunchRequest {
  browser: Pick<FoundBrowser, 'family' | 'label' | 'executablePath'>
  egress: KnownEgress
  sessionDataPath: string
  signal?: AbortSignal
  hooks?: LaunchHooks
}

export interface LauncherDeps {
  spawn?: SpawnBrowser
  // The known-answer suite passes its own builder.
  buildArgs?: (input: LaunchArgsInput) => string[]
  createProfile?: (sessionDataPath: string, family: BrowserFamily) => SessionProfile
  removeProfile?: (sessionDataPath: string, profile: SessionProfile) => void
  timeouts?: Partial<typeof LAUNCHER_TIMEOUTS>
}

export interface BrowserExit {
  code: number | null
  signal: NodeJS.Signals | null
  // The throwaway profile stays; the startup sweep removes it once no browser holds it.
  profileError?: unknown
}

export interface LaunchedBrowser {
  pid: number | undefined
  identity: BrowserIdentity
  profile: SessionProfile
  client: CdpClient
  firstTab: FirstTab
  // Settles once the process has exited, for any reason, and its profile is removed.
  exited: Promise<BrowserExit>
  stop: () => Promise<BrowserExit>
  // SIGKILL with nothing to await, for quitting: Electron does not await before-quit.
  kill: () => void
}

type ProcessExit = Pick<BrowserExit, 'code' | 'signal'>

function codedError(message: string, code: string, extra: object = {}): Error {
  return Object.assign(new Error(message), { code }, extra)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} seconds`
}

// Resolves true if `promise` settles within `ms`, false otherwise.
function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  return Promise.race([promise.then(() => true), late]).finally(() => clearTimeout(timer))
}

function isWritable(stream: Readable | Writable | null | undefined): stream is Writable {
  return typeof (stream as Writable | undefined)?.write === 'function'
}

function isReadable(stream: Readable | Writable | null | undefined): stream is Readable {
  return typeof (stream as Readable | undefined)?.read === 'function'
}

const defaultSpawn: SpawnBrowser = (command, args, options) => nodeSpawn(command, args, options)

export async function launchBrowser(
  request: LaunchRequest,
  deps: LauncherDeps = {}
): Promise<LaunchedBrowser> {
  const { browser, egress, sessionDataPath, signal, hooks = {} } = request
  const {
    spawn = defaultSpawn,
    buildArgs = buildLaunchArgs,
    createProfile = (path: string, family: BrowserFamily) => createSessionProfile(path, family),
    removeProfile = removeSessionProfile
  } = deps
  const timeouts = { ...LAUNCHER_TIMEOUTS, ...deps.timeouts }
  const { label } = browser
  const cancelled = (): Error => codedError('The launch was cancelled.', 'BROWSER_LAUNCH_CANCELLED')
  if (signal?.aborted) throw cancelled()

  const profile = createProfile(sessionDataPath, browser.family)
  let child: BrowserChild
  try {
    const args = buildArgs({ profileDir: profile.profileDir, egress })
    child = spawn(browser.executablePath, args, {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
      detached: false
    })
  } catch (error) {
    removeProfile(sessionDataPath, profile)
    throw error
  }

  const state: { exit: ProcessExit | null } = { exit: null }
  let failStart: (error: Error) => void = () => {}
  const startFailed = new Promise<never>((_, reject) => {
    failStart = reject
  })
  startFailed.catch(() => {})
  const processExited = new Promise<ProcessExit>((resolve) => {
    child.once('exit', (code, exitSignal) => {
      state.exit = { code, signal: exitSignal }
      resolve(state.exit)
    })
    // A child that never started has no exit to wait for.
    child.on('error', (error) => {
      if (child.pid !== undefined) return
      state.exit = { code: null, signal: null }
      resolve(state.exit)
      failStart(
        codedError(`${label} could not be started: ${error.message}`, 'BROWSER_SPAWN_FAILED')
      )
    })
  })
  const exited = processExited.then((exit): BrowserExit => {
    try {
      removeProfile(sessionDataPath, profile)
      return exit
    } catch (profileError) {
      return { ...exit, profileError }
    }
  })
  // Killed now, not after the next await: quitting cancels a launch, and Electron does not await
  // before-quit.
  const onAbort = (): void => {
    child.kill('SIGKILL')
    failStart(cancelled())
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  // Kept until the start succeeds, to say why a browser did not open its connection.
  let stderrTail: Buffer | null = Buffer.alloc(0)
  const [, , stderr, toBrowser, fromBrowser] = child.stdio
  if (isReadable(stderr)) {
    stderr.on('data', (chunk: Buffer) => {
      if (stderrTail === null) return
      const joined = Buffer.concat([stderrTail, chunk])
      stderrTail = joined.subarray(Math.max(0, joined.length - STDERR_TAIL_BYTES))
    })
  }

  // Kills the process during the start, waits for it to go, and returns the error to throw.
  async function abandon(error: Error): Promise<Error> {
    signal?.removeEventListener('abort', onAbort)
    child.kill('SIGKILL')
    if (await within(processExited, timeouts.killMs)) await exited
    return error
  }

  if (child.pid === undefined) {
    // Node reports a failed spawn with an 'error' event on a later tick.
    throw await abandon(await startFailed.catch((error: Error) => error))
  }
  if (!isWritable(toBrowser) || !isReadable(fromBrowser)) {
    throw await abandon(
      codedError(`${label} could not be started: no debugging pipe.`, 'BROWSER_SPAWN_FAILED')
    )
  }

  const during = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, startFailed])
  const client = createCdpClient({ toBrowser, fromBrowser })

  client.disconnected.then(async () => {
    if (!(await within(processExited, timeouts.closeMs))) child.kill('SIGKILL')
  })

  let version: CdpResult<'Browser.getVersion'>
  try {
    version = await during(client.send('Browser.getVersion', {}, { timeoutMs: timeouts.connectMs }))
  } catch (error) {
    await abandon(error as Error)
    const code = (error as { code?: unknown }).code
    if (code !== 'CDP_TIMEOUT' && code !== 'CDP_DISCONNECTED') throw error
    const { exit } = state
    const exitText = exit
      ? `exit code ${exit.code ?? 'none'}, signal ${exit.signal ?? 'none'}`
      : 'no exit'
    throw codedError(
      code === 'CDP_TIMEOUT'
        ? `${label} did not open its debugging connection within ` +
            `${seconds(timeouts.connectMs)}, so Birdbrain closed it.`
        : `${label} did not open its debugging connection: it exited before answering.`,
      'BROWSER_NO_CONNECTION',
      { diagnostic: `${exitText}; stderr: ${(stderrTail ?? Buffer.alloc(0)).toString('utf8')}` }
    )
  }

  const identification = identifyBrowser(browser, version)
  if (!identification.ok) {
    const code =
      identification.code === 'unrecognized' ? 'BROWSER_UNRECOGNIZED' : 'BROWSER_BELOW_FLOOR'
    throw await abandon(codedError(identification.message, code))
  }

  // Tabs other than the first wait paused until the checks pass.
  let released = false
  const held: Array<{ session: CdpSession; target: TargetInfo }> = []
  let resolveFirstTab: (tab: { tab: FirstTab; ready: Promise<unknown> }) => void = () => {}
  const firstTabFound = new Promise<{ tab: FirstTab; ready: Promise<unknown> }>((resolve) => {
    resolveFirstTab = resolve
  })
  let firstTabTaken = false

  function reportFailure(target: TargetInfo, error: unknown): void {
    hooks.onTargetSetupFailed?.(target, error instanceof Error ? error : new Error(String(error)))
  }

  function resume(
    session: CdpSession,
    target: TargetInfo,
    waiting: boolean,
    now: boolean
  ): Promise<unknown> {
    if (!waiting) return Promise.resolve()
    if (!now && !released) {
      held.push({ session, target })
      return Promise.resolve()
    }
    return session.send('Runtime.runIfWaitingForDebugger', {})
  }

  function record(
    session: CdpSession,
    target: TargetInfo,
    waiting: boolean,
    nested: boolean,
    isFirstTab: boolean
  ): Promise<unknown> {
    hooks.onRecordedSession?.(session, target)
    if (nested) {
      session.on('Target.attachedToTarget', (params) => onAttached(params, true))
    }
    // Written together, so the resume never waits on an answer (probe P4).
    const steps = [
      session.send('Network.enable', NETWORK_LIMITS),
      ...(nested ? [session.send('Target.setAutoAttach', AUTO_ATTACH)] : []),
      resume(session, target, waiting, isFirstTab)
    ]
    return Promise.all(steps)
  }

  function onAttached(
    { sessionId, targetInfo, waitingForDebugger }: CdpEventMap['Target.attachedToTarget'],
    underRecordedTarget: boolean
  ): void {
    const session = client.session(sessionId)
    const { type, url } = targetInfo
    const recorded = underRecordedTarget ? type === 'iframe' || type === 'worker' : type === 'page'
    if (!recorded) {
      resume(session, targetInfo, waitingForDebugger, false).catch((error) =>
        reportFailure(targetInfo, error)
      )
      return
    }
    const isFirstTab = !underRecordedTarget && !firstTabTaken && url === START_URL
    if (isFirstTab) firstTabTaken = true
    const ready = record(session, targetInfo, waitingForDebugger, type !== 'worker', isFirstTab)
    if (isFirstTab) {
      ready.catch(() => {})
      resolveFirstTab({ tab: { targetId: targetInfo.targetId, session }, ready })
    } else {
      ready.catch((error) => reportFailure(targetInfo, error))
    }
  }

  const warned = new Set<string>()
  function watchExtension({ targetInfo }: { targetInfo: TargetInfo }): void {
    const id = EXTENSION_URL.exec(targetInfo.url)?.[1]
    if (!id || COMPONENTS.has(id) || warned.has(id)) return
    warned.add(id)
    hooks.onExtensionWarning?.(id)
  }

  let tabs = new Map<string, LaunchedBrowserTab>()
  function reportTabs(): void {
    hooks.onTabsChanged?.([...tabs.values()])
  }
  function trackTab({ targetInfo }: { targetInfo: TargetInfo }): void {
    const tab = tabOf(targetInfo)
    if (!tab || sameTab(tabs.get(tab.targetId), tab)) return
    tabs.set(tab.targetId, tab)
    reportTabs()
  }
  // The browser's whole list: known tabs keep their place, and new ones go after them.
  function syncTabs(targetInfos: readonly TargetInfo[]): void {
    const listed = new Map<string, LaunchedBrowserTab>()
    for (const info of targetInfos) {
      const tab = tabOf(info)
      if (tab) listed.set(tab.targetId, tab)
    }
    const next = new Map<string, LaunchedBrowserTab>()
    for (const id of tabs.keys()) {
      const tab = listed.get(id)
      if (tab) next.set(id, tab)
    }
    for (const [id, tab] of listed) if (!next.has(id)) next.set(id, tab)
    const before = [...tabs.values()]
    const after = [...next.values()]
    if (before.length === after.length && before.every((tab, i) => sameTab(tab, after[i]))) return
    tabs = next
    reportTabs()
  }

  client.on('Target.attachedToTarget', (params) => onAttached(params, false))
  client.on('Target.targetCreated', trackTab)
  client.on('Target.targetInfoChanged', trackTab)
  client.on('Target.targetDestroyed', ({ targetId }) => {
    if (tabs.delete(targetId)) reportTabs()
  })
  if (egress.kind !== 'direct') {
    client.on('Target.targetCreated', watchExtension)
    client.on('Target.targetInfoChanged', watchExtension)
  }

  const setupFailed = (error: unknown): Error =>
    codedError(`Birdbrain could not set up ${label}: ${messageOf(error)}`, 'BROWSER_SETUP_FAILED')

  let firstTab: FirstTab
  try {
    await during(
      client.send('Browser.setPermission', {
        permission: { name: 'geolocation' },
        setting: 'denied'
      })
    )
    await during(client.send('Target.setDiscoverTargets', { discover: true }))
    await during(client.send('Target.setAutoAttach', AUTO_ATTACH))
  } catch (error) {
    throw await abandon(isStartError(error) ? (error as Error) : setupFailed(error))
  }

  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const tooLate = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            codedError(
              `${label} did not open its first tab at ${START_URL} within ` +
                `${seconds(timeouts.firstTabMs)}, so Birdbrain closed it.`,
              'BROWSER_NO_FIRST_TAB'
            )
          ),
        timeouts.firstTabMs
      )
    })
    // No command is waiting here, so nothing else notices the browser going.
    const gone = client.disconnected.then((): never => {
      throw codedError(`${label} closed before it opened its first tab.`, 'BROWSER_NO_FIRST_TAB')
    })
    const found = await during(Promise.race([firstTabFound, tooLate, gone])).finally(() =>
      clearTimeout(timer)
    )
    firstTab = found.tab
    await during(found.ready)
  } catch (error) {
    throw await abandon(isStartError(error) ? (error as Error) : setupFailed(error))
  }

  try {
    await during(hooks.checkFirstTab?.(firstTab) ?? Promise.resolve())
  } catch (error) {
    throw await abandon(error as Error)
  }

  signal?.removeEventListener('abort', onAbort)
  stderrTail = null
  released = true
  for (const { session, target } of held.splice(0)) {
    session
      .send('Runtime.runIfWaitingForDebugger', {})
      .catch((error) => reportFailure(target, error))
  }

  let refreshing = false
  const refresh = setInterval(() => {
    if (refreshing) return
    refreshing = true
    client
      .send('Target.getTargets', {})
      .then(({ targetInfos }) => syncTabs(targetInfos))
      .catch(() => {})
      .finally(() => {
        refreshing = false
      })
  }, timeouts.tabRefreshMs)
  refresh.unref?.()
  void client.disconnected.then(() => clearInterval(refresh))

  let stopping: Promise<BrowserExit> | null = null
  async function stopOnce(): Promise<BrowserExit> {
    if (state.exit === null) {
      // The exit is the answer that counts; the reply may never come once the browser goes.
      client.send('Browser.close', {}, { timeoutMs: timeouts.closeMs }).catch(() => {})
      if (!(await within(processExited, timeouts.closeMs))) {
        child.kill('SIGKILL')
        if (!(await within(processExited, timeouts.killMs))) {
          throw codedError(
            `${label} did not exit after Birdbrain killed it.`,
            'BROWSER_DID_NOT_EXIT'
          )
        }
      }
    }
    return exited
  }

  return {
    pid: child.pid,
    identity: identification.identity,
    profile,
    client,
    firstTab,
    exited,
    stop: () => {
      stopping ??= stopOnce()
      return stopping
    },
    kill: () => {
      child.kill('SIGKILL')
    }
  }
}

// A tab the panel lists: a page target, not one prerendered and not the browser's toolbar.
function tabOf({ targetId, type, subtype, title, url }: TargetInfo): LaunchedBrowserTab | null {
  if (type !== 'page' || subtype !== undefined || TOOLBAR_URL.test(url)) return null
  return { targetId, title: title.slice(0, TAB_TEXT_LIMIT), url: url.slice(0, TAB_TEXT_LIMIT) }
}

function sameTab(a: LaunchedBrowserTab | undefined, b: LaunchedBrowserTab): boolean {
  return a?.targetId === b.targetId && a.title === b.title && a.url === b.url
}

const START_ERROR_CODES: ReadonlySet<unknown> = new Set([
  'BROWSER_LAUNCH_CANCELLED',
  'BROWSER_SPAWN_FAILED',
  'BROWSER_NO_FIRST_TAB'
])

function isStartError(error: unknown): boolean {
  return START_ERROR_CODES.has((error as { code?: unknown } | null)?.code)
}
