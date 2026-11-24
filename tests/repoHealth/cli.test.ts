import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { USAGE, main, parseArgs, repositoryRoot } from '../../scripts/repo-health/cli.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { decodeState } from '../../scripts/repo-health/lib/report.mjs'
import {
  SIGNALS,
  UNEXPECTED_FAILURE,
  collect
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/repo-health/lib/signals.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { Unmeasured } from '../../scripts/repo-health/lib/unmeasured.mjs'
import { ctxOf, type Ctx, type Measurement, type Signal } from './helpers'

const ROOT = join(__dirname, '..', '..')

const signal = (id: string, measure: (ctx: Ctx) => Measurement, budget = 5): Signal => ({
  id,
  family: 'code',
  label: `Signal ${id}`,
  unit: 'count',
  better: 'lower',
  budget,
  why: 'test fixture',
  needs: 'tree',
  measure
})

const tree: Record<string, string> = { 'src/main/a.ts': 'export const a = 1\n' }

const harness = (over: Record<string, unknown> = {}) => {
  const out: string[] = []
  const err: string[] = []
  const appended: { path: string; text: string }[] = []
  const deps = {
    cwd: '/fixture/src/main',
    locate: () => '/fixture',
    env: {} as Record<string, string>,
    gh: null as unknown,
    appendFile: (path: string, text: string) => appended.push({ path, text }),
    signals: [signal('steady', () => ({ value: 3 }))],
    listFiles: () => Object.keys(tree),
    info: () => ({ commit: 'abc1234', dirty: false }),
    read: (path: string) => tree[path],
    knip: () => ({ issues: [] }),
    now: () => new Date('2026-11-23T09:13:00.000Z'),
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    ...over
  }
  return { out, err, appended, deps }
}

const ISSUES = 'repos/o/r/issues?state=open&labels=repo-health&per_page=100'
const PUBLISH_ENV = { GITHUB_REPOSITORY: 'o/r', GITHUB_REPOSITORY_OWNER: 'o' }

// A gh that answers the issue list and records every write.
const recordingGh = (issues: unknown[] | Error = []) => {
  const writes: string[] = []
  const gh = (args: string[]) => {
    if (args[0] === '-X') {
      writes.push(`${args[1]} ${args[2]}`)
      return {}
    }
    if (args[0] !== ISSUES) throw new Error(`gh api ${args[0]} failed (exit 1): Not Found`)
    if (issues instanceof Error) throw issues
    return issues
  }
  return { gh, writes }
}

describe('parseArgs', () => {
  it('prints text unless one other format is asked for', () => {
    expect(parseArgs([])).toEqual({ format: 'text', publish: false })
    expect(parseArgs(['--json'])).toEqual({ format: 'json', publish: false })
    expect(parseArgs(['--markdown'])).toEqual({ format: 'markdown', publish: false })
  })

  it('publishes only when asked, alongside any format', () => {
    expect(parseArgs(['--publish'])).toEqual({ format: 'text', publish: true })
    expect(parseArgs(['--publish', '--json'])).toEqual({ format: 'json', publish: true })
  })

  it('refuses an unknown flag and names the usage', () => {
    expect(() => parseArgs(['--strict'])).toThrow(`unknown argument "--strict"\n${USAGE}`)
  })

  it('refuses two formats at once', () => {
    expect(() => parseArgs(['--json', '--markdown'])).toThrow('choose one output format')
  })
})

describe('collect', () => {
  const ctx = ctxOf(tree)

  it('describes each signal with its value, and leaves the measure function behind', () => {
    const [row] = collect({ signals: [signal('a', () => ({ value: 3, note: 'of 4' }))], ctx })
    expect(row).toEqual({
      id: 'a',
      family: 'code',
      label: 'Signal a',
      unit: 'count',
      better: 'lower',
      budget: 5,
      needs: 'tree',
      value: 3,
      note: 'of 4',
      reason: null
    })
  })

  it('turns a known failure into a missing value with its fixed reason, and logs nothing', () => {
    const logged: string[] = []
    const [row] = collect({
      signals: [
        signal('a', () => {
          throw new Unmeasured('knip is not installed')
        })
      ],
      ctx,
      log: (line: string) => logged.push(line)
    })
    expect(row).toMatchObject({ value: null, note: null, reason: 'knip is not installed' })
    expect(logged).toEqual([])
  })

  it('logs an unexpected failure and publishes only a fixed phrase for it', () => {
    const logged: string[] = []
    const [row] = collect({
      signals: [
        signal('a', () => {
          throw new Error('ENOENT: /home/someone/secret-path')
        })
      ],
      ctx,
      log: (line: string) => logged.push(line)
    })
    expect(row).toMatchObject({ value: null, reason: UNEXPECTED_FAILURE })
    expect(logged).toEqual(['a: ENOENT: /home/someone/secret-path'])
  })

  it('keeps going after a failure, with or without a log', () => {
    const rows = collect({
      signals: [
        signal('broken', () => {
          throw new Error('boom')
        }),
        signal('fine', () => ({ value: 1 }))
      ],
      ctx
    })
    expect(rows.map((row: { value: number | null }) => row.value)).toEqual([null, 1])
  })

  it('does not accept a value that is not a finite number', () => {
    const bad = [undefined, null, '3', Number.NaN, Number.POSITIVE_INFINITY]
    for (const value of bad) {
      const [row] = collect({
        signals: [signal('a', () => ({ value }) as unknown as Measurement)],
        ctx
      })
      expect(row).toMatchObject({ value: null, reason: UNEXPECTED_FAILURE })
    }
  })

  it('gives every registered signal a distinct id and a known shape', () => {
    const ids = SIGNALS.map((entry: Signal) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of SIGNALS as Signal[]) {
      expect(['code', 'dependencies', 'docs', 'tests', 'repository']).toContain(entry.family)
      expect(['count', 'percent']).toContain(entry.unit)
      expect(['lower', 'higher']).toContain(entry.better)
      expect(['tree', 'install', 'gh']).toContain(entry.needs)
      expect(Number.isFinite(entry.budget)).toBe(true)
    }
  })
})

describe('main', () => {
  it('prints the text report and exits 0 when everything is within budget', () => {
    const { out, err, deps } = harness()
    expect(main([], deps)).toBe(0)
    expect(out[0]).toContain('repo-health: commit abc1234, measured 2026-11-23T09:13:00.000Z')
    expect(out[0]).toContain('1 signals: 1 within budget, 0 outside budget, 0 not measured')
    expect(err).toEqual([])
  })

  it('still exits 0 when a signal is outside its budget: the report is advisory', () => {
    const { out, deps } = harness({ signals: [signal('grown', () => ({ value: 9 }))] })
    expect(main([], deps)).toBe(0)
    expect(out[0]).toContain('0 within budget, 1 outside budget')
  })

  it('reports a failing signal as not measured, runs the rest, and logs the cause', () => {
    const { out, err, deps } = harness({
      signals: [
        signal('broken', () => {
          throw new Error('boom')
        }),
        signal('steady', () => ({ value: 3 }))
      ]
    })
    expect(main(['--json'], deps)).toBe(0)
    const report = JSON.parse(out[0])
    expect(report.counts).toEqual({ within: 1, outside: 0, notMeasured: 1 })
    expect(report.signals[0]).toMatchObject({
      id: 'broken',
      value: null,
      status: 'not measured',
      reason: UNEXPECTED_FAILURE
    })
    expect(report.signals[1]).toMatchObject({ id: 'steady', value: 3, status: 'within' })
    expect(err).toEqual(['repo-health: broken: boom'])
  })

  it('hands each signal the tracked paths, the reader, knip and the run date', () => {
    let seen: Ctx | null = null
    const { deps } = harness({
      signals: [
        signal('spy', (ctx) => {
          seen = ctx
          return { value: 0 }
        })
      ]
    })
    main([], deps)
    expect(seen).toMatchObject({
      root: '/fixture',
      paths: ['src/main/a.ts'],
      today: '2026-11-23',
      now: Date.parse('2026-11-23T09:13:00.000Z'),
      gh: null,
      repo: null
    })
    expect(seen!.read('src/main/a.ts')).toBe(tree['src/main/a.ts'])
    expect(seen!.knip()).toEqual({ issues: [] })
  })

  it('prints the issue body with --markdown, ending in a readable state block', () => {
    const { out, deps } = harness()
    expect(main(['--markdown'], deps)).toBe(0)
    expect(out[0]).toContain('| code | Signal steady | 3 | <= 5 | - | no previous value | within |')
    expect(decodeState(out[0]).state.signals).toEqual({ steady: { value: 3, status: 'within' } })
  })

  it('exits 2 on an unknown flag, with the usage and no report', () => {
    const { out, err, deps } = harness()
    expect(main(['--publish-everything'], deps)).toBe(2)
    expect(out).toEqual([])
    expect(err[0]).toContain('repo-health: unknown argument "--publish-everything"')
    expect(err[0]).toContain(USAGE)
  })

  it('exits 2 outside a git repository instead of reporting on nothing', () => {
    const { out, err, deps } = harness({
      info: () => {
        throw new Error('not a git repository')
      }
    })
    expect(main([], deps)).toBe(2)
    expect(out).toEqual([])
    expect(err).toEqual(['repo-health: not a git repository'])
  })

  it('exits 2 when the tracked files cannot be listed', () => {
    const { out, deps } = harness({
      listFiles: () => {
        throw new Error('git ls-files failed')
      }
    })
    expect(main([], deps)).toBe(2)
    expect(out).toEqual([])
  })

  it('exits 2 when the top of the working tree cannot be found', () => {
    const thrown = harness({
      locate: () => {
        throw new Error('fatal: not a git repository')
      }
    })
    expect(main([], thrown.deps)).toBe(2)
    expect(thrown.out).toEqual([])
    expect(thrown.err).toEqual(['repo-health: fatal: not a git repository'])
    const empty = harness({ locate: () => '' })
    expect(main([], empty.deps)).toBe(2)
    expect(empty.err).toEqual(['repo-health: could not find the top of the working tree'])
  })

  it('lists and reads from the top of the tree, not from the folder it was started in', () => {
    const seen: string[] = []
    const { deps } = harness({
      listFiles: (root: string) => {
        seen.push(`list ${root}`)
        return Object.keys(tree)
      },
      info: (root: string) => {
        seen.push(`info ${root}`)
        return { commit: 'abc1234', dirty: false }
      }
    })
    expect(main([], deps)).toBe(0)
    expect(seen).toEqual(['info /fixture', 'list /fixture'])
  })
})

describe('repositoryRoot', () => {
  it('finds the top of this repository from any folder inside it', () => {
    expect(repositoryRoot(ROOT)).toBe(ROOT)
    expect(repositoryRoot(join(ROOT, 'src', 'main'))).toBe(ROOT)
    expect(repositoryRoot(join(ROOT, 'docs', 'plans'))).toBe(ROOT)
  })

  it('throws outside a repository', () => {
    expect(() => repositoryRoot(tmpdir())).toThrow()
  })
})

describe('main on this repository', () => {
  const measure = (cwd: string) => {
    const out: string[] = []
    const code = main(['--json'], {
      cwd,
      env: {},
      gh: null,
      now: () => new Date('2026-11-24T12:00:00.000Z'),
      knip: () => {
        throw new Unmeasured('knip is not installed')
      },
      stdout: (line: string) => out.push(line),
      stderr: () => {}
    })
    return { code, report: JSON.parse(out[0]) }
  }

  it('measures every tree signal, with knip reported as not installed', () => {
    const { code, report } = measure(ROOT)
    expect(code).toBe(0)
    expect(report.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(report.signals.length).toBe(SIGNALS.length)
    for (const row of report.signals) {
      if (row.needs === 'tree') {
        expect(row.reason, row.id).toBeNull()
        expect(Number.isInteger(row.value), row.id).toBe(true)
      } else {
        expect(row, row.id).toMatchObject({
          value: null,
          status: 'not measured',
          reason: row.needs === 'gh' ? 'no gh token' : 'knip is not installed'
        })
      }
    }
  })

  // Run from a sub-folder, `git ls-files` lists that folder only. A report taken
  // there once showed zero skipped tests and one broken link as within budget.
  it.each(['src', 'docs', 'tests/repoHealth'])(
    'reports the same numbers from %s as from the top level',
    (folder) => {
      const top = measure(ROOT).report
      const inside = measure(join(ROOT, ...folder.split('/'))).report
      expect(inside.signals).toEqual(top.signals)
      expect(inside.counts).toEqual(top.counts)
    }
  )
})

describe('main under the workflow', () => {
  it('passes the repository and a gh to the signals when the environment has them', () => {
    let seen: Ctx | null = null
    const { gh } = recordingGh()
    const { deps } = harness({
      env: PUBLISH_ENV,
      gh,
      signals: [
        signal('spy', (ctx) => {
          seen = ctx
          return { value: 0 }
        })
      ]
    })
    main([], deps)
    expect(seen).toMatchObject({ repo: 'o/r', gh })
  })

  it('prints a warning annotation for each signal that is not within budget', () => {
    const { out, deps } = harness({
      env: { GITHUB_ACTIONS: 'true' },
      signals: [
        signal('grown', () => ({ value: 9 })),
        signal('steady', () => ({ value: 3 })),
        signal('lost', () => {
          throw new Unmeasured('knip is not installed')
        })
      ]
    })
    expect(main([], deps)).toBe(0)
    expect(out.slice(1)).toEqual([
      '::warning title=Repository health::Signal grown: outside',
      '::warning title=Repository health::Signal lost: not measured'
    ])
  })

  it('prints no annotation outside the workflow', () => {
    const { out, deps } = harness({ signals: [signal('grown', () => ({ value: 9 }))] })
    main([], deps)
    expect(out).toHaveLength(1)
  })

  it('appends the report to the step summary when there is one, and not otherwise', () => {
    const { appended, deps } = harness({ env: { GITHUB_STEP_SUMMARY: '/tmp/summary.md' } })
    expect(main([], deps)).toBe(0)
    expect(appended).toHaveLength(1)
    expect(appended[0].path).toBe('/tmp/summary.md')
    expect(appended[0].text).toContain('| code | Signal steady | 3 | <= 5 |')
    const none = harness()
    main([], none.deps)
    expect(none.appended).toEqual([])
  })
})

describe('main --publish', () => {
  it('does a dry run unless DRY_RUN is exactly false, and says what it would write', () => {
    for (const DRY_RUN of [undefined, 'true', 'FALSE', '0']) {
      const { gh, writes } = recordingGh()
      const env = DRY_RUN === undefined ? PUBLISH_ENV : { ...PUBLISH_ENV, DRY_RUN }
      const { err, deps } = harness({ env, gh })
      expect(main(['--publish'], deps)).toBe(0)
      expect(writes).toEqual([])
      expect(err).toContain('repo-health: would open the repo-health issue')
      expect(err).toContain('repo-health: dry run: nothing was written (DRY_RUN is not "false")')
    }
  })

  it('writes with DRY_RUN=false and says what it did', () => {
    const { gh, writes } = recordingGh()
    const { err, deps } = harness({ env: { ...PUBLISH_ENV, DRY_RUN: 'false' }, gh })
    expect(main(['--publish'], deps)).toBe(0)
    expect(writes).toEqual(['POST repos/o/r/labels', 'POST repos/o/r/issues'])
    expect(err).toEqual([
      'repo-health: did create the repo-health label',
      'repo-health: did open the repo-health issue'
    ])
  })

  it('compares with the open issue in what it prints, and names a duplicate', () => {
    const { gh } = recordingGh([
      { number: 50, body: 'duplicate' },
      {
        number: 41,
        body:
          '<!-- repo-health-state:v1\n' +
          '{"schemaVersion":1,"measuredAt":"2026-11-16T09:13:00.000Z","commit":"x",' +
          '"signals":{"steady":{"value":5,"status":"within"}}}\n-->'
      }
    ])
    const { out, err, appended, deps } = harness({
      env: {
        ...PUBLISH_ENV,
        DRY_RUN: 'false',
        GITHUB_STEP_SUMMARY: '/tmp/s.md',
        RUN_URL: 'https://x/1'
      },
      gh
    })
    expect(main(['--publish'], deps)).toBe(0)
    expect(out[0]).toContain('[better by 2]')
    expect(err).toContain(
      'repo-health: more than one open repo-health issue; used #41, ignored #50'
    )
    expect(appended[0].text).toContain('Compared with: the run of 2026-11-16T09:13:00.000Z')
    expect(appended[0].text).toContain('Run: https://x/1')
    expect(appended[0].text).toContain('- did rewrite issue #41')
  })

  it('prints the published body with --markdown, and plain JSON with --json', () => {
    const first = recordingGh()
    const markdown = harness({ env: { ...PUBLISH_ENV, RUN_URL: 'https://x/1' }, gh: first.gh })
    expect(main(['--publish', '--markdown'], markdown.deps)).toBe(0)
    expect(markdown.out[0]).toContain('Run: https://x/1')
    const second = recordingGh()
    const json = harness({ env: PUBLISH_ENV, gh: second.gh })
    expect(main(['--publish', '--json'], json.deps)).toBe(0)
    expect(JSON.parse(json.out[0]).signals[0].id).toBe('steady')
  })

  it('exits 2 without a token or without a repository, and prints no report', () => {
    const noToken = harness({ env: PUBLISH_ENV, gh: null })
    expect(main(['--publish'], noToken.deps)).toBe(2)
    expect(noToken.out).toEqual([])
    expect(noToken.err[0]).toContain('--publish needs GH_TOKEN (or GITHUB_TOKEN)')
    const noRepo = harness({ env: {}, gh: recordingGh().gh })
    expect(main(['--publish'], noRepo.deps)).toBe(2)
    expect(noRepo.out).toEqual([])
  })

  it('exits 2 when the issue list cannot be read, so the run goes red', () => {
    const { gh, writes } = recordingGh(new Error('gh api issues failed (exit 1): HTTP 502'))
    const { out, err, deps } = harness({ env: { ...PUBLISH_ENV, DRY_RUN: 'false' }, gh })
    expect(main(['--publish'], deps)).toBe(2)
    expect(out).toEqual([])
    expect(writes).toEqual([])
    expect(err).toEqual(['repo-health: could not publish: gh api issues failed (exit 1): HTTP 502'])
  })
})
