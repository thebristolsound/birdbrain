import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  BLOCK_VERSION,
  DEFAULT_OUT,
  childEnv,
  dirtyTreeProblem,
  formatVerificationBlock,
  nodeVersionProblem,
  parseVitestSummary,
  summarizeDiffCoverage,
  touchesExtension
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/preflight.mjs'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'preflight.mjs')
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const MERGE_BASE = '0123456789abcdef0123456789abcdef01234567'

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1'
}

let repo: string

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: gitEnv }).trim()

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'preflight-'))
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'init')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('formatVerificationBlock', () => {
  const passingSteps = [
    { command: 'pnpm lint', status: 'pass', exitCode: 0 },
    { command: 'pnpm typecheck', status: 'pass', exitCode: 0 },
    {
      command: 'BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test',
      status: 'pass',
      exitCode: 0,
      detail: '2094 passed, 3 skipped (2097)'
    },
    { command: 'pnpm build', status: 'pass', exitCode: 0 },
    { command: 'pnpm build:extension', status: 'skipped', detail: 'no extension/ changes' },
    {
      command: 'pnpm test:coverage',
      status: 'pass',
      exitCode: 0,
      detail: '2094 passed, 3 skipped (2097), thresholds met'
    },
    {
      command: 'pnpm coverage:diff',
      status: 'pass',
      exitCode: 0,
      detail: '96.30% of 54 changed lines covered (floor 90%)'
    }
  ]

  it('renders the marker, header and one line per step for a passing run', () => {
    const block = formatVerificationBlock({
      sha: SHA,
      nodeVersion: '20.20.2',
      base: 'origin/main',
      mergeBase: MERGE_BASE,
      steps: passingSteps
    })
    expect(block).toBe(
      [
        `<!-- preflight v${BLOCK_VERSION} sha=${SHA} status=pass -->`,
        '## Verification',
        '',
        '`pnpm preflight` at `' +
          SHA +
          '` on Node v20.20.2; diff scored against `origin/main` (merge base `012345678`). Result: **pass**.',
        '',
        '- `pnpm lint` - pass (exit 0)',
        '- `pnpm typecheck` - pass (exit 0)',
        '- `BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test` - pass (exit 0) - 2094 passed, 3 skipped (2097)',
        '- `pnpm build` - pass (exit 0)',
        '- `pnpm build:extension` - skipped - no extension/ changes',
        '- `pnpm test:coverage` - pass (exit 0) - 2094 passed, 3 skipped (2097), thresholds met',
        '- `pnpm coverage:diff` - pass (exit 0) - 96.30% of 54 changed lines covered (floor 90%)',
        ''
      ].join('\n')
    )
  })

  it('stamps status=fail and keeps every step when any step failed', () => {
    const steps = passingSteps.map((step) =>
      step.command === 'pnpm typecheck' ? { ...step, status: 'fail', exitCode: 2 } : step
    )
    const block = formatVerificationBlock({
      sha: SHA,
      nodeVersion: '20.20.2',
      base: 'origin/main',
      mergeBase: MERGE_BASE,
      steps
    })
    expect(block.split('\n')[0]).toBe(`<!-- preflight v${BLOCK_VERSION} sha=${SHA} status=fail -->`)
    expect(block).toContain('Result: **fail**.')
    expect(block).toContain('- `pnpm typecheck` - fail (exit 2)')
    expect(block).toContain('- `pnpm coverage:diff` - pass (exit 0)')
    expect(block.match(/^- /gm)).toHaveLength(7)
  })

  it('marks the extension build as a real step when it ran', () => {
    const block = formatVerificationBlock({
      sha: SHA,
      nodeVersion: '20.20.2',
      base: 'origin/main',
      mergeBase: MERGE_BASE,
      steps: [{ command: 'pnpm build:extension', status: 'pass', exitCode: 0 }]
    })
    expect(block).toContain('- `pnpm build:extension` - pass (exit 0)\n')
  })
})

describe('parseVitestSummary', () => {
  it('reads the closing Tests line and ignores the Test Files line', () => {
    const output = [
      ' Test Files  187 passed (187)',
      '      Tests  2094 passed | 3 skipped (2097)',
      '   Start at  10:00:00',
      '   Duration  61.20s'
    ].join('\n')
    expect(parseVitestSummary(output)).toEqual({ summary: '2094 passed, 3 skipped', total: 2097 })
  })

  it('returns null when no summary is present', () => {
    expect(parseVitestSummary('Error: something broke before the run\n')).toBeNull()
  })
})

describe('summarizeDiffCoverage', () => {
  it('reports the percentage against the floor when scored', () => {
    expect(
      summarizeDiffCoverage({ scored: true, pct: 96.296, total: 54, min: 90, unscored: [] })
    ).toBe('96.30% of 54 changed lines covered (floor 90%)')
  })

  it('names the uninstrumented files count', () => {
    expect(
      summarizeDiffCoverage({
        scored: true,
        pct: 100,
        total: 3,
        min: 90,
        unscored: ['extension/src/content.ts']
      })
    ).toBe('100.00% of 3 changed lines covered (floor 90%); 1 changed source file not instrumented')
  })

  it('says so when nothing was scored', () => {
    expect(
      summarizeDiffCoverage({ scored: false, pct: null, total: 0, min: 90, unscored: [] })
    ).toBe('not scored, no instrumented source lines changed')
  })
})

describe('touchesExtension', () => {
  it('fires only on paths under extension/', () => {
    expect(touchesExtension(['src/main/index.ts', 'extension/src/popup/App.tsx'])).toBe(true)
    expect(touchesExtension(['src/main/index.ts', 'tests/extension/api.test.ts'])).toBe(false)
    expect(touchesExtension([])).toBe(false)
  })
})

describe('childEnv', () => {
  it('requires OpenSSL and drops the diff-coverage floor override', () => {
    const env = childEnv({ PATH: '/usr/bin', COVERAGE_DIFF_MIN: '0', COVERAGE_DIFF_BASE: 'main' })
    expect(env).toEqual({
      PATH: '/usr/bin',
      COVERAGE_DIFF_BASE: 'main',
      BIRDBRAIN_REQUIRE_OPENSSL: '1'
    })
  })
})

describe('nodeVersionProblem', () => {
  it('accepts any 20.x', () => {
    expect(nodeVersionProblem('20.20.2')).toBeNull()
    expect(nodeVersionProblem('20.19.0')).toBeNull()
  })

  it('names the pin and the mise gap on any other major', () => {
    const problem = nodeVersionProblem('24.17.0')
    expect(problem).toContain('Node v24.17.0 is not the pinned 20.x')
    expect(problem).toContain('mise')
    expect(nodeVersionProblem('22.0.0')).toContain('not the pinned 20.x')
  })
})

describe('dirtyTreeProblem', () => {
  it('is null on a clean tree', () => {
    expect(dirtyTreeProblem(repo)).toBeNull()
  })

  it('lists tracked edits and untracked files', () => {
    writeFileSync(join(repo, 'a.txt'), 'changed\n')
    writeFileSync(join(repo, 'new.txt'), 'new\n')
    const problem = dirtyTreeProblem(repo)
    expect(problem).toContain('the working tree is dirty')
    expect(problem).toContain(' M a.txt')
    expect(problem).toContain('?? new.txt')
  })
})

describe('pnpm preflight on a dirty tree', () => {
  it('exits 2 before running any step and removes any earlier block', () => {
    writeFileSync(join(repo, 'a.txt'), 'changed\n')
    const stale = join(repo, DEFAULT_OUT)
    mkdirSync(join(repo, '.preflight'))
    writeFileSync(stale, '<!-- preflight v1 sha=old status=pass -->\n')
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: repo,
      encoding: 'utf8',
      env: gitEnv
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('preflight: refusing to run, the working tree is dirty')
    expect(result.stderr).toContain(' M a.txt')
    expect(result.stdout).not.toContain('preflight: pnpm lint')
    expect(existsSync(stale)).toBe(false)
  })

  it('honours an absolute --out path when clearing the earlier block', () => {
    writeFileSync(join(repo, 'a.txt'), 'changed\n')
    const elsewhere = mkdtempSync(join(tmpdir(), 'preflight-out-'))
    const stale = join(elsewhere, 'verification.md')
    writeFileSync(stale, '<!-- preflight v1 sha=old status=pass -->\n')
    try {
      const result = spawnSync(process.execPath, [SCRIPT, '--out', stale], {
        cwd: repo,
        encoding: 'utf8',
        env: gitEnv
      })
      expect(result.status).toBe(2)
      expect(existsSync(stale)).toBe(false)
      expect(existsSync(join(repo, stale))).toBe(false)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})
