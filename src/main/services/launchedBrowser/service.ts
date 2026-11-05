import type {
  BirdbrainSettings,
  EgressSetting,
  LaunchedBrowserNotice,
  LaunchedBrowserStatus,
  LaunchedBrowserStep,
  LaunchedBrowserSummary
} from '@shared/types'
import { logger, type Logger } from '@main/services/logger'
import type { SessionService } from '@main/services/session'
import { getSettings, onEgressChange, recordLaunchedBrowserVersion } from '@main/services/settings'
import type { FoundBrowser } from '@main/services/launchedBrowser/discovery'
import { prepareEgressChecks, type EgressGuard } from '@main/services/launchedBrowser/egressChecks'
import {
  launchBrowser,
  type BrowserExit,
  type LaunchedBrowser,
  type LaunchHooks,
  type LaunchRequest
} from '@main/services/launchedBrowser/launcher'
import {
  createLaunchedCaptures,
  type CaptureRequest,
  type LaunchedCaptures,
  type LaunchedCapturesDeps
} from '@main/services/launchedBrowser/captures'
import { pickShortcutTab } from '@main/services/launchedBrowser/tabPicking'

// One launched browser at a time, inside a Capture Session (decisions D10 and D20). A launch
// needs an operator name and an Active Case, checks the Egress proxy before the browser starts,
// and starts the Capture Session, or joins the running one, only once the browser has passed
// its checks. Ending the Capture Session closes the browser; the browser closing leaves the
// Capture Session running. While the browser runs, opening another Case does not move the
// Capture Session (the session service's pin).

export type LaunchableBrowser = Pick<FoundBrowser, 'family' | 'label' | 'executablePath'>

export type SessionControl = Pick<
  SessionService,
  'snapshot' | 'start' | 'stop' | 'pinActiveCase' | 'unpinActiveCase'
>

export interface LaunchedBrowserServiceDeps {
  session: SessionControl
  // Electron's sessionData path, under which the throwaway profiles go.
  sessionDataPath: string
  readSettings?: () => Pick<BirdbrainSettings, 'operatorName' | 'egress'>
  saveVersion?: (executablePath: string, version: string) => void
  launch?: (request: LaunchRequest) => Promise<LaunchedBrowser>
  prepareEgress?: (egress: EgressSetting, label: string) => Promise<EgressGuard>
  subscribeEgressChange?: (listener: () => void) => () => void
  emitStatus?: (status: LaunchedBrowserStatus) => void
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
  // Clicked Captures (#1832). Without it the browser launches and records nothing.
  captures?: Pick<LaunchedCapturesDeps, 'sink' | 'birdbrainVersion' | 'citationOf' | 'timings'> &
    Partial<Pick<LaunchedCapturesDeps, 'capture'>>
  platform?: NodeJS.Platform
  // Electron's globalShortcut, injected so the service stays testable. `register` answers
  // whether Electron accepted the accelerator; a desktop can still drop it silently (P17).
  shortcut?: {
    register: (accelerator: string, onPress: () => void) => boolean
    unregister: (accelerator: string) => void
  }
  // Asks the renderer to open the tab picker, when the shortcut finds more than one tab or none.
  emitPickTab?: () => void
}

// The capture shortcut. Microsoft Edge binds Ctrl+Shift+S (the mock's note), and the probe
// registered this accelerator under X11 (P17).
export const CAPTURE_SHORTCUT = 'CommandOrControl+Shift+F9'

// The maintainer's ruling of 2026-11-05 on P7: no launched Capture on macOS until a macOS run of
// the pipe and the known-answer validation pass there.
export const MACOS_CAPTURE_UNAVAILABLE =
  'Captures in a launched browser are not available on macOS yet: Birdbrain has not been ' +
  'validated with a launched browser there.'

export interface LaunchedBrowserService {
  status: () => LaunchedBrowserStatus
  launch: (browser: LaunchableBrowser) => Promise<LaunchedBrowserStatus>
  // Stops the Capture Session and settles once the launched browser has exited, or Birdbrain
  // has given up on it.
  endCaptureSession: () => Promise<void>
  // Stops a launch that is still starting, which then fails as cancelled. A running Capture
  // Session keeps running, and an open browser stays open.
  cancelLaunch: () => void
  // The session service's onSessionEnded.
  sessionEnded: () => void
  // SIGKILL with nothing to await, for quitting: Electron does not await before-quit.
  killForQuit: () => void
  // A clicked Capture of one tab (#1832). Resolves with the progress the panel shows; never
  // rejects.
  capture: (targetId: string, request: CaptureRequest) => Promise<LaunchedBrowserStatus>
  // What the capture shortcut does: capture the one tab that is visible and focused, or ask for
  // the tab picker.
  shortcutPressed: () => Promise<void>
  dispose: () => void
}

type AbortReason = 'session' | 'egress' | 'quit' | 'cancel'

interface Attempt {
  controller: AbortController
  abortReason: AbortReason | null
  summary: LaunchedBrowserSummary
  step: LaunchedBrowserStep
  // Set once the launch resolves, until the process exits.
  browser: LaunchedBrowser | null
  closing: Promise<void> | null
  notice: LaunchedBrowserNotice | undefined
  // Settles when the launch has resolved or failed.
  settled: Promise<void>
  captures: LaunchedCaptures | null
  shortcutRegistered: boolean
}

const BUSY: Readonly<Record<'starting' | 'open' | 'closing', string>> = {
  starting: 'still starting',
  open: 'already open',
  closing: 'still closing'
}

// The launcher's code for a launch its signal cancelled.
const CANCELLED = 'BROWSER_LAUNCH_CANCELLED'

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

function noticeOf(error: unknown): LaunchedBrowserNotice {
  const { code, message } = error as { code?: unknown; message?: unknown }
  return { code: String(code), message: String(message) }
}

export function createLaunchedBrowserService(
  deps: LaunchedBrowserServiceDeps
): LaunchedBrowserService {
  const {
    session,
    sessionDataPath,
    readSettings = getSettings,
    saveVersion = recordLaunchedBrowserVersion,
    launch = launchBrowser,
    prepareEgress = prepareEgressChecks,
    subscribeEgressChange = onEgressChange,
    emitStatus,
    log = logger,
    platform = process.platform,
    shortcut,
    emitPickTab
  } = deps
  const captureUnavailable = platform === 'darwin' ? MACOS_CAPTURE_UNAVAILABLE : undefined

  let current: LaunchedBrowserStatus = { state: 'none' }
  let active: Attempt | null = null

  function setStatus(next: LaunchedBrowserStatus): void {
    current = next
    emitStatus?.(next)
  }

  // The summary with each tab's recording flags and the last Capture's progress.
  function summaryOf(attempt: Attempt): LaunchedBrowserSummary {
    const { summary, captures, shortcutRegistered } = attempt
    const progress = captures?.progress()
    return {
      ...summary,
      tabs: captures ? captures.decorate(summary.tabs) : summary.tabs,
      ...(progress ? { capture: progress } : {}),
      ...(captureUnavailable ? { captureUnavailable } : {}),
      ...(captures && !captureUnavailable && summary.version !== null
        ? {
            shortcut: {
              accelerator: CAPTURE_SHORTCUT,
              state: shortcutRegistered ? ('unknown' as const) : ('failed' as const)
            }
          }
        : {})
    }
  }

  function show(attempt: Attempt, state: 'starting' | 'open' | 'closing'): void {
    if (active !== attempt) return
    const { step } = attempt
    const browser = summaryOf(attempt)
    setStatus(state === 'starting' ? { state, browser, step } : { state, browser })
  }

  function stopCaptures(attempt: Attempt): void {
    if (attempt.shortcutRegistered) {
      shortcut?.unregister(CAPTURE_SHORTCUT)
      attempt.shortcutRegistered = false
    }
    attempt.captures?.dispose()
  }

  function reach(attempt: Attempt, step: LaunchedBrowserStep): void {
    if (attempt.step === step) return
    attempt.step = step
    if (current.state === 'starting') show(attempt, 'starting')
  }

  // The attempt gives up the slot and the pin. `closed` keeps its summary for the panel.
  function release(attempt: Attempt, next: LaunchedBrowserStatus): void {
    if (active !== attempt) return
    stopCaptures(attempt)
    active = null
    session.unpinActiveCase()
    setStatus(next)
  }

  function abort(attempt: Attempt, reason: AbortReason): void {
    attempt.abortReason ??= reason
    attempt.controller.abort()
  }

  function failed(attempt: Attempt, error: unknown): unknown {
    release(attempt, { state: 'none' })
    const { abortReason, summary } = attempt
    if ((error as { code?: unknown } | null)?.code !== CANCELLED) {
      log.warn('launchedBrowser', 'launchedBrowser.launch_failed', undefined, error)
      return error
    }
    if (abortReason !== 'session' && abortReason !== 'egress') return error
    const what = abortReason === 'session' ? 'The Capture Session ended' : 'The Egress changed'
    return codedError(
      `${what} while ${summary.label} was starting, so Birdbrain stopped the launch.`,
      CANCELLED
    )
  }

  function onExit(attempt: Attempt, { profileError }: BrowserExit): void {
    if (profileError !== undefined) {
      log.warn('launchedBrowser', 'launchedBrowser.profile_remove_failed', undefined, profileError)
    }
    attempt.browser = null
    // Closed by the Operator, or gone on its own: its Capture Session runs on.
    if (!attempt.closing) {
      release(attempt, { state: 'closed', browser: { ...attempt.summary, tabs: [] } })
    }
  }

  // Settles with the error a stop failed with, once logged, or undefined.
  function stopBrowser(browser: LaunchedBrowser): Promise<unknown> {
    return browser.stop().then(
      () => undefined,
      (error: unknown) => {
        log.error('launchedBrowser', 'launchedBrowser.stop_failed', undefined, error)
        return error
      }
    )
  }

  function closeBrowser(attempt: Attempt): Promise<void> {
    const { browser } = attempt
    if (attempt.closing || !browser) return attempt.closing ?? Promise.resolve()
    show(attempt, 'closing')
    attempt.closing = stopBrowser(browser).then((error) => {
      if (error !== undefined) attempt.notice = noticeOf(error)
      const { notice } = attempt
      release(attempt, notice ? { state: 'none', notice } : { state: 'none' })
    })
    return attempt.closing
  }

  // Birdbrain ends the Capture Session, so the Operator is told why.
  function endSession(attempt: Attempt, notice: LaunchedBrowserNotice): void {
    attempt.notice ??= notice
    session.stop()
    void closeBrowser(attempt)
  }

  function sessionEnded(): void {
    if (current.state === 'closed') {
      setStatus({ state: 'none' })
      return
    }
    const attempt = active
    if (!attempt) return
    if (attempt.browser) void closeBrowser(attempt)
    else abort(attempt, 'session')
  }

  function egressChanged(): void {
    const attempt = active
    if (!attempt || attempt.closing) return
    if (!attempt.browser) {
      abort(attempt, 'egress')
      return
    }
    log.info('launchedBrowser', 'launchedBrowser.egress_changed')
    endSession(attempt, {
      code: 'EGRESS_CHANGED',
      message:
        'The Egress changed, so Birdbrain ended the Capture Session and closed ' +
        `${attempt.summary.label}.`
    })
  }

  async function startBrowser(
    attempt: Attempt,
    found: LaunchableBrowser,
    egress: EgressSetting
  ): Promise<LaunchedBrowserStatus> {
    const { label } = found
    const { caseId } = attempt.summary
    const refresh = (): void => {
      if (current.state === 'starting' || current.state === 'open') show(attempt, current.state)
    }
    if (deps.captures) {
      attempt.captures = createLaunchedCaptures({
        ...deps.captures,
        activeCaseId: () => session.snapshot().activeCaseId,
        onChange: refresh,
        log
      })
    }
    const hooks: LaunchHooks = {
      onExtensionWarning: (extensionId) => {
        const { extensionWarnings } = attempt.summary
        attempt.summary = {
          ...attempt.summary,
          extensionWarnings: [...extensionWarnings, extensionId]
        }
        if (current.state === 'starting' || current.state === 'open') show(attempt, current.state)
      },
      onTargetSetupFailed: (_target, error) => {
        log.warn('launchedBrowser', 'launchedBrowser.target_setup_failed', undefined, error)
      },
      onTabsChanged: (tabs) => {
        attempt.summary = { ...attempt.summary, tabs }
        if (current.state === 'starting' || current.state === 'open') show(attempt, current.state)
      }
    }

    let guard: EgressGuard
    let launched: LaunchedBrowser
    try {
      guard = await prepareEgress(egress, label)
      reach(attempt, 'browser')
      const { captures } = attempt
      if (captures) {
        captures.setEgress(guard.egress)
        const guardSession = guard.hooks.onRecordedSession
        hooks.onRecordedSession = (cdpSession, target, recording) => {
          guardSession?.(cdpSession, target, recording)
          captures.onRecordedSession(cdpSession, target, recording)
        }
      }
      const { checkFirstTab } = guard.hooks
      const firstTab: LaunchHooks = checkFirstTab
        ? {
            checkFirstTab: (tab) => {
              reach(attempt, 'first-tab')
              return checkFirstTab(tab)
            }
          }
        : {}
      launched = await launch({
        browser: found,
        egress: guard.egress,
        sessionDataPath,
        signal: attempt.controller.signal,
        hooks: { ...guard.hooks, ...hooks, ...firstTab }
      })
    } catch (error) {
      throw failed(attempt, error)
    }
    attempt.browser = launched
    void launched.exited.then((exit) => onExit(attempt, exit))

    // The pin holds the Case against everything but its deletion. A cancel can also land after
    // the launcher's last look at its signal.
    const deleted = session.snapshot().activeCaseId !== caseId
    if (deleted || attempt.abortReason !== null) {
      attempt.closing = stopBrowser(launched).then(() => {})
      await attempt.closing
      throw failed(
        attempt,
        deleted
          ? codedError(
              `The Active Case was deleted while ${label} was starting, so Birdbrain closed ` +
                'the browser.',
              'ACTIVE_CASE_DELETED'
            )
          : codedError('The launch was cancelled.', CANCELLED)
      )
    }

    if (!session.snapshot().sessionActive) session.start()
    const { version } = launched.identity
    attempt.summary = {
      ...attempt.summary,
      version,
      sessionStartedAt: session.snapshot().startedAt
    }
    try {
      saveVersion(found.executablePath, version)
    } catch (error) {
      log.warn('launchedBrowser', 'launchedBrowser.version_save_failed', undefined, error)
    }
    if (attempt.captures) {
      attempt.captures.attach(launched.client, launched.identity, launched.firstTab)
      if (!captureUnavailable && shortcut) {
        let registered = false
        try {
          registered = shortcut.register(CAPTURE_SHORTCUT, () => void shortcutPressed())
        } catch (error) {
          log.warn('launchedBrowser', 'launchedBrowser.shortcut_failed', undefined, error)
        }
        attempt.shortcutRegistered = registered
      }
    }
    guard.enforce(launched, (error) => {
      const unwatched = (error as { code?: unknown }).code === 'EGRESS_UNWATCHED'
      log.warn(
        'launchedBrowser',
        unwatched ? 'launchedBrowser.target_unwatched' : 'launchedBrowser.egress_bypass',
        undefined,
        error
      )
      endSession(
        attempt,
        unwatched
          ? {
              code: 'EGRESS_UNWATCHED',
              message:
                `Birdbrain could not watch the responses of a tab in ${label}, so it ended ` +
                'the Capture Session and closed the browser.'
            }
          : {
              code: 'EGRESS_BYPASS',
              message:
                `A response in ${label} did not come through the Egress proxy, so Birdbrain ` +
                'ended the Capture Session and closed the browser.'
            }
      )
    })
    show(attempt, 'open')
    return current
  }

  async function launchOne(found: LaunchableBrowser): Promise<LaunchedBrowserStatus> {
    if (current.state === 'starting' || current.state === 'open' || current.state === 'closing') {
      throw codedError(
        `Birdbrain runs one launched browser at a time, and ${current.browser.label} is ` +
          `${BUSY[current.state]}.`,
        'BROWSER_ALREADY_RUNNING'
      )
    }
    // Read the way the Capture Lifecycle's operator gate reads it (trimmedOperatorName).
    const { operatorName, egress } = readSettings()
    if (!(operatorName?.trim() ?? '')) {
      throw codedError(
        'Operator name required. Configure your name in Birdbrain settings before launching ' +
          'a browser.',
        'NO_OPERATOR_NAME'
      )
    }
    const { activeCaseId: caseId } = session.snapshot()
    if (!caseId) {
      throw codedError(
        'No active case selected. Open a Case before launching a browser.',
        'NO_ACTIVE_CASE'
      )
    }

    let settle: () => void = () => {}
    const attempt: Attempt = {
      controller: new AbortController(),
      abortReason: null,
      summary: {
        family: found.family,
        label: found.label,
        caseId,
        version: null,
        extensionWarnings: [],
        sessionStartedAt: null,
        tabs: []
      },
      step: egress.kind === 'direct' ? 'browser' : 'proxy',
      browser: null,
      closing: null,
      notice: undefined,
      captures: null,
      shortcutRegistered: false,
      settled: new Promise<void>((resolve) => {
        settle = resolve
      })
    }
    active = attempt
    session.pinActiveCase()
    show(attempt, 'starting')
    try {
      return await startBrowser(attempt, found, egress)
    } finally {
      settle()
    }
  }

  async function captureTabOf(
    targetId: string,
    request: CaptureRequest
  ): Promise<LaunchedBrowserStatus> {
    const attempt = active
    if (captureUnavailable) {
      throw codedError(captureUnavailable, 'LAUNCHED_CAPTURE_UNAVAILABLE')
    }
    if (!attempt || current.state !== 'open' || !attempt.captures) {
      throw codedError('No launched browser is open.', 'BROWSER_NOT_OPEN')
    }
    await attempt.captures.capture(targetId, request)
    return current
  }

  async function shortcutPressed(): Promise<void> {
    const attempt = active
    if (!attempt?.captures || current.state !== 'open' || captureUnavailable) return
    const choice = pickShortcutTab(await attempt.captures.focusStates())
    if ('pick' in choice) {
      emitPickTab?.()
      return
    }
    await attempt.captures.capture(choice.capture, { scrollToLoad: false })
  }

  const unsubscribe = subscribeEgressChange(egressChanged)

  return {
    status: () => current,
    launch: launchOne,
    endCaptureSession: async () => {
      const attempt = active
      session.stop()
      sessionEnded()
      if (attempt) await (attempt.closing ?? attempt.settled)
    },
    cancelLaunch: () => {
      const attempt = active
      if (attempt && !attempt.browser) abort(attempt, 'cancel')
    },
    sessionEnded,
    capture: captureTabOf,
    shortcutPressed,
    killForQuit: () => {
      const attempt = active
      if (attempt?.browser) attempt.browser.kill()
      else if (attempt) abort(attempt, 'quit')
    },
    dispose: unsubscribe
  }
}
