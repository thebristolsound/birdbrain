import type {
  BirdbrainSettings,
  EgressSetting,
  LaunchedBrowserNotice,
  LaunchedBrowserStatus,
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
}

export interface LaunchedBrowserService {
  status: () => LaunchedBrowserStatus
  launch: (browser: LaunchableBrowser) => Promise<LaunchedBrowserStatus>
  // Stops the Capture Session and settles once the launched browser has exited, or Birdbrain
  // has given up on it.
  endCaptureSession: () => Promise<void>
  // The session service's onSessionEnded.
  sessionEnded: () => void
  // SIGKILL with nothing to await, for quitting: Electron does not await before-quit.
  killForQuit: () => void
  dispose: () => void
}

type AbortReason = 'session' | 'egress' | 'quit'

interface Attempt {
  controller: AbortController
  abortReason: AbortReason | null
  summary: LaunchedBrowserSummary
  // Set once the launch resolves, until the process exits.
  browser: LaunchedBrowser | null
  closing: Promise<void> | null
  notice: LaunchedBrowserNotice | undefined
  // Settles when the launch has resolved or failed.
  settled: Promise<void>
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
    log = logger
  } = deps

  let current: LaunchedBrowserStatus = { state: 'none' }
  let active: Attempt | null = null

  function setStatus(next: LaunchedBrowserStatus): void {
    current = next
    emitStatus?.(next)
  }

  function show(attempt: Attempt, state: 'starting' | 'open' | 'closing'): void {
    if (active === attempt) setStatus({ state, browser: attempt.summary })
  }

  // The attempt gives up the slot and the pin. `closed` keeps its summary for the panel.
  function release(attempt: Attempt, next: LaunchedBrowserStatus): void {
    if (active !== attempt) return
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
    if (!attempt.closing) release(attempt, { state: 'closed', browser: attempt.summary })
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
      }
    }

    let guard: EgressGuard
    let launched: LaunchedBrowser
    try {
      guard = await prepareEgress(egress, label)
      launched = await launch({
        browser: found,
        egress: guard.egress,
        sessionDataPath,
        signal: attempt.controller.signal,
        hooks: { ...guard.hooks, ...hooks }
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
    attempt.summary = { ...attempt.summary, version }
    try {
      saveVersion(found.executablePath, version)
    } catch (error) {
      log.warn('launchedBrowser', 'launchedBrowser.version_save_failed', undefined, error)
    }
    guard.enforce(launched, (error) => {
      log.warn('launchedBrowser', 'launchedBrowser.egress_bypass', undefined, error)
      endSession(attempt, {
        code: 'EGRESS_BYPASS',
        message:
          `A response in ${label} did not come through the Egress proxy, so Birdbrain ended ` +
          'the Capture Session and closed the browser.'
      })
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
        extensionWarnings: []
      },
      browser: null,
      closing: null,
      notice: undefined,
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
    sessionEnded,
    killForQuit: () => {
      const attempt = active
      if (attempt?.browser) attempt.browser.kill()
      else if (attempt) abort(attempt, 'quit')
    },
    dispose: unsubscribe
  }
}
