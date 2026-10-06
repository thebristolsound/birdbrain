import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'run.sh')
const SESSION = '5f1c2a3b-0000-4000-8000-000000000001'
const TRUNCATED = 'Waiting on CI for PR #1589 before the pre-pass. sk-ant-oat01-abcdefghijkl'
const REPORT = '## Dispatch cycle report\n\n- Slot: 0/1\n- Exited idle'
// Assembled at runtime, like the values in dispatchRedact.test.ts.
const CREDENTIAL = `ghp_${'Ab3'.repeat(12)}`

// A stand-in for the CLI: the nth call copies leave-<n>/ into the working directory,
// as the agent copies a reviewer report, prints responses/<n>.json, and exits with
// exit-<n> when that file exists. It records its arguments (NUL-separated, since the
// prompt spans lines), the background flag and the hook binding.
const STUB = `#!/usr/bin/env bash
dir="$(dirname "$0")"
n=$(( $(cat "$dir/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$dir/count"
printf '%s\\0' "$@" > "$dir/args-$n"
printf '%s' "\${CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:-}" > "$dir/env-$n"
printf '%s' "\${BIRDBRAIN_DISPATCH:-}" > "$dir/dispatch-env-$n"
if [ -d "$dir/leave-$n" ]; then cp -R "$dir/leave-$n/." .; fi
cat "$dir/responses/$n.json" || exit
if [ -f "$dir/exit-$n" ]; then exit "$(cat "$dir/exit-$n")"; fi
`

const result = (text: string, cost: number) => ({
  type: 'result',
  is_error: false,
  result: text,
  session_id: SESSION,
  total_cost_usd: cost,
  num_turns: 10,
  duration_ms: 1000,
  // Two models, so stripping the spend has to reach every entry.
  modelUsage: {
    'claude-opus-5-5': { inputTokens: 100, outputTokens: 20, costUSD: cost * 0.75 },
    'claude-haiku-4-5': { inputTokens: 50, outputTokens: 10, costUSD: cost * 0.25 }
  }
})

const SPEND = /cost/i

// The path of every key, at any depth, whose name reads as a spend figure.
const spendKeys = (value: unknown, path = ''): string[] => {
  if (Array.isArray(value)) return value.flatMap((item, i) => spendKeys(item, `${path}[${i}]`))
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => [
    ...(SPEND.test(key) ? [`${path}.${key}`] : []),
    ...spendKeys(item, `${path}.${key}`)
  ])
}

let root: string
let bin: string
let work: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dispatch-run-'))
  bin = join(root, 'bin')
  work = join(root, 'work')
  mkdirSync(join(bin, 'responses'), { recursive: true })
  mkdirSync(work)
  writeFileSync(join(bin, 'claude'), STUB)
  chmodSync(join(bin, 'claude'), 0o755)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const respond = (...responses: unknown[]) =>
  responses.forEach((response, index) =>
    writeFileSync(join(bin, 'responses', `${index + 1}.json`), JSON.stringify(response))
  )
const exitWith = (n: number, status: number) => writeFileSync(join(bin, `exit-${n}`), `${status}`)
// Keyed by path from the working directory.
const leave = (n: number, files: Record<string, string>) =>
  Object.entries(files).forEach(([path, text]) => {
    const target = join(bin, `leave-${n}`, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  })

const run = (env: Record<string, string> = {}) =>
  spawnSync('bash', [SCRIPT, 'cycle'], {
    cwd: work,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
      RUN_URL: 'https://example.test/run/1',
      ...env
    }
  })

const calls = () =>
  existsSync(join(bin, 'count')) ? Number(readFileSync(join(bin, 'count'), 'utf8')) : 0
const argsOf = (n: number) =>
  readFileSync(join(bin, `args-${n}`), 'utf8')
    .split('\0')
    .slice(0, -1)
const dispatchFile = (name: string) => readFileSync(join(work, '.dispatch', name), 'utf8')

describe('dispatch run.sh', () => {
  it('resumes a cycle that ended without its report, once, in the same session', () => {
    // The CLI's array shape on the first call, the object shape on the second.
    respond([{ type: 'system', session_id: SESSION }, result(TRUNCATED, 1.5)], result(REPORT, 0.5))

    const { status, stderr } = run()

    expect(status, stderr).toBe(0)
    expect(calls()).toBe(2)
    const resumeArgs = argsOf(2)
    expect(resumeArgs[resumeArgs.indexOf('--resume') + 1]).toBe(SESSION)
    expect(resumeArgs[resumeArgs.indexOf('-p') + 1]).toMatch(/no longer exists/)
    expect(dispatchFile('report.md').trim()).toBe(REPORT)
    expect(dispatchFile('report-1.md')).toContain('Waiting on CI')
    expect(dispatchFile('result-1.json')).toContain('sk-ant-<REDACTED>')
    expect(dispatchFile('result-1.json')).not.toContain('abcdefghijkl')
    expect(JSON.parse(dispatchFile('meta.json'))).toMatchObject({ turns: 20, calls: 2 })
  })

  it('fails when the resumed call still ends without a report', () => {
    respond(result(TRUNCATED, 1), result('The implementer is running in the background.', 1))

    const { status, stderr } = run()

    expect(status).not.toBe(0)
    expect(stderr).toMatch(/without a report heading after one resume/)
    expect(calls()).toBe(2)
  })

  it('does not resume a cycle that returned its report', () => {
    respond(result('**Dispatch cycle report — run 1**\n\nExited idle.', 1))

    const { status, stderr } = run()

    expect(status, stderr).toBe(0)
    expect(calls()).toBe(1)
    expect(existsSync(join(work, '.dispatch', 'result-1.json'))).toBe(false)
    expect(JSON.parse(dispatchFile('meta.json'))).toMatchObject({ calls: 1 })
  })

  it('runs the CLI with background tasks disabled and Monitor disallowed', () => {
    respond(result(REPORT, 1))

    expect(run().status).toBe(0)
    const args = argsOf(1)
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('Monitor')
    expect(readFileSync(join(bin, 'env-1'), 'utf8')).toBe('1')
    expect(args[args.indexOf('-p') + 1]).toMatch(/run_in_background: false/)
  })

  it('scrubs the prompt file before a failed cycle exits', () => {
    // No response is queued, so the stub CLI exits non-zero and the cycle fails.
    const { status } = run({ TARGET_ISSUE: `1 ${CREDENTIAL}` })

    expect(status).not.toBe(0)
    expect(calls()).toBe(1)
    expect(dispatchFile('prompt.txt')).toContain('ISSUE #1 ghp_<REDACTED>')
    expect(dispatchFile('prompt.txt')).not.toContain(CREDENTIAL)
  })

  it('keeps the spend out of meta.json and both result files', () => {
    respond([{ type: 'system', session_id: SESSION }, result(TRUNCATED, 1.25)], result(REPORT, 0.5))

    const { status, stderr } = run()

    expect(status, stderr).toBe(0)
    const files = ['meta.json', 'result.json', 'result-1.json']
    const spend = files.map((name) => [name, spendKeys(JSON.parse(dispatchFile(name)))])
    expect(Object.fromEntries(spend)).toEqual(Object.fromEntries(files.map((name) => [name, []])))
    // Only the spend goes: the token counts beside it stay.
    expect(JSON.parse(dispatchFile('result.json')).modelUsage).toEqual({
      'claude-opus-5-5': { inputTokens: 100, outputTokens: 20 },
      'claude-haiku-4-5': { inputTokens: 50, outputTokens: 10 }
    })
  })

  it('keeps the spend out of the run summary and the report in it', () => {
    respond([{ type: 'system', session_id: SESSION }, result(TRUNCATED, 1.25)], result(REPORT, 0.5))

    const { status, stderr } = run()

    expect(status, stderr).toBe(0)
    const summary = readFileSync(join(root, 'summary.md'), 'utf8')
    expect(summary).toContain(REPORT)
    expect(summary).not.toMatch(SPEND)
    expect(summary).not.toContain('1.75')
  })

  it('scrubs every file the agent left under reports/, after the resumed call too', () => {
    const report = (n: number) => `Full report\n\nThe log quoted ${CREDENTIAL} at step ${n}.\n`
    respond(result(TRUNCATED, 1), result(REPORT, 1))
    leave(1, { '.dispatch/reports/pr-1589-abc1234.md': report(1) })
    leave(2, { '.dispatch/reports/round-2/pr-1589-def5678.md': report(2) })

    const { status, stderr } = run()

    expect(status, stderr).toBe(0)
    expect(calls()).toBe(2)
    expect(dispatchFile('reports/pr-1589-abc1234.md')).toBe(
      report(1).replace(CREDENTIAL, 'ghp_<REDACTED>')
    )
    expect(dispatchFile('reports/round-2/pr-1589-def5678.md')).toBe(
      report(2).replace(CREDENTIAL, 'ghp_<REDACTED>')
    )
    expect(readdirSync(join(work, '.dispatch', 'reports')).sort()).toEqual([
      'pr-1589-abc1234.md',
      'round-2'
    ])
  })

  it('strips the spend and scrubs the reports before a failed call exits', () => {
    respond({ ...result('API Error: 529 overloaded', 3.25), is_error: true })
    exitWith(1, 1)
    leave(1, { '.dispatch/reports/pr-1589-abc1234.md': `${CREDENTIAL}\n` })

    const { status, stderr } = run()

    expect(status).toBe(1)
    expect(stderr).toContain('claude -p exited 1')
    expect(stderr).toContain('API Error: 529 overloaded')
    expect(stderr).not.toMatch(SPEND)
    expect(spendKeys(JSON.parse(dispatchFile('result.json')))).toEqual([])
    expect(dispatchFile('reports/pr-1589-abc1234.md')).toBe('ghp_<REDACTED>\n')
  })

  it("prints a failed call's stdout when it is not JSON", () => {
    writeFileSync(join(bin, 'responses', '1.json'), 'Error: the CLI stopped before its result\n')
    exitWith(1, 3)

    const { status, stderr } = run()

    expect(status).toBe(3)
    expect(stderr).toContain('claude -p exited 3')
    expect(stderr).toContain('Error: the CLI stopped before its result')
  })

  it('keeps the stream as a scrubbed transcript without the spend, and reads the result from it', () => {
    const stream = [
      { type: 'system', subtype: 'init', session_id: SESSION },
      { type: 'assistant', message: { content: [{ type: 'text', text: `token ${CREDENTIAL}` }] } },
      result(REPORT, 2)
    ]
    writeFileSync(
      join(bin, 'responses', '1.json'),
      `${stream.map((event) => JSON.stringify(event)).join('\n')}\nnot json\n`
    )

    const { status, stderr } = run()

    expect(status, stderr).toBe(0)
    const lines = dispatchFile('transcript.jsonl').trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe('not json')
    expect(lines[1]).toContain('ghp_<REDACTED>')
    expect(lines.slice(0, 3).flatMap((line) => spendKeys(JSON.parse(line)))).toEqual([])
    expect(JSON.parse(dispatchFile('result.json'))).toMatchObject({
      type: 'result',
      result: REPORT
    })
    const args = argsOf(1)
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json')
    expect(args).toContain('--verbose')
  })

  it('binds the posting hooks to every session of the cycle', () => {
    respond(result(REPORT, 1))

    expect(run().status).toBe(0)
    expect(readFileSync(join(bin, 'dispatch-env-1'), 'utf8')).toBe('1')
  })

  it('on Actions, trusts the workspace and swaps includeIf credentials for a plain include', () => {
    respond(result(REPORT, 1))
    const home = join(root, 'home')
    mkdirSync(home)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: work, encoding: 'utf8' })
    git('init', '-q')
    git('config', '--local', 'includeIf.gitdir:/w/.git.path', '/tmp/cred.config')
    git('config', '--local', 'includeIf.gitdir:/w/.git/worktrees/*.path', '/tmp/cred.config')

    const { status, stderr } = run({ GITHUB_ACTIONS: 'true', HOME: home })

    expect(status, stderr).toBe(0)
    expect(git('config', '--local', '--get-regexp', '^include').trim()).toBe(
      'include.path /tmp/cred.config'
    )
    const config = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    expect(Object.values(config.projects)).toEqual([{ hasTrustDialogAccepted: true }])
  })
})
