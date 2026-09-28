import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'
import { type GhRoutes, type GhStub, makeGhStub } from './helpers/ghStub'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'pregate.sh')
const API = 'repos/o/r'
const MAIN = 'feedc0de00000000000000000000000000000000'
const PR_SHA = 'abcdef1200000000000000000000000000000000'

type Run = { name: string; status: string; conclusion: string | null }
const run = (name: string, conclusion: string | null, status = 'completed'): Run => ({
  name,
  status,
  conclusion
})

const mainRoutes = (checkRuns: Run[]): GhRoutes => ({
  [`${API}/commits/main`]: { sha: MAIN },
  [`${API}/rules/branches/main`]: [
    { type: 'deletion' },
    {
      type: 'required_status_checks',
      parameters: { required_status_checks: [{ context: 'lint' }, { context: 'test' }] }
    }
  ],
  [`${API}/commits/${MAIN}/check-runs?per_page=100`]: {
    total_count: checkRuns.length,
    check_runs: checkRuns
  },
  [`${API}/commits/${MAIN}/status?per_page=100`]: { statuses: [] }
})

// The open PRs and claimed issues, an empty queue, and no recent label events.
const slot = (prs: GhRoutes[], wip: number[]): GhRoutes => ({
  [`${API}/pulls?state=open&per_page=100`]: prs,
  [`${API}/issues?state=open&labels=agent-wip&per_page=100`]: wip.map((number) => ({
    number,
    state: 'open',
    assignees: [],
    labels: [{ name: 'agent-wip' }]
  })),
  [`${API}/issues?state=open&labels=ready-for-agent,queued&per_page=100`]: [],
  [`${API}/issues/events?per_page=100&page=1`]: []
})

const PR9 = {
  number: 9,
  head: { sha: PR_SHA, ref: 'agent/9-fix' },
  draft: true,
  labels: [{ name: 'agent-pr' }]
}

// PR #9, a draft whose head carries no agent/pre-pass status, so a verdict is owed. The
// pipeline labelled it and pushed its head, which is what makes the verdict owed (#1310).
const prOwingVerdict: GhRoutes = {
  [`${API}/issues/9/events?per_page=100`]: [
    {
      event: 'labeled',
      label: { name: 'agent-pr' },
      actor: { login: 'birdbrain-agent' },
      created_at: '2026-09-25T09:00:00Z'
    }
  ],
  [`${API}/activity?ref=refs/heads/agent/9-fix&per_page=100`]: [
    { after: PR_SHA, actor: { login: 'birdbrain-agent' }, timestamp: '2026-09-25T10:00:00Z' }
  ],
  [`${API}/commits/${PR_SHA}/statuses?per_page=100`]: [],
  [`${API}/commits/${PR_SHA}`]: { commit: { committer: { date: '2026-09-25T10:00:00Z' } } },
  [`${API}/issues/9/comments?per_page=100`]: [],
  [`${API}/pulls/9/comments?per_page=100`]: [],
  [`${API}/pulls/9/reviews?per_page=100`]: []
}

// Issue #5 was claimed by the pipeline long before the 4-hour expiry.
const staleClaim: GhRoutes = {
  [`${API}/issues/5/events?per_page=100`]: [
    {
      event: 'labeled',
      label: { name: 'agent-wip' },
      actor: { login: 'birdbrain-agent' },
      created_at: '2026-01-01T00:00:00Z'
    }
  ]
}

// Issue #11 is queued by the maintainer, unassigned and unblocked.
const frontier: GhRoutes = {
  [`${API}/issues?state=open&labels=ready-for-agent,queued&per_page=100`]: [
    {
      number: 11,
      state: 'open',
      assignees: [],
      labels: [{ name: 'ready-for-agent' }, { name: 'queued' }]
    }
  ],
  [`${API}/issues/11/events?per_page=100`]: ['ready-for-agent', 'queued'].map((name) => ({
    event: 'labeled',
    label: { name },
    actor: { login: 'thebristolsound' },
    created_at: '2026-09-25T09:00:00Z'
  })),
  [`${API}/issues/11/dependencies/blocked_by`]: []
}

const redMain = [run('lint', 'success'), run('test', 'failure')]
const greenMain = [run('lint', 'success'), run('test', 'success')]

let stub: GhStub | undefined

afterEach(() => {
  stub?.cleanup()
  stub = undefined
})

const pregate = (routes: GhRoutes) => {
  stub = makeGhStub(routes)
  const output = join(stub.dir, 'output')
  const summary = join(stub.dir, 'summary')
  writeFileSync(output, '')
  writeFileSync(summary, '')
  const result = spawnSync('bash', [SCRIPT, 'cycle'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: stub.path,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      LOGIN: 'birdbrain-agent'
    }
  })
  const fields = Object.fromEntries(
    readFileSync(output, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )
  return {
    ...result,
    run: fields.run,
    reason: fields.reason,
    summary: readFileSync(summary, 'utf8')
  }
}

describe.skipIf(!HAS_JQ)('pregate.sh while main is red', () => {
  it('holds a verdict owed on a PR head and names the red check', () => {
    const result = pregate({ ...mainRoutes(redMain), ...slot([PR9], []), ...prOwingVerdict })
    expect(result.status).toBe(0)
    expect(result.run).toBe('false')
    expect(result.reason).toContain('while main is red (test)')
    expect(result.summary).toContain('Main feedc0de is red: required check(s) test failed')
    expect(result.summary).toContain('Held while main is red: PR #9 head abcdef12')
  })

  it('holds a free slot with an eligible frontier', () => {
    const result = pregate({ ...mainRoutes(redMain), ...slot([], []), ...frontier })
    expect(result.status).toBe(0)
    expect(result.run).toBe('false')
    expect(result.reason).toBe(
      'the slot is free and 1 queued issue(s) wait, but main is red (test)'
    )
  })

  it('still runs to age out a stale claim', () => {
    const result = pregate({ ...mainRoutes(redMain), ...slot([], [5]), ...staleClaim })
    expect(result.status).toBe(0)
    expect(result.run).toBe('true')
    expect(result.reason).toContain('issue #5 holds an agent-wip claim')
    expect(result.summary).toContain('Main feedc0de is red')
  })
})

describe.skipIf(!HAS_JQ)('pregate.sh while main is green', () => {
  it('runs for a verdict owed on a PR head, as before', () => {
    const result = pregate({ ...mainRoutes(greenMain), ...slot([PR9], []), ...prOwingVerdict })
    expect(result.status).toBe(0)
    expect(result.run).toBe('true')
    expect(result.reason).toBe('PR #9 head abcdef12 has agent/pre-pass=absent; a verdict is owed')
    expect(result.summary).not.toContain('is red')
  })

  it('does not count a failing check the rules do not require, or a required one still running', () => {
    const result = pregate({
      ...mainRoutes([
        run('lint', 'success'),
        run('test', null, 'in_progress'),
        run('Dependency audit', 'failure')
      ]),
      ...slot([], []),
      ...frontier
    })
    expect(result.run).toBe('true')
    expect(result.reason).toBe('the slot is free and 1 unblocked queued issue(s) wait')
  })

  it('counts main as green when the rules read fails', () => {
    const routes = { ...mainRoutes(redMain), ...slot([PR9], []), ...prOwingVerdict }
    delete routes[`${API}/rules/branches/main`]
    const result = pregate(routes)
    expect(result.run).toBe('true')
    expect(result.summary).toContain('Could not read the required checks on main')
  })
})
