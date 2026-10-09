import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'
import { type GhRoutes, type GhStub, makeGhStub } from './helpers/ghStub'

// The script and the step scripts it runs are copied into a throwaway repository, so the
// run touches nothing in this checkout, and the fake repository has no origin to fetch.
const SOURCE = resolve(__dirname, '..')
// .mise.toml rides along so mise resolves the pinned Node inside the copy, as in a checkout.
const COPIED = [
  '.github/scripts/dispatch',
  '.github/scripts/health',
  'scripts/dispatch-local.sh',
  '.mise.toml',
  '.nvmrc'
]
const REPO = 'o/r'
const PIPELINE = 'birdbrain-agent'
const REPORT = '## Dispatch cycle report\n\n- Slot: 0/1\n- Exited idle'

// A stand-in for the CLI. --version answers at once; any other call is counted, records its
// arguments and environment, holds for hold-<n> seconds when that file exists, then prints
// responses/<n>.json. The probe is call 1 and the cycle call 2.
const CLAUDE_STUB = `#!/usr/bin/env bash
dir="$(dirname "$0")"
if [ "\${1:-}" = --version ]; then echo "9.9.9 (stub)"; exit 0; fi
n=$(( $(cat "$dir/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$dir/count"
printf '%s\\0' "$@" > "$dir/args-$n"
env > "$dir/env-$n"
if [ -f "$dir/hold-$n" ]; then sleep "$(cat "$dir/hold-$n")"; fi
cat "$dir/responses/$n.json" || exit 1
`

const result = (text: string) =>
  JSON.stringify({
    type: 'result',
    is_error: false,
    result: text,
    session_id: 'a',
    num_turns: 1,
    duration_ms: 10
  })

// Every route an idle fire and a report-mode fire read. The red-main read on commits/main
// has no route, which the pre-gate counts as green.
const routes = ({ login = PIPELINE }: { login?: string } = {}): GhRoutes => ({
  user: { login, id: 42 },
  [`repos/${REPO}/actions/workflows/dispatch.yml/runs?per_page=100&page=1`]: {
    total_count: 0,
    workflow_runs: []
  },
  [`repos/${REPO}/pulls?state=open&per_page=100`]: [],
  [`repos/${REPO}/issues?state=open&labels=agent-wip&per_page=100`]: [],
  [`repos/${REPO}/issues?state=open&labels=ready-for-agent,queued&per_page=100`]: [],
  [`repos/${REPO}/issues/events?per_page=100&page=1`]: [],
  [`repos/${REPO}/issues?state=open&labels=agent-pr&per_page=100`]: []
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let root: string
let repo: string
let home: string
let state: string
let bin: string
let gh: GhStub | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dispatch-local-'))
  repo = join(root, 'repo')
  home = join(root, 'home')
  state = join(root, 'state')
  bin = join(root, 'bin')
  for (const rel of COPIED) cpSync(join(SOURCE, rel), join(repo, rel), { recursive: true })
  mkdirSync(join(repo, 'node_modules', 'electron', 'dist'), { recursive: true })
  spawnSync('git', ['init', '-q'], { cwd: repo })
  mkdirSync(join(home, '.config', 'birdbrain-agent'), { recursive: true })
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(
    join(home, '.config', 'birdbrain-agent', 'env'),
    `BIRDBRAIN_AGENT_GH_LOGIN=${PIPELINE}\nBIRDBRAIN_AGENT_GH_TOKEN=ghp_${'x'.repeat(36)}\nBIRDBRAIN_AGENT_GH_TOKEN_EXPIRES=2099-01-01\n`
  )
  mkdirSync(join(bin, 'responses'), { recursive: true })
  writeFileSync(join(bin, 'claude'), CLAUDE_STUB)
  chmodSync(join(bin, 'claude'), 0o755)
})

afterEach(() => {
  gh?.cleanup()
  gh = undefined
  rmSync(root, { recursive: true, force: true })
})

const env = () => {
  const inherited = { ...process.env }
  // A runner's own step files must not leak into the fake fire.
  delete inherited.GITHUB_OUTPUT
  delete inherited.GITHUB_STEP_SUMMARY
  delete inherited.CLAUDE_CODE_OAUTH_TOKEN
  return {
    ...inherited,
    PATH: gh!.path,
    HOME: home,
    GITHUB_ACTIONS: '',
    GITHUB_REPOSITORY: REPO,
    DISPATCH_STATE_DIR: state,
    CLAUDE_BIN: join(bin, 'claude'),
    CLAUDE_CONFIG_DIR: join(home, '.claude')
  }
}

const script = () => join(repo, 'scripts', 'dispatch-local.sh')
// From outside the repository, to show the script finds its own checkout.
const run = (...args: string[]) =>
  spawnSync('bash', [script(), ...args], { cwd: root, encoding: 'utf8', env: env() })

const respond = (...responses: string[]) =>
  responses.forEach((r, i) => writeFileSync(join(bin, 'responses', `${i + 1}.json`), r))
const claudeCalls = () =>
  existsSync(join(bin, 'count')) ? Number(readFileSync(join(bin, 'count'), 'utf8')) : 0
const runDir = () => {
  const runs = readdirSync(join(state, 'runs'))
  expect(runs).toHaveLength(1)
  return join(state, 'runs', runs[0])
}
const summary = () => readFileSync(join(runDir(), 'summary.md'), 'utf8')
const status = () => readFileSync(join(runDir(), 'status'), 'utf8').trim()
const stubEnv = (n: number) =>
  Object.fromEntries(
    readFileSync(join(bin, `env-${n}`), 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )

describe.skipIf(!HAS_JQ || process.platform !== 'linux')('scripts/dispatch-local.sh', () => {
  it('stops at the identity gate when the token resolves to another login, and runs no cleanup', () => {
    gh = makeGhStub(routes({ login: 'someone-else' }))

    const { status: code, stdout } = run('cycle')

    expect(code).toBe(1)
    expect(stdout).toContain("machine token resolves to 'someone-else', expected 'birdbrain-agent'")
    expect(summary()).toContain('Failed: machine token resolves to')
    expect(status()).toBe('failure')
    expect(claudeCalls()).toBe(0)
    // Only the identity read: nothing is cleaned up for a fire that never held an identity.
    expect(gh.calls()).toEqual(['api user --jq "\\(.login)\\t\\(.id)"'])
  })

  it('ends an idle fire at the pre-gate without calling Claude, and still runs cleanup', () => {
    gh = makeGhStub(routes())

    const { status: code, stdout, stderr } = run('cycle')

    expect(code, stderr).toBe(0)
    expect(summary()).toContain('Identity: birdbrain-agent (id 42)')
    expect(summary()).toContain('Pre-gate: run=false (the slot is free but the queue is empty)')
    expect(summary()).toContain('Cleanup: done (job status success)')
    expect(stdout).toContain('ended: success (exit 0)')
    expect(status()).toBe('success')
    expect(claudeCalls()).toBe(0)
    expect(existsSync(join(state, 'ledger.jsonl'))).toBe(false)
    expect(existsSync(join(state, 'latest', 'summary.md'))).toBe(true)
    expect(existsSync(join(repo, '.dispatch'))).toBe(false)
  })

  it('runs a report-mode fire through the probe, the cycle and cleanup, and keeps the run', () => {
    gh = makeGhStub(routes())
    respond(result('ok'), result(REPORT))

    const { status: code, stderr } = run()

    expect(code, stderr).toBe(0)
    expect(claudeCalls()).toBe(2)
    // The probe reads the login the CLI holds; the cycle carries the machine identity and
    // the hook binding, and is told where it runs.
    expect(stubEnv(1).CLAUDE_TOKEN_SOURCE).toBe('login')
    const cycle = stubEnv(2)
    expect(cycle.GH_TOKEN).toBe(`ghp_${'x'.repeat(36)}`)
    expect(cycle.GIT_AUTHOR_NAME).toBe(PIPELINE)
    expect(cycle.GIT_COMMITTER_EMAIL).toBe('42+birdbrain-agent@users.noreply.github.com')
    expect(cycle.BIRDBRAIN_DISPATCH).toBe('1')
    expect(cycle.CLAUDE_CONFIG_DIR).toBe(join(home, '.claude'))
    const args = readFileSync(join(bin, 'args-2'), 'utf8').split('\0')
    const prompt = args[args.indexOf('-p') + 1]
    expect(prompt).toContain('MODE: REPORT-ONLY')
    expect(prompt).toContain(`${runDir()}/dispatch/reports/pr-<number>-<short sha>.md`)
    // The ledger records the paid cycle before it starts, with no target for report mode.
    const ledger = readFileSync(join(state, 'ledger.jsonl'), 'utf8').trim().split('\n')
    expect(ledger).toHaveLength(1)
    expect(JSON.parse(ledger[0])).toMatchObject({ mode: 'report', targets: [] })
    // The artifact moved into the run directory, and the checkout is clean of it.
    expect(readFileSync(join(runDir(), 'dispatch', 'report.md'), 'utf8').trim()).toBe(REPORT)
    expect(existsSync(join(repo, '.dispatch'))).toBe(false)
    expect(summary()).toContain('## Dispatch cycle (report)')
    expect(summary()).toContain(REPORT)
    expect(summary()).toContain("Claude credential: the CLI's stored login probe ok")
    expect(status()).toBe('success')
    // The workspace is trusted in the CLI's own config directory, so the hooks load.
    const config = JSON.parse(readFileSync(join(home, '.claude', '.claude.json'), 'utf8'))
    expect(config.projects[repo]).toEqual({ hasTrustDialogAccepted: true })
  })

  it('fails the fire when the cycle exits non-zero, and tells cleanup so', () => {
    gh = makeGhStub(routes())
    respond(result('ok'))
    // No second response: the cycle call exits 1 before a result.

    const { status: code, stdout } = run()

    expect(code).toBe(1)
    expect(stdout).toContain('Failed: the cycle exited 1')
    expect(status()).toBe('failure')
    expect(summary()).toContain('Cleanup: done (job status failure)')
    expect(existsSync(join(runDir(), 'dispatch', 'prompt.txt'))).toBe(true)
  })

  it('does nothing while another fire holds the lock', async () => {
    gh = makeGhStub(routes())
    mkdirSync(state, { recursive: true })
    const lock = join(state, 'lock')
    const holder = spawn('flock', [lock, 'sleep', '10'])
    try {
      for (let i = 0; i < 50 && spawnSync('flock', ['-n', lock, 'true']).status === 0; i++) {
        await sleep(100)
      }
      const { status: code, stderr } = run('cycle')
      expect(code).toBe(3)
      expect(stderr).toContain('holds')
      expect(existsSync(join(state, 'runs'))).toBe(true)
      expect(readdirSync(join(state, 'runs'))).toEqual([])
    } finally {
      holder.kill('SIGKILL')
    }
  })

  it('stops the cycle on SIGTERM, tells cleanup it was cancelled, and keeps the files', async () => {
    gh = makeGhStub(routes())
    respond(result('ok'), result(REPORT))
    writeFileSync(join(bin, 'hold-2'), '60')

    const child = spawn('bash', [script()], { cwd: root, env: env() })
    const exit = new Promise<number | null>((r) => child.on('close', (code) => r(code)))
    for (let i = 0; i < 300 && !existsSync(join(bin, 'args-2')); i++) await sleep(100)
    expect(existsSync(join(bin, 'args-2'))).toBe(true)
    await sleep(200)
    child.kill('SIGTERM')

    expect(await exit).toBe(143)
    expect(status()).toBe('cancelled')
    expect(summary()).toContain('Cleanup: done (job status cancelled)')
    expect(summary()).toContain('ended: cancelled (exit 143)')
    expect(existsSync(join(runDir(), 'dispatch', 'prompt.txt'))).toBe(true)
    expect(existsSync(join(repo, '.dispatch'))).toBe(false)
    // The held CLI call died with its process group rather than outliving the fire.
    expect(spawnSync('pgrep', ['-f', `sleep 60`], { encoding: 'utf8' }).stdout.trim()).toBe('')
  }, 60_000)

  it('rejects an argument it does not know', () => {
    gh = makeGhStub(routes())
    const { status: code, stderr } = run('--now')
    expect(code).toBe(2)
    expect(stderr).toContain("Unknown argument '--now'")
  })
})
