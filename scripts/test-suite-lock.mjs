// Runs a command while holding a lock in the repository's shared git directory, so full test
// runs from different worktrees take turns. Two at once compete for the CPUs, and tests near
// the 15 second timeout fail in files neither branch touched (docs/agents/testing.md).
//
//   node scripts/test-suite-lock.mjs <command> [args...]
//
// The lock is a directory, because mkdir is atomic on every platform. Its owner.json names the
// process holding it; a lock whose process is gone is taken over. A command started by a
// process that already holds the lock (HELD_ENV is set) runs without waiting.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LOCK_NAME = 'birdbrain-test-suite.lock'
export const HELD_ENV = 'BIRDBRAIN_TEST_SUITE_LOCK_HELD'
const OWNER_FILE = 'owner.json'
// mkdir and writing owner.json are two steps, so a lock briefly has no owner. One that stays
// ownerless this long belongs to a process that died between them.
export const OWNERLESS_GRACE_MS = 30_000

const log = (message) => process.stderr.write(`test-suite-lock: ${message}\n`)

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

export const readOwner = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, OWNER_FILE), 'utf8'))
  } catch {
    return null
  }
}

const sameOwner = (a, b) => a?.pid === b?.pid && a?.startedAt === b?.startedAt

const isStale = (dir, owner, { now, alive }) => {
  if (owner) return !(Number.isInteger(owner.pid) && alive(owner.pid))
  try {
    return now - statSync(dir).mtimeMs > OWNERLESS_GRACE_MS
  } catch {
    return false
  }
}

// Moving the stale lock aside first means two waiters that both judged it stale cannot both
// delete it: the second rename fails, or moves a lock someone has since taken, which it
// moves back.
const clearStale = (dir, seen) => {
  const aside = `${dir}.stale-${process.pid}`
  try {
    renameSync(dir, aside)
  } catch {
    return
  }
  if (sameOwner(readOwner(aside), seen)) {
    rmSync(aside, { recursive: true, force: true })
    return
  }
  try {
    renameSync(aside, dir)
  } catch {
    rmSync(aside, { recursive: true, force: true })
  }
}

// Returns null once this process holds the lock, or the current owner (null fields while the
// owner is still writing owner.json) when another live process holds it.
export const tryAcquire = (dir, owner, { now = Date.now(), alive = isAlive } = {}) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, OWNER_FILE), JSON.stringify(owner))
      return null
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    const current = readOwner(dir)
    if (!isStale(dir, current, { now, alive })) return current ?? { pid: null }
    log(
      current
        ? `removing a lock left by process ${current.pid}, which is no longer running`
        : 'removing a lock that never recorded its owner'
    )
    clearStale(dir, current)
  }
  return readOwner(dir) ?? { pid: null }
}

export const release = (dir, owner) => {
  if (sameOwner(readOwner(dir), owner)) rmSync(dir, { recursive: true, force: true })
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const describeOwner = (owner) =>
  owner.pid === null
    ? 'a run that is starting'
    : `the run in ${owner.cwd} (process ${owner.pid}, started ${owner.startedAt})`

export const acquire = async (dir, owner, { pollMs = 5_000, reportMs = 60_000 } = {}) => {
  let waitingSince = null
  let lastReport = 0
  for (;;) {
    const holder = tryAcquire(dir, owner)
    if (!holder) {
      if (waitingSince !== null) log('lock acquired; starting')
      return
    }
    const now = Date.now()
    if (waitingSince === null) {
      waitingSince = now
      lastReport = now
      log(`another full test run is using this machine; waiting for ${describeOwner(holder)}`)
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
  const owner = { pid: process.pid, cwd, startedAt: new Date().toISOString() }
  if (dir) await acquire(dir, owner)
  const unlock = () => dir && release(dir, owner)
  process.on('exit', unlock)

  // pnpm's Windows shims are .cmd files, which Node only spawns through a shell.
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, [HELD_ENV]: String(process.pid) }
  })
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
