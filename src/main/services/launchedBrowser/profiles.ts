import { mkdirSync, readdirSync, readlinkSync, rmSync } from 'fs'
import { hostname as osHostname } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { randomUUID as cryptoRandomUUID } from 'crypto'
import type { BrowserFamily } from '@shared/types'
import * as personaRepo from '@main/services/db/personaRepo'

// Launched browser profiles (spec, "Browser profiles per Persona"), one folder per Persona or
// Capture Session holding one profile per browser family:
//
//   <sessionData>/launched-browsers/persona-<personaId>/<family>/
//   <sessionData>/launched-browsers/session-<uuid>/<family>/   (throwaway, removed at session end)
//
// The root sits beside Chromium's `Partitions` folder, so the startup sweep can apply the guard
// the partition sweep uses (personaSessions.ts, findOrphans).

const ROOT_FOLDER = 'launched-browsers'
const SESSION_PREFIX = 'session-'
const PERSONA_PREFIX = 'persona-'

export function launchedBrowsersRoot(sessionDataPath: string): string {
  return join(sessionDataPath, ROOT_FOLDER)
}

export function personaProfileDir(
  sessionDataPath: string,
  personaId: string,
  family: BrowserFamily
): string {
  return join(launchedBrowsersRoot(sessionDataPath), `${PERSONA_PREFIX}${personaId}`, family)
}

export interface SessionProfile {
  sessionDir: string
  profileDir: string
}

export function createSessionProfile(
  sessionDataPath: string,
  family: BrowserFamily,
  { randomUUID = cryptoRandomUUID }: { randomUUID?: () => string } = {}
): SessionProfile {
  const sessionDir = join(launchedBrowsersRoot(sessionDataPath), `${SESSION_PREFIX}${randomUUID()}`)
  const profileDir = join(sessionDir, family)
  mkdirSync(profileDir, { recursive: true })
  return { sessionDir, profileDir }
}

// Removes the throwaway profile with everything the browser wrote to it. Refuses any folder that
// is not a session folder directly under the root.
export function removeSessionProfile(
  sessionDataPath: string,
  { sessionDir }: SessionProfile
): void {
  const root = resolve(launchedBrowsersRoot(sessionDataPath))
  const dir = resolve(sessionDir)
  if (dirname(dir) !== root || !basename(dir).startsWith(SESSION_PREFIX)) {
    throw new Error(`${sessionDir} is not a throwaway browser profile`)
  }
  rmSync(dir, { recursive: true, force: true })
}

export interface ProfileLockDeps {
  hostname?: () => string
  isAlive?: (pid: number) => boolean
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists and belongs to someone else.
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

// On Linux, Chromium holds a profile with a `SingletonLock` link to `<host>-<pid>` while it runs
// and leaves the link behind when it is killed. A lock that cannot be checked counts as in use.
export function profileInUse(profileDir: string, deps: ProfileLockDeps = {}): boolean {
  const { hostname = osHostname, isAlive = processAlive } = deps
  let target: string
  try {
    target = readlinkSync(join(profileDir, 'SingletonLock'))
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ENOENT'
  }
  const split = target.lastIndexOf('-')
  const host = target.slice(0, split)
  const pid = Number(target.slice(split + 1))
  if (split === -1 || host !== hostname() || !Number.isSafeInteger(pid) || pid <= 0) return true
  return isAlive(pid)
}

function folderInUse(folder: string, deps: ProfileLockDeps): boolean {
  return readdirSync(folder, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && profileInUse(join(folder, entry.name), deps)
  )
}

export interface ProfileSweepDeps extends ProfileLockDeps {
  personaExists?: (personaId: string) => boolean
  remove?: (path: string) => void
}

export interface ProfileSweepResult {
  removed: string[]
  // Folders kept because a browser still holds them; a startup after it closes removes them.
  inUse: string[]
  failed: Array<{ name: string; error: unknown }>
  // False when the database is not beside the session folders, where a Persona's absence from
  // it proves nothing.
  personaFoldersSwept: boolean
}

// At startup, before any launch: every session folder is left from an earlier run, and a
// Persona folder whose Persona has no row, live or deleted, is an orphan.
export function sweepLaunchedBrowserProfiles(
  userDataPath: string,
  sessionDataPath: string,
  deps: ProfileSweepDeps = {}
): ProfileSweepResult {
  const {
    personaExists = (id: string) => personaRepo.getPersonaLabel(id) !== undefined,
    remove = (path: string) => rmSync(path, { recursive: true, force: true })
  } = deps
  const personaFoldersSwept = resolve(sessionDataPath) === resolve(userDataPath)
  const result: ProfileSweepResult = { removed: [], inUse: [], failed: [], personaFoldersSwept }
  const root = launchedBrowsersRoot(sessionDataPath)
  let names: string[]
  try {
    names = readdirSync(root).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      result.failed.push({ name: ROOT_FOLDER, error })
    }
    return result
  }
  const leftover = (name: string): boolean =>
    name.startsWith(SESSION_PREFIX) ||
    (personaFoldersSwept &&
      name.startsWith(PERSONA_PREFIX) &&
      !personaExists(name.slice(PERSONA_PREFIX.length)))
  for (const name of names.filter(leftover)) {
    const folder = join(root, name)
    try {
      if (folderInUse(folder, deps)) {
        result.inUse.push(name)
        continue
      }
      remove(folder)
      result.removed.push(name)
    } catch (error) {
      result.failed.push({ name, error })
    }
  }
  return result
}
