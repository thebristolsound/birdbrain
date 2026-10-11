import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  DEFAULT_OUT,
  LEFT_TO_PREFLIGHT,
  formatSummary,
  parseChanges,
  planChecks,
  systemSharpAddon,
  testEnv,
  typecheckProjects
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/check.mjs'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check.mjs')
const MERGE_BASE = '0123456789abcdef0123456789abcdef01234567'
const PROJECTS = ['tsconfig.node.json', 'tsconfig.web.json']

type Check = {
  name: string
  scope?: string
  command: string
  args: string[]
  advisory?: boolean
  describe?: (output: string) => string | undefined
  warns?: (output: string) => boolean
}

const changed = (...paths: string[]) => paths.map((path) => ({ path, deleted: false }))
const plan = (changes: { path: string; deleted: boolean }[]): Check[] =>
  planChecks(changes, { mergeBase: MERGE_BASE, projects: PROJECTS })
const names = (checks: Check[]) => checks.map((check) => check.name)
const find = (checks: Check[], name: string) => checks.find((check) => check.name === name)

describe('parseChanges', () => {
  it('reads -z name-status pairs and untracked paths, marking deletions', () => {
    const nameStatus = 'M\0src/a.ts\0D\0src/old name.ts\0A\0docs/b.md\0'
    expect(parseChanges(nameStatus, 'tests/new.test.ts\0')).toEqual([
      { path: 'src/a.ts', deleted: false },
      { path: 'src/old name.ts', deleted: true },
      { path: 'docs/b.md', deleted: false },
      { path: 'tests/new.test.ts', deleted: false }
    ])
  })

  it('returns nothing for a clean tree', () => {
    expect(parseChanges('', '')).toEqual([])
  })
})

describe('typecheckProjects', () => {
  it('reads every -p project from the typecheck script in order', () => {
    const script = 'tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p extension/tsconfig.json'
    expect(typecheckProjects(script)).toEqual(['tsconfig.node.json', 'extension/tsconfig.json'])
  })

  it('matches the repository typecheck script', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'))
    expect(typecheckProjects(pkg.scripts.typecheck)).toHaveLength(6)
  })

  it('throws rather than typechecking nothing when the script has no project', () => {
    expect(() => typecheckProjects('tsc --noEmit')).toThrow('no "-p <project>"')
    expect(() => typecheckProjects(undefined)).toThrow('no "-p <project>"')
  })
})

describe('planChecks', () => {
  it('plans nothing for no changes', () => {
    expect(plan([])).toEqual([])
  })

  it('runs only the prose check for a Markdown-only change', () => {
    const checks = plan(changed('website/content/docs/x.mdx'))
    expect(names(checks)).toEqual(['prose'])
    expect(checks[0].args).toEqual(['.claude/hooks/vale-prose.sh', '--base', MERGE_BASE])
  })

  it('maps a source change to lint, every typecheck project, related tests and boundaries', () => {
    const checks = plan(changed('src/main/services/a.ts', 'tests/main/a.test.ts'))
    expect(names(checks)).toEqual([
      'lint',
      'typecheck tsconfig.node.json',
      'typecheck tsconfig.web.json',
      'test',
      'boundaries'
    ])
    expect(find(checks, 'lint')?.args.slice(-2)).toEqual([
      'src/main/services/a.ts',
      'tests/main/a.test.ts'
    ])
    const test = find(checks, 'test')
    expect(test?.scope).toBe('related to 2 files')
    expect(test?.command).toBe('node')
    expect(test?.args).toEqual([
      'node_modules/electron/cli.js',
      './node_modules/vitest/vitest.mjs',
      'related',
      '--run',
      '--passWithNoTests',
      'src/main/services/a.ts',
      'tests/main/a.test.ts'
    ])
  })

  it('lints and tests a script without typechecking or the boundary check', () => {
    expect(names(plan(changed('scripts/preflight.mjs')))).toEqual(['lint', 'test'])
  })

  it('typechecks a tsconfig change without linting or testing', () => {
    expect(names(plan(changed('e2e/tsconfig.json')))).toEqual([
      'typecheck tsconfig.node.json',
      'typecheck tsconfig.web.json'
    ])
  })

  it.each(['package.json', 'pnpm-lock.yaml'])(
    'typechecks every project when %s changes',
    (path) => {
      expect(names(plan(changed(path)))).toEqual(
        expect.arrayContaining(['typecheck tsconfig.node.json', 'typecheck tsconfig.web.json'])
      )
    }
  )

  it('lints the whole repository when the ESLint config changes', () => {
    const lint = find(plan(changed('eslint.config.js', 'src/a.ts')), 'lint')
    expect(lint?.scope).toBe('whole repository, eslint.config.js changed')
    expect(lint?.command).toBe('pnpm')
    expect(lint?.args).toEqual(['lint'])
  })

  it('passes changed paths only to Node checks, never to a pnpm script', () => {
    const risky = ['src/a&whoami.ts', 'tests/b c.test.ts']
    const checks = plan(changed(...risky, 'CLAUDE.md', 'docs/adr/0099-x.md'))
    const pnpmChecks = checks.filter((check) => check.command === 'pnpm')
    expect(names(pnpmChecks)).toEqual(['boundaries', 'adr numbers', 'agents-md'])
    // Windows runs pnpm through a shell, so its arguments must be the fixed script name alone.
    for (const check of pnpmChecks) expect(check.args).toHaveLength(1)
    expect(find(checks, 'lint')?.command).toBe('node')
    expect(find(checks, 'lint')?.args.slice(-2)).toEqual(risky)
    expect(find(checks, 'test')?.args.slice(-2)).toEqual(risky)
  })

  it('runs the whole suite when a code file is deleted, and lints only files that exist', () => {
    const checks = plan([
      { path: 'src/shared/gone.ts', deleted: true },
      { path: 'src/shared/kept.ts', deleted: false }
    ])
    expect(find(checks, 'lint')?.args.slice(-1)).toEqual(['src/shared/kept.ts'])
    const test = find(checks, 'test')
    expect(test?.scope).toBe('whole suite, src/shared/gone.ts was deleted or renamed')
    expect(test?.args.slice(-1)).toEqual(['run'])
    expect(names(checks)).toContain('boundaries')
  })

  it.each([
    'vitest.config.ts',
    'tests/setup/signing-key.ts',
    'pnpm-lock.yaml',
    'tests/shared/verify/fixtures/pre-scope-package/evidence.json'
  ])('runs the whole suite when %s changes', (path) => {
    const test = find(plan(changed(path)), 'test')
    expect(test?.scope).toBe(`whole suite, ${path} changed`)
    expect(test?.args.slice(-1)).toEqual(['run'])
  })

  it('checks ADR numbers for a change under docs/adr/', () => {
    expect(names(plan(changed('docs/adr/0099-x.md')))).toEqual(['prose', 'adr numbers'])
  })

  it('reports agents-md drift as advisory when CLAUDE.md changes', () => {
    const checks = plan(changed('CLAUDE.md'))
    expect(names(checks)).toEqual(['prose', 'agents-md'])
    expect(find(checks, 'agents-md')?.advisory).toBe(true)
  })

  it('warns on agents-md drift even though the lint exits 0', () => {
    const agentsMd = find(plan(changed('AGENTS.md')), 'agents-md')
    const drift = 'lint:agents-md: CLAUDE.md and AGENTS.md differ - 1 only in CLAUDE.md\n'
    expect(agentsMd?.warns?.(drift)).toBe(true)
    expect(agentsMd?.describe?.(drift)).toBe('CLAUDE.md and AGENTS.md differ - 1 only in CLAUDE.md')
    expect(agentsMd?.warns?.('lint:agents-md: CLAUDE.md and AGENTS.md match\n')).toBe(false)
    expect(agentsMd?.warns?.('')).toBe(true)
  })

  it.each(['.dependency-cruiser.cjs', 'tsconfig.boundaries.json', 'tsconfig.json'])(
    'runs the boundary check when its configuration %s changes',
    (path) => {
      expect(names(plan(changed(path)))).toContain('boundaries')
    }
  )
})

describe('testEnv', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-sharp-'))
    mkdirSync(join(dir, 'node_modules', 'sharp'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules', 'sharp', 'package.json'),
      JSON.stringify({ version: '9.9.9' })
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const buildAddon = () => {
    const addon = systemSharpAddon(dir, 'x64')
    mkdirSync(join(addon, '..'), { recursive: true })
    writeFileSync(addon, '')
    return addon
  }

  it('locates the addon where the test setup loads it', () => {
    expect(systemSharpAddon(dir, 'x64')).toBe(
      join(dir, '.cache/test-sharp/sharp/src/build/Release/sharp-linux-x64-9.9.9.node')
    )
  })

  it('turns on the system sharp build on Linux when it was built and the variable is unset', () => {
    buildAddon()
    const env = testEnv({}, { cwd: dir, platform: 'linux', arch: 'x64' })
    expect(env.BIRDBRAIN_TEST_SYSTEM_SHARP).toBe('1')
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.BIRDBRAIN_REQUIRE_OPENSSL).toBe('1')
  })

  it('leaves the variable alone when the build is missing, set explicitly, or not on Linux', () => {
    expect(
      testEnv({}, { cwd: dir, platform: 'linux', arch: 'x64' }).BIRDBRAIN_TEST_SYSTEM_SHARP
    ).toBeUndefined()
    buildAddon()
    expect(
      testEnv({ BIRDBRAIN_TEST_SYSTEM_SHARP: '0' }, { cwd: dir, platform: 'linux', arch: 'x64' })
        .BIRDBRAIN_TEST_SYSTEM_SHARP
    ).toBe('0')
    expect(
      testEnv({}, { cwd: dir, platform: 'darwin', arch: 'x64' }).BIRDBRAIN_TEST_SYSTEM_SHARP
    ).toBeUndefined()
  })

  it('returns no addon path when sharp is not installed', () => {
    expect(systemSharpAddon(join(dir, 'missing'), 'x64')).toBeNull()
  })
})

describe('formatSummary', () => {
  it('lists each check with its status, exit code, timing and detail, then what preflight owns', () => {
    const summary = formatSummary({
      base: 'origin/main',
      mergeBase: MERGE_BASE,
      changedCount: 3,
      results: [
        { name: 'lint', scope: '2 files', exitCode: 0, ms: 1200 },
        { name: 'test', scope: 'related to 2 files', exitCode: 1, ms: 4000, detail: '1 failed' },
        { name: 'agents-md', scope: 'advisory', exitCode: 1, ms: 100, advisory: true },
        { name: 'drift', exitCode: 0, ms: 100, advisory: true, warning: true }
      ]
    })
    expect(summary).toContain('check: 4 checks for 3 changed files since origin/main')
    expect(summary).toContain('(merge base 012345678)')
    expect(summary).toMatch(/pass {2}lint \(2 files\) +exit 0 {2}1\.2s/)
    expect(summary).toMatch(/FAIL {2}test \(related to 2 files\) +exit 1 {2}4\.0s {2}1 failed/)
    expect(summary).toMatch(/warn {2}agents-md \(advisory\) +exit 1/)
    expect(summary).toMatch(/warn {2}drift +exit 0/)
    expect(summary).toContain(`left to pnpm preflight: ${LEFT_TO_PREFLIGHT}`)
  })
})

describe('pnpm check', () => {
  const STAND_INS = {
    'bin/pnpm': 'pnpm',
    'node_modules/eslint/bin/eslint.js': 'eslint',
    'node_modules/typescript/bin/tsc': 'tsc',
    'node_modules/electron/cli.js': 'electron'
  }
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

  // The parent Vitest process uses Electron's Node, and check refuses a non-20 Node before
  // running anything, so resolve node from PATH as the preflight CLI tests do.
  const run = (args: string[], overrides: Record<string, string> = {}) =>
    spawnSync('node', [SCRIPT, '--base', 'main', ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...gitEnv, PATH: `${join(repo, 'bin')}:${process.env.PATH}`, ...overrides }
    })

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'check-'))
    git('init', '-q', '-b', 'main')
    // Stand-ins for pnpm and the tool entry points: each records its call, prints SAY and
    // fails when FAIL names the tool or one of its arguments.
    for (const [path, tool] of Object.entries(STAND_INS)) {
      mkdirSync(join(repo, path, '..'), { recursive: true })
      writeFileSync(
        join(repo, path),
        `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = [${JSON.stringify(tool)}, ...process.argv.slice(2)]
appendFileSync('calls.txt', args.join(' ') + '\\n')
if (process.env.SAY) console.log(process.env.SAY)
const failing = (process.env.FAIL || '').split(',').filter(Boolean)
if (failing.some((name) => args.includes(name))) {
  console.log('broken: ' + args.join(' '))
  process.exit(3)
}
`,
        { mode: 0o755 }
      )
    }
    writeFileSync(join(repo, '.gitignore'), 'bin/\nnode_modules/\ncalls.txt\n.preflight/\n')
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ scripts: { typecheck: 'tsc --noEmit -p tsconfig.node.json' } })
    )
    mkdirSync(join(repo, 'src'))
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1\n')
    git('add', '.gitignore', 'package.json', 'src/a.ts')
    git('commit', '-qm', 'init')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('says so and exits 0 when nothing changed', () => {
    const result = run([])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('check: nothing changed since main')
  })

  it('clears an earlier summary before deciding there is nothing to check', () => {
    mkdirSync(join(repo, '.preflight'))
    writeFileSync(join(repo, DEFAULT_OUT), 'stale\n')
    const result = run([])
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(repo, DEFAULT_OUT))).toBe(false)
  })

  it('prints the plan for staged, unstaged and untracked changes without running it', () => {
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2\n')
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 1\n')
    const result = run(['--dry-run'])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('check: 2 changed files; would run:')
    expect(result.stdout).toContain(
      'lint (2 files): node node_modules/eslint/bin/eslint.js --no-warn-ignored src/a.ts src/b.ts'
    )
    expect(result.stdout).toContain(
      'typecheck tsconfig.node.json: node node_modules/typescript/bin/tsc --noEmit -p'
    )
    expect(result.stdout).toContain('test (related to 2 files):')
    expect(result.stdout).toContain('boundaries: pnpm lint:boundaries')
  })

  it('runs every planned check, exits 1 on a failure and writes the summary', () => {
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2\n')
    const result = run([], { FAIL: 'tsc' })
    expect(result.status, result.stderr).toBe(1)
    const calls = readFileSync(join(repo, 'calls.txt'), 'utf8').trim().split('\n').sort()
    expect(calls).toEqual([
      'electron ./node_modules/vitest/vitest.mjs related --run --passWithNoTests src/a.ts',
      'eslint --no-warn-ignored src/a.ts',
      'pnpm lint:boundaries',
      'tsc --noEmit -p tsconfig.node.json'
    ])
    expect(result.stdout).toContain('--- typecheck tsconfig.node.json ---\nbroken: tsc')
    const summary = readFileSync(join(repo, DEFAULT_OUT), 'utf8')
    expect(summary).toMatch(/FAIL {2}typecheck tsconfig\.node\.json +exit 3/)
    expect(summary).toMatch(/pass {2}lint \(1 file\) +exit 0/)
  })

  const changeClaudeMd = () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# x\n')
    mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'hooks', 'vale-prose.sh'), 'exit 0\n')
  }

  it('exits 0 when only an advisory check fails', () => {
    changeClaudeMd()
    const result = run([], { FAIL: 'lint:agents-md' })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(repo, DEFAULT_OUT), 'utf8')).toMatch(/warn {2}agents-md/)
  })

  it('shows agents-md drift as a warning with its output while exiting 0', () => {
    changeClaudeMd()
    const drift = 'lint:agents-md: CLAUDE.md and AGENTS.md differ - 1 only in CLAUDE.md'
    const result = run([], { SAY: drift })
    expect(result.status, result.stderr).toBe(0)
    const summary = readFileSync(join(repo, DEFAULT_OUT), 'utf8')
    expect(summary).toMatch(
      /warn {2}agents-md \(advisory\) +exit 0 .*CLAUDE\.md and AGENTS\.md differ - 1 only/
    )
    expect(summary).toContain(`--- agents-md (advisory) ---\n${drift}`)
  })

  it('rejects an unknown argument', () => {
    const result = run(['--fast'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown argument "--fast"')
  })
})
