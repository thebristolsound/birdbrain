import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { formatVerificationBlock } from '../scripts/preflight.mjs'

const HOOK = resolve(__dirname, '../.claude/hooks/verify-before-stop.sh')
const TEARDOWN = resolve(__dirname, '../.claude/skills/teardown/scripts/teardown.sh')

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

// The block preflight itself writes, so a change to its stamp line breaks these tests.
const writeBlock = (sha: string, status: 'pass' | 'fail' = 'pass', root = repo) => {
  mkdirSync(join(root, '.preflight'), { recursive: true })
  writeFileSync(
    join(root, '.preflight', 'verification.md'),
    formatVerificationBlock({
      sha,
      nodeVersion: '24.0.0',
      base: 'origin/main',
      mergeBase: sha,
      steps: [{ command: 'pnpm lint', status, exitCode: status === 'pass' ? 0 : 1 }]
    })
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

// A linked worktree one commit past origin/main, the tree an implementer works in. Teardown
// refuses the main checkout, so the cleanup tests need one.
const linkedTree = () => {
  const tree = `${repo}-tree`
  git('worktree', 'add', '-q', '-b', 'task', tree)
  writeFileSync(join(tree, 'task.txt'), 'task\n')
  git('-C', tree, 'add', 'task.txt')
  git('-C', tree, 'commit', '-q', '-m', 'task')
  return { tree, head: git('-C', tree, 'rev-parse', 'HEAD') }
}

// The implementer's last step: `teardown.sh close --artefacts`, run from inside its tree.
const closeArtefacts = (tree: string) =>
  execFileSync('bash', [TEARDOWN, 'close', '--artefacts'], { cwd: tree, encoding: 'utf8' })

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'verify-before-stop-'))
  git('init', '-q', '-b', 'work')
  writeFileSync(join(repo, '.gitignore'), '.preflight/\n')
  git('add', '.gitignore')
  git('commit', '-q', '-m', 'ignore preflight output')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
  rmSync(`${repo}-tree`, { recursive: true, force: true })
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

  it('lets the next stop through when the block at HEAD records a failure', () => {
    writeBlock(commit('work.txt'), 'fail')
    expect(stop(implementer).code).toBe(2)
    expect(stop({ ...implementer, stop_hook_active: true }).code).toBe(0)
  })

  it('holds a failing block once when an earlier stop on the commit was already held', () => {
    const head = commit('work.txt')
    const again = { ...implementer, stop_hook_active: true }
    expect(stop(implementer).stderr).toContain('no verification block')
    writeBlock(head, 'fail')
    const { code, stderr } = stop(again)
    expect(code).toBe(2)
    expect(stderr).toContain('records status=fail')
    expect(stop(again).code).toBe(0)
  })

  it('holds a failing block once after the three holds for a missing block are spent', () => {
    const head = commit('work.txt')
    const again = { ...implementer, stop_hook_active: true }
    for (let i = 0; i < 3; i += 1) stop(again)
    writeBlock(head, 'fail')
    expect(stop(again).stderr).toContain('records status=fail')
    expect(stop(again).code).toBe(0)
  })

  it('names the give-up path when it holds a stop with no block', () => {
    commit('work.txt')
    const { stderr } = stop(implementer)
    expect(stderr).toContain('give-up path')
    expect(stderr).toContain('after 3 held stops')
  })

  it('still passes a verified implementer after teardown clears the artefacts', () => {
    const { tree, head } = linkedTree()
    writeBlock(head, 'pass', tree)
    writeFileSync(join(tree, '.preflight', 'check.md'), 'a check summary\n')
    expect(stop({ ...implementer, cwd: tree }).code).toBe(0)
    expect(closeArtefacts(tree)).toContain('kept .preflight/verification.md')
    expect(existsSync(join(tree, '.preflight', 'check.md'))).toBe(false)
    expect(stop({ ...implementer, cwd: tree }).code).toBe(0)
  })

  it('keeps the count of held stops across a teardown of the artefacts', () => {
    const { tree } = linkedTree()
    const held = { ...implementer, cwd: tree }
    const codes = []
    for (let i = 0; i < 3; i += 1) {
      codes.push(stop(held).code)
      mkdirSync(join(tree, '.preflight'), { recursive: true })
      closeArtefacts(tree)
    }
    expect(codes).toEqual([2, 2, 2])
    expect(stop(held).code).toBe(0)
  })

  it('holds a main session started as the implementer, not only a subagent', () => {
    commit('work.txt')
    expect(stop({ ...implementer, hook_event_name: 'Stop' }).code).toBe(2)
  })

  it('blocks uncommitted changes even with a passing block at HEAD', () => {
    writeBlock(commit('work.txt'))
    writeFileSync(join(repo, 'work.txt'), 'edited after preflight\n')
    const { code, stderr } = stop({ ...implementer, stop_hook_active: true })
    expect(code).toBe(2)
    expect(stderr).toContain('uncommitted changes')
  })

  it('lets the implementer stop with a passing block at HEAD', () => {
    writeBlock(commit('work.txt'))
    expect(stop(implementer).code).toBe(0)
  })

  it('keeps blocking a missing block when the agent stops again', () => {
    commit('work.txt')
    stop(implementer)
    const { code, stderr } = stop({ ...implementer, stop_hook_active: true })
    expect(code).toBe(2)
    expect(stderr).toContain('Stop 2 of 3')
  })

  it('lets the stop through after three held stops on one commit', () => {
    commit('work.txt')
    const again = { ...implementer, stop_hook_active: true }
    expect([stop(implementer), stop(again), stop(again)].map((r) => r.code)).toEqual([2, 2, 2])
    expect(stop(again).code).toBe(0)
  })

  it('starts the count again on a new commit', () => {
    commit('work.txt')
    for (let i = 0; i < 4; i += 1) stop(implementer)
    commit('more.txt')
    const { code, stderr } = stop(implementer)
    expect(code).toBe(2)
    expect(stderr).toContain('Stop 1 of 3')
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
