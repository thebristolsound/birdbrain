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

const run = (name: string, conclusion: string) => ({ name, status: 'completed', conclusion })

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

describe.skipIf(!HAS_JQ)("merge.sh takes the admin bypass only for the gh login's own PR", () => {
  const rules = requiredRules(['lint'])
  const green = [run('lint', 'success')]
  const own = (prePass: { by: string; state: string }[]) =>
    routes(rules, green, { author: 'maintainer', prePass })
  const mergeCall = (calls: string[]) => calls.find((call) => call.startsWith('pr merge '))

  it('passes --admin to the merge on a success pre-pass from the machine account', () => {
    // The stub has no route for `pr merge`, so the script stops after the call it makes.
    const result = invoke(own([{ by: 'birdbrain-agent', state: 'success' }]), [])
    expect(result.stdout).toContain(
      'merge-pr: authored by maintainer: merging with the admin bypass on a success pre-pass'
    )
    expect(mergeCall(result.calls)).toMatch(/^pr merge 7 --squash --admin --match-head-commit /)
  })

  it('accepts a success pre-pass the maintainer posted', () => {
    const result = dryRun(own([{ by: 'maintainer', state: 'success' }]))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('merging with the admin bypass')
  })

  it("refuses on the workflow's automatic pass, which no trusted account posted", () => {
    const result = dryRun(own([{ by: 'github-actions[bot]', state: 'success' }]))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'needs a success agent/pre-pass at head from maintainer or birdbrain-agent (it is missing)'
    )
  })

  it('reads the newest trusted pre-pass, skipping newer ones from anyone else', () => {
    const failed = dryRun(
      own([
        { by: 'github-actions[bot]', state: 'success' },
        { by: 'birdbrain-agent', state: 'failure' },
        { by: 'birdbrain-agent', state: 'success' }
      ])
    )
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('(it is failure)')
  })

  it('refuses with no pre-pass at all', () => {
    const result = dryRun(own([]))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('(it is missing)')
  })

  it("merges someone else's PR without --admin", () => {
    const result = invoke(
      routes(rules, green, { prePass: [{ by: 'birdbrain-agent', state: 'success' }] }),
      []
    )
    expect(result.stdout).not.toContain('admin bypass')
    expect(mergeCall(result.calls)).toMatch(/^pr merge 7 --squash --match-head-commit /)
  })
})
