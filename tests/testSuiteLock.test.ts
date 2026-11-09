import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  HELD_ENV,
  LOCK_NAME,
  OWNERLESS_GRACE_MS,
  acquire,
  lockPath,
  readOwner,
  release,
  tryAcquire
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/test-suite-lock.mjs'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'test-suite-lock.mjs')
const alive = () => true
const dead = () => false
const owner = (pid: number) => ({ pid, cwd: '/w', startedAt: `t${pid}` })

let root: string
let dir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'suite-lock-'))
  dir = join(root, LOCK_NAME)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('tryAcquire', () => {
  it('takes a free lock and records its owner', () => {
    expect(tryAcquire(dir, owner(1), { alive })).toBeNull()
    expect(readOwner(dir)).toEqual(owner(1))
  })

  it('reports the owner of a lock held by a live process', () => {
    tryAcquire(dir, owner(1), { alive })
    expect(tryAcquire(dir, owner(2), { alive })).toEqual(owner(1))
    expect(readOwner(dir)).toEqual(owner(1))
  })

  it('takes over a lock whose process has exited', () => {
    tryAcquire(dir, owner(1), { alive })
    expect(tryAcquire(dir, owner(2), { alive: dead })).toBeNull()
    expect(readOwner(dir)).toEqual(owner(2))
  })

  it('waits on an ownerless lock until the grace period has passed', () => {
    mkdirSync(dir)
    const now = Date.now()
    expect(tryAcquire(dir, owner(2), { alive, now })).toEqual({ pid: null })
    const old = new Date(now - OWNERLESS_GRACE_MS - 1_000)
    utimesSync(dir, old, old)
    expect(tryAcquire(dir, owner(2), { alive, now })).toBeNull()
    expect(readOwner(dir)).toEqual(owner(2))
  })

  it('treats an owner file without a numeric pid as stale', () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'owner.json'), '{"pid":"x"}')
    expect(tryAcquire(dir, owner(2), { alive })).toBeNull()
  })
})

describe('release', () => {
  it('removes only a lock this owner holds', () => {
    tryAcquire(dir, owner(1), { alive })
    release(dir, owner(2))
    expect(readOwner(dir)).toEqual(owner(1))
    release(dir, owner(1))
    expect(existsSync(dir)).toBe(false)
  })
})

describe('acquire', () => {
  it('waits until the holder releases the lock', async () => {
    const first = { ...owner(process.pid), startedAt: 'first' }
    tryAcquire(dir, first)
    let acquired = false
    const waiting = acquire(dir, owner(process.pid), { pollMs: 20 }).then(() => {
      acquired = true
    })
    await new Promise((done) => setTimeout(done, 100))
    expect(acquired).toBe(false)
    release(dir, first)
    await waiting
    expect(readOwner(dir)).toEqual(owner(process.pid))
  })
})

describe('lockPath', () => {
  it('puts the lock in the common git directory shared by worktrees', () => {
    const repo = join(root, 'repo')
    mkdirSync(repo)
    execFileSync('git', ['init', '-q'], { cwd: repo })
    mkdirSync(join(repo, 'sub'))
    expect(lockPath(join(repo, 'sub'))).toBe(join(repo, '.git', LOCK_NAME))
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

  const repoEnv = () => {
    const env = { ...process.env }
    delete env[HELD_ENV]
    return env
  }

  it('holds the lock while the command runs, passes its exit code and releases', async () => {
    execFileSync('git', ['init', '-q'], { cwd: root })
    const lock = join(root, '.git', LOCK_NAME)
    const probe =
      `const fs = require('fs');` +
      `const o = JSON.parse(fs.readFileSync(${JSON.stringify(join(lock, 'owner.json'))}, 'utf8'));` +
      `process.exit(o.pid === Number(process.env.${HELD_ENV}) ? 7 : 1)`
    const { status } = await run(root, repoEnv(), probe)
    expect(status).toBe(7)
    expect(existsSync(lock)).toBe(false)
  })

  it('runs without waiting when a parent already holds the lock', async () => {
    execFileSync('git', ['init', '-q'], { cwd: root })
    const lock = join(root, '.git', LOCK_NAME)
    mkdirSync(lock)
    writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner(process.pid)))
    const { status, stderr } = await run(
      root,
      { ...repoEnv(), [HELD_ENV]: String(process.pid) },
      'process.exit(0)'
    )
    expect(status).toBe(0)
    expect(stderr).toBe('')
    expect(readOwner(lock)).toEqual(owner(process.pid))
  })
})
