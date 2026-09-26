import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'pregate.sh')
const REPO = 'o/r'
const PIPELINE = 'birdbrain-agent'
const MAINTAINER = 'thebristolsound'
const PR = 7
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

// A stub `gh` that answers `gh api [--paginate] <endpoint> [--jq <expr>]` from
// fixtures.json, keyed by endpoint, and fails on any endpoint it has no answer
// for, so a pregate call the fixtures do not cover surfaces as a non-zero exit.
const GH_STUB = `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = api ] || { echo "stub gh: unsupported command $*" >&2; exit 2; }
shift
endpoint='' expr=''
while [ $# -gt 0 ]; do
  case "$1" in
    --paginate) ;;
    --jq) expr="$2"; shift ;;
    -*) echo "stub gh: unsupported flag $1" >&2; exit 2 ;;
    *) endpoint="$1" ;;
  esac
  shift
done
body="$(jq -c --arg k "$endpoint" '.[$k] // error("stub gh: no fixture for \\($k)")' "$GH_STUB_DIR/fixtures.json")"
if [ -n "$expr" ]; then jq -r "$expr" <<<"$body"; else printf '%s\\n' "$body"; fi
`

type Comment = { login: string; at: string }

const HEAD_AT = '2026-09-20T10:00:00Z'
const VERDICT_AT = '2026-09-20T11:00:00Z'
const PARKED_AT = '2026-09-20T11:05:00Z'

const fixtures = ({ labels, comments }: { labels: string[]; comments: Comment[] }) => ({
  [`repos/${REPO}/issues?state=open&labels=agent-pr&per_page=100`]: [
    { number: PR, pull_request: {} }
  ],
  [`repos/${REPO}/issues?state=open&labels=agent-wip&per_page=100`]: [],
  [`repos/${REPO}/pulls/${PR}`]: { head: { sha: SHA }, draft: true },
  [`repos/${REPO}/commits/${SHA}/status`]: {
    statuses: [
      { context: 'agent/pre-pass', state: 'failure', description: '1 blocking: a false claim' }
    ]
  },
  [`repos/${REPO}/commits/${SHA}`]: { commit: { committer: { date: HEAD_AT } } },
  [`repos/${REPO}/issues/${PR}/labels`]: labels.map((name) => ({ name })),
  [`repos/${REPO}/issues/${PR}/events?per_page=100`]: [
    { event: 'labeled', label: { name: 'agent-pr' }, created_at: '2026-09-19T09:00:00Z' },
    ...(labels.includes('awaiting-maintainer')
      ? [{ event: 'labeled', label: { name: 'awaiting-maintainer' }, created_at: PARKED_AT }]
      : [])
  ],
  [`repos/${REPO}/issues/${PR}/comments?per_page=100`]: comments.map(({ login, at }) => ({
    user: { login },
    created_at: at
  })),
  [`repos/${REPO}/pulls/${PR}/comments?per_page=100`]: [],
  [`repos/${REPO}/pulls/${PR}/reviews?per_page=100`]: []
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pregate-'))
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const run = (fixture: ReturnType<typeof fixtures>) => {
  writeFileSync(join(dir, 'fixtures.json'), JSON.stringify(fixture))
  const output = join(dir, 'output')
  const summary = join(dir, 'summary')
  writeFileSync(output, '')
  writeFileSync(summary, '')
  const result = spawnSync('bash', [SCRIPT, 'cycle'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_STUB_DIR: dir,
      GITHUB_REPOSITORY: REPO,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      LOGIN: PIPELINE
    }
  })
  const outputs = Object.fromEntries(
    readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )
  return {
    status: result.status,
    stderr: result.stderr,
    outputs,
    summary: readFileSync(summary, 'utf8')
  }
}

const PARKED = ['agent-pr', 'agent-authored', 'awaiting-maintainer']

describe.skipIf(!HAS_JQ)('pregate.sh on a PR parked for the maintainer', () => {
  it('skips a parked PR whose only activity after the label is the pipeline', () => {
    const result = run(
      fixtures({
        labels: PARKED,
        comments: [
          { login: MAINTAINER, at: '2026-09-20T10:30:00Z' },
          { login: PIPELINE, at: VERDICT_AT },
          { login: PIPELINE, at: '2026-09-20T12:00:00Z' }
        ]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({
      run: 'false',
      reason: 'the slot is held and no open agent PR needs the routine'
    })
    expect(result.summary).toContain(`PR #${PR} is parked for the maintainer since ${PARKED_AT}`)
  })

  it('runs for a parked PR once someone other than the pipeline comments after the label', () => {
    const humanAt = '2026-09-21T08:00:00Z'
    const result = run(
      fixtures({
        labels: PARKED,
        comments: [
          { login: PIPELINE, at: VERDICT_AT },
          { login: MAINTAINER, at: humanAt }
        ]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({
      run: 'true',
      reason: `PR #${PR} is parked for the maintainer and has activity at ${humanAt} newer than the label (${PARKED_AT})`
    })
  })

  it('keeps the unlabelled failure-verdict rule: the pipeline verdict counts as activity', () => {
    const result = run(
      fixtures({
        labels: ['agent-pr', 'agent-authored'],
        comments: [{ login: PIPELINE, at: VERDICT_AT }]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({
      run: 'true',
      reason: `PR #${PR} has activity at ${VERDICT_AT} newer than its head (${HEAD_AT})`
    })
  })
})
