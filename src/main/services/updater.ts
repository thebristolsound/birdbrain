import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BirdbrainSettings, ReleaseChannel, UpdateState, UpdateStatus } from '@shared/types'
import { GITHUB_RELEASES_URL } from '@shared/constants'

// Update delivery. Wraps electron-updater's GitHub-provider `autoUpdater` and
// exposes a small state machine to the renderer. Downloads run only on explicit
// user action or under the auto-check policy, and only on platforms that can
// install an update (Windows NSIS, Linux AppImage, Linux deb) — everywhere else
// resolution is notify-only. Birdbrain is a forensic capture tool, so nothing
// ever restarts on its own: install happens via the explicit "Restart to
// update" action or naturally on next quit (autoInstallOnAppQuit; deb installs
// are explicit-only because they need a system password prompt). See
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
  // Download the available update (auto-install platforms only). Progress
  // arrives via status events; resolves once the download settles.
  download(): Promise<void>
  // Quit and install a downloaded update. Only ever user-triggered.
  install(): void
  // React to a settings change: reconfigure the channel and/or reschedule checks.
  applySettingsChange(partial: Partial<BirdbrainSettings>): void
  // Tear down timers and listeners (app quit / tests).
  dispose(): void
}

// How was this Linux build installed? AppImage advertises itself via the
// APPIMAGE env var; for package installs electron-builder embeds a
// `package-type` file in the app resources, which is also what electron-updater
// reads to pick its DebUpdater. Archive installs (tar/zip) have neither.
type LinuxPackageFormat = 'appimage' | 'deb' | null

function detectLinuxPackageFormat(): LinuxPackageFormat {
  if (process.env.APPIMAGE) return 'appimage'
  try {
    const packageType = readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim()
    if (packageType === 'deb') return 'deb'
  } catch {
    // No package-type file — not a package-manager install.
  }
  return null
}

// Can this build install an update itself, or only notify? The download/install
// path is gated on this flag; notify-only platforms surface a release link.
function detectSupportsAutoInstall(linuxFormat: LinuxPackageFormat): boolean {
  if (!app.isPackaged) return false
  switch (process.platform) {
    case 'win32':
      return true // NSIS full auto-update
    case 'linux':
      // AppImage replaces itself in place; deb installs via electron-updater's
      // DebUpdater (dpkg behind a system password prompt).
      return linuxFormat !== null
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
  const linuxFormat = process.platform === 'linux' ? detectLinuxPackageFormat() : null
  const isDebInstall = linuxFormat === 'deb'
  const supportsAutoInstall = detectSupportsAutoInstall(linuxFormat)
  // deb installs go through dpkg behind a system password prompt, so they must
  // never run implicitly at quit — only via the explicit "Restart to update".
  const installOnQuit = supportsAutoInstall && !isDebInstall
  // Only a packaged build has real release metadata to check against; in dev the
  // service stays inert (no checks, no schedule).
  const canCheck = app.isPackaged

  let status: UpdateStatus = { state: 'idle', currentVersion, supportsAutoInstall, installOnQuit }
  let initialTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null
  let listenersAttached = false
  let checkInProgress = false
  let downloadInProgress = false
  // The version last reported available, so progress transitions can carry it
  // (electron-updater's progress events don't include version info).
  let availableVersion: string | null = null

  // Build a status from scratch per transition so stale fields (availableVersion,
  // error, …) never leak across states.
  function base(state: UpdateState): UpdateStatus {
    return { state, currentVersion, supportsAutoInstall, installOnQuit }
  }

  function transition(next: UpdateStatus): void {
    status = next
    deps.emit(status)
  }

  function attachListeners(): void {
    if (listenersAttached) return
    listenersAttached = true
    autoUpdater.on('checking-for-update', () => transition(base('checking')))
    // We read only `version`/`percent`; typing the params minimally avoids
    // depending on electron-updater's non-re-exported UpdateInfo/ProgressInfo.
    autoUpdater.on('update-available', (info: { version: string }) => {
      availableVersion = info.version
      transition({
        ...base('available'),
        availableVersion: info.version,
        releaseNotesUrl: releasePageUrl(info.version)
      })
      // Auto-download when the platform can install in place AND the user has
      // background checking on — that's the "auto" in auto-update. With
      // auto-check off, downloading stays a deliberate click.
      if (supportsAutoInstall && deps.isAutoCheckEnabled()) void download()
    })
    autoUpdater.on('update-not-available', () => {
      availableVersion = null
      transition(base('up-to-date'))
    })
    autoUpdater.on('download-progress', (progress: { percent: number }) =>
      transition({
        ...base('downloading'),
        availableVersion: availableVersion ?? undefined,
        releaseNotesUrl: availableVersion ? releasePageUrl(availableVersion) : undefined,
        percent: progress.percent
      })
    )
    autoUpdater.on('update-downloaded', (info: { version: string }) => {
      availableVersion = info.version
      transition({
        ...base('downloaded'),
        availableVersion: info.version,
        releaseNotesUrl: releasePageUrl(info.version)
      })
    })
    autoUpdater.on('error', (err) => transition({ ...base('error'), error: messageOf(err) }))
  }

  function configure(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = installOnQuit
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
    // Short-circuit concurrent invocations (manual + scheduled can overlap).
    if (checkInProgress) return status
    checkInProgress = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      // electron-updater normally emits 'error' before rejecting, which already
      // records the failure. Belt-and-braces: if a rejection arrives without a
      // prior 'error' event (e.g. a pre-emit network failure), the state won't
      // yet be 'error', so synthesize one to ensure the UI always gets feedback.
      if (status.state !== 'error') {
        transition({ ...base('error'), error: messageOf(err) })
      }
    } finally {
      checkInProgress = false
    }
    return status
  }

  async function download(): Promise<void> {
    // Only from a known-available update, on a platform that can install it,
    // and never twice concurrently — auto-download and a manual click can race
    // before the first progress event moves the state off 'available'.
    if (!canCheck || !supportsAutoInstall || status.state !== 'available') return
    if (downloadInProgress) return
    downloadInProgress = true
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      // Mirrors check(): 'error' usually fired already; synthesize one only if
      // the rejection arrived mid-download with no error event.
      if (status.state === 'available' || status.state === 'downloading') {
        transition({ ...base('error'), error: messageOf(err) })
      }
    } finally {
      downloadInProgress = false
    }
  }

  function install(): void {
    // Forensic safety: installing restarts the app, so it must be impossible to
    // reach without a fully downloaded update and an explicit user click.
    if (status.state !== 'downloaded') return
    if (isDebInstall) {
      // isForceRunAfter relaunches the app once dpkg finishes — without it a
      // deb install would quit and leave the user to reopen Birdbrain manually.
      autoUpdater.quitAndInstall(false, true)
    } else {
      autoUpdater.quitAndInstall()
    }
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
    autoUpdater.removeAllListeners('download-progress')
    autoUpdater.removeAllListeners('update-downloaded')
    autoUpdater.removeAllListeners('error')
    listenersAttached = false
  }

  return {
    start,
    getStatus: () => status,
    check,
    download,
    install,
    applySettingsChange,
    dispose
  }
}
