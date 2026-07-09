import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { UpdateStatus, ReleaseChannel } from '@shared/types'

// --- Module mocks -----------------------------------------------------------
// Built inside vi.hoisted so the shared stubs exist when the hoisted vi.mock
// factories run (before the imports below). `autoUpdater` is a hand-rolled
// event emitter; `appMock` is mutable so each test can vary isPackaged/version.
type Listener = (...args: unknown[]) => void

const { autoUpdater, appMock } = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>()
  const au = {
    autoDownload: undefined as boolean | undefined,
    autoInstallOnAppQuit: undefined as boolean | undefined,
    allowPrerelease: undefined as boolean | undefined,
    allowDowngrade: undefined as boolean | undefined,
    channel: undefined as string | null | undefined,
    checkForUpdates: vi.fn(async () => ({})),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
    on(event: string, cb: Listener) {
      const arr = listeners.get(event) ?? []
      arr.push(cb)
      listeners.set(event, arr)
      return au
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args)
      return true
    },
    removeAllListeners(event?: string) {
      if (event) listeners.delete(event)
      else listeners.clear()
      return au
    }
  }
  return { autoUpdater: au, appMock: { isPackaged: true, getVersion: vi.fn(() => '1.2.3') } }
})

vi.mock('electron', () => ({ app: appMock }))
vi.mock('electron-updater', () => ({ autoUpdater }))

import { createUpdaterService, type UpdaterServiceDeps } from '@main/services/updater'

const origPlatform = process.platform
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function makeDeps(overrides: Partial<UpdaterServiceDeps> = {}): {
  deps: UpdaterServiceDeps
  emitted: UpdateStatus[]
} {
  const emitted: UpdateStatus[] = []
  const deps: UpdaterServiceDeps = {
    emit: (s) => emitted.push(s),
    getChannel: () => 'stable',
    isAutoCheckEnabled: () => true,
    ...overrides
  }
  return { deps, emitted }
}

beforeEach(() => {
  autoUpdater.removeAllListeners()
  autoUpdater.checkForUpdates = vi.fn(async () => ({}))
  autoUpdater.downloadUpdate = vi.fn(async () => [])
  autoUpdater.quitAndInstall = vi.fn()
  autoUpdater.autoDownload = undefined
  autoUpdater.autoInstallOnAppQuit = undefined
  autoUpdater.allowPrerelease = undefined
  autoUpdater.allowDowngrade = undefined
  autoUpdater.channel = undefined
  appMock.isPackaged = true
  appMock.getVersion = vi.fn(() => '1.2.3')
  setPlatform('linux')
  delete process.env.APPIMAGE
  vi.useRealTimers()
})

afterEach(() => {
  setPlatform(origPlatform)
  delete process.env.APPIMAGE
  vi.useRealTimers()
})

describe('updater service — status snapshot', () => {
  it('starts idle with the current version', () => {
    appMock.isPackaged = false
    const { deps } = makeDeps()
    const svc = createUpdaterService(deps)
    const status = svc.getStatus()
    expect(status.state).toBe('idle')
    expect(status.currentVersion).toBe('1.2.3')
  })
})

describe('updater service — check transitions', () => {
  it('emits checking then available with a derived release-page URL', async () => {
    const { deps, emitted } = makeDeps()
    setPlatform('win32')
    const svc = createUpdaterService(deps)
    svc.start()
    autoUpdater.checkForUpdates = vi.fn(async () => {
      autoUpdater.emit('checking-for-update')
      autoUpdater.emit('update-available', { version: '2.0.0' })
      return {}
    })

    const result = await svc.check()
    expect(result.state).toBe('available')
    expect(result.availableVersion).toBe('2.0.0')
    expect(result.releaseNotesUrl).toBe(
      'https://github.com/thebristolsound/birdbrain/releases/tag/v2.0.0'
    )
    expect(emitted.map((s) => s.state)).toContain('checking')
    expect(emitted.map((s) => s.state)).toContain('available')
  })

  it('resolves up-to-date when no update is available', async () => {
    const { deps } = makeDeps()
    const svc = createUpdaterService(deps)
    svc.start()
    autoUpdater.checkForUpdates = vi.fn(async () => {
      autoUpdater.emit('checking-for-update')
      autoUpdater.emit('update-not-available', { version: '1.2.3' })
      return {}
    })
    const result = await svc.check()
    expect(result.state).toBe('up-to-date')
    expect(result.availableVersion).toBeUndefined()
  })

  it('records an error and swallows the rejection', async () => {
    const { deps } = makeDeps()
    const svc = createUpdaterService(deps)
    svc.start()
    autoUpdater.checkForUpdates = vi.fn(async () => {
      autoUpdater.emit('error', new Error('network down'))
      throw new Error('network down')
    })
    const result = await svc.check()
    expect(result.state).toBe('error')
    expect(result.error).toBe('network down')
  })

  it('synthesizes an error if a check rejects without an error event', async () => {
    const { deps } = makeDeps()
    const svc = createUpdaterService(deps)
    svc.start()
    autoUpdater.checkForUpdates = vi.fn(async () => {
      // Enter the checking state but reject before any terminal event.
      autoUpdater.emit('checking-for-update')
      throw new Error('boom')
    })
    const result = await svc.check()
    expect(result.state).toBe('error')
    expect(result.error).toBe('boom')
  })

  it('is a no-op in dev (unpackaged) — never calls checkForUpdates', async () => {
    appMock.isPackaged = false
    const { deps, emitted } = makeDeps()
    const svc = createUpdaterService(deps)
    svc.start()
    const result = await svc.check()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(result.state).toBe('idle')
    expect(emitted).toHaveLength(0)
  })
})

describe('updater service — channel configuration', () => {
  it('maps stable → allowPrerelease false and pins allowDowngrade false', () => {
    const { deps } = makeDeps({ getChannel: () => 'stable' })
    const svc = createUpdaterService(deps)
    svc.start()
    expect(autoUpdater.allowPrerelease).toBe(false)
    expect(autoUpdater.allowDowngrade).toBe(false)
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
    // The GitHub provider uses the prerelease flag, not named channel files.
    expect(autoUpdater.channel).toBeUndefined()
  })

  it('maps beta → allowPrerelease true while keeping allowDowngrade false', () => {
    const { deps } = makeDeps({ getChannel: () => 'beta' })
    const svc = createUpdaterService(deps)
    svc.start()
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(autoUpdater.allowDowngrade).toBe(false)
  })

  it('reconfigures and re-checks when the channel setting changes', async () => {
    let channel: ReleaseChannel = 'stable'
    const { deps } = makeDeps({ getChannel: () => channel })
    const svc = createUpdaterService(deps)
    svc.start()
    expect(autoUpdater.allowPrerelease).toBe(false)

    channel = 'beta'
    svc.applySettingsChange({ releaseChannel: 'beta' })
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
  })

  it('ignores unrelated settings changes', () => {
    const { deps } = makeDeps()
    const svc = createUpdaterService(deps)
    svc.start()
    autoUpdater.checkForUpdates = vi.fn(async () => ({}))
    svc.applySettingsChange({ operatorName: 'X' })
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('updater service — auto-install detection', () => {
  const cases: Array<{ platform: NodeJS.Platform; appImage: boolean; expected: boolean }> = [
    { platform: 'win32', appImage: false, expected: true },
    { platform: 'linux', appImage: true, expected: true },
    { platform: 'linux', appImage: false, expected: false },
    { platform: 'darwin', appImage: false, expected: false }
  ]
  for (const { platform, appImage, expected } of cases) {
    it(`${platform}${appImage ? ' (AppImage)' : ''} → supportsAutoInstall=${expected}`, () => {
      setPlatform(platform)
      if (appImage) process.env.APPIMAGE = '/tmp/app.AppImage'
      const { deps } = makeDeps()
      const svc = createUpdaterService(deps)
      expect(svc.getStatus().supportsAutoInstall).toBe(expected)
    })
  }

  it('is always false in dev regardless of platform', () => {
    appMock.isPackaged = false
    setPlatform('win32')
    const { deps } = makeDeps()
    const svc = createUpdaterService(deps)
    expect(svc.getStatus().supportsAutoInstall).toBe(false)
  })
})

describe('updater service — scheduling', () => {
  it('checks ~30s after start and again on the interval', async () => {
    vi.useFakeTimers()
    const { deps } = makeDeps()
    const svc = createUpdaterService(deps)
    svc.start()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    vi.advanceTimersByTime(30_000)
    // Flush microtasks so the first check's async cleanup (checkInProgress reset)
    // completes before the interval fires.
    await Promise.resolve()
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(4 * 60 * 60 * 1000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('does not schedule when auto-check is disabled', () => {
    vi.useFakeTimers()
    const { deps } = makeDeps({ isAutoCheckEnabled: () => false })
    const svc = createUpdaterService(deps)
    svc.start()
    vi.advanceTimersByTime(30_000)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('re-arms the schedule when auto-check is toggled on', () => {
    vi.useFakeTimers()
    let enabled = false
    const { deps } = makeDeps({ isAutoCheckEnabled: () => enabled })
    const svc = createUpdaterService(deps)
    svc.start()
    vi.advanceTimersByTime(30_000)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    enabled = true
    svc.applySettingsChange({ autoCheckForUpdates: true })
    vi.advanceTimersByTime(30_000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('does not schedule in dev even with auto-check enabled', () => {
    vi.useFakeTimers()
    appMock.isPackaged = false
    const { deps } = makeDeps()
    const svc = createUpdaterService(deps)
    svc.start()
    vi.advanceTimersByTime(4 * 60 * 60 * 1000)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('updater service — download & install', () => {
  // Drives a fresh service to the 'available' state on an auto-install
  // platform. Auto-check defaults OFF so downloads stay manual unless the
  // test opts in.
  function makeAvailable(opts: { autoCheck?: boolean } = {}) {
    setPlatform('win32')
    const { deps, emitted } = makeDeps({ isAutoCheckEnabled: () => opts.autoCheck ?? false })
    const svc = createUpdaterService(deps)
    svc.start()
    autoUpdater.emit('update-available', { version: '2.0.0' })
    return { svc, emitted }
  }

  it('auto-downloads an available update when auto-check is on', () => {
    makeAvailable({ autoCheck: true })
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('leaves downloading to a manual click when auto-check is off', async () => {
    const { svc } = makeAvailable()
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    await svc.download()
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('never downloads on a notify-only platform', async () => {
    setPlatform('darwin')
    const { deps } = makeDeps({ isAutoCheckEnabled: () => true })
    const svc = createUpdaterService(deps)
    svc.start()
    autoUpdater.emit('update-available', { version: '2.0.0' })
    await svc.download()
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('ignores download() unless an update is available', async () => {
    setPlatform('win32')
    const { deps } = makeDeps()
    const svc = createUpdaterService(deps)
    svc.start()
    await svc.download() // still idle
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('tracks progress and lands in downloaded with a release URL', () => {
    const { svc, emitted } = makeAvailable()
    autoUpdater.emit('download-progress', { percent: 41.5 })
    expect(svc.getStatus().state).toBe('downloading')
    expect(svc.getStatus().percent).toBe(41.5)
    expect(svc.getStatus().availableVersion).toBe('2.0.0')

    autoUpdater.emit('update-downloaded', { version: '2.0.0' })
    const status = svc.getStatus()
    expect(status.state).toBe('downloaded')
    expect(status.availableVersion).toBe('2.0.0')
    expect(status.releaseNotesUrl).toBe(
      'https://github.com/thebristolsound/birdbrain/releases/tag/v2.0.0'
    )
    expect(emitted.map((s) => s.state)).toEqual(
      expect.arrayContaining(['available', 'downloading', 'downloaded'])
    )
  })

  it('synthesizes an error if the download rejects without an error event', async () => {
    const { svc } = makeAvailable()
    autoUpdater.downloadUpdate = vi.fn(async () => {
      throw new Error('disk full')
    })
    await svc.download()
    expect(svc.getStatus().state).toBe('error')
    expect(svc.getStatus().error).toBe('disk full')
  })

  it('install() is a no-op until downloaded, then quits and installs', () => {
    const { svc } = makeAvailable()
    svc.install() // available but not yet downloaded
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()

    autoUpdater.emit('update-downloaded', { version: '2.0.0' })
    svc.install()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})

describe('updater service — dispose', () => {
  it('detaches listeners and clears timers', () => {
    vi.useFakeTimers()
    const { deps, emitted } = makeDeps()
    const svc = createUpdaterService(deps)
    svc.start()
    svc.dispose()

    // Timers cleared: no scheduled check fires after dispose.
    vi.advanceTimersByTime(4 * 60 * 60 * 1000)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    // Listeners detached: stray events no longer transition status.
    emitted.length = 0
    autoUpdater.emit('update-available', { version: '9.9.9' })
    autoUpdater.emit('download-progress', { percent: 50 })
    autoUpdater.emit('update-downloaded', { version: '9.9.9' })
    expect(emitted).toHaveLength(0)
    expect(svc.getStatus().state).toBe('idle')
  })
})
