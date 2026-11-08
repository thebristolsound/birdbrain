import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildCase,
  gitDeps,
  loadSpecs,
  writeFixture
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/build-cases.mjs'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { bodyAt, showFile, revExists } from '../../scripts/bench/review/lib/git.mjs'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t'
    }
  }).trim()

let repo: string
let base: string
let head: string

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'bench-review-test-'))
  git(repo, 'init', '-q', '-b', 'main')
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src', 'a.ts'), 'one\nif (guard) return\ntwo\n')
  git(repo, 'add', 'src/a.ts')
  git(repo, 'commit', '-q', '-m', 'base')
  base = git(repo, 'rev-parse', 'HEAD')
  writeFileSync(join(repo, 'src', 'a.ts'), 'one\nif (guard) return\ntwo\nthree\n')
  git(repo, 'add', 'src/a.ts')
  git(repo, 'commit', '-q', '-m', 'pr')
  head = git(repo, 'rev-parse', 'HEAD')
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

const spec = () => ({
  id: 'm01-guard',
  kind: 'mutation',
  source: { pr: 7, base, head },
  tags: ['removed-guard'],
  mutations: [
    {
      id: 'd1',
      file: 'src/a.ts',
      find: 'if (guard) return\n',
      replace: '',
      category: 'removed-guard',
      blocking: true,
      description: 'guard gone'
    }
  ]
})

describe('buildCase with git', () => {
  it('materialises the mutation inside the PR diff and leaves no worktree behind', () => {
    const built = buildCase(spec(), gitDeps(repo, { gh: false }))
    expect(built.truth).toEqual({
      verdict: 'request changes',
      defects: [
        {
          id: 'd1',
          file: 'src/a.ts',
          lineStart: 2,
          lineEnd: 2,
          category: 'removed-guard',
          blocking: true,
          description: 'guard gone'
        }
      ],
      refuted: []
    })
    expect(built.files.get('src/a.ts')).toBe('one\ntwo\nthree\n')
    expect(built.diff).toContain('-if (guard) return')
    expect(built.diff).toContain('+three')
    expect(built.pr).toBeNull()
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
  })
  it('builds a real case from its truth file and checks the cited files exist', () => {
    const real = {
      id: 'r-7',
      kind: 'real',
      source: { pr: 7, base, head },
      tags: [],
      truth: {
        verdict: 'approve for human review',
        defects: [
          {
            id: 'd1',
            file: 'src/a.ts',
            lineStart: 4,
            lineEnd: 4,
            category: 'off-by-one',
            blocking: false,
            description: 'x'
          },
          {
            id: 'd2',
            file: 'PR_BODY',
            category: 'overclaim',
            blocking: false,
            description: 'body claim'
          }
        ],
        refuted: []
      }
    }
    const built = buildCase(real, gitDeps(repo, { gh: false }))
    expect(built.files.size).toBe(0)
    expect(built.diff).toContain('+three')
    expect(() =>
      buildCase(
        {
          ...real,
          truth: { ...real.truth, defects: [{ ...real.truth.defects[0], file: 'src/zz.ts' }] }
        },
        gitDeps(repo, { gh: false })
      )
    ).toThrow(/not at head/)
  })
  it('writes the fixture files', () => {
    const out = mkdtempSync(join(tmpdir(), 'bench-review-fixture-'))
    try {
      const built = buildCase(spec(), {
        ...gitDeps(repo, { gh: false }),
        pr: () => ({ title: 'T', url: 'u', body: 'B' })
      })
      writeFixture(out, built)
      expect(JSON.parse(readFileSync(join(out, 'case.json'), 'utf8')).truth).toBeUndefined()
      expect(JSON.parse(readFileSync(join(out, 'truth.json'), 'utf8')).verdict).toBe(
        'request changes'
      )
      expect(readFileSync(join(out, 'files', 'src', 'a.ts'), 'utf8')).toBe('one\ntwo\nthree\n')
      expect(readFileSync(join(out, 'pr.md'), 'utf8')).toBe('# T\n\nu\n\nB\n')
      expect(existsSync(join(out, 'diff.patch'))).toBe(true)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
  it('asks for the PR as it read at the pinned head', () => {
    const asked: unknown[][] = []
    buildCase(spec(), {
      ...gitDeps(repo, { gh: false }),
      pr: (...args: unknown[]) => {
        asked.push(args)
        return { title: 'T', url: 'u', body: 'B' }
      }
    })
    expect(asked).toEqual([[7, head]])
  })
  it('git helpers answer null and false for what is not there', () => {
    expect(showFile(repo, head, 'src/a.ts')).toContain('three')
    expect(showFile(repo, head, 'src/missing.ts')).toBeNull()
    expect(revExists(repo, head)).toBe(true)
    expect(revExists(repo, 'c'.repeat(40))).toBe(false)
  })
})

describe('loadSpecs', () => {
  it('reads the committed cases and validates each one', () => {
    const specs = loadSpecs()
    expect(specs.length).toBeGreaterThanOrEqual(20)
    expect(new Set(specs.map((s: { id: string }) => s.id)).size).toBe(specs.length)
    // A real case approved with no adjudicated defect carries an empty list.
    for (const s of specs) {
      if (s.kind === 'mutation') expect(s.mutations.length).toBeGreaterThan(0)
      else expect(['approve for human review', 'request changes']).toContain(s.truth.verdict)
    }
    expect(
      specs.filter((s: { tags: string[] }) => s.tags.includes('approve')).length
    ).toBeGreaterThanOrEqual(20)
  })
  it('rejects a spec whose kind does not match its directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-review-specs-'))
    try {
      mkdirSync(join(dir, 'real'))
      writeFileSync(join(dir, 'real', 'x.json'), JSON.stringify(spec()))
      expect(() => loadSpecs(dir)).toThrow(/kind is mutation/)
      writeFileSync(join(dir, 'real', 'x.json'), JSON.stringify({ ...spec(), id: 'Bad' }))
      expect(() => loadSpecs(dir)).toThrow(/lowercase/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('bodyAt', () => {
  const commits = [
    { oid: 'a', committedDate: '2026-11-06T01:00:00Z' },
    { oid: 'b', committedDate: '2026-11-06T02:00:00Z' },
    { oid: 'c', committedDate: '2026-11-06T03:00:00Z' }
  ]
  // Out of order on purpose: GitHub lists the newest edit first.
  const edits = [
    { editedAt: '2026-11-06T02:30:00Z', diff: 'after b' },
    { editedAt: '2026-11-06T01:30:00Z', diff: 'after a' },
    { editedAt: '2026-11-06T01:10:00Z', diff: 'opened' }
  ]
  const pr = { body: 'final', commits, edits }

  it('takes the last edit before the next commit', () => {
    expect(bodyAt(pr, 'a')).toBe('after a')
    expect(bodyAt(pr, 'b')).toBe('after b')
  })
  it('keeps the current body for the newest commit or a body never edited', () => {
    expect(bodyAt(pr, 'c')).toBe('final')
    expect(bodyAt({ ...pr, edits: [] }, 'a')).toBe('final')
  })
  it('takes the first body when the PR was opened after the next commit', () => {
    expect(
      bodyAt({ ...pr, edits: [{ editedAt: '2026-11-06T02:10:00Z', diff: 'late' }] }, 'a')
    ).toBe('late')
  })
  it('refuses a head the PR does not hold', () => {
    expect(() => bodyAt(pr, 'z')).toThrow(/not a commit of the PR/)
  })
})
