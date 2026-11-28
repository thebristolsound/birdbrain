import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'
import { type GhStub, makeGhStub } from './helpers/ghStub'

// phase.sh is copied into a throwaway repository beside stand-ins for the step scripts it
// calls, so each test reads what one phase passed on and left behind, and nothing here
// depends on what the real pre-gate or cycle does.
const SOURCE = resolve(__dirname, '..')
const PHASE = 'scripts/dispatch-workflow/phase.sh'
const LIB = '.github/scripts/dispatch/lib.sh'
const PIPELINE = 'birdbrain-agent'
const MAINTAINER = readFileSync(join(SOURCE, LIB), 'utf8').match(/^MAINTAINER='(.+)'$/m)?.[1]
// Assembled at runtime, like the values in dispatchRedact.test.ts.
const TOKEN = `ghp_${'Ab3'.repeat(12)}`
const RUN = 'run-1'

// What each stand-in does besides recording its call and environment. The cycle stand-in
// holds while plan/run.hold exists and plan/run.release does not, so a test decides when it
// ends.
const STEP_BODIES: Record<string, string> = {
  '.github/scripts/dispatch/pregate.sh': `if [ -f "$plan/targets" ]; then echo "::notice title=Dispatch target::$(cat "$plan/targets")"; fi
if [ -f "$plan/gate.out" ]; then cat "$plan/gate.out" >> "$GITHUB_OUTPUT"; fi`,
  '.github/scripts/dispatch/run.sh': `mkdir -p .dispatch
echo report > .dispatch/report.md
if [ -f "$plan/run.hold" ]; then while [ ! -f "$plan/run.release" ]; do sleep 0.1; done; fi`,
  '.github/scripts/dispatch/cleanup.sh':
    'echo "Cleanup: done (job status $JOB_STATUS)" >> "$GITHUB_STEP_SUMMARY"',
  '.github/scripts/dispatch/postcheck.sh': '',
  '.github/scripts/dispatch/friction.sh': '',
  '.github/scripts/dispatch/scrub.sh':
    'if [ -d .dispatch ]; then echo scrubbed > .dispatch/scrubbed; fi',
  '.github/scripts/health/claude-token.sh': 'echo "::notice::a notice line"\necho "probe ok"',
  'scripts/setup-worktree.sh': 'mkdir -p node_modules/electron/dist'
}
// The identity phase refuses a checkout whose step scripts do not name these.
const MARKERS: Record<string, string> = {
  '.github/scripts/dispatch/pregate.sh': 'DISPATCH_LOCAL_LEDGER',
  '.github/scripts/dispatch/run.sh': 'DISPATCH_HOST',
  '.github/scripts/health/claude-token.sh': 'CLAUDE_TOKEN_SOURCE'
}

let root: string
let repo: string
let home: string
let state: string
let plan: string
let claudeBin: string
let gh: GhStub | undefined

const writeStep = (rel: string, { marker = true }: { marker?: boolean } = {}) => {
  const file = join(repo, rel)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(
    file,
    `#!/usr/bin/env bash
${marker && MARKERS[rel] ? `# Reads ${MARKERS[rel]}.` : '# A stand-in.'}
name="$(basename "$0" .sh)"
plan='${plan}'
env > "$plan/env-$name"
echo "$name $*" >> "$plan/calls"
${STEP_BODIES[rel]}
if [ -f "$plan/$name.exit" ]; then exit "$(cat "$plan/$name.exit")"; fi
`
  )
}

const identityFile = (lines: Record<string, string>) =>
  writeFileSync(
    join(home, '.config', 'birdbrain-agent', 'env'),
    Object.entries(lines)
      .map(([key, value]) => `${key}=${value}\n`)
      .join('')
  )

const stubGh = (login: string | null = PIPELINE) => {
  gh?.cleanup()
  gh = makeGhStub({ user: login === null ? null : { login, id: 42 } })
  // mise would put its own gh ahead of the stub and resolve tools against the fake HOME.
  writeFileSync(join(gh.dir, 'mise'), '#!/usr/bin/env bash\nexit 0\n')
  chmodSync(join(gh.dir, 'mise'), 0o755)
}

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const inherited = { ...process.env }
  // A runner's own step files and a developer's own settings must not leak into the phase.
  for (const key of [
    'GITHUB_OUTPUT',
    'GITHUB_STEP_SUMMARY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_TOKEN_SOURCE',
    'GH_TOKEN',
    'XDG_STATE_HOME',
    'BIRDBRAIN_AGENT_ENV_FILE',
    'RUN_ID',
    'MODE',
    'TARGET_ISSUE',
    'JOB_STATUS',
    'DISPATCH_TIMEOUT_MINUTES',
    'DISPATCH_KEEP_DAYS',
    'DISPATCH_MODEL',
    'DISPATCH_EFFORT'
  ]) {
    delete inherited[key]
  }
  return {
    ...inherited,
    PATH: gh!.path,
    HOME: home,
    DISPATCH_STATE_DIR: state,
    CLAUDE_BIN: claudeBin,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    ...extra
  }
}

// From outside the repository, to show the script finds its own checkout.
const phase = (name: string, run = RUN, extra: NodeJS.ProcessEnv = {}) =>
  spawnSync('bash', [join(repo, PHASE), name], {
    cwd: root,
    encoding: 'utf8',
    env: env({ RUN_ID: run, ...extra })
  })
const pass = (names: string[], run = RUN, extra: NodeJS.ProcessEnv = {}) => {
  for (const name of names) {
    const result = phase(name, run, extra)
    expect(result.status, `${name}: ${result.stderr}`).toBe(0)
  }
}

const runDir = (run = RUN) => join(state, 'runs', run)
const left = (name: string, run = RUN) => readFileSync(join(runDir(run), name), 'utf8')
const calls = () =>
  existsSync(join(plan, 'calls'))
    ? readFileSync(join(plan, 'calls'), 'utf8').split('\n').filter(Boolean)
    : []
const stepEnv = (name: string): Record<string, string> =>
  Object.fromEntries(
    readFileSync(join(plan, `env-${name}`), 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )
const gate = (decision: string) => writeFileSync(join(plan, 'gate.out'), decision)
const hold = () => writeFileSync(join(plan, 'run.hold'), '')
const cyclePid = (run = RUN) => Number(left('cycle.pid', run).split(' ')[0])
const groupAlive = (pid: number) => {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 25))
  expect(condition()).toBe(true)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dispatch-phase-'))
  repo = join(root, 'repo')
  home = join(root, 'home')
  state = join(root, 'state')
  plan = join(root, 'plan')
  claudeBin = join(root, 'claude')
  mkdirSync(plan)
  mkdirSync(join(home, '.config', 'birdbrain-agent'), { recursive: true })
  mkdirSync(join(home, '.claude'), { recursive: true })
  identityFile({
    BIRDBRAIN_AGENT_GH_LOGIN: PIPELINE,
    BIRDBRAIN_AGENT_GH_TOKEN: TOKEN,
    BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES: '2099-01-01'
  })
  stubGh()
  for (const rel of [PHASE, LIB]) cpSync(join(SOURCE, rel), join(repo, rel))
  for (const rel of Object.keys(STEP_BODIES)) writeStep(rel)
  mkdirSync(join(repo, 'node_modules', 'electron', 'dist'), { recursive: true })
  // The toolchain phase compares the Node on PATH with the pin, so the pin is that Node.
  const node = spawnSync('node', ['--version'], { encoding: 'utf8', env: env() }).stdout
  writeFileSync(join(repo, '.nvmrc'), `${node.trim().replace(/^v(\d+).*/, '$1')}\n`)
  writeFileSync(claudeBin, '#!/usr/bin/env bash\necho "9.9.9 (stub)"\n')
  chmodSync(claudeBin, 0o755)
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: repo, env: env() })
  git('init', '-q')
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.test',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  )
})

afterEach(() => {
  // A test that left a cycle running must not leave its process group behind.
  if (existsSync(join(state, 'runs'))) {
    for (const run of readdirSync(join(state, 'runs'))) {
      if (!existsSync(join(runDir(run), 'cycle.pid'))) continue
      try {
        process.kill(-cyclePid(run), 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
  gh?.cleanup()
  gh = undefined
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!HAS_JQ || process.platform !== 'linux')(
  'scripts/dispatch-workflow/phase.sh',
  () => {
    describe('usage', () => {
      it.each([
        ['an unknown phase', 'deploy', {}],
        ['a run id that is not a file name', 'identity', { RUN_ID: '../escape' }],
        ['an unknown mode', 'identity', { MODE: 'fast' }],
        ['a target that is not a number', 'identity', { TARGET_ISSUE: '12; rm' }]
      ])('exits 2 on %s and reads nothing', (_title, name, extra) => {
        const result = phase(name, RUN, extra)

        expect(result.status).toBe(2)
        expect(gh!.calls()).toEqual([])
        expect(existsSync(join(root, 'escape'))).toBe(false)
      })
    })

    describe('identity', () => {
      it('records the machine login and keeps the token out of everything it writes', () => {
        const result = phase('identity')

        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout.trim()).toMatch(
          /^Identity: birdbrain-agent \(id 42\), token expires 2099-01-01, run started \d{4}-/
        )
        expect(left('identity')).toBe('birdbrain-agent\t42\n')
        expect(left('summary.md')).toContain('Identity: birdbrain-agent (id 42)')
        expect(result.stdout + result.stderr + left('summary.md')).not.toContain(TOKEN)
      })

      it.each([
        ['resolves to another login', 'someone-else', /resolves to 'someone-else', expected/],
        ['resolves to the maintainer', MAINTAINER!, /resolves to the maintainer; ADR-0027 forbids/]
      ])('fails when the token %s', (_title, login, reason) => {
        stubGh(login)
        // The maintainer case has to pass the expected-login check to reach its own.
        identityFile({
          BIRDBRAIN_AGENT_GH_LOGIN: login === MAINTAINER ? login : PIPELINE,
          BIRDBRAIN_AGENT_GH_TOKEN: TOKEN,
          BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES: '2099-01-01'
        })

        const result = phase('identity')

        expect(result.status).toBe(1)
        expect(result.stderr).toMatch(reason)
        expect(left('summary.md')).toMatch(/^Failed: machine token resolves to/m)
        expect(existsSync(join(runDir(), 'identity'))).toBe(false)
      })

      it('fails on an expired token before it asks GitHub anything', () => {
        identityFile({
          BIRDBRAIN_AGENT_GH_LOGIN: PIPELINE,
          BIRDBRAIN_AGENT_GH_TOKEN: TOKEN,
          BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES: '2000-01-01'
        })

        const result = phase('identity')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('machine token expired on 2000-01-01')
        expect(gh!.calls()).toEqual([])
      })

      it('fails when the identity file leaves a value out', () => {
        identityFile({ BIRDBRAIN_AGENT_GH_LOGIN: PIPELINE, BIRDBRAIN_AGENT_GH_TOKEN: TOKEN })

        const result = phase('identity')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('must set BIRDBRAIN_AGENT_GH_TOKEN')
        expect(gh!.calls()).toEqual([])
      })

      it('fails when the identity file is missing', () => {
        const result = phase('identity', RUN, { BIRDBRAIN_AGENT_ENV_FILE: join(root, 'absent') })

        expect(result.status).toBe(1)
        expect(result.stderr).toContain(`machine identity file ${join(root, 'absent')} is missing`)
      })

      it('fails with the last line gh printed when GitHub rejects the token', () => {
        stubGh(null)

        const result = phase('identity')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('GitHub rejected the machine token: gh stub: no route')
        expect(existsSync(join(runDir(), 'identity'))).toBe(false)
      })

      it.each([
        ['.github/scripts/dispatch/pregate.sh', /pre-gate does not read DISPATCH_LOCAL_LEDGER/],
        ['.github/scripts/dispatch/run.sh', /run\.sh does not read DISPATCH_HOST/],
        [
          '.github/scripts/health/claude-token.sh',
          /claude-token\.sh does not read CLAUDE_TOKEN_SOURCE/
        ]
      ])('refuses a checkout whose %s lacks local-host support', (rel, reason) => {
        writeStep(rel, { marker: false })

        const result = phase('identity')

        expect(result.status).toBe(1)
        expect(result.stderr).toMatch(reason)
        expect(gh!.calls()).toEqual([])
      })
    })

    describe('pregate', () => {
      it('fails when the identity phase has not passed for the run', () => {
        const result = phase('pregate')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain(`the identity phase has not passed for run ${RUN}`)
        expect(calls()).toEqual([])
      })

      it('hands the pre-gate the machine identity, the mode, the target and the ledger', () => {
        pass(['identity'])
        writeFileSync(join(runDir(), 'started'), '2026-01-01T00:00:00Z\n')
        gate('run=true\nreason=a PR needs a pre-pass\n')

        const result = phase('pregate', RUN, { MODE: 'cycle', TARGET_ISSUE: '1234' })

        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout.trim()).toBe('run')
        expect(calls()).toEqual(['pregate cycle'])
        const seen = stepEnv('pregate')
        expect(seen.GH_TOKEN).toBe(TOKEN)
        expect(seen.LOGIN).toBe(PIPELINE)
        expect(seen.TARGET_ISSUE).toBe('1234')
        expect(seen.DISPATCH_LOCAL_LEDGER).toBe(join(state, 'ledger.jsonl'))
        expect(seen.GITHUB_STEP_SUMMARY).toBe(join(runDir(), 'summary.md'))
        // A phase that runs later keeps the start the first phase of the run recorded.
        expect(seen.STARTED).toBe('2026-01-01T00:00:00Z')
      })

      it('starts an empty ledger for the pre-gate on the first fire, and keeps one that exists', () => {
        pass(['identity'])
        gate('run=true\nreason=a PR needs a pre-pass\n')
        const ledger = join(state, 'ledger.jsonl')
        expect(existsSync(ledger)).toBe(false)

        expect(phase('pregate').status).toBe(0)
        expect(readFileSync(ledger, 'utf8')).toBe('')

        const line = '{"at":"2026-01-01T00:00:00Z","targets":null,"mode":"report","run":"r"}\n'
        writeFileSync(ledger, line)
        expect(phase('pregate').status).toBe(0)
        expect(readFileSync(ledger, 'utf8')).toBe(line)
      })

      it('reports an idle fire with the reason the pre-gate gave', () => {
        pass(['identity'])
        gate('run=false\nreason=the slot is free but the queue is empty\n')

        const result = phase('pregate')

        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout.trim()).toBe('idle: the slot is free but the queue is empty')
      })

      it('fails when the pre-gate exits 0 without a decision', () => {
        pass(['identity'])

        const result = phase('pregate')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('pre-gate exited 0 without a run= decision')
      })

      it('fails when the pre-gate exits non-zero, whatever it decided first', () => {
        pass(['identity'])
        gate('run=true\nreason=a PR needs a pre-pass\n')
        writeFileSync(join(plan, 'pregate.exit'), '1')

        const result = phase('pregate')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('pre-gate exited non-zero')
        expect(result.stdout).toBe('')
      })
    })

    describe('toolchain', () => {
      it('gives later phases the named CLI as the only claude and clears a stale .dispatch', () => {
        mkdirSync(join(repo, '.dispatch'))
        writeFileSync(join(repo, '.dispatch', 'stale.md'), 'from an earlier run')

        const result = phase('toolchain')

        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout).toContain(`claude 9.9.9 (stub) at ${claudeBin}`)
        expect(existsSync(join(repo, '.dispatch'))).toBe(false)
        const shim = spawnSync(join(runDir(), 'bin', 'claude'), ['--version'], { encoding: 'utf8' })
        expect(shim.stdout.trim()).toBe('9.9.9 (stub)')
        pass(['credential'])
        expect(stepEnv('claude-token').PATH.startsWith(`${join(runDir(), 'bin')}:`)).toBe(true)
      })

      it('fails when the Node on PATH is not the pinned major', () => {
        writeFileSync(join(repo, '.nvmrc'), '1\n')

        const result = phase('toolchain')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('this repository pins Node 1')
      })

      it('fails when no Claude Code CLI is found', () => {
        const result = phase('toolchain', RUN, { CLAUDE_BIN: join(root, 'absent') })

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('no Claude Code CLI found')
        expect(existsSync(join(runDir(), 'bin', 'claude'))).toBe(false)
      })

      it('installs dependencies when the checkout has none, and fails when that fails', () => {
        rmSync(join(repo, 'node_modules'), { recursive: true })

        expect(phase('toolchain').status).toBe(0)
        expect(calls()).toEqual(['setup-worktree '])

        rmSync(join(repo, 'node_modules'), { recursive: true })
        writeFileSync(join(plan, 'setup-worktree.exit'), '1')
        const failed = phase('toolchain')
        expect(failed.status).toBe(1)
        expect(failed.stderr).toContain('scripts/setup-worktree.sh failed')
      })
    })

    describe('ledger', () => {
      it('records one paid cycle per run with the targets the pre-gate named', () => {
        pass(['identity'])
        gate('run=true\nreason=two PRs need a pre-pass\n')
        writeFileSync(join(plan, 'targets'), '12 34')
        pass(['pregate', 'ledger'])

        const again = phase('ledger')

        expect(again.status, again.stderr).toBe(0)
        expect(again.stdout).toContain(`run ${RUN} is already recorded`)
        const lines = readFileSync(join(state, 'ledger.jsonl'), 'utf8').trim().split('\n')
        expect(lines).toHaveLength(1)
        const entry = JSON.parse(lines[0])
        expect(entry).toMatchObject({ targets: [12, 34], mode: 'report', run: RUN })
        expect(entry.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
      })

      it('records null targets when the pre-gate named none, which the cap counts for all', () => {
        pass(['identity'])
        gate('run=true\nreason=report mode always runs\n')
        pass(['pregate', 'ledger'])
        pass(['identity', 'pregate', 'ledger'], 'run-2')

        const entries = readFileSync(join(state, 'ledger.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(entries.map(({ run, targets }) => ({ run, targets }))).toEqual([
          { run: RUN, targets: null },
          { run: 'run-2', targets: null }
        ])
      })
    })

    describe('credential', () => {
      it('probes the login the CLI holds when the environment carries no token', () => {
        const result = phase('credential')

        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout.trim()).toBe('Claude credential: probe ok')
        expect(stepEnv('claude-token').CLAUDE_TOKEN_SOURCE).toBe('login')
      })

      it('probes the token when the environment carries one', () => {
        pass(['credential'], RUN, { CLAUDE_CODE_OAUTH_TOKEN: 'a-token' })

        expect(stepEnv('claude-token').CLAUDE_TOKEN_SOURCE).toBe('token')
      })

      it('fails with the first line of the probe that is not an annotation', () => {
        writeFileSync(join(plan, 'claude-token.exit'), '1')

        const result = phase('credential')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('Claude credential probe failed: probe ok')
      })
    })

    describe('cycle-start and cycle-check', () => {
      it('launches the cycle once as the machine account and reports it until it ends', async () => {
        pass(['identity', 'toolchain'])
        hold()

        const started = phase('cycle-start')

        expect(started.status, started.stderr).toBe(0)
        expect(started.stdout.trim()).toBe(`Cycle: launched as process group ${cyclePid()}`)
        await until(() => calls().includes('run report'))
        expect(phase('cycle-check').stdout.trim()).toBe('running')
        const seen = stepEnv('run')
        expect(seen.GH_TOKEN).toBe(TOKEN)
        expect(seen.GIT_AUTHOR_NAME).toBe(PIPELINE)
        expect(seen.GIT_COMMITTER_EMAIL).toBe('42+birdbrain-agent@users.noreply.github.com')
        expect(seen.DISPATCH_HOST).toBe('local')
        expect(seen.DISPATCH_RUN_DIR).toBe(runDir())
        expect(seen.PWD).toBe(repo)

        const again = phase('cycle-start')
        expect(again.status, again.stderr).toBe(0)
        expect(again.stdout).toContain('already launched')

        writeFileSync(join(plan, 'run.release'), '')
        await until(() => existsSync(join(runDir(), 'cycle.exit')))
        const ended = phase('cycle-check')
        expect(ended.status, ended.stderr).toBe(0)
        expect(ended.stdout).toMatch(/^Cycle: finished/)
        expect(calls().filter((call) => call.startsWith('run '))).toEqual(['run report'])
      })

      it('trusts the workspace in the CLI configuration without touching other entries', async () => {
        const config = join(home, '.claude', '.claude.json')
        writeFileSync(config, JSON.stringify({ projects: { '/elsewhere': { kept: true } } }))
        pass(['identity', 'cycle-start'])
        await until(() => existsSync(join(runDir(), 'cycle.exit')))

        const { projects } = JSON.parse(readFileSync(config, 'utf8'))
        expect(projects['/elsewhere']).toEqual({ kept: true })
        expect(projects[repo]).toEqual({ hasTrustDialogAccepted: true })
      })

      it.each([
        ['3', /the cycle exited 3/],
        ['124', /the cycle ran past 110 minutes and was stopped/]
      ])('fails the check when the cycle exits %s', async (code, reason) => {
        writeFileSync(join(plan, 'run.exit'), code)
        pass(['identity', 'cycle-start'])
        await until(() => existsSync(join(runDir(), 'cycle.exit')))

        const result = phase('cycle-check')

        expect(result.status).toBe(1)
        expect(result.stderr).toMatch(reason)
      })

      it('fails the check, and launches nothing again, when the cycle died with no exit status', async () => {
        hold()
        pass(['identity', 'cycle-start'])
        await until(() => calls().includes('run report'))
        process.kill(-cyclePid(), 'SIGKILL')

        const result = phase('cycle-check')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain("the cycle's process is gone and left no exit status")
        expect(phase('cycle-start').stdout).toContain('already launched')
        expect(calls().filter((call) => call.startsWith('run '))).toHaveLength(1)
      })

      it('reads a process id recorded before a reboot as a cycle that is gone', async () => {
        hold()
        pass(['identity', 'cycle-start'])
        await until(() => calls().includes('run report'))
        const [pid, , launched] = left('cycle.pid').trim().split(' ')
        writeFileSync(join(runDir(), 'cycle.pid'), `${pid} an-earlier-boot ${launched}\n`)

        const result = phase('cycle-check')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain("the cycle's process is gone and left no exit status")
        process.kill(-Number(pid), 'SIGKILL')
      })

      it('fails the check once the cycle has outlived its limit', async () => {
        hold()
        pass(['identity', 'cycle-start'])
        await until(() => calls().includes('run report'))
        const [pid, boot] = left('cycle.pid').split(' ')
        writeFileSync(join(runDir(), 'cycle.pid'), `${pid} ${boot} 1\n`)

        const result = phase('cycle-check')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('the cycle is still running 113 minutes after its launch')
      })

      it('refuses to launch a cycle whose earlier launch was interrupted', () => {
        pass(['identity'])
        writeFileSync(join(runDir(), 'cycle.launched'), '')

        const result = phase('cycle-start')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain(
          'interrupted while launching the cycle; it is not run again'
        )
        expect(calls()).toEqual([])
      })

      it('fails the check when no cycle was launched', () => {
        pass(['identity'])

        const result = phase('cycle-check')

        expect(result.status).toBe(1)
        expect(result.stderr).toContain(`no cycle was launched for run ${RUN}`)
      })
    })

    describe('postcheck', () => {
      it('runs the post-check as the machine account and fails when it does', () => {
        pass(['identity', 'postcheck'])
        expect(stepEnv('postcheck').GH_TOKEN).toBe(TOKEN)
        expect(stepEnv('postcheck').LOGIN).toBe(PIPELINE)

        writeFileSync(join(plan, 'postcheck.exit'), '1')
        const failed = phase('postcheck')
        expect(failed.status).toBe(1)
        expect(failed.stderr).toContain('post-check found a problem')
      })
    })

    describe('finish', () => {
      it('cleans up with the job status, scrubs, and keeps the run', () => {
        pass(['identity'])
        mkdirSync(join(repo, '.dispatch'))
        writeFileSync(join(repo, '.dispatch', 'report.md'), 'report')

        const result = phase('finish', RUN, { JOB_STATUS: 'success' })

        expect(result.status, result.stderr).toBe(0)
        expect(calls()).toEqual(['cleanup ', 'scrub '])
        const seen = stepEnv('cleanup')
        expect(seen.JOB_STATUS).toBe('success')
        expect(seen.GH_TOKEN).toBe(TOKEN)
        expect(seen.LOGIN).toBe(PIPELINE)
        expect(seen.STARTED).toBe(left('started').trim())
        expect(existsSync(join(repo, '.dispatch'))).toBe(false)
        expect(left('dispatch/report.md')).toBe('report')
        expect(left('dispatch/scrubbed')).toBe('scrubbed\n')
        expect(left('status').trim()).toBe('success')
        expect(readlinkSync(join(state, 'latest'))).toBe(`runs/${RUN}`)
        expect(left('summary.md')).toContain(`Run ${RUN} ended: success`)
      })

      it('reads a missing job status as failure', () => {
        pass(['identity', 'finish'])

        expect(stepEnv('cleanup').JOB_STATUS).toBe('failure')
        expect(left('status').trim()).toBe('failure')
      })

      it('runs no cleanup for a run that never held an identity', () => {
        const result = phase('finish', RUN, { JOB_STATUS: 'failure' })

        expect(result.status, result.stderr).toBe(0)
        expect(calls()).toEqual([])
        expect(left('status').trim()).toBe('failure')
      })

      it('exits non-zero when cleanup fails, after it has still scrubbed and kept the run', () => {
        pass(['identity'])
        mkdirSync(join(repo, '.dispatch'))
        writeFileSync(join(plan, 'cleanup.exit'), '1')

        const result = phase('finish', RUN, { JOB_STATUS: 'success' })

        expect(result.status).toBe(1)
        expect(result.stderr).toContain('Cleanup step failed')
        expect(left('dispatch/scrubbed')).toBe('scrubbed\n')
        expect(left('status').trim()).toBe('success')
      })

      it('stops a cycle that is still running, and no other run starts one meanwhile', async () => {
        hold()
        pass(['identity', 'toolchain', 'cycle-start'])
        await until(() => calls().includes('run report'))
        const pid = cyclePid()

        const second = phase('toolchain', 'run-2')
        expect(second.status).toBe(1)
        expect(second.stderr).toContain(
          `run ${RUN} still has a cycle running; this fire does not start a second one`
        )
        expect(existsSync(join(repo, '.dispatch', 'report.md'))).toBe(true)

        const result = phase('finish', RUN, { JOB_STATUS: 'cancelled' })

        expect(result.status, result.stderr).toBe(0)
        expect(groupAlive(pid)).toBe(false)
        expect(stepEnv('cleanup').JOB_STATUS).toBe('cancelled')
        expect(left('status').trim()).toBe('cancelled')
        expect(phase('toolchain', 'run-2').status).toBe(0)
      })

      it('posts friction notes once, for a cycle-mode run that launched a cycle', async () => {
        const cycle = { MODE: 'cycle' }
        pass(['identity', 'cycle-start'], RUN, cycle)
        await until(() => existsSync(join(runDir(), 'cycle.exit')))
        pass(['finish', 'finish'], RUN, { ...cycle, JOB_STATUS: 'success' })

        expect(calls().filter((call) => call.startsWith('friction'))).toEqual(['friction '])
        expect(stepEnv('friction').GITHUB_SHA).toMatch(/^[0-9a-f]{40}$/)
        expect(stepEnv('friction').GH_TOKEN).toBe(TOKEN)
      })

      it.each([
        ['a report-mode run', {}, ['identity', 'cycle-start']],
        ['a cycle-mode run that launched no cycle', { MODE: 'cycle' }, ['identity']]
      ])('posts no friction notes for %s', async (_title, mode, phases) => {
        pass(phases, RUN, mode)
        if (phases.includes('cycle-start')) {
          await until(() => existsSync(join(runDir(), 'cycle.exit')))
        }
        pass(['finish'], RUN, { ...mode, JOB_STATUS: 'success' })

        expect(calls().filter((call) => call.startsWith('friction'))).toEqual([])
      })

      it('prunes runs older than the keep window and leaves newer ones', () => {
        const days = (n: number) => new Date(Date.now() - n * 86_400_000)
        for (const [run, age] of [
          ['old', 9],
          ['recent', 2]
        ] as const) {
          mkdirSync(runDir(run), { recursive: true })
          utimesSync(runDir(run), days(age), days(age))
        }

        pass(['finish'], RUN, { JOB_STATUS: 'success' })

        expect(readdirSync(join(state, 'runs')).sort()).toEqual(['recent', RUN].sort())
      })
    })
  }
)
