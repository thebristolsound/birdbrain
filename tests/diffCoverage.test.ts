import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  changedLinesByFile,
  executableChangedLines,
  lineHitsForFile,
  resolveMergeBase
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/diff-coverage.mjs'

type ChangedLines = Map<string, Set<number> | null>

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

const write = (rel: string, lines: string[]) => {
  mkdirSync(join(repo, rel, '..'), { recursive: true })
  writeFileSync(join(repo, rel), lines.join('\n') + '\n')
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'diff-coverage-'))
  git('init', '-q', '-b', 'main')
  write('src/a.ts', ['a1', 'a2', 'a3'])
  git('add', 'src/a.ts')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'topic')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('changedLinesByFile', () => {
  it('scores committed changes against the merge base', () => {
    write('src/a.ts', ['a1', 'a2 changed', 'a3', 'a4 added'])
    git('commit', '-qam', 'change')
    const changed: ChangedLines = changedLinesByFile(resolveMergeBase('main', repo), repo)
    expect([...changed.keys()]).toEqual(['src/a.ts'])
    expect([...changed.get('src/a.ts')!]).toEqual([2, 4])
  })

  it('scores the working tree, not HEAD, when the tree is dirty (#508)', () => {
    write('src/a.ts', ['a1', 'a2 changed', 'a3'])
    git('commit', '-qam', 'change')
    // Uncommitted edit shifts the committed change down by one line; the
    // coverage run measured this file, so the score must use these numbers.
    write('src/a.ts', ['inserted', 'a1', 'a2 changed', 'a3'])
    const changed: ChangedLines = changedLinesByFile(resolveMergeBase('main', repo), repo)
    expect([...changed.get('src/a.ts')!]).toEqual([1, 3])
  })

  it('counts untracked files as wholly added and drops deletions', () => {
    write('src/new.ts', ['n1', 'n2'])
    write('src/staged.ts', ['s1'])
    git('add', 'src/staged.ts')
    rmSync(join(repo, 'src/a.ts'))
    const changed: ChangedLines = changedLinesByFile(resolveMergeBase('main', repo), repo)
    expect([...changed.keys()].sort()).toEqual(['src/new.ts', 'src/staged.ts'])
    expect(changed.get('src/new.ts')).toBeNull()
    expect([...changed.get('src/staged.ts')!]).toEqual([1])
  })

  it('does not count lines added on main after the branch forked', () => {
    git('checkout', '-q', 'main')
    write('src/main-only.ts', ['m1'])
    git('add', 'src/main-only.ts')
    git('commit', '-qm', 'main moves on')
    git('checkout', '-q', 'topic')
    write('src/a.ts', ['a1', 'a2', 'a3', 'a4'])
    git('commit', '-qam', 'topic change')
    const changed: ChangedLines = changedLinesByFile(resolveMergeBase('main', repo), repo)
    expect([...changed.keys()]).toEqual(['src/a.ts'])
    expect([...changed.get('src/a.ts')!]).toEqual([4])
  })
})

describe('resolveMergeBase', () => {
  it('explains an unresolvable base', () => {
    expect(() => resolveMergeBase('no-such-ref', repo)).toThrow(/Cannot resolve a merge base/)
  })
})

describe('executableChangedLines', () => {
  const entry = {
    statementMap: {
      '0': { start: { line: 1 } },
      '1': { start: { line: 3 } },
      '2': { start: { line: 3 } },
      '3': { start: { line: 7 } }
    },
    s: { '0': 1, '1': 0, '2': 2, '3': 0 }
  }

  it('sums statement hits per line', () => {
    const hits: Map<number, number> = lineHitsForFile(entry)
    expect([...hits]).toEqual([
      [1, 1],
      [3, 2],
      [7, 0]
    ])
  })

  it('keeps only statement-bearing changed lines, in order', () => {
    const hits = lineHitsForFile(entry)
    expect(executableChangedLines(new Set([7, 2, 3, 1]), hits)).toEqual([1, 3, 7])
    expect(executableChangedLines(new Set([2, 4]), hits)).toEqual([])
  })

  it('treats an untracked file as entirely new', () => {
    expect(executableChangedLines(null, lineHitsForFile(entry))).toEqual([1, 3, 7])
  })
})
