import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { HAS_JQ } from './helpers/jq'
import { type GhStub, makeGhStub } from './helpers/ghStub'

const ROOT = resolve(__dirname, '..')
const SCRIPT = resolve(ROOT, '.claude', 'skills', 'merge-pr', 'scripts', 'merge.sh')
const BODY = readFileSync(
  resolve(ROOT, '.claude', 'skills', 'post-pr-body', 'scripts', 'fixtures', 'pass-filled.md'),
  'utf8'
)
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const API = 'repos/{owner}/{repo}'

const requiredRules = (contexts: string[]) => [
  { type: 'deletion' },
  {
    type: 'required_status_checks',
    parameters: { required_status_checks: contexts.map((context) => ({ context })) }
  },
  { type: 'pull_request', parameters: {} }
]

const run = (name: string, conclusion: string) => ({
  name,
  status: 'completed',
  conclusion,
  details_url: ''
})

const routes = (
  rules: unknown,
  checkRuns: ReturnType<typeof run>[],
  { author = 'someone-else', prePass = [] as { by: string; state: string }[] } = {}
) => ({
  user: { login: 'maintainer' },
  [`${API}/pulls/7`]: {
    user: { login: author },
    state: 'open',
    draft: false,
    merged: false,
    title: 'feat(x): a thing',
    body: BODY,
    labels: [],
    head: { ref: 'feature', sha: SHA, repo: { full_name: 'o/r' } },
    base: { ref: 'main', repo: { full_name: 'o/r' } }
  },
  [`${API}/rules/branches/main`]: rules,
  [`${API}/commits/${SHA}/check-runs?per_page=100`]: {
    total_count: checkRuns.length,
    check_runs: checkRuns
  },
  [`${API}/commits/${SHA}/status?per_page=100`]: { statuses: [] },
  // Newest first, as the statuses list endpoint returns them.
  [`${API}/commits/${SHA}/statuses?per_page=100`]: prePass.map(({ by, state }) => ({
    context: 'agent/pre-pass',
    state,
    creator: { login: by }
  })),
  [`${API}/issues/829/labels`]: []
})

let stub: GhStub | undefined

afterEach(() => {
  stub?.cleanup()
  stub = undefined
})

const invoke = (r: ReturnType<typeof routes>, args: string[]) => {
  stub = makeGhStub(r)
  const result = spawnSync('bash', [SCRIPT, '7', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: stub.path,
      CLAUDE_PROJECT_DIR: ROOT,
      BIRDBRAIN_AGENT_GH_LOGIN: 'birdbrain-agent'
    }
  })
  return { ...result, calls: stub.calls() }
}

const dryRun = (r: ReturnType<typeof routes>) => invoke(r, ['--dry-run'])

describe.skipIf(!HAS_JQ)('merge.sh gates on the required checks of main', () => {
  const green = ['lint', 'typecheck', 'test'].map((name) => run(name, 'success'))

  it('proceeds past a failing non-required check and prints it as a warning', () => {
    const result = dryRun(
      routes(requiredRules(['lint', 'typecheck', 'test']), [
        ...green,
        run('Dependency audit', 'failure')
      ])
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'merge-pr: WARN checks not required on main and not green at head: Dependency audit=completed/failure'
    )
    expect(result.stdout).toContain(
      'merge-pr: required checks green at head: lint, typecheck, test'
    )
    expect(result.stdout).toContain('merge-pr: dry run: stopping')
    expect(result.calls.some((call) => call.startsWith('pr '))).toBe(false)
  })

  it('refuses when a required check failed', () => {
    const result = dryRun(
      routes(requiredRules(['lint', 'typecheck', 'test']), [
        run('lint', 'success'),
        run('typecheck', 'success'),
        run('test', 'failure')
      ])
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'merge-pr: refused: required checks not green at head: test=completed/failure'
    )
  })

  it('refuses when a required check has not reported at head', () => {
    const result = dryRun(routes(requiredRules(['lint', 'e2e']), [run('lint', 'success')]))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('required checks not green at head: e2e=missing')
  })

  it('refuses when the rules for main name no required checks', () => {
    const result = dryRun(routes([{ type: 'deletion' }], green))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('the rules for main name no required status checks')
  })

  it('refuses when the rules read fails', () => {
    const result = dryRun(routes(null, green))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('cannot read the rules for main')
  })
})

// ADR-0041: merge-gate replaces the code-owner review rule, so the script never chooses the
// bypass for the caller; --admin is the maintainer's explicit emergency path.
describe.skipIf(!HAS_JQ)('merge.sh takes the admin bypass only when asked', () => {
  const rules = requiredRules(['lint'])
  const green = [run('lint', 'success')]
  const mergeCall = (calls: string[]) => calls.find((call) => call.startsWith('pr merge '))

  it("merges the gh login's own PR without --admin", () => {
    // The stub has no route for `pr merge`, so the script stops after the call it makes.
    const result = invoke(routes(rules, green, { author: 'maintainer' }), [])
    expect(result.stdout).not.toContain('admin bypass')
    expect(mergeCall(result.calls)).toMatch(/^pr merge 7 --squash --match-head-commit /)
  })

  it('passes --admin to the merge when the caller asks for it', () => {
    const result = invoke(routes(rules, green, { author: 'maintainer' }), ['--admin'])
    expect(result.stdout).toContain('merge-pr: merging with the admin bypass, as asked')
    expect(mergeCall(result.calls)).toMatch(/^pr merge 7 --squash --admin --match-head-commit /)
  })

  it('refuses --admin for the machine account', () => {
    const result = invoke(routes(rules, green), ['--cli', 'agh', '--admin'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("never the machine account's")
    expect(mergeCall(result.calls)).toBeUndefined()
  })

  it('re-runs the last merge-gate attempt when the gate is the red check', () => {
    const gateRun = {
      ...run('merge-gate', 'failure'),
      details_url: 'https://github.com/o/r/actions/runs/4242/job/99'
    }
    const gate = invoke(routes(requiredRules(['lint', 'merge-gate']), [...green, gateRun]), [])
    expect(gate.status).toBe(1)
    expect(gate.calls).toContain('run rerun 4242')
    expect(gate.calls.some((call) => call.startsWith('workflow run'))).toBe(false)
    expect(gate.stderr).toContain('required checks not green at head: merge-gate=completed/failure')
    expect(mergeCall(gate.calls)).toBeUndefined()
  })

  it('re-runs every red merge-gate run at head once each and skips green ones', () => {
    const gateRun = (id: number, conclusion: string) => ({
      ...run('merge-gate', conclusion),
      details_url: `https://github.com/o/r/actions/runs/${id}/job/${id + 1}`
    })
    const gate = invoke(
      routes(requiredRules(['lint', 'merge-gate']), [
        ...green,
        gateRun(4242, 'failure'),
        gateRun(4343, 'failure'),
        gateRun(4343, 'failure'),
        gateRun(4444, 'success')
      ]),
      []
    )
    const reruns = gate.calls.filter((call) => call.startsWith('run rerun'))
    expect(reruns).toEqual(['run rerun 4242', 'run rerun 4343'])
    expect(mergeCall(gate.calls)).toBeUndefined()
  })
})
