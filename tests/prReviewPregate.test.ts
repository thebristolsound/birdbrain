import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'pr-review', 'pregate.sh')
const POST = resolve(__dirname, '..', '.github', 'scripts', 'pr-review', 'post.sh')
const REPO = 'o/r'
const PIPELINE = 'birdbrain-agent'
const MAINTAINER = 'thebristolsound'
const CODEX = 'chatgpt-codex-connector[bot]'
const sha = (c: string) => c.repeat(40)

// The stub of tests/dispatchPregate.test.ts, plus `--input`: answers `gh api` from
// fixtures.json by endpoint, fails on any endpoint it has no answer for, and logs every write.
const GH_STUB = `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = api ] || { echo "stub gh: unsupported command $*" >&2; exit 2; }
shift
endpoint='' expr='' method='' fields=''
while [ $# -gt 0 ]; do
  case "$1" in
    --paginate) ;;
    --jq) expr="$2"; shift ;;
    -X) method="$2"; shift ;;
    -f) fields="$fields $2"; shift ;;
    --input) fields="$fields input=$2"; shift ;;
    -*) echo "stub gh: unsupported flag $1" >&2; exit 2 ;;
    *) endpoint="$1" ;;
  esac
  shift
done
if [ -n "$method" ]; then
  echo "$method $endpoint$fields" >> "$GH_STUB_DIR/writes"
  endpoint="$method $endpoint"
fi
body="$(jq -c --arg k "$endpoint" '.[$k] // error("stub gh: no fixture for \\($k)")' "$GH_STUB_DIR/fixtures.json")"
if [ -n "$expr" ]; then jq -r "$expr" <<<"$body"; else printf '%s\\n' "$body"; fi
`

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

type Pr = {
  n: number
  head?: string
  author?: string
  repo?: string
  openedHoursAgo?: number
  labels?: string[]
  // Comments posted on the PR; a verdict is a pipeline comment naming its reviewed commit.
  verdict?: { sha: string; hoursAgo: number }
  reviews?: { by: string; hoursAgo: number }[]
  files?: string[]
  // Label events, oldest first.
  events?: { label: string; by: string }[]
}

const prFixtures = ({
  n,
  head = sha('a'),
  author = MAINTAINER,
  repo = REPO,
  openedHoursAgo = 3,
  labels = [],
  verdict,
  reviews = [],
  files = ['src/main/index.ts'],
  events = []
}: Pr) => ({
  pull: {
    number: n,
    user: { login: author },
    head: { sha: head, repo: { full_name: repo } },
    created_at: hoursAgo(openedHoursAgo),
    labels: labels.map((name) => ({ name }))
  },
  routes: {
    [`repos/${REPO}/issues/${n}/comments?per_page=100`]: verdict
      ? [
          { user: { login: MAINTAINER }, created_at: hoursAgo(5), body: 'Looks fine.' },
          {
            user: { login: PIPELINE },
            created_at: hoursAgo(verdict.hoursAgo),
            body: `**Review verdict: approve for human review**\n\n<details>\n<summary>Full report</summary>\n\nReviewed commit: ${verdict.sha}\n\n</details>\n`
          }
        ]
      : [],
    [`repos/${REPO}/pulls/${n}/reviews?per_page=100`]: reviews.map(({ by, hoursAgo: h }) => ({
      user: { login: by },
      submitted_at: hoursAgo(h)
    })),
    [`repos/${REPO}/pulls/${n}/files?per_page=100`]: files.map((filename) => ({ filename })),
    [`repos/${REPO}/issues/${n}/events?per_page=100`]: events.map(({ label, by }) => ({
      event: 'labeled',
      label: { name: label },
      actor: { login: by }
    })),
    [`POST repos/${REPO}/issues/${n}/labels`]: [],
    ...Object.fromEntries(
      ['passed', 'changes', 'stale', 'failed', 'skipped'].map((s) => [
        `DELETE repos/${REPO}/issues/${n}/labels/review%3A${s}`,
        []
      ])
    )
  }
})

const RUNS = `repos/${REPO}/actions/workflows/pr-review.yml/runs?per_page=100&page=1`

// Earlier reviews: each started its Claude credential step `hoursAgo` for PR `target`.
const paidHistory = (paid: { hoursAgo: number; target: number }[]) => ({
  [RUNS]: {
    total_count: paid.length,
    workflow_runs: paid.map(({ hoursAgo: h }, i) => ({
      id: 9000 + i,
      run_attempt: 1,
      created_at: hoursAgo(h),
      run_started_at: hoursAgo(h),
      updated_at: hoursAgo(Math.max(h - 0.5, 0))
    }))
  },
  ...Object.fromEntries(
    paid.flatMap(({ hoursAgo: h, target }, i) => [
      [
        `repos/${REPO}/actions/runs/${9000 + i}/jobs?filter=all&per_page=100`,
        {
          total_count: 1,
          jobs: [
            {
              id: 7000 + i,
              started_at: hoursAgo(h),
              check_run_url: `https://api.github.com/repos/${REPO}/check-runs/${7000 + i}`,
              steps: [
                {
                  name: 'Claude credential',
                  status: 'completed',
                  conclusion: 'success',
                  started_at: hoursAgo(h)
                }
              ]
            }
          ]
        }
      ],
      [
        `repos/${REPO}/check-runs/${7000 + i}/annotations?per_page=100`,
        [{ title: 'Review target', message: String(target) }]
      ]
    ])
  )
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-review-pregate-'))
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const run = (
  prs: Pr[],
  {
    paid = [],
    mode = 'review',
    env = {}
  }: {
    paid?: { hoursAgo: number; target: number }[]
    mode?: 'review' | 'report'
    env?: Record<string, string>
  } = {}
) => {
  const built = prs.map(prFixtures)
  writeFileSync(
    join(dir, 'fixtures.json'),
    JSON.stringify({
      [`repos/${REPO}/pulls?state=open&per_page=100`]: built.map(({ pull }) => pull),
      ...Object.assign({}, ...built.map(({ routes }) => routes)),
      ...paidHistory(paid)
    })
  )
  const output = join(dir, 'output')
  const summary = join(dir, 'summary')
  writeFileSync(output, '')
  writeFileSync(summary, '')
  rmSync(join(dir, 'writes'), { force: true })
  const result = spawnSync('bash', [SCRIPT, mode], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_STUB_DIR: dir,
      GITHUB_REPOSITORY: REPO,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      LOGIN: PIPELINE,
      ...env
    }
  })
  const outputs = Object.fromEntries(
    readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )
  const writes = join(dir, 'writes')
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    outputs,
    summary: readFileSync(summary, 'utf8'),
    writes: existsSync(writes) ? readFileSync(writes, 'utf8').trim().split('\n') : []
  }
}

describe.skipIf(!HAS_JQ)('pr-review pregate.sh', () => {
  it('reviews an unreviewed maintainer PR and records it as the review target', () => {
    const r = run([{ n: 11 }])
    expect(r.status).toBe(0)
    expect(r.outputs).toMatchObject({ run: 'true', pr: '11', sha: sha('a') })
    expect(r.stdout).toContain('::notice title=Review target::11')
    expect(r.writes).toEqual([])
  })

  it.each([
    ['another author', { author: 'a-collaborator' }],
    ['a fork', { repo: 'someone/r' }],
    ['a dispatch slot PR', { labels: ['agent-pr'] }],
    [
      'an opt-out',
      { labels: ['review:skipped'], events: [{ label: 'review:skipped', by: MAINTAINER }] }
    ]
  ])('leaves out %s', (_, pr) => {
    const r = run([{ n: 11, ...pr }])
    expect(r.status).toBe(0)
    expect(r.outputs.run).toBe('false')
    expect(r.writes).toEqual([])
  })

  it('waits until a PR is an hour old', () => {
    const r = run([{ n: 11, openedHoursAgo: 0.5 }])
    expect(r.outputs).toMatchObject({ run: 'false', reason: 'no PR is owed a review' })
    expect(r.summary).toContain('#11: opened at')
  })

  it('leaves a PR another reviewer has reviewed', () => {
    const r = run([{ n: 11, reviews: [{ by: CODEX, hoursAgo: 2 }] }])
    expect(r.outputs.run).toBe('false')
    expect(r.summary).toContain(`#11: reviewed by ${CODEX}`)
  })

  it('does not count the maintainer reviewing his own PR', () => {
    const r = run([{ n: 11, reviews: [{ by: MAINTAINER, hoursAgo: 2 }] }])
    expect(r.outputs).toMatchObject({ run: 'true', pr: '11' })
  })

  it('labels a process-doc PR skipped instead of reviewing it', () => {
    const r = run([
      { n: 11, files: ['docs/adr/0046-x.md', '.claude/skills/a/SKILL.md', 'CLAUDE.md'] }
    ])
    expect(r.outputs.run).toBe('false')
    expect(r.writes).toEqual([`POST repos/${REPO}/issues/11/labels labels[]=review:skipped`])
  })

  it('takes its own skip back off once the PR touches code', () => {
    const r = run([
      { n: 11, labels: ['review:skipped'], events: [{ label: 'review:skipped', by: PIPELINE }] }
    ])
    expect(r.writes).toEqual([`DELETE repos/${REPO}/issues/11/labels/review%3Askipped`])
    expect(r.outputs).toMatchObject({ run: 'true', pr: '11' })
  })

  it('leaves a PR whose verdict is at head', () => {
    const r = run([{ n: 11, labels: ['review:passed'], verdict: { sha: sha('a'), hoursAgo: 1 } }])
    expect(r.outputs).toMatchObject({ run: 'false', reason: 'no PR is owed a review' })
    expect(r.writes).toEqual([])
  })

  it('marks a verdict on an older commit stale and reviews again', () => {
    const r = run([{ n: 11, labels: ['review:changes'], verdict: { sha: sha('b'), hoursAgo: 2 } }])
    expect(r.writes).toEqual([
      `DELETE repos/${REPO}/issues/11/labels/review%3Achanges`,
      `POST repos/${REPO}/issues/11/labels labels[]=review:stale`
    ])
    expect(r.outputs).toMatchObject({ run: 'true', pr: '11' })
  })

  it('counts only reviews from others after its own verdict on a stale PR', () => {
    const before = run([
      {
        n: 11,
        labels: ['review:stale'],
        verdict: { sha: sha('b'), hoursAgo: 2 },
        reviews: [{ by: CODEX, hoursAgo: 2.5 }]
      }
    ])
    expect(before.outputs).toMatchObject({ run: 'true', pr: '11' })
    const after = run([
      {
        n: 11,
        labels: ['review:stale'],
        verdict: { sha: sha('b'), hoursAgo: 2 },
        reviews: [{ by: CODEX, hoursAgo: 1 }]
      }
    ])
    expect(after.outputs.run).toBe('false')
  })

  it('puts first reviews ahead of retries and retries ahead of stale PRs', () => {
    const prs: Pr[] = [
      {
        n: 10,
        openedHoursAgo: 9,
        labels: ['review:stale'],
        verdict: { sha: sha('b'), hoursAgo: 2 }
      },
      {
        n: 11,
        openedHoursAgo: 8,
        labels: ['review:failed'],
        events: [{ label: 'review:failed', by: PIPELINE }]
      },
      { n: 12, openedHoursAgo: 2 }
    ]
    expect(run(prs).outputs.pr).toBe('12')
    expect(run(prs.slice(0, 2)).outputs.pr).toBe('11')
  })

  it('retries a failed review once', () => {
    const failed = (times: number): Pr => ({
      n: 11,
      labels: ['review:failed'],
      events: Array.from({ length: times }, () => ({ label: 'review:failed', by: PIPELINE }))
    })
    expect(run([failed(1)]).outputs).toMatchObject({ run: 'true', pr: '11' })
    const twice = run([failed(2)])
    expect(twice.outputs.run).toBe('false')
    expect(twice.summary).toContain('#11: failed 2 times')
  })

  it('stops at four reviews in a day', () => {
    const r = run([{ n: 11 }], {
      paid: [1, 5, 9, 13].map((h, i) => ({ hoursAgo: h, target: 20 + i }))
    })
    expect(r.outputs.run).toBe('false')
    expect(r.outputs.reason).toContain('the spend cap holds this review: 4 started')
  })

  it('holds a PR reviewed in the last six hours and takes the next one', () => {
    const r = run([{ n: 11, openedHoursAgo: 8 }, { n: 12 }], {
      paid: [{ hoursAgo: 2, target: 11 }]
    })
    expect(r.outputs).toMatchObject({ run: 'true', pr: '12' })
    expect(r.summary).toContain('#11: held by the spend cap')
  })

  it('writes nothing and never runs in report mode', () => {
    const r = run(
      [
        { n: 11, labels: ['review:passed'], verdict: { sha: sha('b'), hoursAgo: 2 } },
        { n: 12, files: ['docs/a.md'] }
      ],
      { mode: 'report' }
    )
    expect(r.writes).toEqual([])
    expect(r.outputs).toMatchObject({ run: 'false', pr: '11' })
    expect(r.outputs.reason).toContain('report mode: would review #11')
    expect(r.summary).toContain('Would label #11 review:stale')
    expect(r.summary).toContain('Would label #12 review:skipped')
  })

  it('considers only the PR a supervised fire names', () => {
    const prs: Pr[] = [{ n: 11, openedHoursAgo: 8 }, { n: 12 }]
    expect(run(prs, { env: { TARGET_PR: '12' } }).outputs.pr).toBe('12')
    const missing = run(prs, { env: { TARGET_PR: '99' } })
    expect(missing.outputs.run).toBe('false')
    expect(missing.outputs.reason).toContain('PR #99 is not an open PR')
  })

  it('ends the step when a read fails', () => {
    writeFileSync(join(dir, 'fixtures.json'), '{}')
    const result = spawnSync('bash', [SCRIPT, 'review'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_STUB_DIR: dir, LOGIN: PIPELINE }
    })
    expect(result.status).not.toBe(0)
  })
})

const verdictFile = (first: string, commit = sha('a')) =>
  `${first}\n\n1. The new check reads the wrong field.\n\n<details>\n<summary>Full report</summary>\n\nReviewed commit: ${commit}\n\n| # | severity | file:line | finding |\n|---|---|---|---|\n| 1 | blocking | src/a.ts:3 | Reads the wrong field. |\n\n</details>\n`

const post = ({
  verdict,
  outcome = 'success',
  labels = [],
  head = sha('a')
}: {
  verdict?: string
  outcome?: string
  labels?: string[]
  head?: string
}) => {
  const { routes } = prFixtures({ n: 11 })
  writeFileSync(
    join(dir, 'fixtures.json'),
    JSON.stringify({
      ...routes,
      [`repos/${REPO}/issues/11/labels?per_page=100`]: labels.map((name) => ({ name })),
      [`repos/${REPO}/pulls/11`]: { head: { sha: head } },
      [`POST repos/${REPO}/issues/11/comments`]: {}
    })
  )
  rmSync(join(dir, '.dispatch'), { recursive: true, force: true })
  rmSync(join(dir, 'writes'), { force: true })
  if (verdict !== undefined) {
    spawnSync('mkdir', ['-p', join(dir, '.dispatch')])
    writeFileSync(join(dir, '.dispatch', 'verdict.md'), verdict)
  }
  const result = spawnSync('bash', [POST], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_STUB_DIR: dir,
      GITHUB_REPOSITORY: REPO,
      GITHUB_STEP_SUMMARY: join(dir, 'summary'),
      PR: '11',
      SHA: sha('a'),
      RUN_OUTCOME: outcome
    }
  })
  const writes = join(dir, 'writes')
  return {
    status: result.status,
    stderr: result.stderr,
    writes: existsSync(writes) ? readFileSync(writes, 'utf8').trim().split('\n') : []
  }
}

const COMMENT = `POST repos/${REPO}/issues/11/comments input=.dispatch/verdict.json`
const label = (l: string) => `POST repos/${REPO}/issues/11/labels labels[]=${l}`

describe.skipIf(!HAS_JQ)('pr-review post.sh', () => {
  it('posts a verdict and labels the PR by its verdict line', () => {
    const changes = post({ verdict: verdictFile('**Review verdict: request changes**') })
    expect(changes.status).toBe(0)
    expect(changes.writes).toEqual([COMMENT, label('review:changes')])
    const passed = post({
      verdict: verdictFile('**Review verdict: approve for human review**'),
      labels: ['review:stale']
    })
    expect(passed.writes).toEqual([
      COMMENT,
      `DELETE repos/${REPO}/issues/11/labels/review%3Astale`,
      label('review:passed')
    ])
  })

  it('labels the PR stale when its head moved during the review', () => {
    const r = post({ verdict: verdictFile('**Review verdict: request changes**'), head: sha('c') })
    expect(r.writes).toEqual([COMMENT, label('review:stale')])
  })

  it.each([
    [
      'the review step failed',
      { verdict: verdictFile('**Review verdict: request changes**'), outcome: 'failure' }
    ],
    ['no verdict was written', {}],
    ['the first line is not a verdict', { verdict: verdictFile('Looks good to me') }],
    [
      'the verdict names another commit',
      { verdict: verdictFile('**Review verdict: request changes**', sha('b')) }
    ]
  ])('labels the PR failed and posts nothing when %s', (_, args) => {
    const r = post(args)
    expect(r.status).toBe(0)
    expect(r.writes).toEqual([label('review:failed')])
  })
})
