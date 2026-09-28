import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'
import { type GhRoutes, type GhStub, makeGhStub } from './helpers/ghStub'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'cutover', 'dry-run.sh')
const API = 'repos/o/r'
const DELETE = [
  'backup/local-merge-230-231',
  'backup/pre-sync-diagnostic-logging',
  'backup/simplify-f8fb6f1',
  'coderabbitai/docstrings/9f4bb7c',
  ...[1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15].map((n) => `stash-archive/${n}`),
  't3code/302982b9',
  'worktree-agent-a712ebebe2fa7fc0b',
  'worktree-agent-ace974456560e04ec'
]
const KEPT = 't3code/review-pr-1518-1'

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1'
}

let remote: string
let stub: GhStub | undefined

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: remote, encoding: 'utf8', env: gitEnv }).trim()

const refs = () => git('for-each-ref', '--format=%(objectname) %(refname)')

// A remote shaped like origin: main, the 20 ruled branches, the kept one, a pull-request ref
// and a tag, all on one commit.
beforeEach(() => {
  remote = mkdtempSync(join(tmpdir(), 'cutover-remote-'))
  git('init', '-q', '-b', 'main')
  git('commit', '-q', '--allow-empty', '-m', 'init')
  for (const branch of [...DELETE, KEPT]) git('update-ref', `refs/heads/${branch}`, 'HEAD')
  git('update-ref', 'refs/pull/1/head', 'HEAD')
  git('update-ref', 'refs/tags/v1.0.0', 'HEAD')
})

afterEach(() => {
  stub?.cleanup()
  stub = undefined
  rmSync(remote, { recursive: true, force: true })
})

const mainRuleset = {
  enforcement: 'active',
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }],
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'creation' },
    {
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [
          'lint',
          'typecheck',
          'test',
          'build',
          'e2e',
          'Secret scan (full history)',
          'Registry publish guard'
        ].map((context) => ({ context }))
      }
    },
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 1,
        require_code_owner_review: true,
        require_last_push_approval: true,
        dismiss_stale_reviews_on_push: true,
        required_review_thread_resolution: false,
        allowed_merge_methods: ['squash']
      }
    },
    { type: 'required_signatures' }
  ]
}

// Every setting as read back on 2026-09-28, so the unmodified routes are all GO.
const routes = (overrides: GhRoutes = {}): GhRoutes => ({
  [API]: { visibility: 'private' },
  [`${API}/actions/workflows?per_page=100`]: {
    workflows: [
      { state: 'active', name: 'CI', path: '.github/workflows/ci.yml' },
      { state: 'disabled_manually', name: 'Dispatch', path: '.github/workflows/dispatch.yml' },
      { state: 'active', name: 'Copilot', path: 'dynamic/agents/copilot-pull-request-reviewer' }
    ]
  },
  [`${API}/pulls?state=open&per_page=100`]: [{ head: { ref: 'feat/x', sha: '0'.repeat(40) } }],
  [`${API}/rulesets/14967088`]: mainRuleset,
  [`${API}/rulesets/24098840`]: {
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    rules: [
      { type: 'creation' },
      { type: 'update' },
      { type: 'deletion' },
      { type: 'non_fast_forward' }
    ]
  },
  [`${API}/actions/permissions`]: { enabled: true, allowed_actions: 'all' },
  [`${API}/actions/permissions/workflow`]: {
    default_workflow_permissions: 'read',
    can_approve_pull_request_reviews: false
  },
  [`${API}/actions/permissions/fork-pr-workflows-private-repos`]: {
    send_write_tokens_to_workflows: false,
    send_secrets_and_variables: false
  },
  [`${API}/actions/secrets`]: { total_count: 0, secrets: [] },
  [`${API}/actions/variables?per_page=100`]: {
    variables: [{ name: 'COPILOT_AGENT_FIREWALL_ENABLED' }]
  },
  [`${API}/actions/variables/COPILOT_AGENT_FIREWALL_ENABLED`]: { value: 'true' },
  ...overrides
})

const dryRun = (r: GhRoutes) => {
  stub = makeGhStub(r)
  const before = refs()
  const result = spawnSync('bash', [SCRIPT], {
    cwd: stub.dir,
    encoding: 'utf8',
    env: { ...gitEnv, PATH: stub.path, CUTOVER_REPO: 'o/r', CUTOVER_REMOTE: remote }
  })
  const lines = result.stdout.split('\n')
  return {
    ...result,
    nogo: lines.filter((l) => l.startsWith('NO-GO  ')),
    // The stub logs one line per call, so a multi-line --jq program continues on indented lines.
    calls: stub.calls().filter((c) => !/^\s/.test(c)),
    remoteChanged: refs() !== before
  }
}

describe.skipIf(!HAS_JQ)('scripts/cutover/dry-run.sh', () => {
  it('reports GO on every check when the settings match the 2026-09-28 read-back', () => {
    const result = dryRun(routes())
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.nogo).toEqual([])
    expect(result.stdout).toContain('GO     freeze list: 3 registered; the freeze disables the 2')
    expect(result.stdout).toContain('mirror refs: 22 heads, 1 pull, 1 tags')
    expect(result.stdout).toContain('GO     bundle: 24 refs bundled, verified, restored')
    expect(result.stdout).toContain(`GO     keep ${KEPT}`)
  })

  it('makes only GET calls to GitHub and leaves the remote untouched', () => {
    const result = dryRun(routes())
    expect(result.calls.length).toBeGreaterThan(0)
    for (const call of result.calls) expect(call).toMatch(/^api --method GET /)
    expect(result.calls.join('\n')).not.toMatch(/ -f | -F | --input | -X /)
    expect(result.remoteChanged).toBe(false)
  })

  it('stops on a ruled branch that is the head of an open pull request, by name or tip', () => {
    const tip = git('rev-parse', 'HEAD')
    const result = dryRun(
      routes({
        [`${API}/pulls?state=open&per_page=100`]: [
          { head: { ref: 'stash-archive/7', sha: '1'.repeat(40) } },
          { head: { ref: 'feat/persona-thing', sha: tip } }
        ]
      })
    )
    expect(result.status).toBe(1)
    expect(result.nogo).toContain(
      'NO-GO  delete stash-archive/7: an open pull request uses it as its head'
    )
    expect(result.nogo).toContain(
      'NO-GO  delete stash-archive/1: its tip is the head commit of an open pull request'
    )
  })

  it('stops when a ruled branch is already gone from the remote', () => {
    git('update-ref', '-d', 'refs/heads/backup/simplify-f8fb6f1')
    const result = dryRun(routes())
    expect(result.status).toBe(1)
    expect(result.nogo).toEqual([
      'NO-GO  delete backup/simplify-f8fb6f1: not on origin, so the list no longer matches the ruling'
    ])
  })

  it.each([
    [
      'main ruleset',
      {
        [`${API}/rulesets/14967088`]: {
          ...mainRuleset,
          bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }]
        }
      }
    ],
    ['repository secrets', { [`${API}/actions/secrets`]: { total_count: 1, secrets: [{}] } }],
    ['visibility', { [API]: { visibility: 'public' } }],
    ['workflow token', { [`${API}/actions/permissions/workflow`]: null }]
  ])('stops when %s drifts from the expected value or cannot be read', (name, override) => {
    const result = dryRun(routes(override))
    expect(result.status).toBe(1)
    expect(result.nogo).toHaveLength(1)
    expect(result.nogo[0]).toMatch(new RegExp(`^NO-GO  ${name}: `))
  })
})
