import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'run.sh')
const SESSION = '5f1c2a3b-0000-4000-8000-000000000001'
const TRUNCATED = 'Waiting on CI for PR #1589 before the pre-pass. sk-ant-oat01-abcdefghijkl'
const REPORT = '## Dispatch cycle report\n\n- Slot: 0/1\n- Exited idle'

// A stand-in for the CLI: the nth call prints responses/<n>.json and records its
// arguments (NUL-separated, since the prompt spans lines) and the background flag.
const STUB = `#!/usr/bin/env bash
dir="$(dirname "$0")"
n=$(( $(cat "$dir/count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$dir/count"
printf '%s\\0' "$@" > "$dir/args-$n"
printf '%s' "\${CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:-}" > "$dir/env-$n"
cat "$dir/responses/$n.json"
`

const result = (text: string, cost: number) => ({
  type: 'result',
  is_error: false,
  result: text,
  session_id: SESSION,
  total_cost_usd: cost,
  num_turns: 10,
  duration_ms: 1000
})

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
    expect(JSON.parse(dispatchFile('meta.json'))).toMatchObject({ cost: 2, turns: 20, calls: 2 })
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
    expect(JSON.parse(dispatchFile('meta.json'))).toMatchObject({ cost: 1, calls: 1 })
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
    // Assembled at runtime, like the values in dispatchRedact.test.ts.
    const credential = `ghp_${'Ab3'.repeat(12)}`

    // No response is queued, so the stub CLI exits non-zero and the cycle fails.
    const { status } = run({ TARGET_ISSUE: `1 ${credential}` })

    expect(status).not.toBe(0)
    expect(calls()).toBe(1)
    expect(dispatchFile('prompt.txt')).toContain('ISSUE #1 ghp_<REDACTED>')
    expect(dispatchFile('prompt.txt')).not.toContain(credential)
  })
})
