import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const HOOK = resolve(__dirname, '../.claude/hooks/verify-before-stop.sh')

let repo: string

const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1'
    }
  }).trim()

const commit = (name: string) => {
  writeFileSync(join(repo, name), `${name}\n`)
  git('add', name)
  git('commit', '-q', '-m', name)
  return git('rev-parse', 'HEAD')
}

const writeBlock = (sha: string, status = 'pass') => {
  mkdirSync(join(repo, '.preflight'), { recursive: true })
  writeFileSync(
    join(repo, '.preflight', 'verification.md'),
    `## Verification\n\n<!-- preflight v3 sha=${sha} status=${status} -->\n\n| step | exit |\n`
  )
}

// Runs the hook under bash, as Claude Code does, and returns its exit code and stderr.
const stop = (payload: Record<string, unknown>) => {
  try {
    execFileSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'SubagentStop', cwd: repo, ...payload }),
      encoding: 'utf8',
      stdio: 'pipe'
    })
    return { code: 0, stderr: '' }
  } catch (error) {
    const { status, stderr } = error as { status: number; stderr: string }
    return { code: status, stderr }
  }
}

const implementer = { agent_type: 'birdbrain-implementer', stop_hook_active: false }

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'verify-before-stop-'))
  git('init', '-q', '-b', 'work')
  commit('base.txt')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('verify-before-stop hook', () => {
  it('blocks an implementer with committed work and no verification block', () => {
    commit('work.txt')
    const { code, stderr } = stop(implementer)
    expect(code).toBe(2)
    expect(stderr).toContain('no verification block at .preflight/verification.md')
    expect(stderr).toContain('pnpm preflight')
  })

  it('blocks when the block names an older commit', () => {
    const older = commit('work.txt')
    writeBlock(older)
    const head = commit('more.txt')
    const { code, stderr } = stop(implementer)
    expect(code).toBe(2)
    expect(stderr).toContain(`is for ${older.slice(0, 12)}, not HEAD ${head.slice(0, 12)}`)
  })

  it('blocks when the block at HEAD records a failure', () => {
    writeBlock(commit('work.txt'), 'fail')
    const { code, stderr } = stop(implementer)
    expect(code).toBe(2)
    expect(stderr).toContain('records status=fail')
  })

  it('lets the implementer stop with a passing block at HEAD', () => {
    writeBlock(commit('work.txt'))
    expect(stop(implementer).code).toBe(0)
  })

  it('lets the stop through the second time, so the give-up path is never trapped', () => {
    commit('work.txt')
    expect(stop({ ...implementer, stop_hook_active: true }).code).toBe(0)
  })

  it('lets an implementer with nothing committed past main stop', () => {
    expect(stop(implementer).code).toBe(0)
  })

  it('passes every other agent and a session with no agent type', () => {
    commit('work.txt')
    expect(stop({ agent_type: 'Explore' }).code).toBe(0)
    expect(stop({ hook_event_name: 'Stop' }).code).toBe(0)
  })

  it('passes when the working directory is not a git repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'verify-before-stop-outside-'))
    try {
      expect(stop({ ...implementer, cwd: outside }).code).toBe(0)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('passes a payload that is not JSON', () => {
    expect(() =>
      execFileSync('bash', [HOOK], { input: 'not json', stdio: 'pipe', cwd: repo })
    ).not.toThrow()
  })
})
