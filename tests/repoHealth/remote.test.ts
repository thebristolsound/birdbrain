import { describe, expect, it } from 'vitest'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { createGh, hasToken } from '../../scripts/repo-health/lib/gh.mjs'
import {
  KEPT_BRANCHES,
  REMOTE_DEPENDENCY_SIGNALS,
  REMOTE_REPOSITORY_SIGNALS,
  REMOTE_TEST_SIGNALS,
  badgeCoverage,
  redRuns,
  staleBranches,
  staleDependabotPulls
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/repo-health/lib/remote.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { Unmeasured } from '../../scripts/repo-health/lib/unmeasured.mjs'
import { signalOf, type Signal } from './helpers'

const NOW = Date.parse('2026-11-23T09:13:00Z')
const DAY = 86_400_000
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString()

const REMOTE: Signal[] = [
  ...REMOTE_DEPENDENCY_SIGNALS,
  ...REMOTE_TEST_SIGNALS,
  ...REMOTE_REPOSITORY_SIGNALS
]

type Gh = (args: string[]) => unknown

const ctxOf = (gh: Gh | null, over: Record<string, unknown> = {}) => {
  const logged: string[] = []
  const calls: string[][] = []
  const ctx = {
    gh: gh
      ? (args: string[]) => {
          calls.push(args)
          return gh(args)
        }
      : null,
    repo: 'o/r',
    now: NOW,
    log: (line: string) => logged.push(line),
    ...over
  }
  return { ctx, logged, calls }
}

const measure = (id: string, ctx: unknown) =>
  (signalOf(REMOTE, id).measure as (ctx: unknown) => unknown)(ctx)

const badgeFile = (badge: unknown) => ({
  content: Buffer.from(typeof badge === 'string' ? badge : JSON.stringify(badge)).toString('base64')
})
const BADGE = { schemaVersion: 1, label: 'coverage', message: '95.93%', color: 'brightgreen' }
const badgeCommit = (days: number) => [{ commit: { committer: { date: daysAgo(days) } } }]

const branch = (name: string, days: number, openPulls = 0) => ({
  name,
  target: { committedDate: daysAgo(days) },
  associatedPullRequests: { totalCount: openPulls }
})

describe('hasToken', () => {
  it('is true with either token name and false with neither or an empty one', () => {
    expect(hasToken({ GH_TOKEN: 'x' })).toBe(true)
    expect(hasToken({ GITHUB_TOKEN: 'x' })).toBe(true)
    expect(hasToken({})).toBe(false)
    expect(hasToken({ GH_TOKEN: '' })).toBe(false)
  })
})

describe('createGh', () => {
  type Call = {
    command: string
    args: string[]
    options: { input?: string; env: unknown; timeout?: number }
  }
  const fake = (result: Record<string, unknown>) => {
    const calls: Call[] = []
    const gh = createGh({
      env: { GH_TOKEN: 'x' },
      spawn: (command: string, args: string[], options: Call['options']) => {
        calls.push({ command, args, options })
        return { status: 0, stdout: '{}', stderr: '', ...result }
      }
    })
    return { gh, calls }
  }

  it('runs `gh api` with the arguments and parses the JSON it prints', () => {
    const { gh, calls } = fake({ stdout: '{"number":7}' })
    expect(gh(['repos/o/r/issues/7'])).toEqual({ number: 7 })
    expect(calls[0].command).toBe('gh')
    expect(calls[0].args).toEqual(['api', 'repos/o/r/issues/7'])
    expect(calls[0].options.env).toEqual({ GH_TOKEN: 'x' })
  })

  it('sends a write payload on standard input, never on the command line', () => {
    const { gh, calls } = fake({})
    gh(['-X', 'POST', 'repos/o/r/issues', '--input', '-'], '{"title":"t"}')
    expect(calls[0].options.input).toBe('{"title":"t"}')
    expect(calls[0].args.join(' ')).not.toContain('title')
  })

  it('throws on a failed call, naming the endpoint and the first error line', () => {
    const { gh } = fake({ status: 1, stderr: 'gh: Not Found (HTTP 404)\nmore' })
    expect(() => gh(['repos/o/r/labels/x'])).toThrow(
      'gh api repos/o/r/labels/x failed (exit 1): gh: Not Found (HTTP 404)'
    )
  })

  it('throws when gh cannot be started or prints no JSON', () => {
    expect(() => fake({ error: new Error('ENOENT') }).gh(['x'])).toThrow(
      'gh could not be started: ENOENT'
    )
    expect(() => fake({ stdout: '' }).gh(['repos/o/r'])).toThrow('gh api repos/o/r printed no JSON')
    expect(() => fake({ status: 1, stderr: undefined }).gh(['--paginate'])).toThrow(
      'gh api api failed (exit 1): '
    )
  })

  it('gives each call a minute, and names the call that ran out of time', () => {
    const timedOut = Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' })
    const { gh, calls } = fake({ error: timedOut })
    expect(() => gh(['repos/o/r/pulls'])).toThrow(
      'gh api repos/o/r/pulls did not finish in 60 seconds'
    )
    expect(calls[0].options.timeout).toBe(60_000)
  })

  it('names the endpoint of a write that fails or runs out of time, not its method', () => {
    const write = ['-X', 'PATCH', 'repos/o/r/issues/41', '--input', '-']
    expect(() => fake({ status: 1, stderr: 'HTTP 502' }).gh(write, '{}')).toThrow(
      'gh api repos/o/r/issues/41 failed (exit 1): HTTP 502'
    )
    const timedOut = Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' })
    const comment = ['-X', 'POST', 'repos/o/r/issues/41/comments', '--input', '-']
    expect(() => fake({ error: timedOut }).gh(comment, '{}')).toThrow(
      'gh api repos/o/r/issues/41/comments did not finish in 60 seconds'
    )
    const query = ['graphql', '-f', 'query=x', '-f', 'owner=o']
    expect(() => fake({ stdout: '' }).gh(query)).toThrow('gh api graphql printed no JSON')
    expect(() => fake({ stdout: '' }).gh(['--paginate', '--slurp', 'repos/o/r/pulls'])).toThrow(
      'gh api repos/o/r/pulls printed no JSON'
    )
  })

  it('defaults to the real spawn and the process environment', () => {
    expect(typeof createGh()).toBe('function')
  })
})

describe('reading GitHub', () => {
  it('is not measured without a token, for every remote signal, and asks nothing', () => {
    const { ctx } = ctxOf(null)
    for (const signal of REMOTE) {
      expect(signal.needs).toBe('gh')
      expect(() => measure(signal.id, ctx)).toThrow(Unmeasured)
      expect(() => measure(signal.id, ctx)).toThrow('no gh token')
    }
  })

  it('is not measured without a repository to ask about', () => {
    const { ctx, calls } = ctxOf(() => [], { repo: null })
    for (const signal of REMOTE) {
      expect(() => measure(signal.id, ctx)).toThrow('GITHUB_REPOSITORY is not set')
    }
    expect(calls).toEqual([])
  })

  it('logs a failed read in full and publishes one fixed phrase for it', () => {
    const { ctx, logged } = ctxOf(() => {
      throw new Error('gh api repos/o/r/pulls failed (exit 1): HTTP 502 from 10.0.0.7')
    })
    for (const signal of REMOTE) {
      expect(() => measure(signal.id, ctx)).toThrow('GitHub could not be read; see the run log')
    }
    expect(logged).toHaveLength(REMOTE.length)
    expect(logged[0]).toContain('HTTP 502 from 10.0.0.7')
  })

  it('still reads when the context has no log', () => {
    const { ctx } = ctxOf(
      () => {
        throw new Error('boom')
      },
      { log: undefined }
    )
    expect(() => measure('stale-dependabot-pulls', ctx)).toThrow(Unmeasured)
  })
})

describe('Dependabot pull requests', () => {
  const pull = (login: string, days: number) => ({ user: { login }, created_at: daysAgo(days) })

  it('counts the ones open over 14 days, across pages, by Dependabot only', () => {
    const pages = [
      [pull('dependabot[bot]', 15), pull('dependabot[bot]', 3), pull('thebristolsound', 90)],
      [pull('dependabot[bot]', 40), pull('birdbrain-agent', 20)]
    ]
    expect(staleDependabotPulls(pages, NOW)).toEqual({
      value: 2,
      note: 'of 3 open Dependabot pull request(s)'
    })
  })

  it('does not count one at exactly 14 days, and counts one just past it', () => {
    expect(staleDependabotPulls([[pull('dependabot[bot]', 14)]], NOW).value).toBe(0)
    expect(staleDependabotPulls([[pull('dependabot[bot]', 14.01)]], NOW).value).toBe(1)
  })

  it('reads an empty list as none open, which is a measurement', () => {
    expect(staleDependabotPulls([[]], NOW)).toEqual({
      value: 0,
      note: 'of 0 open Dependabot pull request(s)'
    })
  })

  it('is not measured when the response is not a list of pages or a date is unreadable', () => {
    for (const bad of [null, {}, [{}], 'x']) {
      expect(() => staleDependabotPulls(bad, NOW)).toThrow('GitHub returned no pull request list')
    }
    const undated = [[{ user: { login: 'dependabot[bot]' }, created_at: 'soon' }]]
    expect(() => staleDependabotPulls(undated, NOW)).toThrow(
      'GitHub returned a date that could not be read'
    )
  })

  it('is not measured when no page was read or a pull request has no author', () => {
    expect(() => staleDependabotPulls([], NOW)).toThrow('GitHub returned no pull request list')
    for (const pull of [{}, null, { user: {} }, { user: { login: 7 } }]) {
      expect(() => staleDependabotPulls([[pull]], NOW)).toThrow(
        'GitHub returned a pull request with no author'
      )
    }
  })

  it('asks for every page of open pull requests', () => {
    const { ctx, calls } = ctxOf(() => [[pull('dependabot[bot]', 20)]])
    expect(measure('stale-dependabot-pulls', ctx)).toMatchObject({ value: 1 })
    expect(calls).toEqual([['--paginate', '--slurp', 'repos/o/r/pulls?state=open&per_page=100']])
  })
})

describe('line coverage on main', () => {
  it('reads the percentage from the badge file and says when it was published', () => {
    expect(badgeCoverage(badgeFile(BADGE), badgeCommit(1), NOW)).toEqual({
      value: 95.93,
      note: `published ${daysAgo(1).slice(0, 10)}`
    })
    const whole = { ...BADGE, message: '96%' }
    expect(badgeCoverage(badgeFile(whole), badgeCommit(1), NOW).value).toBe(96)
    for (const [message, value] of [
      ['100%', 100],
      ['0%', 0]
    ] as const) {
      expect(badgeCoverage(badgeFile({ ...BADGE, message }), badgeCommit(1), NOW).value).toBe(value)
    }
  })

  it('is not measured when the file is missing, not JSON, or holds no percentage', () => {
    expect(() => badgeCoverage(undefined, badgeCommit(1), NOW)).toThrow(
      'the coverage badge file is not JSON'
    )
    expect(() => badgeCoverage(badgeFile('<html>'), badgeCommit(1), NOW)).toThrow(
      'the coverage badge file is not JSON'
    )
    for (const message of ['unknown', '', '95.93', '-3%', '100.01%', '101%', undefined]) {
      expect(() => badgeCoverage(badgeFile({ ...BADGE, message }), badgeCommit(1), NOW)).toThrow(
        'the coverage badge holds no percentage'
      )
    }
    expect(() => badgeCoverage(badgeFile('null'), badgeCommit(1), NOW)).toThrow(Unmeasured)
  })

  it('is not measured when the badge has no commit date', () => {
    for (const commits of [[], null, [{}], {}]) {
      expect(() => badgeCoverage(badgeFile(BADGE), commits, NOW)).toThrow(
        'the coverage badge has no commit date'
      )
    }
  })

  it('accepts a badge 14 days old and refuses an older one as stale, not as a number', () => {
    expect(badgeCoverage(badgeFile(BADGE), badgeCommit(14), NOW).value).toBe(95.93)
    expect(() => badgeCoverage(badgeFile(BADGE), badgeCommit(14.5), NOW)).toThrow(
      'the coverage badge is more than 14 days old'
    )
  })

  it('reads the file and its last commit from the badge branch', () => {
    const { ctx, calls } = ctxOf((args) =>
      args[0].includes('/contents/') ? badgeFile(BADGE) : badgeCommit(2)
    )
    expect(measure('line-coverage-on-main', ctx)).toMatchObject({ value: 95.93 })
    expect(calls).toEqual([
      ['repos/o/r/contents/coverage.json?ref=coverage-badge'],
      ['repos/o/r/commits?sha=coverage-badge&per_page=1']
    ])
  })
})

describe('red CI runs on main', () => {
  const run = (conclusion: string, run_attempt = 1) => ({ conclusion, run_attempt })

  it('counts failures, timeouts and runs that needed a second attempt', () => {
    const response = {
      total_count: 7,
      workflow_runs: [
        run('success'),
        run('failure'),
        run('timed_out'),
        run('success', 2),
        run('cancelled'),
        run('skipped'),
        { conclusion: 'success' }
      ]
    }
    expect(redRuns(response)).toEqual({ value: 3, note: 'of 7 completed run(s)' })
  })

  it('does not count a cancelled run, even one that was on its second attempt', () => {
    const response = { total_count: 2, workflow_runs: [run('cancelled', 2), run('cancelled')] }
    expect(redRuns(response)).toEqual({ value: 0, note: 'of 2 completed run(s)' })
  })

  it('reads a week of green runs as zero', () => {
    expect(redRuns({ total_count: 2, workflow_runs: [run('success'), run('success')] })).toEqual({
      value: 0,
      note: 'of 2 completed run(s)'
    })
  })

  it('is not measured with no runs in the window: no runs is not a clean week', () => {
    expect(() => redRuns({ workflow_runs: [] })).toThrow(Unmeasured)
    expect(() => redRuns({ workflow_runs: [] })).toThrow(
      'no completed CI run on main in the last 7 days'
    )
  })

  it('is not measured when the response has no run list', () => {
    for (const bad of [null, {}, { workflow_runs: {} }, []]) {
      expect(() => redRuns(bad)).toThrow('GitHub returned no run list')
    }
  })

  it('is not measured when a run has no conclusion: an unread result is not a green run', () => {
    for (const bad of [{}, { conclusion: null }, { conclusion: '' }, { run_attempt: 2 }, null]) {
      const response = { total_count: 2, workflow_runs: [run('success'), bad] }
      expect(() => redRuns(response)).toThrow(Unmeasured)
      expect(() => redRuns(response)).toThrow('GitHub returned a run with no conclusion')
    }
  })

  it('is not measured when the window holds more runs than the page it read', () => {
    const page = { total_count: 101, workflow_runs: [run('success')] }
    expect(() => redRuns(page)).toThrow('more than 1 CI runs on main in the window')
    for (const total_count of [undefined, '1', 1.5]) {
      expect(() => redRuns({ total_count, workflow_runs: [run('failure')] })).toThrow(
        'GitHub returned no run total'
      )
    }
  })

  it('asks for completed push runs on main from exactly seven days before the run', () => {
    const { ctx, calls } = ctxOf(() => ({ total_count: 1, workflow_runs: [run('success')] }))
    expect(measure('red-ci-runs-on-main', ctx)).toMatchObject({ value: 0 })
    expect(calls).toEqual([
      [
        'repos/o/r/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed' +
          '&created=%3E%3D2026-11-16T09:13:00Z&per_page=100'
      ]
    ])
  })
})

describe('stale branches', () => {
  it('counts branches with no open pull request and no commit in 30 days', () => {
    const nodes = [
      branch('agent/old-1', 31),
      branch('agent/old-2', 200),
      branch('agent/fresh', 2),
      branch('agent/old-but-open', 90, 1),
      branch('main', 400),
      branch('coverage-badge', 400)
    ]
    expect(staleBranches(nodes, NOW)).toEqual({ value: 2, note: 'of 6 branch(es)' })
  })

  it('does not count a branch at exactly 30 days', () => {
    expect(staleBranches([branch('a', 30)], NOW).value).toBe(0)
    expect(staleBranches([branch('a', 30.01)], NOW).value).toBe(1)
  })

  it('keeps only the default branch and the badge branch by name', () => {
    expect(KEPT_BRANCHES).toEqual(['main', 'coverage-badge'])
  })

  it('is not measured when a branch has no pull request count or no commit date', () => {
    const uncounted = [{ name: 'a', target: { committedDate: daysAgo(40) } }]
    expect(() => staleBranches(uncounted, NOW)).toThrow(
      'GitHub returned a branch with no pull request count'
    )
    const undated = [{ name: 'a', target: {}, associatedPullRequests: { totalCount: 0 } }]
    expect(() => staleBranches(undated, NOW)).toThrow(
      'GitHub returned a date that could not be read'
    )
  })

  it('is not measured when the listing holds no branch at all', () => {
    expect(() => staleBranches([], NOW)).toThrow('GitHub returned no branches')
  })

  const page = (nodes: unknown[], endCursor: string | null) => ({
    data: {
      repository: { refs: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes } }
    }
  })

  it('walks every page of branches with the cursor GitHub hands back', () => {
    const pages = [page([branch('a', 40)], 'c1'), page([branch('b', 50), branch('c', 1)], null)]
    let index = 0
    const { ctx, calls } = ctxOf(() => pages[index++])
    expect(measure('stale-branches', ctx)).toEqual({ value: 2, note: 'of 3 branch(es)' })
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe('graphql')
    expect(calls[0]).toContain('owner=o')
    expect(calls[0]).toContain('name=r')
    expect(calls[0].some((arg) => arg.startsWith('after='))).toBe(false)
    expect(calls[1]).toContain('after=c1')
  })

  it('is not measured when the response has no branch list', () => {
    for (const bad of [
      null,
      {},
      { data: { repository: null } },
      { data: { repository: { refs: {} } } }
    ]) {
      const { ctx } = ctxOf(() => bad)
      expect(() => measure('stale-branches', ctx)).toThrow('GitHub returned no branch list')
    }
  })

  it('is not measured when a page does not say whether it is the last', () => {
    const nodes = [branch('a', 40)]
    for (const refs of [{ nodes }, { nodes, pageInfo: {} }, { nodes, pageInfo: null }]) {
      const { ctx, calls } = ctxOf(() => ({ data: { repository: { refs } } }))
      expect(() => measure('stale-branches', ctx)).toThrow(Unmeasured)
      expect(() => measure('stale-branches', ctx)).toThrow(
        'GitHub returned a branch page that does not say whether it is the last'
      )
      expect(calls).toHaveLength(2)
    }
  })

  it('is not measured when a page has more behind it and hands back no cursor', () => {
    for (const endCursor of [null, undefined, '']) {
      const refs = { nodes: [branch('a', 40)], pageInfo: { hasNextPage: true, endCursor } }
      const { ctx, calls } = ctxOf(() => ({ data: { repository: { refs } } }))
      expect(() => measure('stale-branches', ctx)).toThrow(
        'GitHub returned a branch page with no cursor for the next one'
      )
      expect(calls).toHaveLength(1)
    }
  })

  it('gives up, without a partial count, on a listing that never ends', () => {
    const { ctx, calls } = ctxOf(() => page([branch('a', 40)], 'again'))
    expect(() => measure('stale-branches', ctx)).toThrow(
      'the repository has more than 2000 branches'
    )
    expect(calls).toHaveLength(20)
  })
})
