// Runs a command while holding a lock in the repository's shared git directory, so full test
// runs from different worktrees take turns. Two at once compete for the CPUs, and tests near
// the 15 second timeout fail in files neither branch touched (docs/agents/testing.md).
//
//   node scripts/test-suite-lock.mjs <command> [args...]
//
// The lock is a directory holding owner.json. A process builds it under a temporary name and
// renames it into place, and a rename onto a directory that has files in it fails, so exactly
// one process wins and the lock never exists without its owner. A lock whose processes are
// gone is stale; on Linux a pid also counts as gone once its start time no longer matches. A
// waiter clears a stale lock only while holding a second lock (<lock>.reap), after reading the
// owner again, so it never removes a lock that another waiter has taken since. A command started
// under a process that already holds the lock (HELD_ENV is set) runs without waiting.
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LOCK_NAME = 'birdbrain-test-suite.lock'
export const HELD_ENV = 'BIRDBRAIN_TEST_SUITE_LOCK_HELD'
// Where there is no /proc to read a start time from, age is the only sign that a live pid was
// reused: a coverage run takes minutes, so a lock this old is stale.
export const MAX_AGE_MS = 60 * 60_000
// A lock directory with files but no owner.json was made by hand (an empty one is simply
// replaced); give whoever made it time to finish.
export const OWNERLESS_GRACE_MS = 30_000
// Clearing a stale lock takes milliseconds, so a reap lock this old belongs to a dead waiter.
export const REAP_STALE_MS = 10_000
const OWNER_FILE = 'owner.json'

const log = (message) => process.stderr.write(`test-suite-lock: ${message}\n`)
const unique = () => `${process.pid}-${randomBytes(4).toString('hex')}`

// The common directory is shared by every worktree of one clone; null outside a repository.
export const lockPath = (cwd) => {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return join(resolve(cwd, common), LOCK_NAME)
  } catch {
    return null
  }
}

// EPERM means the process exists but belongs to another user.
export const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// Linux only: the start time, in clock ticks after boot (field 22 of /proc/<pid>/stat), tells
// a reused pid from the process that recorded it. The command name in field 2 may contain spaces,
// so fields are counted from its closing parenthesis.
export const startTime = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null
  } catch {
    return null
  }
}

// null when the lock has no owner record. A record that is there but cannot be read or parsed
// comes back as { unreadable: <cause> }, so a waiter does not take it for a lock nobody holds.
export const readOwner = (dir) => {
  let text
  try {
    text = readFileSync(join(dir, OWNER_FILE), 'utf8')
  } catch (error) {
    return error.code === 'ENOENT' ? null : { unreadable: error.code ?? error.message }
  }
  try {
    const owner = JSON.parse(text)
    return owner && typeof owner === 'object' ? owner : { unreadable: 'not a JSON object' }
  } catch (error) {
    return { unreadable: `not valid JSON: ${error.message}` }
  }
}

const sameOwner = (a, b) =>
  a?.pid === b?.pid && a?.startedAt === b?.startedAt && a?.unreadable === b?.unreadable

// Writing a temporary file and renaming it over owner.json keeps readers from seeing half of it.
const writeOwner = (dir, owner) => {
  const temp = join(dir, `${OWNER_FILE}.${unique()}`)
  writeFileSync(temp, JSON.stringify(owner))
  renameSync(temp, join(dir, OWNER_FILE))
}

const create = (dir, owner) => {
  const temp = `${dir}.new-${unique()}`
  mkdirSync(temp)
  writeOwner(temp, owner)
  try {
    renameSync(temp, dir)
    return true
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    // Linux reports ENOTEMPTY or EEXIST for an occupied target, Windows EPERM.
    if (['ENOTEMPTY', 'EEXIST', 'EPERM'].includes(error.code)) return false
    throw error
  }
}

export const isStale = (
  dir,
  owner,
  { now = Date.now(), alive = isAlive, startOf = startTime } = {}
) => {
  if (!owner || owner.unreadable) {
    // An unreadable record may belong to a live run whose processes cannot be checked, so it
    // waits out the same age as a lock with no start times.
    const limit = owner ? MAX_AGE_MS : OWNERLESS_GRACE_MS
    try {
      return now - statSync(dir).mtimeMs > limit
    } catch {
      return false
    }
  }
  // The child is recorded too: a wrapper killed on its own leaves the test run going.
  const processes = [
    [owner.pid, owner.pidStart],
    [owner.childPid, owner.childStart]
  ].filter(([pid]) => Number.isInteger(pid))
  const running = processes.some(
    ([pid, start]) => alive(pid) && (start == null || startOf(pid) === start)
  )
  if (!running) return true
  if (processes.some(([, start]) => start != null)) return false
  return !(now - Date.parse(owner.startedAt) <= MAX_AGE_MS)
}

// Removes the lock if it still belongs to `seen`. Returns whether it did.
export const clearStale = (dir, seen, { now = Date.now() } = {}) => {
  const reap = `${dir}.reap`
  try {
    mkdirSync(reap)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    try {
      if (now - statSync(reap).mtimeMs > REAP_STALE_MS) rmdirSync(reap)
    } catch {
      // Another waiter cleared it first.
    }
    return false
  }
  try {
    if (!sameOwner(readOwner(dir), seen)) return false
    // A new lock can be renamed over an empty directory, so an empty ownerless one goes with
    // rmdir, which fails if that has happened since the check above. A directory with files in
    // it cannot be renamed over, so the rest are moved aside, which also means nobody sees one
    // half-deleted.
    if (!seen) {
      try {
        rmdirSync(dir)
        return true
      } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) return false
        if (readOwner(dir)) return false
      }
    }
    const aside = `${dir}.stale-${unique()}`
    renameSync(dir, aside)
    rmSync(aside, { recursive: true, force: true })
    return true
  } catch {
    return false
  } finally {
    rmSync(reap, { recursive: true, force: true })
  }
}

const describeStale = (owner) => {
  if (!owner) return 'removed a lock directory that had no owner record'
  if (owner.unreadable) {
    return `removed a lock over an hour old whose owner record could not be read (${owner.unreadable})`
  }
  return `removed a stale lock left by process ${owner.pid} (started ${owner.startedAt})`
}

// Returns { owner } once this process holds the lock, with the record it wrote, or
// { holder } naming the current holder (null when the lock has no owner record, and
// { unreadable } when it has one that cannot be read).
export const tryAcquire = (
  dir,
  base,
  { now = Date.now(), alive = isAlive, startOf = startTime } = {}
) => {
  const owner = { ...base, startedAt: new Date(now).toISOString() }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (create(dir, owner)) return { owner }
    const current = readOwner(dir)
    if (!existsSync(dir)) continue
    if (!isStale(dir, current, { now, alive, startOf })) return { holder: current }
    if (clearStale(dir, current, { now })) log(describeStale(current))
  }
  return { holder: readOwner(dir) }
}

export const recordChild = (dir, owner, childPid) => {
  if (!sameOwner(readOwner(dir), owner)) return
  writeOwner(dir, { ...owner, childPid, childStart: startTime(childPid) })
}

export const release = (dir, owner) => {
  if (!sameOwner(readOwner(dir), owner)) return
  const aside = `${dir}.done-${unique()}`
  try {
    renameSync(dir, aside)
  } catch {
    return
  }
  rmSync(aside, { recursive: true, force: true })
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const describeHolder = (holder) => {
  if (!holder) return 'whoever made the lock directory'
  if (holder.unreadable) return `a run whose owner record cannot be read (${holder.unreadable})`
  return `the run in ${holder.cwd} (process ${holder.pid}, started ${holder.startedAt})`
}

// Resolves with the owner record once this process holds the lock.
export const acquire = async (dir, base, { pollMs = 5_000, reportMs = 60_000 } = {}) => {
  let waitingSince = null
  let lastReport = 0
  for (;;) {
    const { owner, holder } = tryAcquire(dir, base)
    if (owner) {
      if (waitingSince !== null) log('lock acquired; starting')
      return owner
    }
    const now = Date.now()
    if (waitingSince === null) {
      waitingSince = now
      lastReport = now
      log(`another full test run is using this clone; waiting for ${describeHolder(holder)}`)
      log(`if that process is not a test run, delete ${dir}`)
    } else if (now - lastReport >= reportMs) {
      lastReport = now
      log(`still waiting after ${Math.round((now - waitingSince) / 60_000)} min`)
    }
    await sleep(pollMs)
  }
}

const main = async () => {
  const [command, ...args] = process.argv.slice(2)
  if (!command) throw new Error('usage: test-suite-lock <command> [args...]')
  const cwd = process.cwd()
  const dir = process.env[HELD_ENV] ? null : lockPath(cwd)
  const self = { pid: process.pid, pidStart: startTime(process.pid), cwd }
  const owner = dir ? await acquire(dir, self) : null
  const unlock = () => owner && release(dir, owner)
  process.on('exit', unlock)

  // pnpm's Windows shims are .cmd files, which Node only spawns through a shell. An absolute
  // path such as process.execPath may contain spaces, which a shell would split.
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && !isAbsolute(command),
    env: { ...process.env, [HELD_ENV]: String(process.pid) }
  })
  if (owner && child.pid) recordChild(dir, owner, child.pid)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => child.kill(signal))
  }
  child.on('error', (error) => {
    log(error.message)
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    unlock()
    process.exitCode = code ?? 1
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    log(error.message)
    process.exitCode = 1
  })
}
