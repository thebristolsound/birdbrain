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
  { author = 'someone-else', statuses = [] as { context: string; state: string }[] } = {}
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
  [`${API}/commits/${SHA}/status?per_page=100`]: { statuses },
  [`${API}/issues/829/labels`]: []
})

let stub: GhStub | undefined

afterEach(() => {
  stub?.cleanup()
  stub = undefined
})

const dryRun = (r: ReturnType<typeof routes>) => {
  stub = makeGhStub(r)
  const result = spawnSync('bash', [SCRIPT, '7', '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: stub.path, CLAUDE_PROJECT_DIR: ROOT }
  })
  return { ...result, calls: stub.calls() }
}

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

describe.skipIf(!HAS_JQ)("merge.sh takes the admin bypass only for the maintainer's own PR", () => {
  const rules = requiredRules(['lint'])
  const green = [run('lint', 'success')]
  const prePass = (state: string) => [{ context: 'agent/pre-pass', state }]

  it('uses the bypass for a PR the gh login authored with a success pre-pass', () => {
    const result = dryRun(
      routes(rules, green, { author: 'maintainer', statuses: prePass('success') })
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'merge-pr: authored by maintainer: merging with the admin bypass on a success pre-pass'
    )
  })

  it("refuses the maintainer's own PR without a success pre-pass at head", () => {
    const failed = dryRun(
      routes(rules, green, { author: 'maintainer', statuses: prePass('failure') })
    )
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('needs a success agent/pre-pass at head (it is failure)')

    const missing = dryRun(routes(rules, green, { author: 'maintainer' }))
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('(it is missing)')
  })

  it('does not use the bypass for a PR someone else authored', () => {
    const result = dryRun(routes(rules, green, { statuses: prePass('success') }))
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('admin bypass')
  })
})
