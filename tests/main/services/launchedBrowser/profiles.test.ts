import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { createPersona, softDeletePersona } from '@main/services/db/personaRepo'
import {
  createSessionProfile,
  launchedBrowsersRoot,
  personaProfileDir,
  processAlive,
  profileInUse,
  removeSessionProfile,
  sweepLaunchedBrowserProfiles,
  sweepLaunchedBrowsersAtStartup
} from '@main/services/launchedBrowser/profiles'

const HOST = 'birdbrain-host'
const LIVE_PID = 4242
// Whatever the injected checks are asked, only LIVE_PID on HOST is a running browser.
const lockDeps = {
  hostname: () => HOST,
  isAlive: (pid: number) => pid === LIVE_PID
}

let userData: string

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'birdbrain-launched-profiles-'))
  await initDatabase(join(userData, 'birdbrain.db'))
})

afterEach(() => {
  closeDatabase()
  rmSync(userData, { recursive: true, force: true })
})

function root(): string {
  return launchedBrowsersRoot(userData)
}

// A product folder with the lock Chromium leaves in it: `<host>-<pid>` while the browser runs,
// and still there after the browser is killed.
function profileFolder(folder: string, product: string, lockTarget?: string): string {
  const dir = join(root(), folder, product)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Local State'), '{}')
  if (lockTarget !== undefined) symlinkSync(lockTarget, join(dir, 'SingletonLock'))
  return dir
}

describe('profile paths', () => {
  it('puts every launched browser profile under launched-browsers beside the partitions', () => {
    expect(root()).toBe(join(userData, 'launched-browsers'))
    expect(personaProfileDir(userData, 'p-1', 'edge')).toBe(
      join(userData, 'launched-browsers', 'persona-p-1', 'edge')
    )
  })

  it('creates a throwaway profile at session-<uuid>/<product> and removes the session folder', () => {
    const profile = createSessionProfile(userData, 'chrome', { randomUUID: () => 'u-1' })
    expect(profile).toEqual({
      sessionDir: join(root(), 'session-u-1'),
      profileDir: join(root(), 'session-u-1', 'chrome')
    })
    expect(existsSync(profile.profileDir)).toBe(true)
    writeFileSync(join(profile.profileDir, 'Cookies'), 'x')
    removeSessionProfile(userData, profile)
    expect(readdirSync(root())).toEqual([])
  })

  it('gives each throwaway profile its own folder', () => {
    const first = createSessionProfile(userData, 'brave')
    const second = createSessionProfile(userData, 'brave')
    expect(first.sessionDir).not.toBe(second.sessionDir)
    expect(first.sessionDir).toMatch(/session-[0-9a-f-]{36}$/)
  })

  it('refuses to remove a folder that is not a session folder under the root', () => {
    for (const sessionDir of [userData, join(root(), 'persona-p-1'), join(userData, 'session-x')]) {
      expect(() =>
        removeSessionProfile(userData, { sessionDir, profileDir: join(sessionDir, 'chrome') })
      ).toThrow(/not a throwaway browser profile/)
    }
    expect(existsSync(join(userData, 'birdbrain.db'))).toBe(true)
  })
})

describe('profileInUse', () => {
  it('reads the lock of a running browser as in use, and a dead or missing one as free', () => {
    const running = profileFolder('session-a', 'chrome', `${HOST}-${LIVE_PID}`)
    const killed = profileFolder('session-b', 'chrome', `${HOST}-999`)
    const closed = profileFolder('session-c', 'chrome')
    expect(profileInUse(running, lockDeps)).toBe(true)
    expect(profileInUse(killed, lockDeps)).toBe(false)
    expect(profileInUse(closed, lockDeps)).toBe(false)
  })

  it('treats a lock it cannot check as in use', () => {
    const otherHost = profileFolder('session-a', 'chrome', `another-machine-${LIVE_PID}`)
    const noPid = profileFolder('session-b', 'chrome', `${HOST}-`)
    const notLink = profileFolder('session-c', 'chrome')
    writeFileSync(join(notLink, 'SingletonLock'), '')
    expect(profileInUse(otherHost, lockDeps)).toBe(true)
    expect(profileInUse(noPid, lockDeps)).toBe(true)
    expect(profileInUse(notLink, lockDeps)).toBe(true)
  })

  it('reads the host name a hyphen splits from the pid at the last hyphen', () => {
    const deps = { hostname: () => 'my-laptop-2', isAlive: (pid: number) => pid === 17 }
    expect(profileInUse(profileFolder('session-a', 'chrome', 'my-laptop-2-17'), deps)).toBe(true)
  })
})

describe('processAlive', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('answers from a signal-0 probe, counting a process it may not signal as alive', () => {
    expect(processAlive(process.pid)).toBe(true)
    const kill = vi.spyOn(process, 'kill')
    kill.mockImplementationOnce(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    expect(processAlive(31337)).toBe(false)
    kill.mockImplementationOnce(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
    })
    expect(processAlive(1)).toBe(true)
    expect(kill).toHaveBeenCalledWith(31337, 0)
  })
})

describe('sweepLaunchedBrowserProfiles', () => {
  it('removes leftover session folders and the folders of Personas with no row', () => {
    const live = createPersona({ label: 'Live' }).id
    const deleted = createPersona({ label: 'Deleted' }).id
    softDeletePersona(deleted)
    profileFolder('session-old', 'chrome', `${HOST}-999`)
    profileFolder('session-older', 'edge')
    profileFolder(`persona-${live}`, 'chrome')
    profileFolder(`persona-${deleted}`, 'brave')
    profileFolder('persona-gone', 'chromium')
    mkdirSync(join(root(), 'notes'))

    const result = sweepLaunchedBrowserProfiles(userData, userData, lockDeps)

    expect(result).toEqual({
      removed: ['persona-gone', 'session-old', 'session-older'],
      inUse: [],
      failed: [],
      personaFoldersSwept: true
    })
    expect(readdirSync(root()).sort()).toEqual(
      ['notes', `persona-${deleted}`, `persona-${live}`].sort()
    )
  })

  it('keeps the folder of a browser that is still running', () => {
    profileFolder('session-running', 'chrome', `${HOST}-${LIVE_PID}`)
    profileFolder('persona-gone', 'edge', `${HOST}-${LIVE_PID}`)
    const result = sweepLaunchedBrowserProfiles(userData, userData, lockDeps)
    expect(result).toMatchObject({ removed: [], inUse: ['persona-gone', 'session-running'] })
    expect(readdirSync(root()).sort()).toEqual(['persona-gone', 'session-running'])
  })

  it('sweeps no Persona folder when the database is not beside the session folders', () => {
    profileFolder('persona-gone', 'chrome')
    profileFolder('session-old', 'chrome')
    const elsewhere = join(userData, 'elsewhere')
    const result = sweepLaunchedBrowserProfiles(elsewhere, userData, lockDeps)
    expect(result).toEqual({
      removed: ['session-old'],
      inUse: [],
      failed: [],
      personaFoldersSwept: false
    })
    expect(readdirSync(root())).toEqual(['persona-gone'])
  })

  it('reports a folder it could not remove and goes on to the next', () => {
    profileFolder('session-a', 'chrome')
    profileFolder('session-b', 'chrome')
    const failure = new Error('EBUSY')
    const remove = vi.fn((path: string) => {
      if (path.endsWith('session-a')) throw failure
      rmSync(path, { recursive: true, force: true })
    })
    const result = sweepLaunchedBrowserProfiles(userData, userData, { ...lockDeps, remove })
    expect(result).toMatchObject({
      removed: ['session-b'],
      failed: [{ name: 'session-a', error: failure }]
    })
  })

  it('does nothing when there is no launched-browsers folder', () => {
    expect(sweepLaunchedBrowserProfiles(userData, userData, lockDeps)).toEqual({
      removed: [],
      inUse: [],
      failed: [],
      personaFoldersSwept: true
    })
  })

  it('reports a launched-browsers folder it cannot list', () => {
    writeFileSync(root(), 'not a folder')
    const result = sweepLaunchedBrowserProfiles(userData, userData, lockDeps)
    expect(result).toMatchObject({ removed: [], failed: [{ name: 'launched-browsers' }] })
  })
})

describe('sweepLaunchedBrowsersAtStartup', () => {
  // Which pids on HOST are running browsers, changed by a test to close one.
  let alive: Set<number>
  const log = { info: vi.fn(), warn: vi.fn() }
  const deps = () => ({
    hostname: () => HOST,
    isAlive: (pid: number) => alive.has(pid),
    log
  })

  beforeEach(() => {
    alive = new Set([LIVE_PID])
    log.info.mockClear()
    log.warn.mockClear()
  })

  it('removes the leftovers, logs what it did, and names each browser still running', () => {
    profileFolder('session-old', 'chrome', `${HOST}-999`)
    profileFolder('session-running', 'chrome', `${HOST}-${LIVE_PID}`)
    profileFolder('persona-gone', 'edge', `${HOST}-${LIVE_PID}`)

    const checkLeftovers = sweepLaunchedBrowsersAtStartup(userData, userData, deps())

    expect(readdirSync(root()).sort()).toEqual(['persona-gone', 'session-running'])
    expect(log.info).toHaveBeenCalledWith('launchedBrowser', 'launchedBrowser.profiles_swept', {
      count: 1
    })
    expect(log.warn).toHaveBeenCalledWith('launchedBrowser', 'launchedBrowser.leftover_running', {
      count: 2
    })
    expect(checkLeftovers()).toEqual([
      { label: 'Microsoft Edge', profile: 'persona' },
      { label: 'Google Chrome', profile: 'session' }
    ])
  })

  it('logs nothing and names no browser when nothing was left', () => {
    const checkLeftovers = sweepLaunchedBrowsersAtStartup(userData, userData, deps())
    expect(checkLeftovers()).toEqual([])
    expect(log.info).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('logs each folder it could not remove', () => {
    profileFolder('session-a', 'chrome')
    const failure = new Error('EBUSY')
    const remove = () => {
      throw failure
    }
    sweepLaunchedBrowsersAtStartup(userData, userData, { ...deps(), remove })
    expect(log.warn).toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.profile_sweep_failed',
      undefined,
      failure
    )
  })

  it('removes the folder of a browser that has closed since, and stops naming it', () => {
    profileFolder('session-running', 'chrome', `${HOST}-${LIVE_PID}`)
    const checkLeftovers = sweepLaunchedBrowsersAtStartup(userData, userData, deps())
    expect(checkLeftovers()).toEqual([{ label: 'Google Chrome', profile: 'session' }])

    alive.delete(LIVE_PID)
    expect(checkLeftovers()).toEqual([])
    expect(existsSync(join(root(), 'session-running'))).toBe(false)
    expect(checkLeftovers()).toEqual([])
  })

  it('rechecks only the folders it kept at startup, never a browser launched since', () => {
    profileFolder('session-old', 'chrome', `${HOST}-${LIVE_PID}`)
    const checkLeftovers = sweepLaunchedBrowsersAtStartup(userData, userData, deps())
    profileFolder('session-new', 'brave', `${HOST}-${LIVE_PID}`)
    expect(checkLeftovers()).toEqual([{ label: 'Google Chrome', profile: 'session' }])
  })

  it('drops a kept folder that has gone, and logs one it cannot read', () => {
    profileFolder('session-gone', 'chrome', `${HOST}-${LIVE_PID}`)
    profileFolder('session-file', 'chrome', `${HOST}-${LIVE_PID}`)
    const checkLeftovers = sweepLaunchedBrowsersAtStartup(userData, userData, deps())
    rmSync(join(root(), 'session-gone'), { recursive: true })
    rmSync(join(root(), 'session-file'), { recursive: true })
    writeFileSync(join(root(), 'session-file'), 'not a folder')
    log.warn.mockClear()

    expect(checkLeftovers()).toEqual([])
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith(
      'launchedBrowser',
      'launchedBrowser.profile_sweep_failed',
      undefined,
      expect.objectContaining({ code: 'ENOTDIR' })
    )
  })

  it('names a product folder it does not know by its folder name', () => {
    profileFolder('session-running', 'opera', `${HOST}-${LIVE_PID}`)
    const checkLeftovers = sweepLaunchedBrowsersAtStartup(userData, userData, deps())
    expect(checkLeftovers()).toEqual([{ label: 'opera', profile: 'session' }])
  })
})
