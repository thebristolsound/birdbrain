import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { HAS_JQ } from './helpers/jq'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'pregate.sh')
const REPO = 'o/r'
const PIPELINE = 'birdbrain-agent'
const MAINTAINER = 'thebristolsound'
// Any account outside the trust list, another write collaborator included.
const COLLABORATOR = 'a-collaborator'
const PR = 7
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const BRANCH = 'agent/7-fix'

// A stub `gh` that answers `gh api [--paginate] <endpoint> [--jq <expr>]` from
// fixtures.json, keyed by endpoint, and fails on any endpoint it has no answer
// for, so a pregate call the fixtures do not cover surfaces as a non-zero exit.
// A write (`-X <method>`, with `-f` fields) is logged to writes and answered from
// the key "<method> <endpoint>".
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

type Comment = { login: string; at: string; type?: 'User' | 'Bot' }

const HEAD_AT = '2026-09-20T10:00:00Z'
const VERDICT_AT = '2026-09-20T11:00:00Z'
const PARKED_AT = '2026-09-20T11:05:00Z'
const PUSHED_AT = '2026-09-20T10:01:00Z'
const AFTER_WAKE = '2026-09-21T10:00:00Z'
// The label and its removal in the reviewer's round 2 and round 3 reproductions on #1629.
const REPRO_LABELLED = '2026-09-20T09:30:00Z'
const REPRO_REMOVED = '2026-09-20T09:40:00Z'
const OLD_SHA = '0123456789abcdef0123456789abcdef01234567'

type Status = {
  state: 'success' | 'failure' | 'pending' | 'error'
  by: string | null
  at: string
  description?: string
}

type LabelEvent = { event: 'labeled' | 'unlabeled'; label: string; by: string | null; at: string }
type Push = { after: string; by: string; at: string }

const user = ({ login, type = 'User' }: Comment) => ({ login, type })

// Every label the pre-gate reads, which a write in the stub echoes back as present.
const GATE_LABELS = [
  'agent-pr',
  'agent-wip',
  'awaiting-maintainer',
  'evidence-affecting',
  'ready-for-agent',
  'queued',
  'process'
]

// A label event as the issue events API returns it; the repository-wide list adds `issue`.
const labelEvent = ({ event, label, by, at }: LabelEvent, issue?: number) => ({
  event,
  label: { name: label },
  actor: by === null ? null : { login: by },
  created_at: at,
  ...(issue === undefined ? {} : { issue: { number: issue } })
})

// The label writes the pre-gate may make on issue or PR n: a POST answers with every gate
// label, so any put-back reads as applied, and a DELETE with nothing.
const labelWrites = (n: number, failing = false) =>
  failing
    ? {}
    : {
        [`POST repos/${REPO}/issues/${n}/labels`]: GATE_LABELS.map((name) => ({ name })),
        ...Object.fromEntries(
          GATE_LABELS.map((l) => [`DELETE repos/${REPO}/issues/${n}/labels/${l}`, []])
        )
      }

// The routes every fire reads: the open PRs, the two issue lists, and the repository's
// label events of the last four hours.
const lists = ({
  pulls = [],
  wip = [],
  queue = [],
  recent = []
}: {
  pulls?: unknown[]
  wip?: unknown[]
  queue?: unknown[]
  recent?: unknown[]
}) => ({
  [`repos/${REPO}/pulls?state=open&per_page=100`]: pulls,
  [`repos/${REPO}/issues?state=open&labels=agent-wip&per_page=100`]: wip,
  [`repos/${REPO}/issues?state=open&labels=ready-for-agent,queued&per_page=100`]: queue,
  [`repos/${REPO}/issues/events?per_page=100&page=1`]: recent
})

const fixtures = ({
  labels,
  comments,
  reviewComments = [],
  reviews = [],
  state = 'failure',
  statuses,
  author = PIPELINE,
  agentPrBy = PIPELINE,
  pusher = PIPELINE,
  pushes,
  parkedAt = PARKED_AT,
  parkedBy = PIPELINE,
  events = [],
  headAt = HEAD_AT,
  draft = true,
  reapplyFails = false
}: {
  labels: string[]
  comments: Comment[]
  reviewComments?: Comment[]
  reviews?: Comment[]
  // The pipeline's agent/pre-pass verdict on the head.
  state?: 'success' | 'failure' | 'absent'
  // Every agent/pre-pass status on the head, newest first; overrides state.
  statuses?: Status[]
  author?: string
  // Who applied agent-pr at open; null for no such event.
  agentPrBy?: string | null
  pusher?: string | null
  // Every push on the branch, newest first; overrides pusher.
  pushes?: Push[]
  // When and by whom awaiting-maintainer was applied, if labels carries it; null for no event.
  parkedAt?: string
  parkedBy?: string | null
  events?: LabelEvent[]
  // The head's commit date.
  headAt?: string
  draft?: boolean
  // Whether the pre-gate's label writes fail.
  reapplyFails?: boolean
}) => ({
  ...lists({
    pulls: [
      {
        number: PR,
        head: { sha: SHA, ref: BRANCH },
        draft,
        user: { login: author },
        labels: labels.map((name) => ({ name }))
      }
    ]
  }),
  [`repos/${REPO}/commits/${SHA}/statuses?per_page=100`]: (
    statuses ??
    (state === 'absent'
      ? []
      : [
          {
            state,
            by: PIPELINE,
            at: VERDICT_AT,
            description:
              state === 'failure' ? '1 blocking: a false claim' : 'Approved for human review.'
          }
        ])
  ).map(({ by, at, description = '', ...rest }) => ({
    context: 'agent/pre-pass',
    ...rest,
    description,
    creator: by === null ? null : { login: by },
    created_at: at
  })),
  // The repository activity API, newest first: the push that made the head.
  [`repos/${REPO}/activity?ref=refs/heads/${BRANCH}&per_page=100`]: (
    pushes ?? (pusher === null ? [] : [{ after: SHA, by: pusher, at: PUSHED_AT }])
  ).map(({ after, by, at }) => ({
    activity_type: 'push',
    after,
    actor: { login: by },
    timestamp: at
  })),
  [`repos/${REPO}/commits/${SHA}`]: { commit: { committer: { date: headAt } } },
  ...labelWrites(PR, reapplyFails),
  [`repos/${REPO}/issues/${PR}/events?per_page=100`]: [
    ...(agentPrBy === null
      ? []
      : [
          labelEvent({
            event: 'labeled',
            label: 'agent-pr',
            by: agentPrBy,
            at: '2026-09-19T09:00:00Z'
          })
        ]),
    ...(labels.includes('awaiting-maintainer') && parkedBy !== null
      ? [
          labelEvent({
            event: 'labeled',
            label: 'awaiting-maintainer',
            by: parkedBy,
            at: parkedAt
          })
        ]
      : []),
    ...events.map((e) => labelEvent(e))
  ],
  [`repos/${REPO}/issues/${PR}/comments?per_page=100`]: comments.map((c) => ({
    user: user(c),
    created_at: c.at
  })),
  [`repos/${REPO}/pulls/${PR}/comments?per_page=100`]: reviewComments.map((c) => ({
    user: user(c),
    created_at: c.at
  })),
  [`repos/${REPO}/pulls/${PR}/reviews?per_page=100`]: reviews.map((c) => ({
    user: user(c),
    submitted_at: c.at
  }))
})

// The first page of the dispatch workflow's runs, which the spend cap reads before any cycle.
const RUNS = `repos/${REPO}/actions/workflows/dispatch.yml/runs?per_page=100&page=1`
// No dispatch run in the last 24 hours, so the spend cap holds nothing. Every fixture gets it
// unless it answers RUNS itself.
const NO_PAID_CYCLES = { [RUNS]: { total_count: 0, workflow_runs: [] } }

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

// One earlier job of the dispatch workflow. Its Claude credential step started `hoursAgo`, and
// `targets` is what its pre-gate recorded (null: no record, as before the cap). `step` is that
// step's status and conclusion; a run re-run days after it was created gives `createdDaysAgo`
// and attempt 2, with the run's own times left at its creation.
type Paid = {
  hoursAgo: number
  targets: number[] | null
  step?: { status: string; conclusion: string | null }
  createdDaysAgo?: number
}

// The dispatch runs of `paid`, each run's jobs, and each job's annotations; `missing` drops a
// route so its read fails.
const paidHistory = (paid: Paid[], missing?: 'jobs' | 'annotations') => {
  const runs = paid.map(({ hoursAgo: h, createdDaysAgo }, i) => {
    const created = hoursAgo(createdDaysAgo === undefined ? h : createdDaysAgo * 24)
    return {
      id: 9000 + i,
      run_attempt: createdDaysAgo === undefined ? 1 : 2,
      created_at: created,
      run_started_at: created,
      updated_at: createdDaysAgo === undefined ? hoursAgo(Math.max(h - 0.5, 0)) : created
    }
  })
  return {
    [RUNS]: { total_count: runs.length, workflow_runs: runs },
    ...Object.fromEntries(
      paid.flatMap(({ hoursAgo: h, targets, step }, i) => {
        const job = 7000 + i
        const started = hoursAgo(h)
        return [
          ...(missing === 'jobs'
            ? []
            : [
                [
                  `repos/${REPO}/actions/runs/${9000 + i}/jobs?filter=all&per_page=100`,
                  {
                    total_count: 1,
                    jobs: [
                      {
                        id: job,
                        started_at: started,
                        check_run_url: `https://api.github.com/repos/${REPO}/check-runs/${job}`,
                        steps: [
                          { name: 'Pre-gate', status: 'completed', conclusion: 'success' },
                          {
                            name: 'Claude credential',
                            status: 'completed',
                            conclusion: 'success',
                            ...step,
                            started_at: started
                          }
                        ].map((s) => ({ started_at: started, ...s }))
                      }
                    ]
                  }
                ]
              ]),
          ...(missing === 'annotations'
            ? []
            : [
                [
                  `repos/${REPO}/check-runs/${job}/annotations?per_page=100`,
                  [
                    { title: '', message: 'The ubuntu-latest label will migrate' },
                    ...(targets === null
                      ? []
                      : [{ title: 'Dispatch target', message: targets.join(' ') || 'none' }])
                  ].map((a) => ({ annotation_level: 'notice', path: '.github', ...a }))
                ]
              ])
        ]
      })
    )
  }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pregate-'))
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const run = (
  fixture: Record<string, unknown>,
  env: Record<string, string> = {},
  mode: 'cycle' | 'report' = 'cycle'
) => {
  writeFileSync(join(dir, 'fixtures.json'), JSON.stringify({ ...NO_PAID_CYCLES, ...fixture }))
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

const PARKED = ['agent-pr', 'agent-authored', 'awaiting-maintainer']
const UNPARKED = ['agent-pr', 'agent-authored']
const IDLE = 'the slot is held and no open agent PR needs the routine'
const QUEUE_EMPTY = 'the slot is free but the queue is empty'
const FRONTIER = 'the slot is free and 1 unblocked queued issue(s) wait'
const SKIPPED = `PR #${PR} is parked for the maintainer; skipped until he removes awaiting-maintainer`
const LABEL_AFTER_PARK = '2026-09-21T08:00:00Z'
const APPLIED_AGAIN_AT = '2026-09-21T09:00:00Z'
const REAPPLY = `POST repos/${REPO}/issues/${PR}/labels labels[]=awaiting-maintainer`

type Args = Parameters<typeof fixtures>[0]

// The state after the pre-gate puts back a label someone other than the maintainer removed.
const applyAgain = (args: Args): Args => ({
  ...args,
  labels: [...args.labels, 'awaiting-maintainer'],
  parkedAt: APPLIED_AGAIN_AT
})

const appliedAgain = (by: string | null, at = LABEL_AFTER_PARK) =>
  `PR #${PR}: ${by ?? 'an unrecorded account'} removed awaiting-maintainer at ${at}, which does not count; applied it again`

// Fires the gate on a PR someone other than the maintainer unlabelled: the gate puts the label
// back itself and starts no cycle, then, with the label back, skips the PR on the next two fires.
const expectReappliedWithoutRun = (args: Args, by: string | null, at = LABEL_AFTER_PARK) => {
  const first = run(fixtures(args))
  expect(first.status, first.stderr).toBe(0)
  expect(first.outputs).toEqual({ run: 'false', reason: IDLE })
  expect(first.writes).toEqual([REAPPLY])
  expect(first.summary).toContain(appliedAgain(by, at))
  for (let fire = 0; fire < 2; fire++) {
    const next = run(fixtures(applyAgain(args)))
    expect(next.status, next.stderr).toBe(0)
    expect(next.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(next.writes).toEqual([])
    expect(next.summary).toContain(SKIPPED)
  }
}

const woken = (at = LABEL_AFTER_PARK) =>
  `PR #${PR} was woken when the maintainer removed awaiting-maintainer at ${at}, and the pipeline has not answered on it since; one cycle is owed`

// The maintainer's ruling of 2026-09-28 on #1310: only his removal of the label wakes a
// parked PR.
describe.skipIf(!HAS_JQ)('pregate.sh on a PR parked for the maintainer', () => {
  it.each([
    ['the pipeline', PIPELINE, 'User'],
    ['a review bot', 'coderabbitai[bot]', 'Bot'],
    ['another collaborator', COLLABORATOR, 'User'],
    ['the maintainer', MAINTAINER, 'User']
  ] as const)('stays parked when %s comments after the label', (_, login, type) => {
    const result = run(
      fixtures({
        labels: PARKED,
        comments: [
          { login: PIPELINE, at: VERDICT_AT },
          { login, at: LABEL_AFTER_PARK, type }
        ]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(SKIPPED)
    expect(result.writes).toEqual([])
  })

  it('stays parked when the maintainer reviews after the label', () => {
    const result = run(
      fixtures({
        labels: PARKED,
        comments: [],
        reviews: [{ login: MAINTAINER, at: LABEL_AFTER_PARK }]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
  })

  it.each([PIPELINE, MAINTAINER, COLLABORATOR])(
    'owes no verdict on a parked PR while the label is on, whoever pushed (%s)',
    (by) => {
      const result = run(
        fixtures({
          labels: PARKED,
          state: 'absent',
          comments: [],
          pushes: [{ after: SHA, by, at: LABEL_AFTER_PARK }]
        })
      )
      expect(result.status, result.stderr).toBe(0)
      expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    }
  )

  it('keeps the unlabelled failure-verdict rule: the pipeline verdict counts as activity', () => {
    const result = run(
      fixtures({
        labels: UNPARKED,
        comments: [{ login: PIPELINE, at: VERDICT_AT }]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({
      run: 'true',
      reason: `PR #${PR} has activity at ${VERDICT_AT} newer than its head (${HEAD_AT})`
    })
  })

  // Parked by the pipeline after its request-changes verdict, then unlabelled by `by`.
  const removedBy = (by: string | null): Args => ({
    labels: UNPARKED,
    comments: [{ login: PIPELINE, at: VERDICT_AT }],
    events: [
      { event: 'labeled', label: 'awaiting-maintainer', by: PIPELINE, at: PARKED_AT },
      { event: 'unlabeled', label: 'awaiting-maintainer', by, at: LABEL_AFTER_PARK }
    ]
  })

  it('owes a PR the maintainer woke one cycle', () => {
    const result = run(fixtures(removedBy(MAINTAINER)))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'true', reason: woken() })
    expect(result.writes).toEqual([])
  })

  const FIX_PUSHED_AT = '2026-09-21T09:00:00Z'

  // What the woken cycle may leave on the PR. The skill requires the first two; the last two
  // are the endings it must not reach, and the gate stays quiet on them too.
  const WOKEN_CYCLE_ENDINGS: [string, (args: Args) => Args][] = [
    [
      'parks it again with its reason',
      (args) => ({
        ...args,
        labels: [...args.labels, 'awaiting-maintainer'],
        parkedAt: AFTER_WAKE,
        comments: [...args.comments, { login: PIPELINE, at: AFTER_WAKE }]
      })
    ],
    [
      'approves the head its fix round pushed',
      (args) => ({
        ...args,
        state: 'success',
        headAt: FIX_PUSHED_AT,
        pushes: [{ after: SHA, by: PIPELINE, at: FIX_PUSHED_AT }],
        comments: [...args.comments, { login: PIPELINE, at: AFTER_WAKE }]
      })
    ],
    [
      'requests changes on the head its fix round pushed and does not park it',
      (args) => ({
        ...args,
        headAt: FIX_PUSHED_AT,
        pushes: [{ after: SHA, by: PIPELINE, at: FIX_PUSHED_AT }],
        comments: [...args.comments, { login: PIPELINE, at: AFTER_WAKE }]
      })
    ],
    [
      'only comments, leaving the head and its verdict as they were',
      (args) => ({ ...args, comments: [...args.comments, { login: PIPELINE, at: AFTER_WAKE }] })
    ]
  ]

  // Review round 4 on #1629, reproduction W1: at 280f6298 each of the three fires ran.
  it.each(WOKEN_CYCLE_ENDINGS)(
    'runs once after the maintainer only removes the label, then not on the next two fires, when the woken cycle %s',
    (_, ending) => {
      const wake = removedBy(MAINTAINER)
      const fires = [wake, ending(wake), ending(wake)].map((args) => run(fixtures(args)))
      for (const { status, stderr } of fires) expect(status, stderr).toBe(0)
      expect(fires.map(({ outputs }) => outputs)).toEqual([
        { run: 'true', reason: woken() },
        { run: 'false', reason: IDLE },
        { run: 'false', reason: IDLE }
      ])
    }
  )

  it('does not run again for a maintainer comment the woken cycle answered without a push', () => {
    const parkedComment = { login: MAINTAINER, at: '2026-09-21T07:00:00Z' }
    const wake: Args = {
      ...removedBy(MAINTAINER),
      comments: [{ login: PIPELINE, at: VERDICT_AT }, parkedComment]
    }
    const answered: Args = {
      ...wake,
      comments: [...wake.comments, { login: PIPELINE, at: AFTER_WAKE }]
    }
    expect(run(fixtures(wake)).outputs).toEqual({ run: 'true', reason: woken() })
    expect(run(fixtures(answered)).outputs).toEqual({ run: 'false', reason: IDLE })
    const later = '2026-09-21T11:00:00Z'
    const result = run(
      fixtures({ ...answered, comments: [...answered.comments, { login: MAINTAINER, at: later }] })
    )
    expect(result.outputs).toEqual({
      run: 'true',
      reason: `PR #${PR} has activity at ${later} newer than the pipeline's last comment (${AFTER_WAKE})`
    })
  })

  it('owes one cycle to a woken PR whose head another account pushed, then goes quiet', () => {
    const wake: Args = {
      ...removedBy(MAINTAINER),
      state: 'absent',
      pushes: [{ after: SHA, by: COLLABORATOR, at: PUSHED_AT }]
    }
    expect(run(fixtures(wake)).outputs).toEqual({ run: 'true', reason: woken() })
    const result = run(
      fixtures({ ...wake, comments: [...wake.comments, { login: PIPELINE, at: AFTER_WAKE }] })
    )
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
  })

  it.each([
    [COLLABORATOR, COLLABORATOR],
    ['the pipeline', PIPELINE],
    ['nobody on record', null]
  ])('applies the label again itself when %s removed it, and starts no cycle', (_, by) => {
    expectReappliedWithoutRun(removedBy(by), by)
  })

  // Review round 4 on #1629, reproduction W2: at 280f6298 removals 1, 2 and 3 each ran a cycle.
  it('starts no cycle however often another account removes the label', () => {
    const removals = ['2026-09-21T08:00:00Z', '2026-09-21T09:10:00Z', '2026-09-21T10:10:00Z']
    const events: LabelEvent[] = [
      { event: 'labeled', label: 'awaiting-maintainer', by: PIPELINE, at: PARKED_AT }
    ]
    for (const at of removals) {
      events.push({ event: 'unlabeled', label: 'awaiting-maintainer', by: COLLABORATOR, at })
      const result = run(
        fixtures({ labels: UNPARKED, comments: [{ login: PIPELINE, at: VERDICT_AT }], events })
      )
      expect(result.status, result.stderr).toBe(0)
      expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
      expect(result.writes).toEqual([REAPPLY])
      expect(result.summary).toContain(appliedAgain(COLLABORATOR, at))
      events.push({ event: 'labeled', label: 'awaiting-maintainer', by: PIPELINE, at })
    }
  })

  it('starts no cycle when putting the label back fails, and says so', () => {
    const result = run(fixtures({ ...removedBy(COLLABORATOR), reapplyFails: true }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({
      run: 'false',
      reason: `could not put back awaiting-maintainer on #${PR} to its trusted state; the next fire tries again`
    })
    expect(result.writes).toEqual([REAPPLY])
    expect(result.summary).toContain(
      `PR #${PR}: ${COLLABORATOR} removed awaiting-maintainer at ${LABEL_AFTER_PARK}, which does not count, and putting it back failed`
    )
  })

  it('wakes a PR when the maintainer removes the label the pre-gate applied again', () => {
    const result = run(
      fixtures({
        ...removedBy(COLLABORATOR),
        events: [
          ...(removedBy(COLLABORATOR).events ?? []),
          { event: 'labeled', label: 'awaiting-maintainer', by: PIPELINE, at: APPLIED_AGAIN_AT },
          { event: 'unlabeled', label: 'awaiting-maintainer', by: MAINTAINER, at: AFTER_WAKE }
        ]
      })
    )
    expect(result.outputs).toEqual({ run: 'true', reason: woken(AFTER_WAKE) })
  })

  it('reads only the newest removal: the maintainer waking it once does not wake it again', () => {
    expectReappliedWithoutRun(
      {
        ...removedBy(MAINTAINER),
        events: [
          ...(removedBy(MAINTAINER).events ?? []),
          { event: 'labeled', label: 'awaiting-maintainer', by: PIPELINE, at: APPLIED_AGAIN_AT },
          { event: 'unlabeled', label: 'awaiting-maintainer', by: COLLABORATOR, at: AFTER_WAKE }
        ]
      },
      COLLABORATOR,
      AFTER_WAKE
    )
  })

  // Round 2 of the review on #1629: the maintainer answers a PR another account unlabelled,
  // and a round the pipeline pushes approves it. At 408fe5be this ran every fire.
  it('ends the review round 2 reproduction with the label back and no cycle', () => {
    expectReappliedWithoutRun(
      {
        labels: UNPARKED,
        state: 'success',
        comments: [
          { login: MAINTAINER, at: '2026-09-20T09:50:00Z' },
          { login: PIPELINE, at: VERDICT_AT }
        ],
        events: [
          { event: 'labeled', label: 'awaiting-maintainer', by: PIPELINE, at: REPRO_LABELLED },
          { event: 'unlabeled', label: 'awaiting-maintainer', by: COLLABORATOR, at: REPRO_REMOVED }
        ]
      },
      COLLABORATOR,
      REPRO_REMOVED
    )
  })

  // Round 3 of the review on #1629, scenario A: as round 2, then another account pushes on
  // top of the pipeline's round. At 0c0478c0 this ran every fire.
  it('ends the review round 3 scenario A with the label back and no cycle', () => {
    expectReappliedWithoutRun(
      {
        labels: UNPARKED,
        state: 'absent',
        comments: [{ login: MAINTAINER, at: '2026-09-20T09:50:00Z' }],
        pushes: [
          { after: SHA, by: COLLABORATOR, at: '2026-09-20T10:30:00Z' },
          { after: OLD_SHA, by: PIPELINE, at: PUSHED_AT }
        ],
        events: [
          { event: 'labeled', label: 'awaiting-maintainer', by: PIPELINE, at: REPRO_LABELLED },
          { event: 'unlabeled', label: 'awaiting-maintainer', by: COLLABORATOR, at: REPRO_REMOVED }
        ]
      },
      COLLABORATOR,
      REPRO_REMOVED
    )
  })

  // Scenario B: the label stays on, the maintainer comments, and another account pushes.
  // At 0c0478c0 this ran every fire.
  it('does not run for the review round 3 scenario B', () => {
    const result = run(
      fixtures({
        labels: PARKED,
        parkedAt: REPRO_LABELLED,
        state: 'absent',
        comments: [{ login: MAINTAINER, at: '2026-09-20T09:50:00Z' }],
        pushes: [{ after: SHA, by: COLLABORATOR, at: '2026-09-20T10:30:00Z' }]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(SKIPPED)
  })
})

// The spend ruling on #1310: only the maintainer, the pipeline and, on a PR the
// pipeline opened, the named review bots may start a cycle.
const AFTER_HEAD = '2026-09-20T12:00:00Z'
const RAN = `PR #${PR} has activity at ${AFTER_HEAD} newer than its head (${HEAD_AT})`

type Surface = 'comments' | 'reviewComments' | 'reviews'

// Each bot where it posts: REST shows the Copilot reviewer's inline comments as `Copilot`.
const REVIEW_BOTS: [string, Surface][] = [
  ['coderabbitai[bot]', 'comments'],
  ['chatgpt-codex-connector[bot]', 'reviews'],
  ['Copilot', 'reviewComments'],
  ['copilot-pull-request-reviewer[bot]', 'reviews']
]

// One bot entry after the head, on the one surface the bot posts to.
const botActivity = (login: string, surface: Surface) => {
  const entry: Comment[] = [{ login, at: AFTER_HEAD, type: 'Bot' }]
  return {
    comments: surface === 'comments' ? entry : [],
    reviewComments: surface === 'reviewComments' ? entry : [],
    reviews: surface === 'reviews' ? entry : []
  }
}

describe.skipIf(!HAS_JQ)('pregate.sh trust list', () => {
  it('does not run for a comment from outside the trust list, and names it', () => {
    const before = '2026-09-20T09:00:00Z'
    const result = run(
      fixtures({
        labels: UNPARKED,
        state: 'success',
        comments: [
          { login: COLLABORATOR, at: before },
          { login: COLLABORATOR, at: AFTER_HEAD }
        ]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(
      `PR #${PR} has activity from outside the trust list, not counted: ${COLLABORATOR} at ${AFTER_HEAD}\n`
    )
  })

  it('does not count an untrusted comment on a failure verdict either', () => {
    const result = run(
      fixtures({ labels: UNPARKED, comments: [{ login: COLLABORATOR, at: AFTER_HEAD }] })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
  })

  it('runs for the maintainer', () => {
    const result = run(
      fixtures({
        labels: UNPARKED,
        state: 'success',
        comments: [{ login: MAINTAINER, at: AFTER_HEAD }]
      })
    )
    expect(result.outputs).toEqual({ run: 'true', reason: RAN })
    expect(result.summary).not.toContain('outside the trust list')
  })

  it.each(REVIEW_BOTS)('runs for %s on a PR the pipeline opened', (login, surface) => {
    const result = run(
      fixtures({ labels: UNPARKED, state: 'success', ...botActivity(login, surface) })
    )
    expect(result.outputs).toEqual({ run: 'true', reason: RAN })
  })

  it.each(REVIEW_BOTS)(
    'does not run for %s on a PR the pipeline did not open',
    (login, surface) => {
      const result = run(
        fixtures({
          labels: UNPARKED,
          state: 'success',
          author: MAINTAINER,
          ...botActivity(login, surface)
        })
      )
      expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
      expect(result.summary).toContain(`not counted: ${login} at ${AFTER_HEAD}`)
    }
  )
})

// The follow-up spend ruling: labels and pushes drive the routine too, so they count only
// when a trusted account made them. The events API names who applied or removed a label, the
// activity API who pushed.
describe.skipIf(!HAS_JQ)('pregate.sh counts labels and pushes only from trusted accounts', () => {
  const MAINTAINER_AFTER_PUSH = '2026-09-20T12:00:00Z'

  it('does not work or count a PR whose agent-pr label another account applied', () => {
    const result = run(
      fixtures({
        labels: UNPARKED,
        state: 'success',
        agentPrBy: COLLABORATOR,
        comments: [{ login: MAINTAINER, at: AFTER_HEAD }]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: QUEUE_EMPTY })
    expect(result.writes).toEqual([`DELETE repos/${REPO}/issues/${PR}/labels/agent-pr`])
    expect(result.summary).toContain(
      `PR #${PR}: ${COLLABORATOR} added agent-pr at 2026-09-19T09:00:00Z, which does not count; removed it`
    )
  })

  it('works a PR the maintainer labelled agent-pr', () => {
    const result = run(
      fixtures({
        labels: UNPARKED,
        state: 'success',
        agentPrBy: MAINTAINER,
        comments: [{ login: MAINTAINER, at: AFTER_HEAD }]
      })
    )
    expect(result.outputs).toEqual({ run: 'true', reason: RAN })
  })

  it.each([PIPELINE, MAINTAINER])('owes a verdict on a head %s pushed', (pusher) => {
    const result = run(fixtures({ labels: UNPARKED, state: 'absent', pusher, comments: [] }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({
      run: 'true',
      reason: `PR #${PR} head ${SHA.slice(0, 8)} has agent/pre-pass=absent; a verdict is owed`
    })
  })

  it.each([
    [COLLABORATOR, COLLABORATOR],
    ['nobody on record', null]
  ])('owes no verdict on a head pushed by %s', (named, pusher) => {
    // The pipeline's verdict on the old head is newer than the new head's commit date, which
    // the pusher sets: counted as before, it would run a cycle.
    const result = run(
      fixtures({
        labels: UNPARKED,
        state: 'absent',
        pusher,
        comments: [{ login: PIPELINE, at: VERDICT_AT }]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(
      `PR #${PR} head ${SHA.slice(0, 8)} was pushed by ${pusher === null ? 'an unrecorded account' : named}, outside the trust list; no verdict owed`
    )
  })

  it('runs for the maintainer after a push from outside the trust list', () => {
    const result = run(
      fixtures({
        labels: UNPARKED,
        state: 'absent',
        pusher: COLLABORATOR,
        comments: [{ login: MAINTAINER, at: MAINTAINER_AFTER_PUSH }]
      })
    )
    expect(result.outputs).toEqual({
      run: 'true',
      reason: `PR #${PR} has activity from the maintainer at ${MAINTAINER_AFTER_PUSH} newer than a push from outside the trust list (${PUSHED_AT})`
    })
  })

  it('reads the push time when the activity entry names no account', () => {
    // Between the head's commit date and the push: it predates the push, so it starts nothing.
    const beforePush = '2026-09-20T10:00:30Z'
    const result = run({
      ...fixtures({
        labels: UNPARKED,
        state: 'absent',
        comments: [{ login: MAINTAINER, at: beforePush }]
      }),
      [`repos/${REPO}/activity?ref=refs/heads/${BRANCH}&per_page=100`]: [
        { activity_type: 'push', after: SHA, actor: null, timestamp: PUSHED_AT }
      ]
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(
      `PR #${PR} head ${SHA.slice(0, 8)} was pushed by an unrecorded account, outside the trust list; no verdict owed`
    )
  })
})

describe.skipIf(!HAS_JQ)('pregate.sh stale claims', () => {
  const claim = (by: string) => ({
    ...lists({
      wip: [{ number: 5, state: 'open', assignees: [], labels: [{ name: 'agent-wip' }] }]
    }),
    ...labelWrites(5),
    [`repos/${REPO}/issues/5/events?per_page=100`]: [
      {
        event: 'labeled',
        label: { name: 'agent-wip' },
        actor: { login: by },
        created_at: '2026-01-01T00:00:00Z'
      }
    ]
  })

  it('neither ages out nor counts a claim label another account applied, and removes it', () => {
    const result = run(claim(COLLABORATOR))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: QUEUE_EMPTY })
    expect(result.writes).toEqual([`DELETE repos/${REPO}/issues/5/labels/agent-wip`])
    expect(result.summary).toContain(
      `Issue #5: ${COLLABORATOR} added agent-wip at 2026-01-01T00:00:00Z, which does not count; removed it`
    )
  })

  it.each([PIPELINE, MAINTAINER])('ages out a stale claim label %s applied', (by) => {
    const result = run(claim(by))
    expect(result.outputs.run).toBe('true')
    expect(result.outputs.reason).toContain('issue #5 holds an agent-wip claim')
  })
})

// Section 3 with the slot free: the frontier holds an issue only when the maintainer applied
// both of its queue labels.
const ISSUE = 9

const queue = (readyBy: string, queuedBy: string) => ({
  ...lists({
    queue: [
      { number: ISSUE, assignees: [], labels: [{ name: 'ready-for-agent' }, { name: 'queued' }] }
    ]
  }),
  [`repos/${REPO}/issues/${ISSUE}/events?per_page=100`]: [
    {
      event: 'labeled',
      label: { name: 'ready-for-agent' },
      actor: { login: readyBy },
      created_at: '2026-09-19T09:00:00Z'
    },
    {
      event: 'labeled',
      label: { name: 'queued' },
      actor: { login: queuedBy },
      created_at: '2026-09-19T09:05:00Z'
    }
  ],
  [`repos/${REPO}/issues/${ISSUE}/dependencies/blocked_by`]: []
})

describe.skipIf(!HAS_JQ)('pregate.sh frontier', () => {
  it('counts an issue the maintainer labelled ready-for-agent and queued', () => {
    const result = run(queue(MAINTAINER, MAINTAINER))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'true', reason: FRONTIER })
  })

  // ready-for-agent is left on, so the issue keeps a triage label; queued is taken off.
  it.each([
    [MAINTAINER, COLLABORATOR, `${COLLABORATOR} added queued at 2026-09-19T09:05:00Z`, 'queued'],
    [COLLABORATOR, MAINTAINER, `${COLLABORATOR} added ready-for-agent at 2026-09-19T09:00:00Z`],
    [PIPELINE, MAINTAINER, `${PIPELINE} added ready-for-agent at 2026-09-19T09:00:00Z`]
  ])(
    'leaves out an issue labelled ready-for-agent by %s and queued by %s',
    (readyBy, queuedBy, named, stripped?: string) => {
      const result = run({ ...queue(readyBy, queuedBy), ...labelWrites(ISSUE) })
      expect(result.status, result.stderr).toBe(0)
      expect(result.outputs).toEqual({ run: 'false', reason: QUEUE_EMPTY })
      expect(result.writes).toEqual(
        stripped ? [`DELETE repos/${REPO}/issues/${ISSUE}/labels/${stripped}`] : []
      )
      expect(result.summary).toContain(
        `Issue #${ISSUE}: ${named}, which does not count; ${stripped ? 'removed it' : 'left on'}`
      )
    }
  )
})

// The general rule of the 2026-09-28 rulings on #1310: every label the pre-gate reads counts in
// its trusted state, the one the newest event from its trust list set. A change from anyone
// else is ignored and, where the pre-gate may write the label, undone.
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

type Issue = { number: number; labels: string[]; events: LabelEvent[] }

// Sections 1 and 3 with no PR open. The repository's recent label events list every event
// on these issues, newest first; the pre-gate reads only those of the last four hours.
const issueWorld = (items: Issue[]) => {
  const issue = ({ number, labels }: Issue) => ({
    number,
    state: 'open',
    assignees: [],
    labels: labels.map((name) => ({ name }))
  })
  const has = ({ labels }: Issue, ...wanted: string[]) => wanted.every((l) => labels.includes(l))
  return {
    ...lists({
      wip: items.filter((i) => has(i, 'agent-wip')).map(issue),
      queue: items.filter((i) => has(i, 'ready-for-agent', 'queued')).map(issue),
      recent: items
        .flatMap(({ number, events }) => events.map((e) => labelEvent(e, number)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    }),
    ...Object.fromEntries(
      items.flatMap((i) => [
        [`repos/${REPO}/issues/${i.number}`, issue(i)],
        [
          `repos/${REPO}/issues/${i.number}/events?per_page=100`,
          i.events.map((e) => labelEvent(e))
        ],
        [`repos/${REPO}/issues/${i.number}/dependencies/blocked_by`, []],
        ...Object.entries(labelWrites(i.number))
      ])
    )
  }
}

const EARLIER = ago(30)
const LATER = ago(10)
const queuedBy = (by: string, ...labels: string[]): LabelEvent[] =>
  labels.map((label, i) => ({ event: 'labeled', label, by, at: ago(60 - i) }))
const QUEUED_ISSUE: Issue = {
  number: ISSUE,
  labels: ['ready-for-agent', 'queued'],
  events: queuedBy(MAINTAINER, 'ready-for-agent', 'queued')
}

type Outcome = { run: string; reason: string }

// One label: how to build the world with the label on or off, what the gate decides in each
// state, who is trusted to add and remove it, and whether the pre-gate takes it off.
type Subject = {
  noun: 'PR' | 'Issue'
  n: number
  world: (events: LabelEvent[], on: boolean) => Record<string, unknown>
  whenOn: Outcome
  whenOff: Outcome
  adder: string
  remover: string
  strip: boolean
  times: [string, string]
  // What an add from outside the trust list leads to, when that is not whenOff.
  untrustedAdd?: Outcome
}

const MERGE = `PR #${PR} is approved, ready and non-evidence; section 2a may merge it`
const PARKED_TIMES: [string, string] = [PARKED_AT, LABEL_AFTER_PARK]

const SUBJECTS: Record<string, Subject> = {
  'agent-pr': {
    noun: 'PR',
    n: PR,
    world: (events, on) =>
      fixtures({
        labels: on ? UNPARKED : ['agent-authored'],
        state: 'success',
        agentPrBy: null,
        events,
        comments: [{ login: MAINTAINER, at: AFTER_HEAD }]
      }),
    whenOn: { run: 'true', reason: RAN },
    whenOff: { run: 'false', reason: QUEUE_EMPTY },
    adder: PIPELINE,
    remover: MAINTAINER,
    strip: true,
    times: ['2026-09-19T09:00:00Z', LABEL_AFTER_PARK]
  },
  'agent-wip': {
    noun: 'Issue',
    n: 5,
    world: (events, on) =>
      issueWorld([{ number: 5, labels: on ? ['agent-wip'] : [], events }, QUEUED_ISSUE]),
    whenOn: { run: 'false', reason: IDLE },
    whenOff: { run: 'true', reason: FRONTIER },
    adder: PIPELINE,
    remover: PIPELINE,
    strip: true,
    times: [EARLIER, LATER]
  },
  'awaiting-maintainer': {
    noun: 'PR',
    n: PR,
    world: (events, on) =>
      fixtures({
        labels: on ? PARKED : UNPARKED,
        parkedBy: null,
        events,
        comments: [{ login: PIPELINE, at: VERDICT_AT }]
      }),
    whenOn: { run: 'false', reason: IDLE },
    whenOff: {
      run: 'true',
      reason: `PR #${PR} has activity at ${VERDICT_AT} newer than its head (${HEAD_AT})`
    },
    adder: PIPELINE,
    remover: MAINTAINER,
    strip: true,
    times: PARKED_TIMES
  },
  'evidence-affecting': {
    noun: 'PR',
    n: PR,
    world: (events, on) =>
      fixtures({
        labels: on ? [...UNPARKED, 'evidence-affecting'] : UNPARKED,
        state: 'success',
        draft: false,
        events,
        comments: []
      }),
    whenOn: { run: 'false', reason: IDLE },
    whenOff: { run: 'true', reason: MERGE },
    adder: PIPELINE,
    remover: MAINTAINER,
    strip: false,
    times: ['2026-09-19T09:00:00Z', LABEL_AFTER_PARK],
    // The pre-gate leaves the label on, and merge.sh refuses a PR that carries it.
    untrustedAdd: { run: 'false', reason: IDLE }
  },
  'ready-for-agent': {
    noun: 'Issue',
    n: ISSUE,
    world: (events, on) =>
      issueWorld([
        {
          number: ISSUE,
          labels: on ? ['ready-for-agent', 'queued'] : ['queued'],
          events: [...queuedBy(MAINTAINER, 'queued'), ...events]
        }
      ]),
    whenOn: { run: 'true', reason: FRONTIER },
    whenOff: { run: 'false', reason: QUEUE_EMPTY },
    adder: MAINTAINER,
    remover: PIPELINE,
    strip: false,
    times: [EARLIER, LATER]
  },
  queued: {
    noun: 'Issue',
    n: ISSUE,
    world: (events, on) =>
      issueWorld([
        {
          number: ISSUE,
          labels: on ? ['ready-for-agent', 'queued'] : ['ready-for-agent'],
          events: [...queuedBy(MAINTAINER, 'ready-for-agent'), ...events]
        }
      ]),
    whenOn: { run: 'true', reason: FRONTIER },
    whenOff: { run: 'false', reason: QUEUE_EMPTY },
    adder: MAINTAINER,
    remover: MAINTAINER,
    strip: true,
    times: [EARLIER, LATER]
  },
  process: {
    noun: 'Issue',
    n: ISSUE,
    world: (events, on) =>
      issueWorld([
        {
          number: ISSUE,
          labels: ['ready-for-agent', 'queued', ...(on ? ['process'] : [])],
          events: [...QUEUED_ISSUE.events, ...events]
        }
      ]),
    whenOn: { run: 'false', reason: QUEUE_EMPTY },
    whenOff: { run: 'true', reason: FRONTIER },
    adder: MAINTAINER,
    remover: MAINTAINER,
    strip: true,
    times: [EARLIER, LATER]
  }
}

type Case = {
  events: LabelEvent[]
  on: boolean
  expected: Outcome
  writes: string[]
  summary?: string
}

const CHANGES: [string, (label: string, s: Subject) => Case][] = [
  [
    'another account adds it',
    (label, s) => ({
      events: [{ event: 'labeled', label, by: COLLABORATOR, at: s.times[1] }],
      on: true,
      expected: s.untrustedAdd ?? s.whenOff,
      writes: s.strip ? [`DELETE repos/${REPO}/issues/${s.n}/labels/${label}`] : [],
      summary: `${s.noun} #${s.n}: ${COLLABORATOR} added ${label} at ${s.times[1]}, which does not count; ${s.strip ? 'removed it' : 'left on'}`
    })
  ],
  [
    'another account removes it after a trusted add',
    (label, s) => ({
      events: [
        { event: 'labeled', label, by: s.adder, at: s.times[0] },
        { event: 'unlabeled', label, by: COLLABORATOR, at: s.times[1] }
      ],
      on: false,
      expected: s.whenOn,
      writes: [`POST repos/${REPO}/issues/${s.n}/labels labels[]=${label}`],
      summary: `${s.noun} #${s.n}: ${COLLABORATOR} removed ${label} at ${s.times[1]}, which does not count; applied it again`
    })
  ],
  [
    'a trusted account adds it',
    (label, s) => ({
      events: [{ event: 'labeled', label, by: s.adder, at: s.times[0] }],
      on: true,
      expected: s.whenOn,
      writes: []
    })
  ],
  [
    'a trusted account removes it',
    (label, s) => ({
      events: [
        { event: 'labeled', label, by: s.adder, at: s.times[0] },
        { event: 'unlabeled', label, by: s.remover, at: s.times[1] }
      ],
      on: false,
      // The maintainer's removal of the parking label is the wake.
      expected: label === 'awaiting-maintainer' ? { run: 'true', reason: woken() } : s.whenOff,
      writes: []
    })
  ]
]

describe.skipIf(!HAS_JQ)('pregate.sh reads every label in its trusted state', () => {
  it('covers every label the pre-gate reads', () => {
    const table = readFileSync(SCRIPT, 'utf8').match(/label_trust="\$\(jq[^']*'\{([\s\S]*?)\}'\)"/)
    const read = [...(table?.[1] ?? '').matchAll(/^\s*(?:"([^"]+)"|\(\$park\)):/gm)].map(
      ([, name]) => name ?? 'awaiting-maintainer'
    )
    expect(read.sort()).toEqual(Object.keys(SUBJECTS).sort())
    expect(read.sort()).toEqual([...GATE_LABELS].sort())
  })

  it.each(
    Object.keys(SUBJECTS).flatMap((label) =>
      CHANGES.map(([change, make]) => [label, change, make] as const)
    )
  )('%s: %s', (label, _, make) => {
    const subject = SUBJECTS[label]
    const { events, on, expected, writes, summary } = make(label, subject)
    const result = run(subject.world(events, on))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual(expected)
    expect(result.writes).toEqual(writes)
    if (summary) expect(result.summary).toContain(summary)
  })

  // Review round 4's own body on #1629: removing evidence-affecting from an approved, ready
  // agent PR made the pre-gate run section 2a on every fire, and 2a could merge it.
  it('does not run section 2a after another account removes evidence-affecting', () => {
    const opened: LabelEvent = {
      event: 'labeled',
      label: 'evidence-affecting',
      by: PIPELINE,
      at: '2026-09-19T09:00:00Z'
    }
    const removed: LabelEvent = {
      event: 'unlabeled',
      label: 'evidence-affecting',
      by: COLLABORATOR,
      at: LABEL_AFTER_PARK
    }
    const approved = (labels: string[], events: LabelEvent[]) =>
      fixtures({ labels, state: 'success', draft: false, comments: [], events })
    const first = run(approved(UNPARKED, [opened, removed]))
    expect(first.status, first.stderr).toBe(0)
    expect(first.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(first.writes).toEqual([
      `POST repos/${REPO}/issues/${PR}/labels labels[]=evidence-affecting`
    ])
    expect(first.summary).toContain(`PR #${PR} is evidence-affecting; section 2a never merges it`)
    const putBack: LabelEvent = { ...opened, at: APPLIED_AGAIN_AT }
    for (let fire = 0; fire < 2; fire++) {
      const next = run(approved([...UNPARKED, 'evidence-affecting'], [opened, removed, putBack]))
      expect(next.outputs).toEqual({ run: 'false', reason: IDLE })
      expect(next.writes).toEqual([])
    }
  })

  it('reads a second page of recent label events while the first is all recent', () => {
    const world = issueWorld([
      {
        number: 5,
        labels: [],
        events: [
          { event: 'labeled', label: 'agent-wip', by: PIPELINE, at: EARLIER },
          { event: 'unlabeled', label: 'agent-wip', by: COLLABORATOR, at: LATER }
        ]
      },
      QUEUED_ISSUE
    ])
    const filler = Array.from({ length: 100 }, () =>
      labelEvent({ event: 'labeled', label: 'needs-triage', by: MAINTAINER, at: ago(5) }, 1)
    )
    const result = run({
      ...world,
      [`repos/${REPO}/issues/events?per_page=100&page=1`]: filler,
      [`repos/${REPO}/issues/events?per_page=100&page=2`]:
        world[`repos/${REPO}/issues/events?per_page=100&page=1`]
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.writes).toEqual([`POST repos/${REPO}/issues/5/labels labels[]=agent-wip`])
  })

  it('writes no label outside the workflow, where LOGIN is unset', () => {
    const result = run(
      fixtures({ labels: UNPARKED, agentPrBy: COLLABORATOR, state: 'success', comments: [] }),
      { LOGIN: '' }
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.writes).toEqual([])
    expect(result.summary).toContain('not written, because LOGIN is unset')
  })
})

// Round 6 on #1629: anyone with push access can post a commit status, so an agent/pre-pass
// status counts only from the maintainer or the pipeline. The creator is on the statuses list;
// the combined status does not name it.
describe.skipIf(!HAS_JQ)('pregate.sh counts agent/pre-pass only from trusted creators', () => {
  const FORGED_AT = '2026-09-20T12:30:00Z'
  const INTERRUPTED = 'Dispatch run ended (failure) before the pre-pass reported.'
  const MERGE = `PR #${PR} is approved, ready and non-evidence; section 2a may merge it`
  const RETRY = `PR #${PR} head ${SHA.slice(0, 8)} has a pre-pass an earlier run interrupted; the review is owed a retry`
  const owed = (state: string) =>
    `PR #${PR} head ${SHA.slice(0, 8)} has agent/pre-pass=${state}; a verdict is owed`
  const notCounted = (list: string) =>
    `PR #${PR} head ${SHA.slice(0, 8)} has agent/pre-pass statuses from outside the trust list, not counted: ${list}\n`
  // The pipeline's request-changes verdict on the head, which on its own starts nothing.
  const verdict: Status = {
    state: 'failure',
    by: PIPELINE,
    at: VERDICT_AT,
    description: '1 blocking: a false claim'
  }
  // A ready, non-evidence agent PR whose head the pipeline pushed.
  const ready = (statuses: Status[]) =>
    run(fixtures({ labels: UNPARKED, statuses, draft: false, comments: [] }))

  it.each([
    ['success', 'Approved for human review.', MERGE],
    ['failure', INTERRUPTED, RETRY],
    ['pending', 'Reviewer pre-pass running.', owed('pending')],
    ['error', 'Reviewer pre-pass running.', owed('error')]
  ] as const)(
    'ignores a forged %s on a ready agent PR and keeps the verdict it covers',
    (state, description, trustedReason) => {
      const forged: Status = { state, by: COLLABORATOR, at: FORGED_AT, description }
      const result = ready([forged, verdict])
      expect(result.status, result.stderr).toBe(0)
      expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
      expect(result.summary).toContain(notCounted(`${state} by ${COLLABORATOR} at ${FORGED_AT}`))
      // The same status from the pipeline decides as it did before this rule.
      const trusted = ready([{ ...forged, by: PIPELINE }, verdict])
      expect(trusted.outputs).toEqual({ run: 'true', reason: trustedReason })
      expect(trusted.summary).not.toContain('agent/pre-pass statuses from outside the trust list')
    }
  )

  it.each([
    [COLLABORATOR, COLLABORATOR],
    ['a workflow on another branch', 'github-actions[bot]'],
    ['nobody on record', null]
  ])('does not merge on a success posted by %s', (_, by) => {
    const result = ready([
      { state: 'success', by, at: FORGED_AT, description: 'Approved for human review.' }
    ])
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'true', reason: owed('absent') })
    expect(result.summary).toContain(
      notCounted(`success by ${by ?? 'an unrecorded account'} at ${FORGED_AT}`)
    )
  })

  it('merges on the maintainer success and does not name an older untrusted status', () => {
    const result = ready([
      { state: 'success', by: MAINTAINER, at: FORGED_AT, description: 'Approved.' },
      { state: 'failure', by: COLLABORATOR, at: VERDICT_AT, description: INTERRUPTED }
    ])
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'true', reason: MERGE })
    expect(result.summary).not.toContain('agent/pre-pass statuses from outside the trust list')
  })

  it('owes a verdict when only the seeded pending is on the head', () => {
    const result = ready([
      {
        state: 'pending',
        by: 'github-actions[bot]',
        at: HEAD_AT,
        description: 'Reviewer pre-pass has not reported for this commit.'
      }
    ])
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'true', reason: owed('absent') })
  })
})

// Round 7 on #1629: merge.sh refuses a PR whose required checks are not all green at its head,
// counting every check run and status whoever posted it, and a workflow on any branch can create
// a failing check run under any name. Deciding section 2a over one ran a cycle on every fire.
describe.skipIf(!HAS_JQ)('pregate.sh holds section 2a while merge.sh would refuse', () => {
  const MAIN_SHA = 'feedc0de00000000000000000000000000000000'
  const MERGE = `PR #${PR} is approved, ready and non-evidence; section 2a may merge it`
  type Check = { name: string; status?: string; conclusion?: string | null }
  const green = (name: string): Check => ({ name, conclusion: 'success' })
  // Main green with lint and test required, and the PR head's check runs and combined status.
  const withChecks = (
    head: Check[] | null,
    statuses: { context: string; state: string }[] = []
  ) => ({
    ...fixtures({
      labels: UNPARKED,
      statuses: [
        {
          state: 'success',
          by: PIPELINE,
          at: VERDICT_AT,
          description: 'Approved for human review.'
        }
      ],
      draft: false,
      comments: []
    }),
    [`repos/${REPO}/commits/main`]: { sha: MAIN_SHA },
    [`repos/${REPO}/rules/branches/main`]: [
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'lint' }, { context: 'test' }] }
      }
    ],
    [`repos/${REPO}/commits/${MAIN_SHA}/check-runs?per_page=100`]: {
      check_runs: [green('lint'), green('test')].map((c) => ({ ...c, status: 'completed' }))
    },
    [`repos/${REPO}/commits/${MAIN_SHA}/status?per_page=100`]: { statuses: [] },
    ...(head === null
      ? {}
      : {
          [`repos/${REPO}/commits/${SHA}/check-runs?per_page=100`]: {
            check_runs: head.map(({ name, status = 'completed', conclusion = null }) => ({
              name,
              status,
              conclusion
            }))
          },
          [`repos/${REPO}/commits/${SHA}/status?per_page=100`]: { statuses }
        })
  })
  const held = (checks: string) =>
    `PR #${PR} is approved, ready and non-evidence, but merge.sh would refuse it: required check(s) ${checks} not green at its head`

  it('runs section 2a when every required check is green at the head', () => {
    const result = run(withChecks([green('lint'), green('test'), green('build')]))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'true', reason: MERGE })
  })

  it.each([
    [
      'a failing test check run beside the passing one',
      [green('lint'), green('test'), { name: 'test', conclusion: 'failure' }],
      'test'
    ],
    ['a required check with no run', [green('test')], 'lint (missing)'],
    [
      'a required check still running',
      [green('lint'), { name: 'test', status: 'in_progress' }],
      'test'
    ]
  ] as const)('holds section 2a over %s', (_label, head, named) => {
    const result = run(withChecks([...head]))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(held(named))
  })

  it('holds section 2a over a failing required status from another account', () => {
    const result = run(
      withChecks([green('lint'), green('test')], [{ context: 'test', state: 'failure' }])
    )
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(held('test'))
  })

  it('runs section 2a when the head checks cannot be read', () => {
    const result = run(withChecks(null))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'true', reason: MERGE })
  })

  // Review round 5 on #1629, R2: evidence-affecting on the linked issue, which the pre-gate does
  // not read, so this is the approved, ready, green PR it would merge on every fire. The spend
  // cap now bounds it.
  it('bounds the review round 5 reproduction R2 with the spend cap', () => {
    expectCapped(withChecks([green('lint'), green('test')]), MERGE)
  })
})

// The spend cap across the fires of one day on a PR the pre-gate would start a cycle for on
// every fire: the first runs, a fire half an hour later is held for the PR, one 6.5 hours after
// the last cycle runs, and one after four cycles in 24 hours is held in total.
const expectCapped = (fixture: Record<string, unknown>, reason: string) => {
  const onPr = (...hours: number[]) => hours.map((h) => ({ hoursAgo: h, targets: [PR] }))
  const fires: [Paid[], string][] = [
    [[], `run=true (${reason})`],
    [
      onPr(0.5),
      `run=false (the spend cap holds every cycle owed: #${PR} had one in the last 6 hours)`
    ],
    [onPr(6.5), `run=true (${reason})`],
    [onPr(6.5, 12.5, 18.5, 23), 'run=false (the spend cap holds this cycle: 4 paid cycles started']
  ]
  for (const [paid, want] of fires) {
    const result = run({ ...fixture, ...paidHistory(paid) })
    expect(result.status, result.stderr).toBe(0)
    expect(`run=${result.outputs.run} (${result.outputs.reason})`).toContain(want)
    expect(result.writes).toEqual([])
  }
}

// The maintainer's ruling of 2026-09-28 on #1310: at most 4 paid cycles in any 24 hours, and at
// most 1 for any PR or issue in any 6 hours, counted from the dispatch workflow's own jobs.
describe.skipIf(!HAS_JQ)('pregate.sh spend cap', () => {
  const OWED = fixtures({ labels: UNPARKED, comments: [{ login: PIPELINE, at: VERDICT_AT }] })
  const ACTIVITY = `PR #${PR} has activity at ${VERDICT_AT} newer than its head (${HEAD_AT})`
  const TOTAL = 'the spend cap holds this cycle: 4 paid cycles started since '
  const HELD_PR = `the spend cap holds every cycle owed: #${PR} had one in the last 6 hours`
  const NOTICE = '::notice title=Dispatch target::'
  const others = (...hours: number[]) => hours.map((h, i) => ({ hoursAgo: h, targets: [100 + i] }))

  it('starts a cycle below both limits and records the PR it is for', () => {
    const result = run({ ...OWED, ...paidHistory(others(2, 8, 14)) })
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'true', reason: ACTIVITY })
    expect(result.stdout).toContain(`${NOTICE}${PR}\n`)
  })

  it('holds every cycle once 4 have started in 24 hours', () => {
    const result = run({ ...OWED, ...paidHistory(others(2, 8, 14, 20)) })
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs.run).toBe('false')
    expect(result.outputs.reason).toContain(TOTAL)
    expect(result.outputs.reason).toContain(`and the limit is 4 in 24 hours: ${ACTIVITY}`)
    expect(result.stdout).not.toContain(NOTICE)
  })

  it('holds report mode at the total limit too', () => {
    const result = run({ ...OWED, ...paidHistory(others(2, 8, 14, 20)) }, {}, 'report')
    expect(result.outputs.run).toBe('false')
    expect(result.outputs.reason).toContain(`${TOTAL}`)
    expect(result.outputs.reason).toContain('report mode always runs')
  })

  it('records no target for report mode below the limit', () => {
    const result = run({ ...OWED, ...paidHistory(others(2)) }, {}, 'report')
    expect(result.outputs).toEqual({ run: 'true', reason: 'report mode always runs' })
    expect(result.stdout).toContain(`${NOTICE}none\n`)
  })

  it.each([
    ['a cycle older than 24 hours', others(2, 8, 14, 25)],
    [
      'a fire whose Claude step was skipped',
      [
        ...others(2, 8, 14),
        { hoursAgo: 20, targets: null, step: { status: 'completed', conclusion: 'skipped' } }
      ]
    ]
  ] as const)('does not count %s', (_label, paid) => {
    const result = run({ ...OWED, ...paidHistory([...paid]) })
    expect(result.outputs).toEqual({ run: 'true', reason: ACTIVITY })
  })

  it.each([
    [
      'a run cancelled after its Claude step started',
      { hoursAgo: 20, targets: [104], step: { status: 'completed', conclusion: 'cancelled' } }
    ],
    [
      'a cycle still running',
      { hoursAgo: 1, targets: [104], step: { status: 'in_progress', conclusion: null } }
    ],
    [
      'a re-run of a run created five days earlier',
      { hoursAgo: 3, targets: [104], createdDaysAgo: 5 }
    ]
  ] as const)('counts %s', (_label, last) => {
    const result = run({ ...OWED, ...paidHistory([...others(2, 8, 14), last]) })
    expect(result.outputs.run).toBe('false')
    expect(result.outputs.reason).toContain(TOTAL)
  })

  it('holds a PR that had a cycle 5 hours ago, and names it', () => {
    const result = run({ ...OWED, ...paidHistory([{ hoursAgo: 5, targets: [PR] }]) })
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: HELD_PR })
    expect(result.summary).toMatch(
      new RegExp(
        `Held by the spend cap: #${PR} had a paid cycle at \\S+, and the limit is 1 in 6 hours: ${ACTIVITY.replace(/[()]/g, '\\$&')}`
      )
    )
  })

  it('starts a cycle for a PR whose last cycle was 7 hours ago', () => {
    const result = run({ ...OWED, ...paidHistory([{ hoursAgo: 7, targets: [PR] }]) })
    expect(result.outputs).toEqual({ run: 'true', reason: ACTIVITY })
  })

  it('does not hold a PR for a cycle recorded for another target or for report mode', () => {
    const result = run({
      ...OWED,
      ...paidHistory([
        { hoursAgo: 1, targets: [8] },
        { hoursAgo: 2, targets: [] }
      ])
    })
    expect(result.outputs).toEqual({ run: 'true', reason: ACTIVITY })
  })

  it('holds every target for 6 hours after a cycle that recorded none', () => {
    const result = run({ ...OWED, ...paidHistory([{ hoursAgo: 2, targets: null }]) })
    expect(result.outputs).toEqual({ run: 'false', reason: HELD_PR })
  })

  it("counts a supervised fire's target issue against its limit", () => {
    const result = run(
      { ...OWED, ...paidHistory([{ hoursAgo: 2, targets: [12] }]) },
      { TARGET_ISSUE: '12' }
    )
    expect(result.outputs).toEqual({
      run: 'false',
      reason: 'the spend cap holds every cycle owed: #12 had one in the last 6 hours'
    })
  })

  it('holds queue work while an issue on the frontier had a cycle, and records each issue', () => {
    const held = run({
      ...issueWorld([QUEUED_ISSUE]),
      ...paidHistory([{ hoursAgo: 5, targets: [ISSUE] }])
    })
    expect(held.outputs).toEqual({
      run: 'false',
      reason: `the spend cap holds every cycle owed: #${ISSUE} had one in the last 6 hours`
    })
    const free = run({
      ...issueWorld([QUEUED_ISSUE]),
      ...paidHistory([{ hoursAgo: 7, targets: [ISSUE] }])
    })
    expect(free.outputs).toEqual({ run: 'true', reason: FRONTIER })
    expect(free.stdout).toContain(`${NOTICE}${ISSUE}\n`)
  })

  it('looks past a held PR to a stale claim', () => {
    const stale = issueWorld([
      {
        number: ISSUE,
        labels: ['agent-wip'],
        events: [{ event: 'labeled', label: 'agent-wip', by: PIPELINE, at: '2026-01-01T00:00:00Z' }]
      }
    ])
    const result = run({
      ...stale,
      ...OWED,
      [`repos/${REPO}/issues?state=open&labels=agent-wip&per_page=100`]:
        stale[`repos/${REPO}/issues?state=open&labels=agent-wip&per_page=100`],
      ...paidHistory([{ hoursAgo: 5, targets: [PR] }])
    })
    expect(result.outputs.run).toBe('true')
    expect(result.outputs.reason).toContain(`issue #${ISSUE} holds an agent-wip claim`)
  })

  it.each([
    ['the run list', { [RUNS]: null }],
    ["a run's jobs", paidHistory(others(1), 'jobs')],
    ["a job's annotations", paidHistory(others(1), 'annotations')]
  ] as const)('holds when %s cannot be read', (_label, history) => {
    const result = run({ ...OWED, ...history })
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({
      run: 'false',
      reason: `could not count the paid cycles already started, so the spend cap holds this one: ${ACTIVITY}`
    })
    expect(result.stdout).not.toContain(NOTICE)
  })

  // Review round 5 on #1629, R1: a collaborator force-pushes the branch back to H1, the head the
  // pipeline requested changes on at 09:00, after H2 was approved at 10:30. The pre-gate counts
  // the pipeline's 10:30 comment as activity on H1 on every fire. R1b: H1's failure is the one
  // the cleanup step posts, which reads as an interrupted review owed a retry.
  it.each([
    [
      'R1',
      '1 blocking: a false claim',
      `PR #${PR} has activity at 2026-09-20T10:30:00Z newer than its head (2026-09-20T07:59:00Z)`
    ],
    [
      'R1b',
      'Dispatch run ended (cancelled)',
      `PR #${PR} head ${SHA.slice(0, 8)} has a pre-pass an earlier run interrupted; the review is owed a retry`
    ]
  ])(
    'bounds the review round 5 reproduction %s with the spend cap',
    (_label, description, reason) => {
      expectCapped(
        fixtures({
          labels: UNPARKED,
          draft: false,
          headAt: '2026-09-20T07:59:00Z',
          statuses: [{ state: 'failure', by: PIPELINE, at: '2026-09-20T09:00:00Z', description }],
          comments: [
            { login: PIPELINE, at: '2026-09-20T09:00:00Z' },
            { login: PIPELINE, at: '2026-09-20T10:30:00Z' }
          ],
          pushes: [
            { after: SHA, by: COLLABORATOR, at: '2026-09-20T12:00:00Z' },
            { after: OLD_SHA, by: PIPELINE, at: '2026-09-20T10:00:00Z' },
            { after: SHA, by: PIPELINE, at: '2026-09-20T08:00:00Z' }
          ]
        }),
        reason
      )
    }
  )
})

// The spend cap binds every way dispatch.yml reaches Claude only while the pre-gate runs in the
// same job before every step that reads the Claude credential, each such step waits on its
// answer, and the step the cap counts is the first of them.
describe('dispatch.yml runs the pre-gate before every Claude step', () => {
  const WORKFLOW = resolve(__dirname, '..', '.github', 'workflows', 'dispatch.yml')
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n')
  const steps: string[][] = []
  for (const line of lines.slice(lines.indexOf('    steps:') + 1)) {
    if (/^ {6}- /.test(line)) steps.push([line])
    else steps.at(-1)?.push(line)
  }
  const code = (step: string[]) => step.filter((line) => !/^\s*#/.test(line)).join('\n')
  const named = (step: string[]) => code(step).match(/name: (.+)/)?.[1]
  const constant = (name: string) =>
    readFileSync(SCRIPT, 'utf8').match(new RegExp(`^${name}='([^']+)'$`, 'm'))?.[1]

  it('has one job, so the pre-gate and the cycle share every attempt', () => {
    const jobs = lines.slice(lines.indexOf('jobs:') + 1)
    expect(jobs.filter((line) => /^ {2}[a-z_-]+:\s*$/.test(line))).toEqual(['  cycle:'])
  })

  it('gates every step that reads the Claude credential on the pre-gate', () => {
    const gate = steps.findIndex((step) => code(step).includes('id: gate'))
    const paid = steps.flatMap((step, i) =>
      code(step).includes('secrets.CLAUDE_CODE_OAUTH_TOKEN') ? [i] : []
    )
    expect(gate).toBeGreaterThan(-1)
    expect(paid.length).toBeGreaterThan(0)
    for (const i of paid) {
      expect(i).toBeGreaterThan(gate)
      expect(code(steps[i])).toContain("if: steps.gate.outputs.run == 'true'")
    }
    expect(named(steps[paid[0]])).toBe(constant('CAP_PAID_STEP'))
    expect(constant('CAP_WORKFLOW')).toBe('dispatch.yml')
  })
})
