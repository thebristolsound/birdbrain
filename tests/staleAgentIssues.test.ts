import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'stale', 'run.sh')
const REPO = 'o/r'
const ISSUES = `repos/${REPO}/issues?state=open&creator=birdbrain-agent&per_page=100`
const LABEL = `repos/${REPO}/labels/stale`

// A stub `gh` that answers `gh api [--paginate] <endpoint> [--jq <expr>]` from fixtures.json,
// keyed by endpoint, and fails on a read it has no answer for. A write (`-X <method>`) is logged
// to writes as "<method> <endpoint>" and answered with an empty object.
const GH_STUB = `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = api ] || { echo "stub gh: unsupported command $*" >&2; exit 2; }
shift
endpoint='' expr='' method=''
while [ $# -gt 0 ]; do
  case "$1" in
    --paginate) ;;
    --jq) expr="$2"; shift ;;
    -X) method="$2"; shift ;;
    -f) shift ;;
    -*) echo "stub gh: unsupported flag $1" >&2; exit 2 ;;
    *) endpoint="$1" ;;
  esac
  shift
done
if [ -n "$method" ]; then
  echo "$method $endpoint" >> "$GH_STUB_DIR/writes"
  echo '{}'
  exit 0
fi
jq -e --arg k "$endpoint" 'has($k)' "$GH_STUB_DIR/fixtures.json" > /dev/null ||
  { echo "stub gh: no fixture for $endpoint" >&2; exit 1; }
body="$(jq -c --arg k "$endpoint" '.[$k]' "$GH_STUB_DIR/fixtures.json")"
if [ -n "$expr" ]; then jq -r "$expr" <<<"$body"; else printf '%s\\n' "$body"; fi
`

const DAY = 86_400_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

type Issue = { number: number; updatedAt: string; labels?: string[]; pullRequest?: boolean }

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stale-issues-'))
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(
  issues: Issue[],
  { labelledAt = {}, dryRun = false, labelExists = true } = {} as {
    labelledAt?: Record<number, string>
    dryRun?: boolean
    labelExists?: boolean
  }
) {
  const fixtures: Record<string, unknown> = {
    [ISSUES]: issues.map(({ number, updatedAt, labels = [], pullRequest }) => ({
      number,
      updated_at: updatedAt,
      labels: labels.map((name) => ({ name })),
      ...(pullRequest ? { pull_request: {} } : {})
    }))
  }
  if (labelExists) fixtures[LABEL] = { name: 'stale' }
  for (const [number, at] of Object.entries(labelledAt)) {
    fixtures[`repos/${REPO}/issues/${number}/events`] = [
      { event: 'labeled', label: { name: 'other' }, created_at: ago(30 * DAY) },
      { event: 'labeled', label: { name: 'stale' }, created_at: at }
    ]
  }
  writeFileSync(join(dir, 'fixtures.json'), JSON.stringify(fixtures))
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_STUB_DIR: dir,
      GITHUB_REPOSITORY: REPO,
      DRY_RUN: dryRun ? 'true' : 'false'
    }
  })
  const writesFile = join(dir, 'writes')
  const writes = existsSync(writesFile) ? readFileSync(writesFile, 'utf8').trim().split('\n') : []
  return { ...result, writes }
}

const warning = (n: number) => [
  `POST repos/${REPO}/issues/${n}/comments`,
  `POST repos/${REPO}/issues/${n}/labels`
]
const closing = (n: number) => [
  `POST repos/${REPO}/issues/${n}/comments`,
  `PATCH repos/${REPO}/issues/${n}`
]
const clearing = (n: number) => [`DELETE repos/${REPO}/issues/${n}/labels/stale`]

describe.skipIf(!HAS_JQ)('stale-agent-issues run.sh', () => {
  it('warns an issue untouched for 7 days, commenting before labelling', () => {
    const { status, writes } = run([{ number: 1, updatedAt: ago(8 * DAY) }])
    expect(status).toBe(0)
    expect(writes).toEqual(warning(1))
  })

  it('leaves an issue touched within 7 days alone', () => {
    const { status, writes } = run([{ number: 1, updatedAt: ago(3 * DAY) }])
    expect(status).toBe(0)
    expect(writes).toEqual([])
  })

  it.each([
    'queued',
    'agent-wip',
    'evidence-affecting',
    'security',
    'court-admissibility',
    'blocker',
    'severity:blocking',
    'ready-for-human',
    'needs-triage'
  ])('never warns an issue carrying %s', (label) => {
    const { status, writes } = run([
      { number: 1, updatedAt: ago(60 * DAY), labels: ['bug', label] }
    ])
    expect(status).toBe(0)
    expect(writes).toEqual([])
  })

  it('never closes a warned issue that has since gained an exempt label, and clears the warning', () => {
    const { status, writes } = run(
      [{ number: 1, updatedAt: ago(8 * DAY), labels: ['stale', 'evidence-affecting'] }],
      { labelledAt: { 1: ago(8 * DAY) } }
    )
    expect(status).toBe(0)
    expect(writes).toEqual(clearing(1))
  })

  it('closes a warned issue nobody has touched since the warning', () => {
    const labelled = ago(7 * DAY)
    const { status, writes } = run(
      [{ number: 1, updatedAt: ago(7 * DAY - 5_000), labels: ['stale'] }],
      { labelledAt: { 1: labelled } }
    )
    expect(status).toBe(0)
    expect(writes).toEqual(closing(1))
  })

  it('keeps a warned issue open until the next weekly run', () => {
    const { status, writes } = run(
      [{ number: 1, updatedAt: ago(2 * DAY - 5_000), labels: ['stale'] }],
      { labelledAt: { 1: ago(2 * DAY) } }
    )
    expect(status).toBe(0)
    expect(writes).toEqual([])
  })

  it('clears the warning from an issue someone touched after it', () => {
    const { status, writes } = run([{ number: 1, updatedAt: ago(6 * DAY), labels: ['stale'] }], {
      labelledAt: { 1: ago(8 * DAY) }
    })
    expect(status).toBe(0)
    expect(writes).toEqual(clearing(1))
  })

  it('skips pull requests', () => {
    const { status, writes } = run([{ number: 1, updatedAt: ago(30 * DAY), pullRequest: true }])
    expect(status).toBe(0)
    expect(writes).toEqual([])
  })

  it('writes nothing on a dry run and prints the plan', () => {
    const { status, writes, stdout } = run(
      [
        { number: 1, updatedAt: ago(8 * DAY) },
        { number: 2, updatedAt: ago(7 * DAY - 5_000), labels: ['stale'] }
      ],
      { labelledAt: { 2: ago(7 * DAY) }, dryRun: true, labelExists: false }
    )
    expect(status).toBe(0)
    expect(writes).toEqual([])
    expect(stdout).toContain('warned 1, closed 1, cleared 0 (dry run: nothing written)')
  })

  it('creates the stale label when the repository lacks it', () => {
    const { status, writes } = run([], { labelExists: false })
    expect(status).toBe(0)
    expect(writes).toEqual([`POST repos/${REPO}/labels`])
  })
})
