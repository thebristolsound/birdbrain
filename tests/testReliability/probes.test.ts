import { describe, expect, it } from 'vitest'
import {
  mutationProbe,
  revertProbe
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/test-reliability/lib/probes.mjs'

type TestResult = { fullName: string; status: string; line: number | null }
type FileResult = { path: string; tests: TestResult[] }
type RunArgs = { mode: string; files: string[]; bail?: boolean; timeoutMs?: number }
type RunResult = {
  ok: boolean
  timedOut?: boolean
  durationMs?: number
  output?: string
  report: { success: boolean; files: FileResult[] } | null
}

// A workspace that records edits in memory, so a probe's view of the tree can be checked at
// the moment it runs the tests.
const memoryWorkspace = (files: Record<string, string>) => {
  const tree = new Map(Object.entries(files))
  const originals = new Map<string, string | undefined>()
  const remember = (path: string) => {
    if (!originals.has(path)) originals.set(path, tree.get(path))
  }
  return {
    tree,
    restores: 0,
    write(path: string, content: string) {
      remember(path)
      tree.set(path, content)
    },
    remove(path: string) {
      remember(path)
      tree.delete(path)
    },
    restore() {
      for (const [path, content] of originals) {
        if (content === undefined) tree.delete(path)
        else tree.set(path, content)
      }
      originals.clear()
      this.restores++
    }
  }
}

const TEST_FILE = [
  "it('pins the change', () => {", // 1
  '  expect(f()).toBe(1)', // 2
  '})', // 3
  "it('was here before', () => {", // 4
  '  expect(true).toBe(true)', // 5
  '})', // 6
  "it('passes regardless', () => {", // 7
  '  expect(1).toBe(1)', // 8
  '})' // 9
].join('\n')

const changes = (overrides = {}) => ({
  base: 'base',
  sources: [
    { path: 'src/a.ts', status: 'M', addedLines: new Set([1]) },
    { path: 'src/new.ts', status: 'A', addedLines: new Set([1]) }
  ],
  unitTests: [{ path: 'tests/a.test.ts', status: 'M', addedLines: new Set([2, 8]) }],
  e2e: [],
  ...overrides
})

const result = (tests: TestResult[], ok = true): RunResult => ({
  ok,
  durationMs: 100,
  report: { success: ok, files: [{ path: 'tests/a.test.ts', tests }] }
})

describe('revertProbe', () => {
  const head = [
    { fullName: 'pins the change', status: 'passed', line: 1 },
    { fullName: 'was here before', status: 'passed', line: 4 },
    { fullName: 'passes regardless', status: 'passed', line: 7 }
  ]

  it('reports the touched tests that still pass with the source changes reverted', async () => {
    const workspace = memoryWorkspace({
      'src/a.ts': 'head a',
      'src/new.ts': 'head new',
      'tests/a.test.ts': TEST_FILE
    })
    const seen: Record<string, string | undefined>[] = []
    const run = async ({ files }: RunArgs) => {
      expect(files).toEqual(['tests/a.test.ts'])
      seen.push({ a: workspace.tree.get('src/a.ts'), added: workspace.tree.get('src/new.ts') })
      if (seen.length === 1) return result(head)
      return result(
        [
          { fullName: 'pins the change', status: 'failed', line: 1 },
          { fullName: 'was here before', status: 'passed', line: 4 },
          { fullName: 'passes regardless', status: 'passed', line: 7 }
        ],
        false
      )
    }
    const outcome = await revertProbe({
      changes: changes(),
      read: (path: string) => workspace.tree.get(path),
      readBase: (path: string) => `base of ${path}`,
      workspace,
      run
    })
    expect(seen).toEqual([
      { a: 'head a', added: 'head new' },
      { a: 'base of src/a.ts', added: undefined }
    ])
    expect(workspace.tree.get('src/a.ts')).toBe('head a')
    expect(workspace.tree.get('src/new.ts')).toBe('head new')
    expect(outcome).toEqual({
      sourcesReverted: 2,
      testsChecked: 2,
      failingAtHead: 0,
      findings: [{ path: 'tests/a.test.ts', fullName: 'passes regardless', line: 7 }]
    })
  })

  it('counts a touched test that fails at HEAD without judging it', async () => {
    const workspace = memoryWorkspace({ 'tests/a.test.ts': TEST_FILE })
    const failingHead = [
      { fullName: 'pins the change', status: 'failed', line: 1 },
      { fullName: 'passes regardless', status: 'passed', line: 7 },
      { fullName: 'unlocated', status: 'passed', line: null }
    ]
    const run = async (): Promise<RunResult> => {
      const failing = result(failingHead, false)
      failing.report!.files.push({
        path: 'tests/other.test.ts',
        tests: [{ fullName: 'pins the change', status: 'passed', line: 1 }]
      })
      return failing
    }
    const outcome = await revertProbe({
      changes: changes({ sources: [{ path: 'src/a.ts', status: 'D', addedLines: new Set() }] }),
      read: (path: string) => workspace.tree.get(path),
      readBase: () => 'base',
      workspace,
      run
    })
    expect(outcome.failingAtHead).toBe(1)
    expect(outcome.testsChecked).toBe(1)
    expect(workspace.tree.has('src/a.ts')).toBe(false)
  })

  it('finds nothing when the reverted test files no longer load', async () => {
    const workspace = memoryWorkspace({ 'tests/a.test.ts': TEST_FILE })
    let calls = 0
    const run = async (): Promise<RunResult> =>
      ++calls === 1 ? result(head) : { ok: false, report: null }
    const outcome = await revertProbe({
      changes: changes(),
      read: (path: string) => workspace.tree.get(path),
      readBase: () => 'base',
      workspace,
      run
    })
    expect(outcome.findings).toEqual([])
  })

  it('restores the tree when the reverted run throws', async () => {
    const workspace = memoryWorkspace({ 'src/a.ts': 'head a', 'tests/a.test.ts': TEST_FILE })
    let calls = 0
    const run = async () => {
      if (++calls === 2) throw new Error('runner crashed')
      return result(head)
    }
    await expect(
      revertProbe({
        changes: changes(),
        read: (path: string) => workspace.tree.get(path),
        readBase: () => 'base',
        workspace,
        run
      })
    ).rejects.toThrow('runner crashed')
    expect(workspace.tree.get('src/a.ts')).toBe('head a')
  })

  it('stops when the tests write no report at HEAD', async () => {
    const workspace = memoryWorkspace({ 'tests/a.test.ts': TEST_FILE })
    await expect(
      revertProbe({
        changes: changes(),
        read: (path: string) => workspace.tree.get(path),
        readBase: () => 'base',
        workspace,
        run: async () => ({ ok: false, report: null, output: 'cannot find electron' })
      })
    ).rejects.toThrow(/no report at HEAD:\ncannot find electron/)
  })

  it('skips a branch with no source change, and one with no touched unit test', async () => {
    const run = async () => {
      throw new Error('must not run')
    }
    const base = { read: () => TEST_FILE, readBase: () => '', workspace: memoryWorkspace({}), run }
    expect(await revertProbe({ ...base, changes: changes({ sources: [] }) })).toEqual({
      skipped: 'the branch changes no source file the unit tests can import'
    })
    const untouched = changes({
      unitTests: [
        { path: 'tests/a.test.ts', status: 'M', addedLines: new Set([10]) },
        { path: 'tests/gone.test.ts', status: 'D', addedLines: new Set() }
      ]
    })
    expect(await revertProbe({ ...base, changes: untouched })).toEqual({
      skipped: 'the branch adds or edits no unit test'
    })
  })
})

describe('mutationProbe', () => {
  const SOURCE = 'export const f = (a, b) => a === b\nexport const g = (a) => !a\n'

  const sourceChanges = (sources: unknown[]) => changes({ sources, unitTests: [] })

  it('runs each mutant against the related tests and sorts the outcomes', async () => {
    const workspace = memoryWorkspace({ 'src/a.ts': SOURCE })
    const runs: RunArgs[] = []
    const run = async (args: RunArgs): Promise<RunResult> => {
      runs.push(args)
      if (args.mode === 'related') return { ...result([]), durationMs: 30_000 }
      const text = workspace.tree.get('src/a.ts')!
      if (text.includes('a !== b')) return result([], false)
      if (text.includes('=> a\n')) return { ...result([]), ok: false, timedOut: true }
      return result([])
    }
    const outcome = await mutationProbe({
      changes: sourceChanges([
        { path: 'src/a.ts', status: 'M', addedLines: new Set([1, 2]) },
        { path: 'src/gone.ts', status: 'D', addedLines: new Set() }
      ]),
      read: (path: string) => workspace.tree.get(path),
      workspace,
      run,
      maxMutants: 10,
      budgetMs: 60_000,
      now: () => 0
    })
    expect(runs[0]).toEqual({ mode: 'related', files: ['src/a.ts'] })
    expect(runs.slice(1).every((args) => args.bail && args.timeoutMs === 90_000)).toBe(true)
    expect(runs[1].files).toEqual(['tests/a.test.ts'])
    expect(outcome.candidates).toBe(2)
    expect(outcome.selected).toBe(2)
    expect(
      outcome.results.map(
        ({ replacement, outcome: o }: { replacement: string; outcome: string }) => [replacement, o]
      )
    ).toEqual([
      ['!==', 'killed'],
      ['a', 'timeout']
    ])
    expect(outcome.files).toEqual([
      { path: 'src/a.ts', outcome: 'probed', tests: ['tests/a.test.ts'] }
    ])
    expect(workspace.tree.get('src/a.ts')).toBe(SOURCE)
  })

  it('reports a mutant every test survives', async () => {
    const workspace = memoryWorkspace({ 'src/a.ts': SOURCE })
    const outcome = await mutationProbe({
      changes: sourceChanges([{ path: 'src/a.ts', status: 'M', addedLines: new Set([1]) }]),
      read: (path: string) => workspace.tree.get(path),
      workspace,
      run: async () => result([]),
      maxMutants: 10,
      budgetMs: 60_000,
      minTimeoutMs: 1000
    })
    expect(outcome.results).toMatchObject([{ line: 1, outcome: 'survived', tests: 1 }])
  })

  it('skips a file whose related tests are red or missing', async () => {
    const workspace = memoryWorkspace({ 'src/red.ts': SOURCE, 'src/lonely.ts': SOURCE })
    const run = async ({ files }: RunArgs): Promise<RunResult> =>
      files[0] === 'src/red.ts'
        ? result([], false)
        : { ok: true, report: { success: true, files: [] } }
    const outcome = await mutationProbe({
      changes: sourceChanges([
        { path: 'src/red.ts', status: 'M', addedLines: new Set([1]) },
        { path: 'src/lonely.ts', status: 'A', addedLines: new Set([1]) }
      ]),
      read: (path: string) => workspace.tree.get(path),
      workspace,
      run,
      maxMutants: 10,
      budgetMs: 60_000
    })
    expect(outcome.files).toEqual([
      { path: 'src/red.ts', outcome: 'red-baseline', tests: ['tests/a.test.ts'] },
      { path: 'src/lonely.ts', outcome: 'no-tests', tests: [] }
    ])
    expect(outcome.results.map(({ outcome: o }: { outcome: string }) => o)).toEqual([
      'skipped',
      'no-tests'
    ])
  })

  it('treats a baseline with no report as red', async () => {
    const workspace = memoryWorkspace({ 'src/a.ts': SOURCE })
    const outcome = await mutationProbe({
      changes: sourceChanges([{ path: 'src/a.ts', status: 'M', addedLines: new Set([1]) }]),
      read: (path: string) => workspace.tree.get(path),
      workspace,
      run: async () => ({ ok: false, report: null }),
      maxMutants: 10,
      budgetMs: 60_000
    })
    expect(outcome.files).toEqual([{ path: 'src/a.ts', outcome: 'red-baseline', tests: [] }])
  })

  it('stops starting mutants once the budget is spent', async () => {
    const workspace = memoryWorkspace({ 'src/a.ts': SOURCE, 'src/b.ts': SOURCE })
    let clock = 0
    const run = async (args: RunArgs) => {
      clock += args.mode === 'related' ? 10 : 100
      return result([])
    }
    const outcome = await mutationProbe({
      changes: sourceChanges([
        { path: 'src/a.ts', status: 'M', addedLines: new Set([1, 2]) },
        { path: 'src/b.ts', status: 'M', addedLines: new Set([1]) }
      ]),
      read: (path: string) => workspace.tree.get(path),
      workspace,
      run,
      maxMutants: 10,
      budgetMs: 50,
      now: () => clock
    })
    expect(
      outcome.results.map(({ path, outcome: o }: { path: string; outcome: string }) => [path, o])
    ).toEqual([
      ['src/a.ts', 'survived'],
      ['src/a.ts', 'not-run'],
      ['src/b.ts', 'not-run']
    ])
    expect(outcome.files.map(({ outcome: o }: { outcome: string }) => o)).toEqual([
      'probed',
      'budget'
    ])
  })

  it('restores the file when a mutant run throws', async () => {
    const workspace = memoryWorkspace({ 'src/a.ts': SOURCE })
    const run = async (args: RunArgs) => {
      if (args.mode === 'run') throw new Error('runner crashed')
      return result([])
    }
    await expect(
      mutationProbe({
        changes: sourceChanges([{ path: 'src/a.ts', status: 'M', addedLines: new Set([1]) }]),
        read: (path: string) => workspace.tree.get(path),
        workspace,
        run,
        maxMutants: 10,
        budgetMs: 60_000
      })
    ).rejects.toThrow('runner crashed')
    expect(workspace.tree.get('src/a.ts')).toBe(SOURCE)
  })
})
