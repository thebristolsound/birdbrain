import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
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
  POLL_ENV,
  acquire,
  clearStale,
  discard,
  isAlive,
  lockPath,
  pidNamespace,
  readOwner,
  recordChild,
  release,
  startTime,
  tryAcquire
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/test-suite-lock.mjs'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'test-suite-lock.mjs')
const NODE_ENV = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
// Historical cutoffs are deliberately exceeded to guard against age-based takeover.
const MAX_AGE_MS = 60 * 60_000
const OWNERLESS_GRACE_MS = 30_000
const REAP_STALE_MS = 10_000
const alive = () => true
const noProc = () => null
const ON_LINUX = process.platform === 'linux'
const ON_WINDOWS = process.platform === 'win32'
const base = (pid: number) => ({ pid, pidNs: pidNamespace(), cwd: '/w' })

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

const until = async (check: () => boolean, what: string, ms = 10_000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 20))
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
  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_NAMESPACE',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES'
  ])
    vi.stubEnv(name, undefined)
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
    plant(dir, {
      ...base(process.pid),
      pidStart: 'not-this-process',
      startedAt: new Date().toISOString()
    })
    expect(tryAcquire(dir, base(2)).owner?.pid).toBe(2)
  })

  it('keeps a lock older than an hour while its recorded process is still the same one', () => {
    const now = Date.now()
    const old = new Date(now - MAX_AGE_MS - 1_000).toISOString()
    const held = { ...base(1), pidStart: '100', startedAt: old }
    plant(dir, held)
    expect(tryAcquire(dir, base(2), { alive, now, startOf: () => '100' })).toEqual({ holder: held })
  })

  it('without start times, keeps an old lock while its pid may still be running', () => {
    const now = Date.now()
    const held = { ...base(1), startedAt: new Date(now - MAX_AGE_MS - 1_000).toISOString() }
    plant(dir, held)
    expect(tryAcquire(dir, base(2), { alive, now, startOf: noProc })).toEqual({ holder: held })
  })

  it('keeps a lock taken in another pid namespace although its pid is not running here', () => {
    const held = {
      ...base(exitedPid()),
      pidNs: 'pid:[1]',
      startedAt: new Date().toISOString()
    }
    plant(dir, held)
    expect(tryAcquire(dir, base(2), { namespace: 'pid:[2]' })).toEqual({ holder: held })
    expect(tryAcquire(dir, base(2), { namespace: 'pid:[1]' }).owner?.pid).toBe(2)
  })

  it('keeps an old lock from another pid namespace regardless of local liveness', () => {
    const now = Date.now()
    const old = new Date(now - MAX_AGE_MS - 1_000).toISOString()
    const held = { ...base(1), pidStart: '100', pidNs: 'pid:[1]', startedAt: old }
    plant(dir, held)
    const here = { alive: () => false, now, startOf: () => 'different' }
    expect(tryAcquire(dir, base(2), { ...here, namespace: 'pid:[2]' })).toEqual({ holder: held })
  })

  it('keeps an owner record without a usable pid because its identity is unknown', () => {
    plant(dir, { pid: 'x' })
    expect(tryAcquire(dir, base(2), { alive })).toEqual({ holder: { pid: 'x' } })
  })

  it.each(['wrapper', 'child'])(
    'keeps a live %s with an unreadable current start time',
    (which) => {
      const held = {
        ...base(1),
        pidStart: '100',
        childPid: 2,
        childStart: '200',
        startedAt: new Date().toISOString()
      }
      plant(dir, held)
      const livePid = which === 'wrapper' ? 1 : 2
      expect(
        tryAcquire(dir, base(3), {
          alive: (pid: number) => pid === livePid,
          startOf: noProc
        })
      ).toEqual({ holder: held })
      expect(readOwner(dir)).toEqual(held)
    }
  )

  it('recovers when both the wrapper and child IDs have known different start times', () => {
    plant(dir, {
      ...base(1),
      pidStart: '100',
      childPid: 2,
      childStart: '200',
      startedAt: new Date().toISOString()
    })
    expect(tryAcquire(dir, base(3), { alive, startOf: () => '300' }).owner?.pid).toBe(3)
  })

  it.runIf(ON_LINUX)('keeps a lock when the current or recorded namespace is unknown', () => {
    const held = { ...base(exitedPid()), startedAt: new Date().toISOString() }
    plant(dir, held)
    expect(tryAcquire(dir, base(2), { namespace: null })).toEqual({ holder: held })
    delete held.pidNs
    writeFileSync(join(dir, 'owner.json'), JSON.stringify(held))
    expect(tryAcquire(dir, base(2))).toEqual({ holder: held })
  })

  it('leaves nothing behind when the owner record cannot be written', () => {
    expect(() => tryAcquire(dir, { pid: 1n, cwd: '/w' }, { alive })).toThrow(/BigInt/)
    expect(readdirSync(root)).toEqual([])
  })

  it('replaces an empty lock directory at once', () => {
    mkdirSync(dir)
    expect(tryAcquire(dir, base(2), { alive }).owner?.pid).toBe(2)
  })

  it('keeps a nonempty ownerless directory even after the old grace period', () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'note'), '')
    expect(tryAcquire(dir, base(2), { alive })).toEqual({ holder: null })
    age(dir, OWNERLESS_GRACE_MS + 1_000)
    expect(tryAcquire(dir, base(2), { alive })).toEqual({ holder: null })
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

  it('keeps an old unparsable owner record because age does not prove exit', () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'owner.json'), '{')
    age(dir, MAX_AGE_MS + 1_000)
    const stderr = captureStderr(() => {
      expect(tryAcquire(dir, base(2), { alive }).holder?.unreadable).toContain('not valid JSON')
    })
    expect(stderr).toBe('')
    expect(readFileSync(join(dir, 'owner.json'), 'utf8')).toBe('{')
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

  it('keeps an old cleanup guard whose owner is unknown', () => {
    const stale = { ...base(exitedPid()), startedAt: new Date().toISOString() }
    plant(dir, stale)
    mkdirSync(`${dir}.reap`)
    age(`${dir}.reap`, REAP_STALE_MS + 1_000)
    expect(clearStale(dir, stale)).toBe(false)
    expect(clearStale(dir, stale)).toBe(false)
    expect(readOwner(dir)).toEqual(stale)
    expect(existsSync(`${dir}.reap`)).toBe(true)
  })

  it('keeps a paused reaper exclusive after its guard ages past the old cutoff', async () => {
    const stale = { ...base(exitedPid()), startedAt: new Date().toISOString() }
    plant(dir, stale)
    const paused = join(root, 'paused')
    const resume = join(root, 'resume')
    const worker = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import fs from 'node:fs'
      import { syncBuiltinESMExports } from 'node:module'
      const rename = fs.renameSync
      fs.renameSync = (from, to) => {
        if (from === process.env.LOCK && to.includes('.stale-')) {
          fs.writeFileSync(process.env.PAUSED, '')
          while (!fs.existsSync(process.env.RESUME)) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
          }
        }
        return rename(from, to)
      }
      syncBuiltinESMExports()
      const { clearStale, readOwner } = await import(process.env.SCRIPT_URL)
      process.exitCode = clearStale(process.env.LOCK, readOwner(process.env.LOCK)) ? 0 : 1
    `
      ],
      {
        env: {
          ...NODE_ENV,
          LOCK: dir,
          PAUSED: paused,
          RESUME: resume,
          SCRIPT_URL: pathToFileURL(SCRIPT).href
        }
      }
    )
    const closed = new Promise((done) => worker.on('close', done))
    try {
      await until(() => existsSync(paused), 'the reaper to pause before rename')
      age(`${dir}.reap`, REAP_STALE_MS + 1_000)
      expect(tryAcquire(dir, base(process.pid))).toEqual({ holder: stale })
      expect(tryAcquire(dir, base(process.pid))).toEqual({ holder: stale })
      expect(readOwner(dir)).toEqual(stale)
    } finally {
      writeFileSync(resume, '')
      await closed
    }
    expect(existsSync(dir)).toBe(false)
    expect(tryAcquire(dir, base(process.pid)).owner?.pid).toBe(process.pid)
  })
})

describe('discard', () => {
  it('puts back a lock that is not the one the waiter judged stale', () => {
    const { owner: taken } = tryAcquire(dir, base(2), { alive })
    expect(discard(dir, { ...base(1), startedAt: 'earlier' })).toBe(false)
    expect(readOwner(dir)).toEqual(taken)
    expect(readdirSync(root)).toEqual([LOCK_NAME])
  })

  it('puts back a lock that gained an owner after the waiter saw none', () => {
    const { owner: taken } = tryAcquire(dir, base(2), { alive })
    expect(discard(dir, null)).toBe(false)
    expect(readOwner(dir)).toEqual(taken)
  })

  it('removes the lock the waiter judged stale and leaves nothing behind', () => {
    const stale = { ...base(1), startedAt: 'old' }
    plant(dir, stale)
    expect(discard(dir, stale)).toBe(true)
    expect(readdirSync(root)).toEqual([])
  })
})

describe('many waiters on one stale lock', () => {
  // Release the workers only after every import has finished, so startup time cannot skip
  // contention under load.
  const worker = `
    import(process.env.SCRIPT_URL).then(({ tryAcquire }) => {
      process.stdout.write('ready\\n')
      process.stdin.once('data', () => {
      try {
        const { owner } = tryAcquire(process.env.LOCK, { pid: process.pid, cwd: 'w' })
        process.stdout.write(owner ? 'won' : 'waited')
      } catch (error) {
        process.stdout.write('error ' + error.code)
      }
      // A winner that exited would leave a stale lock that a late worker rightly takes over.
      process.stdin.resume()
      process.stdin.on('end', () => process.exit(0))
      })
    })`

  const trial = async (workers: number) => {
    const children = Array.from({ length: workers }, () =>
      spawn(process.execPath, ['-e', worker], {
        env: {
          ...NODE_ENV,
          LOCK: dir,
          SCRIPT_URL: pathToFileURL(SCRIPT).href
        }
      })
    )
    const outputs = children.map(() => '')
    children.forEach((child, index) => {
      child.stdout.on('data', (chunk) => (outputs[index] += chunk))
    })
    await until(() => outputs.every((out) => out === 'ready\n'), 'all race workers ready')
    const reported = children.map(
      (child) =>
        new Promise<string>((done) => child.stdout.once('data', (chunk) => done(String(chunk))))
    )
    children.forEach((child) => child.stdin.write('go'))
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

describe('isAlive', () => {
  it('tells a running process from one that has exited', () => {
    expect(isAlive(process.pid)).toBe(true)
    expect(isAlive(exitedPid())).toBe(false)
  })

  it('retains uncertain process liveness errors', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('unknown liveness'), { code: 'EACCES' })
    })
    try {
      expect(isAlive(process.pid)).toBe(true)
    } finally {
      kill.mockRestore()
    }
  })

  it.runIf(ON_LINUX)('reports a zombie as gone, and a lock it holds as stale', async () => {
    // exec makes sleep the parent of the exited background job, and sleep never collects it.
    const parent = spawn('sh', ['-c', 'sleep 0 & echo $!; exec sleep 60'])
    try {
      let out = ''
      parent.stdout.on('data', (chunk) => (out += chunk))
      await until(() => out.includes('\n'), 'the background pid')
      const pid = Number(out)
      await until(
        () => readFileSync(`/proc/${pid}/stat`, 'utf8').includes(') Z '),
        'the background job to become a zombie'
      )
      expect(isAlive(pid)).toBe(false)
      plant(dir, { ...base(pid), pidStart: startTime(pid), startedAt: new Date().toISOString() })
      expect(tryAcquire(dir, base(2)).owner?.pid).toBe(2)
    } finally {
      parent.kill('SIGKILL')
    }
  })
})

describe('pidNamespace', () => {
  it.runIf(ON_LINUX)('names the namespace this process runs in', () => {
    expect(pidNamespace()).toBe(readlinkSync('/proc/self/ns/pid'))
    expect(pidNamespace()).toMatch(/^pid:\[\d+\]$/)
  })
})

describe('startTime', () => {
  it.runIf(ON_LINUX)('reads a running process and gives null for one that has exited', () => {
    const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf8')
    const fields = /^\d+ \([\s\S]*\) ([\s\S]*)$/.exec(stat)?.[1].trim().split(/\s+/)
    expect(fields).toBeDefined()
    expect(startTime(process.pid)).toBe(fields?.[22 - 3])
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
  // Starts the wrapper around `node -e <code>`; nodeArgs go to the wrapper's own Node.
  const start = (cwd: string, env: NodeJS.ProcessEnv, code: string, nodeArgs: string[] = []) => {
    const child = spawn(process.execPath, [...nodeArgs, SCRIPT, process.execPath, '-e', code], {
      cwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' }
    })
    const wrapper = {
      child,
      stderr: '',
      closed: new Promise<number | null>((done) => child.on('close', done))
    }
    child.stderr.on('data', (chunk) => (wrapper.stderr += chunk))
    return wrapper
  }

  const run = async (cwd: string, env: NodeJS.ProcessEnv, code: string, nodeArgs?: string[]) => {
    const wrapper = start(cwd, env, code, nodeArgs)
    const status = await wrapper.closed
    return { status, stderr: wrapper.stderr }
  }

  const unheld = () => {
    const env = { ...process.env }
    delete env[HELD_ENV]
    return env
  }

  // Exits 7 when the lock is held by the wrapper that started this command, with it recorded.
  const probe = (lock: string) =>
    `const o = JSON.parse(require('fs').readFileSync(${JSON.stringify(join(lock, 'owner.json'))}, 'utf8'));` +
    `const ns = ${JSON.stringify(pidNamespace())};` +
    `const ok = o.pid === Number(process.env.${HELD_ENV}) && o.childPid === process.pid && o.pidNs === ns;` +
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

  it('takes the lock when an undefined held marker has no recorded owner', async () => {
    git(root, 'init', '-q')
    const lock = join(root, '.git', LOCK_NAME)
    const { status } = await run(
      root,
      { ...unheld(), [HELD_ENV]: 'undefined' },
      `setTimeout(() => { ${probe(lock)} }, 200)`
    )
    expect(status).toBe(7)
    expect(existsSync(lock)).toBe(false)
  })

  it.each([
    ['missing PID', '{}', 'undefined'],
    ['unreadable record', '{', 'undefined'],
    ['null PID', '{"pid":null}', 'null'],
    ['zero PID', '{"pid":0}', '0'],
    ['negative PID', '{"pid":-1}', '-1'],
    ['fractional PID', '{"pid":1.5}', '1.5'],
    ['string PID', JSON.stringify({ pid: String(process.pid) }), String(process.pid)],
    [
      'unreadable owner',
      JSON.stringify({ pid: process.pid, unreadable: 'EACCES' }),
      String(process.pid)
    ]
  ])('retains a lock with %s despite a matching held marker', async (_name, text, marker) => {
    git(root, 'init', '-q')
    const lock = join(root, '.git', LOCK_NAME)
    const ran = join(root, 'ran')
    mkdirSync(lock)
    writeFileSync(join(lock, 'owner.json'), text)
    const wrapper = start(
      root,
      { ...unheld(), [HELD_ENV]: marker, [POLL_ENV]: '20' },
      `require('fs').writeFileSync(${JSON.stringify(ran)}, '')`
    )
    try {
      await until(
        () => existsSync(ran) || wrapper.stderr.includes('waiting for'),
        'the waiter or its command'
      )
      expect(existsSync(ran)).toBe(false)
      expect(wrapper.stderr).toContain('waiting for')
      expect(readFileSync(join(lock, 'owner.json'), 'utf8')).toBe(text)
    } finally {
      wrapper.child.kill('SIGTERM')
      await wrapper.closed
    }
  })

  it.skipIf(ON_WINDOWS)('releases the lock and stops the command on SIGTERM', async () => {
    git(root, 'init', '-q')
    const lock = join(root, '.git', LOCK_NAME)
    const wrapper = start(root, unheld(), 'setInterval(() => {}, 1000)')
    await until(() => Number.isInteger(readOwner(lock)?.childPid), 'the command to be recorded')
    const { childPid } = readOwner(lock)
    wrapper.child.kill('SIGTERM')
    expect(await wrapper.closed).toBe(1)
    expect(existsSync(lock)).toBe(false)
    await until(() => !isAlive(childPid), 'the command to stop')
  })

  it('waits for a live lock despite a stale held marker and reports when it can start', async () => {
    git(root, 'init', '-q')
    const lock = join(root, '.git', LOCK_NAME)
    const [go, order] = [join(root, 'go'), join(root, 'order')].map((path) => JSON.stringify(path))
    const env = { ...unheld(), [POLL_ENV]: '20', [HELD_ENV]: 'stale-marker' }
    const first = start(
      root,
      env,
      `const fs = require('fs')
      const timer = setInterval(() => {
        if (!fs.existsSync(${go})) return
        fs.appendFileSync(${order}, 'first ended\\n')
        clearInterval(timer)
      }, 10)`
    )
    await until(() => readOwner(lock)?.pid === first.child.pid, 'the first run to take the lock')
    const second = start(root, env, `require('fs').appendFileSync(${order}, 'second started\\n')`)
    await until(
      () => second.stderr.includes('only after confirming no holder or reaper can resume'),
      'the wait message'
    )
    expect(second.stderr).toContain(
      `another full test run is using this clone; waiting for the run in ${root} (process ${first.child.pid},`
    )
    expect(existsSync(join(root, 'order'))).toBe(false)
    writeFileSync(join(root, 'go'), '')
    expect(await first.closed).toBe(0)
    expect(await second.closed).toBe(0)
    expect(readFileSync(join(root, 'order'), 'utf8')).toBe('first ended\nsecond started\n')
    expect(second.stderr).toContain('lock acquired; starting')
    expect(existsSync(lock)).toBe(false)
  })

  it('logs a failure to record the child and still passes its exit status on', async () => {
    git(root, 'init', '-q')
    const lock = join(root, '.git', LOCK_NAME)
    const preload = join(root, 'fail-record.cjs')
    writeFileSync(
      preload,
      `const fs = require('fs')
      const { writeFileSync } = fs
      fs.writeFileSync = (path, data, ...rest) => {
        if (String(data).includes('childPid')) throw new Error('disk full')
        return writeFileSync(path, data, ...rest)
      }
      require('module').syncBuiltinESMExports()`
    )
    const held = `process.exit(require('fs').existsSync(${JSON.stringify(lock)}) ? 7 : 1)`
    const { status, stderr } = await run(root, unheld(), held, ['-r', preload])
    expect(status).toBe(7)
    expect(stderr).toBe(
      "test-suite-lock: could not record the command's process in the lock: disk full\n"
    )
    expect(existsSync(lock)).toBe(false)
  })

  it.each(['EACCES', 'ENOENT', 'discovery', 'empty'])(
    'fails before spawn on Git %s errors with a held lock',
    async (failure) => {
      git(root, 'init', '-q')
      const lock = join(root, '.git', LOCK_NAME)
      const held = { ...base(process.pid), startedAt: new Date().toISOString() }
      plant(lock, held)
      const marker = join(root, 'ran')
      const preload = join(root, 'fail-git.cjs')
      writeFileSync(
        preload,
        `
      const cp = require('node:child_process')
      cp.execFileSync = () => {
        if (${JSON.stringify(failure)} === 'empty') return ''
        const error = new Error('Git ${failure} discovery failed')
        error.code = ${JSON.stringify(failure)}
        error.status = 128
        error.stderr = 'fatal: discovery failed'
        throw error
      }
      require('node:module').syncBuiltinESMExports()
    `
      )
      const { status, stderr } = await run(
        root,
        unheld(),
        `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`,
        ['-r', preload]
      )
      expect(status).toBe(1)
      expect(stderr).toContain(
        failure === 'empty' ? 'git returned no common directory' : 'discovery failed'
      )
      expect(existsSync(marker)).toBe(false)
      expect(readOwner(lock)).toEqual(held)
    }
  )

  it('surfaces cleanup permission failures before starting the command', async () => {
    git(root, 'init', '-q')
    const lock = join(root, '.git', LOCK_NAME)
    const held = { ...base(exitedPid()), startedAt: new Date().toISOString() }
    plant(lock, held)
    const preload = join(root, 'fail-cleanup.cjs')
    writeFileSync(
      preload,
      `
      const fs = require('node:fs')
      const rename = fs.renameSync
      fs.renameSync = (from, to) => {
        if (from === ${JSON.stringify(lock)} && to.includes('.stale-')) {
          throw Object.assign(new Error('cleanup permission denied'), { code: 'EACCES' })
        }
        return rename(from, to)
      }
      require('node:module').syncBuiltinESMExports()
    `
    )
    const { status, stderr } = await run(root, unheld(), 'process.exit(7)', ['-r', preload])
    expect(status).toBe(1)
    expect(stderr).toContain('cleanup permission denied')
    expect(readOwner(lock)).toEqual(held)
    expect(existsSync(lock + '.reap')).toBe(false)
  })

  it('rejects broken Git metadata rather than reporting no repository', async () => {
    const marker = join(root, 'ran')
    const { status, stderr } = await run(
      root,
      { ...unheld(), GIT_DIR: join(root, 'missing') },
      `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`
    )
    expect(status).toBe(1)
    expect(stderr).toContain('not a git repository')
    expect(stderr).not.toContain('running the command without the lock')
    expect(existsSync(marker)).toBe(false)
  })

  it('says so when it finds no git directory and runs the command without the lock', async () => {
    const { status, stderr } = await run(root, unheld(), 'process.exit(7)')
    expect(status).toBe(7)
    expect(stderr).toBe(
      `test-suite-lock: no git directory found from ${root}; running the command without the lock\n`
    )
  })
})
