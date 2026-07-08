import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import type { BirdbrainSettings, ReleaseChannel, UpdateState, UpdateStatus } from '@shared/types'
import { GITHUB_RELEASES_URL } from '@shared/constants'

// Update delivery (Phase 1: notify / check-only). Wraps electron-updater's
// GitHub-provider `autoUpdater` and exposes a small state machine to the
// renderer. Downloads/installs are deliberately NOT wired here — Birdbrain is a
// forensic capture tool, so nothing restarts on its own; Phase 1 only detects
// new releases and points the user at the release page. See
// docs/specs/2026-07-07-update-delivery-release-channels-design.md.

// Background check cadence: a short delay after launch, then every few hours.
const INITIAL_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface UpdaterServiceDeps {
  // Broadcast a status transition to the renderer.
  emit: (status: UpdateStatus) => void
  // Current release channel, read from settings on demand.
  getChannel: () => ReleaseChannel
  // Whether background auto-checks are enabled (manual checks are always allowed).
  isAutoCheckEnabled: () => boolean
}

export interface UpdaterService {
  // Attach listeners, apply channel config, and arm the background schedule.
  start(): void
  // Latest status snapshot (renderer fetches this on mount, then listens for events).
  getStatus(): UpdateStatus
  // Run a check now. Resolves with the resulting status.
  check(): Promise<UpdateStatus>
  // React to a settings change: reconfigure the channel and/or reschedule checks.
  applySettingsChange(partial: Partial<BirdbrainSettings>): void
  // Tear down timers and listeners (app quit / tests).
  dispose(): void
}

// Can this build install an update itself, or only notify? Phase 1 treats every
// platform as notify at the UI level, but the flag is computed correctly so the
// Phase 2/3 auto-install path can rely on it.
function detectSupportsAutoInstall(): boolean {
  if (!app.isPackaged) return false
  switch (process.platform) {
    case 'win32':
      return true // NSIS full auto-update
    case 'linux':
      return !!process.env.APPIMAGE // AppImage updates in place; deb does not
    default:
      return false // macOS blocked until Developer ID signing + notarization
  }
}

// The tag-push release workflow tags every release `v<version>`, so the release
// page for a resolved version is derivable without a metadata round-trip.
function releasePageUrl(version: string): string {
  return `${GITHUB_RELEASES_URL}/tag/v${version}`
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createUpdaterService(deps: UpdaterServiceDeps): UpdaterService {
  const currentVersion = app.getVersion()
  const supportsAutoInstall = detectSupportsAutoInstall()
  // Only a packaged build has real release metadata to check against; in dev the
  // service stays inert (no checks, no schedule).
  const canCheck = app.isPackaged

  let status: UpdateStatus = { state: 'idle', currentVersion, supportsAutoInstall }
  let initialTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null
  let listenersAttached = false

  // Build a status from scratch per transition so stale fields (availableVersion,
  // error, …) never leak across states.
  function base(state: UpdateState): UpdateStatus {
    return { state, currentVersion, supportsAutoInstall }
  }

  function transition(next: UpdateStatus): void {
    status = next
    deps.emit(status)
  }

  function attachListeners(): void {
    if (listenersAttached) return
    listenersAttached = true
    autoUpdater.on('checking-for-update', () => transition(base('checking')))
    // We read only `version`; typing the param minimally avoids depending on
    // electron-updater's non-re-exported UpdateInfo type.
    autoUpdater.on('update-available', (info: { version: string }) =>
      transition({
        ...base('available'),
        availableVersion: info.version,
        releaseNotesUrl: releasePageUrl(info.version)
      })
    )
    autoUpdater.on('update-not-available', () => transition(base('up-to-date')))
    autoUpdater.on('error', (err) => transition({ ...base('error'), error: messageOf(err) }))
  }

  function configure(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    // Channel selection rides on the GitHub prerelease flag. Set allowPrerelease
    // FIRST, then pin allowDowngrade false: electron-updater implicitly flips
    // allowDowngrade true whenever allowPrerelease is true, so the order matters.
    // `autoUpdater.channel` is intentionally never assigned — the GitHub provider
    // uses the prerelease flag, not named channel files.
    autoUpdater.allowPrerelease = deps.getChannel() === 'beta'
    autoUpdater.allowDowngrade = false
  }

  function clearTimers(): void {
    if (initialTimer) {
      clearTimeout(initialTimer)
      initialTimer = null
    }
    if (intervalTimer) {
      clearInterval(intervalTimer)
      intervalTimer = null
    }
  }

  function scheduleAutoChecks(): void {
    clearTimers()
    if (!canCheck || !deps.isAutoCheckEnabled()) return
    initialTimer = setTimeout(() => void check(), INITIAL_CHECK_DELAY_MS)
    intervalTimer = setInterval(() => void check(), CHECK_INTERVAL_MS)
  }

  async function check(): Promise<UpdateStatus> {
    if (!canCheck) return status
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      // electron-updater emits 'error' before rejecting, which already recorded
      // the failure — swallow the rejection so it never surfaces as an unhandled
      // promise rejection. Belt-and-braces: if a rejection somehow arrived with
      // no 'error' event, the state is still mid-check, so synthesize one.
      if (status.state === 'checking') {
        transition({ ...base('error'), error: messageOf(err) })
      }
    }
    return status
  }

  function start(): void {
    attachListeners()
    configure()
    scheduleAutoChecks()
  }

  function applySettingsChange(partial: Partial<BirdbrainSettings>): void {
    if ('releaseChannel' in partial) {
      configure()
      void check()
    }
    if ('autoCheckForUpdates' in partial) {
      scheduleAutoChecks()
    }
  }

  function dispose(): void {
    clearTimers()
    autoUpdater.removeAllListeners('checking-for-update')
    autoUpdater.removeAllListeners('update-available')
    autoUpdater.removeAllListeners('update-not-available')
    autoUpdater.removeAllListeners('error')
    listenersAttached = false
  }

  return {
    start,
    getStatus: () => status,
    check,
    applySettingsChange,
    dispose
  }
}
