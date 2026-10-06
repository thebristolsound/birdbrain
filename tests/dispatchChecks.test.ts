import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { HAS_JQ } from './helpers/jq'
import { type GhRoutes, type GhStub, makeGhStub } from './helpers/ghStub'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'checks.sh')
const API = 'repos/o/r'
const PIPELINE = 'birdbrain-agent'
const COLLABORATOR = 'a-collaborator'
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

type CheckRun = {
  id: number
  name: string
  status?: string
  conclusion?: string | null
  app?: string
}
type Status = { context: string; state: string; by: string | null; at: string }

// CI's workflow run for PR #7 against main (run 100, jobs 1 to 3), and a run on the same head
// for another PR, #8, against a branch a collaborator controls (run 200, job 9).
const JOBS: CheckRun[] = [
  { id: 1, name: 'lint' },
  { id: 2, name: 'test' },
  { id: 3, name: 'build' }
]

const routes = ({
  checkRuns = JOBS,
  statuses = []
}: {
  checkRuns?: CheckRun[]
  statuses?: Status[]
}): GhRoutes => ({
  [`${API}/pulls/7`]: { head: { sha: SHA } },
  [`${API}/actions/runs?head_sha=${SHA}&event=pull_request&per_page=100`]: {
    workflow_runs: [
      { id: 100, pull_requests: [{ number: 7, base: { ref: 'main' } }] },
      { id: 200, pull_requests: [{ number: 8, base: { ref: 'collaborator-base' } }] }
    ]
  },
  [`${API}/actions/runs/100/jobs?per_page=100`]: { jobs: [{ id: 1 }, { id: 2 }, { id: 3 }] },
  [`${API}/actions/runs/200/jobs?per_page=100`]: { jobs: [{ id: 9 }] },
  [`${API}/commits/${SHA}/check-runs?per_page=100`]: {
    check_runs: checkRuns.map(
      ({ id, name, status = 'completed', conclusion = 'success', app = 'github-actions' }) => ({
        id,
        name,
        status,
        conclusion: status === 'completed' ? conclusion : null,
        app: { slug: app }
      })
    )
  },
  [`${API}/commits/${SHA}/statuses?per_page=100`]: statuses.map(({ by, at, ...rest }) => ({
    ...rest,
    description: '',
    creator: by === null ? null : { login: by },
    created_at: at
  }))
})

let stub: GhStub | undefined

afterEach(() => {
  stub?.cleanup()
  stub = undefined
})

const checks = (r: GhRoutes, args: string[] = []) => {
  stub = makeGhStub(r)
  const result = spawnSync('bash', [SCRIPT, ...args, '7'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: stub.path,
      GITHUB_REPOSITORY: 'o/r',
      LOGIN: PIPELINE,
      CHECKS_POLL_SECONDS: '1'
    }
  })
  return { ...result, out: result.status === 0 ? JSON.parse(result.stdout) : null }
}

describe.skipIf(!HAS_JQ)('checks.sh counts only the jobs of this PR and trusted statuses', () => {
  it('reports every job of the PR run as passed', () => {
    const { status, stderr, out } = checks(routes({}))
    expect(status, stderr).toBe(0)
    expect(out).toEqual({
      sha: SHA,
      failing: [],
      pending: [],
      passed: ['build', 'lint', 'test'],
      skipped: [],
      ignored: []
    })
  })

  it('counts a failing job of the PR run', () => {
    const { out } = checks(
      routes({ checkRuns: [JOBS[0], { ...JOBS[1], conclusion: 'failure' }, JOBS[2]] })
    )
    expect(out.failing).toEqual(['test'])
  })

  it('waits on a job of the PR run that is still running', () => {
    const { out } = checks(
      routes({ checkRuns: [...JOBS.slice(0, 2), { ...JOBS[2], status: 'in_progress' }] })
    )
    expect(out.pending).toEqual(['build'])
  })

  it('lists a skipped job apart from the passed ones', () => {
    const { out } = checks(
      routes({ checkRuns: [...JOBS.slice(0, 2), { ...JOBS[2], conclusion: 'skipped' }] })
    )
    expect(out.skipped).toEqual(['build'])
    expect(out.passed).toEqual(['lint', 'test'])
  })

  it.each([
    ['a GitHub Actions check run that is no job', { id: 50, app: 'github-actions' }],
    ['a job of another PR on the same head', { id: 9, app: 'github-actions' }],
    ['another app', { id: 51, app: 'some-app' }]
  ])('does not count a failing test from %s', (_label, { id, app }) => {
    const { status, stderr, out } = checks(
      routes({ checkRuns: [...JOBS, { id, name: 'test', conclusion: 'failure', app }] })
    )
    expect(status, stderr).toBe(0)
    expect(out.failing).toEqual([])
    expect(out.ignored).toEqual([
      `check run test (${app}, ${id}): not a job of the latest workflow runs for this PR`
    ])
  })

  it('does not wait on a running check run that is no job', () => {
    const { out } = checks(
      routes({ checkRuns: [...JOBS, { id: 50, name: 'e2e', status: 'in_progress' }] })
    )
    expect(out.pending).toEqual([])
    expect(out.ignored).toHaveLength(1)
  })

  it.each([
    [COLLABORATOR, COLLABORATOR],
    ['github-actions[bot]', 'github-actions[bot]'],
    ['an unrecorded account', null]
  ])('does not count a failing status from %s', (label, by) => {
    const { out } = checks(
      routes({
        statuses: [{ context: 'ci/extra', state: 'failure', by, at: '2026-09-28T10:00:00Z' }]
      })
    )
    expect(out.failing).toEqual([])
    expect(out.ignored).toEqual([`status ci/extra failure by ${label} at 2026-09-28T10:00:00Z`])
  })

  it('counts a failing status from the pipeline, but not its pre-pass verdict', () => {
    const at = '2026-09-28T10:00:00Z'
    const { out } = checks(
      routes({
        statuses: [
          { context: 'ci/extra', state: 'error', by: PIPELINE, at },
          { context: 'agent/pre-pass', state: 'failure', by: PIPELINE, at }
        ]
      })
    )
    expect(out.failing).toEqual(['ci/extra'])
  })

  it('fails when a read fails', () => {
    const r = routes({})
    delete r[`${API}/actions/runs/100/jobs?per_page=100`]
    expect(checks(r).status).not.toBe(0)
  })
})

describe.skipIf(!HAS_JQ)('checks.sh --wait', () => {
  it('returns at once when nothing is pending', () => {
    const { status, out } = checks(routes({}), ['--wait', '60'])
    expect(status).toBe(0)
    expect(out.passed).toEqual(['build', 'lint', 'test'])
  })

  it('exits 124 with the last read when checks are still pending at the deadline', () => {
    const r = routes({ checkRuns: [{ id: 1, name: 'lint', status: 'in_progress' }] })
    const result = checks(r, ['--wait', '1'])
    expect(result.status).toBe(124)
    expect(JSON.parse(result.stdout).pending).toEqual(['lint'])
  })

  it('fails when a read fails', () => {
    const r = routes({})
    delete r[`${API}/actions/runs/100/jobs?per_page=100`]
    expect(checks(r, ['--wait', '1']).status).not.toBe(0)
  })
})
