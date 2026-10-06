import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'scrub.sh')
const WORKFLOW = resolve(__dirname, '..', '.github', 'workflows', 'dispatch.yml')
// Assembled at runtime, like the values in dispatchRedact.test.ts.
const CREDENTIAL = `ghp_${'Ab3'.repeat(12)}`

let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'dispatch-scrub-'))
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

const leave = (files: Record<string, string>) =>
  Object.entries(files).forEach(([path, text]) => {
    mkdirSync(join(work, '.dispatch', path, '..'), { recursive: true })
    writeFileSync(join(work, '.dispatch', path), text)
  })
const scrub = () => spawnSync('bash', [SCRIPT], { cwd: work, encoding: 'utf8' })
const dispatchFile = (name: string) => readFileSync(join(work, '.dispatch', name), 'utf8')

// A cancel or the job timeout ends run.sh inside the `claude` call, before its own scrub, and
// the upload step runs on every exit; this script is what runs between the two.
describe.skipIf(!HAS_JQ)('dispatch scrub.sh', () => {
  it('redacts every file under .dispatch and drops the spend from the JSON ones', () => {
    const event = { type: 'assistant', text: `token ${CREDENTIAL}`, total_cost_usd: 1.5 }
    leave({
      'transcript.jsonl': `${JSON.stringify(event)}\nnot json ${CREDENTIAL}\n`,
      'result-1.json': JSON.stringify({ type: 'result', modelUsage: { m: { costUSD: 2 } } }),
      'claude.err': `API error: ${CREDENTIAL} was rejected\n`,
      'reports/pr-1589-abc1234.md': `The log quoted ${CREDENTIAL}.\n{"total_cost_usd": 1}\n`
    })

    const { status, stderr } = scrub()

    expect(status, stderr).toBe(0)
    expect(dispatchFile('transcript.jsonl')).toBe(
      `{"type":"assistant","text":"token ghp_<REDACTED>"}\nnot json ghp_<REDACTED>\n`
    )
    expect(JSON.parse(dispatchFile('result-1.json'))).toEqual({
      type: 'result',
      modelUsage: { m: {} }
    })
    expect(dispatchFile('claude.err')).toBe('API error: ghp_<REDACTED> was rejected\n')
    // A report is redacted and otherwise left alone: the spend pass is for JSON files only.
    expect(dispatchFile('reports/pr-1589-abc1234.md')).toBe(
      'The log quoted ghp_<REDACTED>.\n{"total_cost_usd": 1}\n'
    )
  })

  it('exits 0 when the run left no .dispatch folder', () => {
    const { status, stderr } = scrub()
    expect(status, stderr).toBe(0)
  })

  it('runs in dispatch.yml on every exit, before the artifact upload', () => {
    const lines = readFileSync(WORKFLOW, 'utf8').split('\n')
    const scrubStep = lines.findIndex((line) => line.includes('run: bash .github/scripts/dispatch/scrub.sh'))
    const upload = lines.findIndex((line) => line.includes('uses: actions/upload-artifact@'))
    expect(scrubStep).toBeGreaterThan(-1)
    expect(upload).toBeGreaterThan(scrubStep)
    expect(lines.slice(scrubStep - 3, scrubStep)).toContain('        if: always()')
  })
})
