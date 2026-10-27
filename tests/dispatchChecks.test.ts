import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
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

// CI's workflow run for PR #7 against its base (run 100, jobs 1 to 3), an older CI run at the
// same head that run 100 superseded (run 90, job 4), a second workflow's run for PR #7 (run 300,
// job 6), a third workflow's run for PR #7 against a base it no longer has (run 400, job 7), and
// a run on the same head for another PR, #8, against a branch a collaborator controls (run 200,
// job 9).
const JOBS: CheckRun[] = [
  { id: 1, name: 'lint' },
  { id: 2, name: 'test' },
  { id: 3, name: 'build' }
]

const pr7 = (ref: string) => ({ number: 7, base: { ref } })

const routes = ({
  checkRuns = JOBS,
  statuses = [],
  base = 'main'
}: {
  checkRuns?: CheckRun[]
  statuses?: Status[]
  base?: string
}): GhRoutes => ({
  [`${API}/pulls/7`]: { head: { sha: SHA }, base: { ref: base } },
  [`${API}/actions/runs?head_sha=${SHA}&event=pull_request&per_page=100`]: {
    workflow_runs: [
      { id: 100, workflow_id: 11, run_number: 5, pull_requests: [pr7(base)] },
      { id: 90, workflow_id: 11, run_number: 4, pull_requests: [pr7(base)] },
      { id: 300, workflow_id: 12, run_number: 1, pull_requests: [pr7(base)] },
      { id: 400, workflow_id: 13, run_number: 1, pull_requests: [pr7('earlier-base')] },
      {
        id: 200,
        workflow_id: 11,
        run_number: 6,
        pull_requests: [{ number: 8, base: { ref: 'collaborator-base' } }]
      }
    ]
  },
  [`${API}/actions/runs/100/jobs?per_page=100`]: { jobs: [{ id: 1 }, { id: 2 }, { id: 3 }] },
  [`${API}/actions/runs/90/jobs?per_page=100`]: { jobs: [{ id: 4 }] },
  [`${API}/actions/runs/300/jobs?per_page=100`]: { jobs: [{ id: 6 }] },
  [`${API}/actions/runs/400/jobs?per_page=100`]: { jobs: [{ id: 7 }] },
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

// A `sleep` beside the gh stub that logs each duration it was asked for before sleeping.
const SLEEP = `#!/usr/bin/env bash
echo "$1" >> "$(dirname "$0")/sleeps.log"
exec /bin/sleep "$1"
`

const checks = (r: GhRoutes, args: string[] = [], env: Record<string, string> = {}) => {
  stub = makeGhStub(r)
  writeFileSync(join(stub.dir, 'sleep'), SLEEP)
  chmodSync(join(stub.dir, 'sleep'), 0o755)
  const result = spawnSync('bash', [SCRIPT, ...args, '7'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: stub.path,
      GITHUB_REPOSITORY: 'o/r',
      LOGIN: PIPELINE,
      CHECKS_POLL_SECONDS: '1',
      ...env
    }
  })
  return { ...result, out: result.status === 0 ? JSON.parse(result.stdout) : null }
}

const sleeps = () => {
  const log = join(stub?.dir ?? '', 'sleeps.log')
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(Number) : []
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
    ['a run for this PR against a base it no longer has', { id: 7, app: 'github-actions' }],
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

  // CI runs on a PR stacked on another branch too (ci.yml's pull_request trigger), and its
  // jobs are that PR's CI.
  it('counts a failing job of the PR run when the PR is stacked on another branch', () => {
    const { status, stderr, out } = checks(
      routes({
        base: 'feat/parent',
        checkRuns: [JOBS[0], { ...JOBS[1], conclusion: 'failure' }, JOBS[2]]
      })
    )
    expect(status, stderr).toBe(0)
    expect(out.failing).toEqual(['test'])
    expect(out.passed).toEqual(['build', 'lint'])
    expect(out.ignored).toEqual([])
  })

  // A valid branch name; spliced into the filter as jq code, it would match every run on the head.
  it('reads a base branch name with quotes in it as a name', () => {
    const { status, stderr, out } = checks(
      routes({
        base: 'x"or(true)or"y',
        checkRuns: [...JOBS, { id: 9, name: 'test', conclusion: 'failure' }]
      })
    )
    expect(status, stderr).toBe(0)
    expect(out.failing).toEqual([])
    expect(out.passed).toEqual(['build', 'lint', 'test'])
  })

  it('does not count a job of an older run of the same workflow at the same head', () => {
    const { status, stderr, out } = checks(
      routes({ checkRuns: [...JOBS, { id: 4, name: 'test', conclusion: 'cancelled' }] })
    )
    expect(status, stderr).toBe(0)
    expect(out.failing).toEqual([])
    expect(out.passed).toEqual(['build', 'lint', 'test'])
    expect(out.ignored).toEqual([
      'check run test (github-actions, 4): not a job of the latest workflow runs for this PR'
    ])
  })

  it('counts a failing job of the latest run of another workflow', () => {
    const { out } = checks(
      routes({ checkRuns: [...JOBS, { id: 6, name: 'analyze', conclusion: 'failure' }] })
    )
    expect(out.failing).toEqual(['analyze'])
  })

  // The probe job is advisory: a red one must not send a fix round, and a running one must not
  // hold the pre-pass, whose test pass runs the probe itself when the job did not succeed.
  it.each([
    ['failing', { conclusion: 'failure' }],
    ['timed-out', { conclusion: 'timed_out' }],
    ['running', { status: 'in_progress' }]
  ])('leaves a %s probe job of the PR run out, as advisory', (_label, run) => {
    const { status, stderr, out } = checks(
      routes({ checkRuns: [...JOBS.slice(0, 2), { ...JOBS[2], name: 'probe', ...run }] })
    )
    expect(status, stderr).toBe(0)
    expect(out.failing).toEqual([])
    expect(out.pending).toEqual([])
    expect(out.passed).toEqual(['lint', 'test'])
    expect(out.ignored).toEqual([
      'check run probe (github-actions, 3): the advisory test reliability probe, read by the pre-pass'
    ])
  })

  // merge-gate fails every agent PR until agent/pre-pass is success (ADR-0041), and the wait
  // here is what precedes that verdict.
  it.each([
    ['failing', { conclusion: 'failure' }],
    ['running', { status: 'in_progress' }]
  ])('leaves a %s merge-gate job of the PR run out, as the verdict it waits for', (_label, run) => {
    const { status, stderr, out } = checks(
      routes({ checkRuns: [...JOBS.slice(0, 2), { ...JOBS[2], name: 'merge-gate', ...run }] })
    )
    expect(status, stderr).toBe(0)
    expect(out.failing).toEqual([])
    expect(out.pending).toEqual([])
    expect(out.passed).toEqual(['lint', 'test'])
    expect(out.ignored).toEqual([
      'check run merge-gate (github-actions, 3): reads the pre-pass verdict (ADR-0041), not CI'
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

  it('never sleeps past the deadline, so the command returns within the wait plus one read', () => {
    const r = routes({ checkRuns: [{ id: 1, name: 'lint', status: 'in_progress' }] })
    const result = checks(r, ['--wait', '2'], { CHECKS_POLL_SECONDS: '30' })
    expect(result.status).toBe(124)
    expect(sleeps().length).toBeGreaterThan(0)
    expect(sleeps().every((seconds) => seconds > 0 && seconds <= 2)).toBe(true)
  })

  it('fails when a read fails', () => {
    const r = routes({})
    delete r[`${API}/actions/runs/100/jobs?per_page=100`]
    expect(checks(r, ['--wait', '1']).status).not.toBe(0)
  })
})
