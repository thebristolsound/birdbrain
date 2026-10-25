import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  USAGE,
  guardSignals,
  main,
  parseArgs
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/test-reliability/cli.mjs'

describe('parseArgs', () => {
  it('defaults to origin/main with both probes on', () => {
    expect(parseArgs([])).toEqual({
      base: 'origin/main',
      maxMutants: 40,
      budgetSeconds: 900,
      revert: true,
      mutate: true,
      json: false,
      summary: null,
      annotations: false
    })
  })

  it('reads every flag', () => {
    expect(
      parseArgs([
        '--base',
        'origin/release',
        '--max-mutants',
        '5',
        '--budget',
        '60',
        '--no-revert',
        '--no-mutate',
        '--json',
        '--summary',
        '/tmp/summary.md',
        '--annotations'
      ])
    ).toEqual({
      base: 'origin/release',
      maxMutants: 5,
      budgetSeconds: 60,
      revert: false,
      mutate: false,
      json: true,
      summary: '/tmp/summary.md',
      annotations: true
    })
  })

  it('refuses a missing value, a bad number and an unknown flag', () => {
    expect(() => parseArgs(['--base'])).toThrow('--base needs a value')
    expect(() => parseArgs(['--summary', '--json'])).toThrow('--summary needs a value')
    expect(parseArgs(['--max-mutants', '1']).maxMutants).toBe(1)
    expect(() => parseArgs(['--max-mutants', '0'])).toThrow(/positive whole number, got "0"/)
    expect(() => parseArgs(['--budget', '1.5'])).toThrow(/positive whole number, got "1.5"/)
    expect(() => parseArgs(['--fast'])).toThrow(`unknown argument "--fast"\n${USAGE}`)
  })
})

describe('guardSignals', () => {
  it('stops the test run, restores the files and exits with the signal code', () => {
    const handlers = new Map<string, () => void>()
    const order: string[] = []
    guardSignals({
      workspace: { restore: () => order.push('restore') },
      runner: { stop: () => order.push('stop') },
      on: (signal: string, handler: () => void) => handlers.set(signal, handler),
      exit: (code: number) => order.push(`exit ${code}`)
    })
    handlers.get('SIGINT')!()
    handlers.get('SIGTERM')!()
    expect(order).toEqual(['stop', 'restore', 'exit 130', 'stop', 'restore', 'exit 143'])
  })
})

describe('main', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'test-reliability-cli-'))
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'tests'))
    writeFileSync(join(root, 'src/a.ts'), 'export const f = (a, b) => a === b\n')
    writeFileSync(
      join(root, 'tests/a.test.ts'),
      "it('compares', () => {\n  expect(f(1, 1)).toBe(true)\n})\n"
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const fakeGit =
    (overrides: Record<string, string> = {}) =>
    (args: string[]) => {
      const [command] = args
      if (command === 'status') return overrides.status ?? ''
      if (command === 'merge-base') return 'base\n'
      if (command === 'rev-parse') return 'head\n'
      if (command === 'show') return 'export const f = () => false\n'
      if (args.includes('--name-status'))
        return 'M\0src/a.ts\0M\0tests/a.test.ts\0A\0e2e/a.spec.ts\0'
      return ['+++ b/src/a.ts', '@@ -1 +1 @@', '+++ b/tests/a.test.ts', '@@ -2 +2 @@'].join('\n')
    }

  const passingRunner = () => ({
    run: vi.fn(async () => ({
      ok: true,
      durationMs: 10,
      report: {
        success: true,
        files: [
          { path: 'tests/a.test.ts', tests: [{ fullName: 'compares', status: 'passed', line: 1 }] }
        ]
      }
    })),
    stop: vi.fn()
  })

  const deps = (overrides = {}) => {
    const out: string[] = []
    const err: string[] = []
    const appended: [string, string][] = []
    return {
      out,
      err,
      appended,
      deps: {
        root,
        git: fakeGit(),
        runner: passingRunner(),
        onSignals: vi.fn(),
        append: (path: string, text: string) => appended.push([path, text]),
        stdout: (line: string) => out.push(line),
        stderr: (line: string) => err.push(line),
        ...overrides
      }
    }
  }

  it('runs both probes and prints the summary', async () => {
    const { out, deps: d } = deps()
    expect(await main(['--annotations'], d)).toBe(0)
    expect(d.onSignals).toHaveBeenCalledOnce()
    const [markdown, ...annotations] = out
    expect(markdown).toContain('Commit `head`, merge base `base`.')
    expect(markdown).toContain('1 still pass without the change.')
    expect(markdown).toContain('1 survived')
    expect(markdown).toContain('Not probed: `e2e/a.spec.ts`.')
    expect(annotations).toHaveLength(2)
  })

  it('appends the summary to a file and prints JSON when asked', async () => {
    const { out, appended, deps: d } = deps()
    expect(await main(['--json', '--summary', 'summary.md', '--no-mutate'], d)).toBe(0)
    const parsed = JSON.parse(out[0])
    expect(parsed).toMatchObject({ commit: 'head', base: 'base', mutation: null })
    expect(parsed.e2e[0].addedLines).toEqual([])
    expect(appended).toHaveLength(1)
    expect(appended[0][0]).toBe('summary.md')
    expect(appended[0][1]).toContain('## Test reliability probe')
  })

  it('reads --budget in seconds', async () => {
    let clock = 0
    const { out, deps: d } = deps({ now: () => (clock += 400) })
    expect(await main(['--budget', '1', '--no-revert'], d)).toBe(0)
    expect(out[0]).toContain('1 survived')
    expect(out[0]).toContain('0 not run for time')
  })

  it('skips the revert probe when told to', async () => {
    const { out, deps: d } = deps()
    expect(await main(['--no-revert'], d)).toBe(0)
    expect(out[0]).toContain('Not run (`--no-revert`).')
  })

  it('refuses a dirty tree before editing anything', async () => {
    const { err, deps: d } = deps({ git: fakeGit({ status: ' M src/a.ts\n' }) })
    expect(await main([], d)).toBe(2)
    expect(err[0]).toMatch(/uncommitted changes/)
    expect(d.runner.run).not.toHaveBeenCalled()
  })

  it('refuses to start while an earlier run left its journal', async () => {
    mkdirSync(join(root, '.cache/test-reliability'), { recursive: true })
    writeFileSync(
      join(root, '.cache/test-reliability/journal.json'),
      JSON.stringify({ paths: ['src/a.ts'] })
    )
    const { err, deps: d } = deps()
    expect(await main([], d)).toBe(2)
    expect(err[0]).toMatch(/an earlier run stopped with edited files in place: src\/a\.ts/)
  })

  it('reports an argument error with exit code 2', async () => {
    const { err, deps: d } = deps()
    expect(await main(['--nope'], d)).toBe(2)
    expect(err[0]).toMatch(/^test-reliability: unknown argument "--nope"/)
  })
})
