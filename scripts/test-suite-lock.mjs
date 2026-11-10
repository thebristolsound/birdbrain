// Runs a command while holding a lock in the repository's shared git directory, so full test
// runs from different worktrees take turns. Two at once compete for the CPUs, and tests near
// the 15 second timeout fail in files neither branch touched (docs/agents/testing.md).
//
//   node scripts/test-suite-lock.mjs <command> [args...]
//
// The lock is built with its owner record under a temporary name and renamed into place.
// Cleanup holds <lock>.reap until it finishes. That guard never expires: elapsed time cannot
// prove a paused reaper stopped. A reaper killed during cleanup leaves a guard for manual
// inspection. Unknown ownership also waits; only established process exit or PID reuse lets
// a waiter clear a recorded owner. This tracks the wrapper and direct child, not descendants.
//
// A command started under the process that holds the lock (HELD_ENV names the holder's pid)
// runs without waiting. Outside a repository there is nowhere to put the lock: the command runs
// without it, and the script says so.
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LOCK_NAME = 'birdbrain-test-suite.lock'
export const HELD_ENV = 'BIRDBRAIN_TEST_SUITE_LOCK_HELD'
// Milliseconds between attempts while waiting, for the tests; the default is five seconds.
export const POLL_ENV = 'BIRDBRAIN_TEST_SUITE_LOCK_POLL_MS'
const OWNER_FILE = 'owner.json'

const log = (message) => process.stderr.write(`test-suite-lock: ${message}\n`)
const unique = () => `${process.pid}-${randomBytes(4).toString('hex')}`

// The common directory is shared by every worktree of one clone; null outside a repository.
export const lockPath = (cwd) => {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C' }
    }).trim()
    if (!common) throw new Error('git returned no common directory')
    return join(resolve(cwd, common), LOCK_NAME)
  } catch (error) {
    if (
      error.status === 128 &&
      /^fatal: not a git repository \(or any of the parent directories\): \.git\s*$/.test(
        String(error.stderr)
      )
    )
      return null
    throw error
  }
}

// Linux only: the fields of /proc/<pid>/stat from the third on. The command name in field 2
// may contain spaces, so fields are counted from its closing parenthesis.
const statFields = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  } catch {
    return null
  }
}

// EPERM means the process exists but belongs to another user. A zombie (state Z, field 3) has
// exited and runs nothing; it keeps its pid and start time until its parent collects it.
export const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error.code === 'ESRCH') return false
  }
  return statFields(pid)?.[0] !== 'Z'
}

// The start time, in clock ticks after boot (field 22), tells a reused pid from the process
// that recorded it.
export const startTime = (pid) => statFields(pid)?.[19] ?? null

// Linux only: a pid means something only inside its own pid namespace, so the owner record
// names the one it was written in. A container or sandbox has another. null without /proc.
export const pidNamespace = () => {
  try {
    return readlinkSync('/proc/self/ns/pid')
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
  let built = false
  try {
    mkdirSync(temp)
    writeOwner(temp, owner)
    built = true
    renameSync(temp, dir)
    return true
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    // Linux reports ENOTEMPTY or EEXIST for an occupied target, Windows EPERM. The same codes
    // from building the temporary directory are failures.
    if (built && ['ENOTEMPTY', 'EEXIST', 'EPERM'].includes(error.code)) return false
    throw error
  }
}

export const isStale = (
  _dir,
  owner,
  { alive = isAlive, startOf = startTime, namespace = pidNamespace() } = {}
) => {
  if (!owner || owner.unreadable) return false
  // Missing or foreign namespace identity cannot establish that the recorded pids exited.
  if (process.platform === 'linux' && namespace == null) return false
  if ((owner.pidNs ?? null) !== namespace) return false
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) return false
  if (owner.childPid != null && (!Number.isInteger(owner.childPid) || owner.childPid <= 0)) {
    return false
  }
  const processes = [
    [owner.pid, owner.pidStart],
    [owner.childPid, owner.childStart]
  ].filter(([pid]) => pid != null)
  return processes.every(([pid, start]) => {
    if (!alive(pid)) return true
    if (start == null) return false
    const current = startOf(pid)
    return current != null && current !== start
  })
}

// The caller holds the cleanup guard. The identity check also preserves a lock that changed
// outside that protocol, provided no process acquires the path before it can be restored.
export const discard = (dir, seen) => {
  const aside = `${dir}.stale-${unique()}`
  renameSync(dir, aside)
  if (sameOwner(readOwner(aside), seen)) {
    rmSync(aside, { recursive: true, force: true })
    return true
  }
  try {
    renameSync(aside, dir)
  } catch (error) {
    log(
      `moved a live lock aside and could not put it back; two runs may overlap (${error.message})`
    )
    rmSync(aside, { recursive: true, force: true })
  }
  return false
}

// Removes the lock if it still belongs to `seen`. Returns whether it did.
export const clearStale = (dir, seen) => {
  const reap = `${dir}.reap`
  try {
    mkdirSync(reap)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    // A stalled reaper may resume at any instruction, including immediately before rename.
    // Do not remove its guard, even if it has no readable owner or is old.
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
    return discard(dir, seen)
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  } finally {
    rmSync(reap, { recursive: true, force: true })
  }
}

const describeStale = (owner) => {
  if (!owner) return 'removed a lock directory that had no owner record'
  return `removed a stale lock left by process ${owner.pid} (started ${owner.startedAt})`
}

// Returns { owner } once this process holds the lock, with the record it wrote, or
// { holder } naming the current holder (null when the lock has no owner record, and
// { unreadable } when it has one that cannot be read).
export const tryAcquire = (
  dir,
  base,
  { now = Date.now(), alive = isAlive, startOf = startTime, namespace = pidNamespace() } = {}
) => {
  const owner = { ...base, startedAt: new Date(now).toISOString() }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (create(dir, owner)) return { owner }
    const current = readOwner(dir)
    if (!existsSync(dir)) continue
    if (!isStale(dir, current, { now, alive, startOf, namespace })) return { holder: current }
    if (clearStale(dir, current)) log(describeStale(current))
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
      log(
        `inspect ${dir} and ${dir}.reap; remove them only after confirming no holder or reaper can resume`
      )
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
  const dir = lockPath(cwd)
  if (!dir) log(`no git directory found from ${cwd}; running the command without the lock`)
  // HELD_ENV skips the lock only for a command the current holder started. A value left in the
  // environment by an earlier run, or set by hand, waits like any other run.
  const heldBy = process.env[HELD_ENV]
  const nested = Boolean(dir && heldBy && String(readOwner(dir)?.pid) === heldBy)
  const self = {
    pid: process.pid,
    pidStart: startTime(process.pid),
    pidNs: pidNamespace(),
    cwd
  }
  const pollMs = Number(process.env[POLL_ENV]) || undefined
  const owner = dir && !nested ? await acquire(dir, self, { pollMs }) : null
  const unlock = () => owner && release(dir, owner)
  process.on('exit', unlock)

  // pnpm's Windows shims are .cmd files, which Node only spawns through a shell. An absolute
  // path such as process.execPath may contain spaces, which a shell would split.
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && !isAbsolute(command),
    // A nested run passes the holder's pid on unchanged, so a run nested in it still matches.
    env: owner ? { ...process.env, [HELD_ENV]: String(process.pid) } : process.env
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => child.kill(signal))
  }
  if (owner && child.pid) {
    // The lock is held either way; without the child it reads as stale if this wrapper is
    // killed on its own.
    try {
      recordChild(dir, owner, child.pid)
    } catch (error) {
      log(`could not record the command's process in the lock: ${error.message}`)
    }
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
