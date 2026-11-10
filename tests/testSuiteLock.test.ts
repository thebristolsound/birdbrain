import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { pathToFileURL } from 'url'
import {
  HELD_ENV,
  LOCK_NAME,
  MAX_AGE_MS,
  OWNERLESS_GRACE_MS,
  REAP_STALE_MS,
  acquire,
  clearStale,
  lockPath,
  readOwner,
  recordChild,
  release,
  startTime,
  tryAcquire
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/test-suite-lock.mjs'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'test-suite-lock.mjs')
const NODE_ENV = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
const alive = () => true
const noProc = () => null
const ON_LINUX = process.platform === 'linux'
const base = (pid: number) => ({ pid, cwd: '/w' })

// The pid of a process that has exited, so the real liveness check reports it gone.
const exitedPid = () => {
  const { pid } = spawnSync(process.execPath, ['-e', ''], { env: NODE_ENV })
  return pid as number
}

const plant = (dir: string, owner: object) => {
  mkdirSync(dir)
  writeFileSync(join(dir, 'owner.json'), JSON.stringify(owner))
}

const age = (path: string, ms: number) => {
  const then = new Date(Date.now() - ms)
  utimesSync(path, then, then)
}

const captureStderr = (action: () => void) => {
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  try {
    action()
    return spy.mock.calls.map(([chunk]) => String(chunk)).join('')
  } finally {
    spy.mockRestore()
  }
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'ignore'
  })

let root: string
let dir: string

beforeEach(() => {
  // git prints canonical paths, so a symlinked temporary directory (macOS /var) must not differ.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'suite-lock-')))
  dir = join(root, LOCK_NAME)
  // git answers from an exported GIT_DIR, or from a repository the temporary directory sits in,
  // before it looks at these scratch directories.
  vi.stubEnv('GIT_DIR', undefined)
  vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(root))
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('tryAcquire', () => {
  it('takes a free lock and records its owner with the time it was taken', () => {
    const { owner, holder } = tryAcquire(dir, base(1), { alive, now: 1_000 })
    expect(holder).toBeUndefined()
    expect(owner).toEqual({ ...base(1), startedAt: new Date(1_000).toISOString() })
    expect(readOwner(dir)).toEqual(owner)
  })

  it('reports the holder of a lock held by a live process and leaves it alone', () => {
    const { owner } = tryAcquire(dir, base(1), { alive })
    expect(tryAcquire(dir, base(2), { alive })).toEqual({ holder: owner })
    expect(readOwner(dir)).toEqual(owner)
  })

  it('takes over a lock whose process has exited, judged by the real process table', () => {
    plant(dir, { ...base(exitedPid()), startedAt: new Date().toISOString() })
    const { owner } = tryAcquire(dir, base(process.pid))
    expect(owner?.pid).toBe(process.pid)
    expect(readOwner(dir)).toEqual(owner)
  })

  it('keeps a lock whose wrapper died while its test run is still going', () => {
    plant(dir, { ...base(exitedPid()), childPid: process.pid, startedAt: new Date().toISOString() })
    expect(tryAcquire(dir, base(2)).holder?.childPid).toBe(process.pid)
  })

  it.runIf(ON_LINUX)('takes over a lock whose pid now belongs to a different process', () => {
    plant(dir, { ...base(process.pid), pidStart: 'not-this-process', startedAt: 'now' })
    expect(tryAcquire(dir, base(2)).owner?.pid).toBe(2)
  })

  it('keeps a lock older than an hour while its recorded process is still the same one', () => {
    const now = Date.now()
    const old = new Date(now - MAX_AGE_MS - 1_000).toISOString()
    const held = { ...base(1), pidStart: '100', startedAt: old }
    plant(dir, held)
    expect(tryAcquire(dir, base(2), { alive, now, startOf: () => '100' })).toEqual({ holder: held })
  })

  it('without start times, takes over a lock older than an hour even if its pid is in use', () => {
    const now = Date.now()
    plant(dir, { ...base(1), startedAt: new Date(now - MAX_AGE_MS - 1_000).toISOString() })
    expect(tryAcquire(dir, base(2), { alive, now, startOf: noProc }).owner?.pid).toBe(2)
  })

  it('treats an owner record without a usable pid as stale', () => {
    plant(dir, { pid: 'x' })
    expect(tryAcquire(dir, base(2), { alive }).owner?.pid).toBe(2)
  })

  it('replaces an empty lock directory at once', () => {
    mkdirSync(dir)
    expect(tryAcquire(dir, base(2), { alive }).owner?.pid).toBe(2)
  })

  it('waits on a lock directory with no owner record until the grace period has passed', () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'note'), '')
    expect(tryAcquire(dir, base(2), { alive })).toEqual({ holder: null })
    age(dir, OWNERLESS_GRACE_MS + 1_000)
    expect(tryAcquire(dir, base(2), { alive }).owner?.pid).toBe(2)
  })

  it('keeps a lock whose owner record cannot be parsed, and names the cause', () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'owner.json'), '')
    age(dir, OWNERLESS_GRACE_MS + 1_000)
    const { owner, holder } = tryAcquire(dir, base(2), { alive })
    expect(owner).toBeUndefined()
    expect(holder).toEqual({ unreadable: 'not valid JSON: Unexpected end of JSON input' })
    expect(existsSync(join(dir, 'owner.json'))).toBe(true)
  })

  it('takes over a lock with an unparsable owner record only once it is over an hour old', () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'owner.json'), '{')
    age(dir, MAX_AGE_MS + 1_000)
    const stderr = captureStderr(() => {
      expect(tryAcquire(dir, base(2), { alive }).owner?.pid).toBe(2)
    })
    expect(stderr).toContain('owner record could not be read (not valid JSON')
    expect(stderr).not.toContain('no owner record')
  })
})

describe('readOwner', () => {
  it('gives null for a missing record and the cause for one that cannot be read', () => {
    mkdirSync(dir)
    expect(readOwner(dir)).toBeNull()
    mkdirSync(join(dir, 'owner.json'))
    expect(readOwner(dir)).toEqual({ unreadable: 'EISDIR' })
  })

  it('does not accept a record that is not a JSON object', () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'owner.json'), 'null')
    expect(readOwner(dir)).toEqual({ unreadable: 'not a JSON object' })
  })
})

describe('clearStale', () => {
  it('leaves a lock that another process took after the waiter read it', () => {
    const { owner: taken } = tryAcquire(dir, base(2), { alive })
    expect(clearStale(dir, { ...base(1), startedAt: 'earlier' })).toBe(false)
    expect(readOwner(dir)).toEqual(taken)
  })

  it('leaves an ownerless lock that a new owner has replaced', () => {
    const { owner: taken } = tryAcquire(dir, base(2), { alive })
    expect(clearStale(dir, null)).toBe(false)
    expect(readOwner(dir)).toEqual(taken)
  })

  it('does nothing while another waiter is clearing', () => {
    const stale = { ...base(1), startedAt: 'old' }
    plant(dir, stale)
    mkdirSync(`${dir}.reap`)
    expect(clearStale(dir, stale)).toBe(false)
    expect(readOwner(dir)).toEqual(stale)
  })

  it('clears a reap lock left by a waiter that died, then removes the stale lock', () => {
    const stale = { ...base(1), startedAt: 'old' }
    plant(dir, stale)
    mkdirSync(`${dir}.reap`)
    age(`${dir}.reap`, REAP_STALE_MS + 1_000)
    expect(clearStale(dir, stale)).toBe(false)
    expect(clearStale(dir, stale)).toBe(true)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(`${dir}.reap`)).toBe(false)
  })
})

describe('many waiters on one stale lock', () => {
  // Each worker imports the script and calls tryAcquire at the same instant, the way waiters
  // whose polls coincide do. The first version of the takeover let two win in about one
  // trial in eight, or crashed one with ENOENT.
  const worker = `
    const start = Number(process.env.START)
    import(process.env.SCRIPT_URL).then(({ tryAcquire }) => {
      while (Date.now() < start) {}
      try {
        const { owner } = tryAcquire(process.env.LOCK, { pid: process.pid, cwd: 'w' })
        process.stdout.write(owner ? 'won' : 'waited')
      } catch (error) {
        process.stdout.write('error ' + error.code)
      }
      // A winner that exited would leave a stale lock that a late worker rightly takes over.
      process.stdin.resume()
      process.stdin.on('end', () => process.exit(0))
    })`

  const trial = async (workers: number) => {
    const start = Date.now() + 400
    const children = Array.from({ length: workers }, () =>
      spawn(process.execPath, ['-e', worker], {
        env: {
          ...NODE_ENV,
          START: String(start),
          LOCK: dir,
          SCRIPT_URL: pathToFileURL(SCRIPT).href
        }
      })
    )
    const reported = children.map(
      (child) =>
        new Promise<string>((done) => {
          let out = ''
          child.stdout.on('data', (chunk) => {
            out += chunk
            done(out)
          })
          child.on('close', () => done(out))
        })
    )
    const outcomes = await Promise.all(reported)
    await Promise.all(
      children.map((child) => {
        const closed = new Promise((done) => child.on('close', done))
        child.stdin.end()
        return closed
      })
    )
    return outcomes
  }

  it('lets exactly one take it over, and none fails', async () => {
    for (let round = 0; round < 6; round += 1) {
      rmSync(dir, { recursive: true, force: true })
      plant(dir, { ...base(exitedPid()), startedAt: new Date().toISOString() })
      const outcomes = await trial(4)
      expect(outcomes.filter((outcome) => outcome === 'won')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome === 'waited')).toHaveLength(3)
    }
  }, 60_000)
})

describe('startTime', () => {
  it.runIf(ON_LINUX)('reads a running process and gives null for one that has exited', () => {
    expect(startTime(process.pid)).toMatch(/^\d+$/)
    expect(startTime(exitedPid())).toBeNull()
  })
})

describe('release and recordChild', () => {
  it('removes only a lock this owner holds', () => {
    const { owner } = tryAcquire(dir, base(1), { alive })
    release(dir, { ...owner, startedAt: 'other' })
    expect(readOwner(dir)).toEqual(owner)
    release(dir, owner)
    expect(existsSync(dir)).toBe(false)
  })

  it('adds the child pid to the owner record without changing who owns it', () => {
    const { owner } = tryAcquire(dir, base(1), { alive })
    recordChild(dir, owner, process.pid)
    expect(readOwner(dir)).toEqual({
      ...owner,
      childPid: process.pid,
      childStart: startTime(process.pid)
    })
    release(dir, owner)
    expect(existsSync(dir)).toBe(false)
  })
})

describe('acquire', () => {
  it('waits until the holder releases the lock', async () => {
    const { owner: first } = tryAcquire(dir, base(process.pid))
    let acquired = false
    const waiting = acquire(dir, base(process.pid), { pollMs: 20 }).then((owner: object) => {
      acquired = true
      return owner
    })
    await new Promise((done) => setTimeout(done, 100))
    expect(acquired).toBe(false)
    release(dir, first)
    const owner = await waiting
    expect(readOwner(dir)).toEqual(owner)
  })
})

describe('lockPath', () => {
  it('gives a linked worktree the lock in the main clone, not its own git directory', () => {
    const repo = join(root, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'x')
    git(repo, 'worktree', 'add', '-q', join(root, 'linked'))
    expect(lockPath(join(root, 'linked'))).toBe(join(repo, '.git', LOCK_NAME))
  })

  it('returns null outside a repository', () => {
    expect(lockPath(root)).toBeNull()
  })
})

describe('the command line', () => {
  const run = (cwd: string, env: NodeJS.ProcessEnv, code: string) =>
    new Promise<{ status: number | null; stderr: string }>((done) => {
      const child = spawn(process.execPath, [SCRIPT, process.execPath, '-e', code], {
        cwd,
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' }
      })
      let stderr = ''
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('close', (status) => done({ status, stderr }))
    })

  const unheld = () => {
    const env = { ...process.env }
    delete env[HELD_ENV]
    return env
  }

  // Exits 7 when the lock is held by the wrapper that started this command, with it recorded.
  const probe = (lock: string) =>
    `const o = JSON.parse(require('fs').readFileSync(${JSON.stringify(join(lock, 'owner.json'))}, 'utf8'));` +
    `const ok = o.pid === Number(process.env.${HELD_ENV}) && o.childPid === process.pid;` +
    `process.exit(ok ? 7 : 1)`

  it('holds the lock with the child recorded while the command runs, then releases', async () => {
    git(root, 'init', '-q')
    const lock = join(root, '.git', LOCK_NAME)
    // recordChild runs just after spawn, so the probe may read the record before it lands.
    const waitForChild = `setTimeout(() => { ${probe(lock)} }, 200)`
    const { status } = await run(root, unheld(), waitForChild)
    expect(status).toBe(7)
    expect(existsSync(lock)).toBe(false)
  })

  it('runs without waiting when a parent already holds the lock', async () => {
    git(root, 'init', '-q')
    const lock = join(root, '.git', LOCK_NAME)
    const held = { ...base(process.pid), startedAt: new Date().toISOString() }
    plant(lock, held)
    const { status, stderr } = await run(
      root,
      { ...unheld(), [HELD_ENV]: String(process.pid) },
      'process.exit(0)'
    )
    expect(status).toBe(0)
    expect(stderr).toBe('')
    expect(readOwner(lock)).toEqual(held)
  })

  it('takes the lock when the held variable names a process that does not hold it', async () => {
    git(root, 'init', '-q')
    const lock = join(root, '.git', LOCK_NAME)
    const { status } = await run(
      root,
      { ...unheld(), [HELD_ENV]: '1' },
      `setTimeout(() => { ${probe(lock)} }, 200)`
    )
    expect(status).toBe(7)
    expect(existsSync(lock)).toBe(false)
  })

  it('says so when it finds no git directory and runs the command without the lock', async () => {
    const { status, stderr } = await run(root, unheld(), 'process.exit(7)')
    expect(status).toBe(7)
    expect(stderr).toBe(
      `test-suite-lock: no git directory found from ${root}; running the command without the lock\n`
    )
  })
})
