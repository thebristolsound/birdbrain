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

type LabelEvent = { event: 'labeled' | 'unlabeled'; label: string; by: string | null; at: string }
type Push = { after: string; by: string; at: string }

const user = ({ login, type = 'User' }: Comment) => ({ login, type })

const fixtures = ({
  labels,
  comments,
  reviewComments = [],
  reviews = [],
  state = 'failure',
  author = PIPELINE,
  agentPrBy = PIPELINE,
  pusher = PIPELINE,
  pushes,
  parkedAt = PARKED_AT,
  events = [],
  headAt = HEAD_AT,
  reapplyFails = false
}: {
  labels: string[]
  comments: Comment[]
  reviewComments?: Comment[]
  reviews?: Comment[]
  state?: 'success' | 'failure' | 'absent'
  author?: string
  agentPrBy?: string
  pusher?: string | null
  // Every push on the branch, newest first; overrides pusher.
  pushes?: Push[]
  // When the pipeline applied awaiting-maintainer, if labels carries it.
  parkedAt?: string
  events?: LabelEvent[]
  // The head's commit date.
  headAt?: string
  // Whether the pre-gate's write of awaiting-maintainer fails.
  reapplyFails?: boolean
}) => ({
  [`repos/${REPO}/issues?state=open&labels=agent-pr&per_page=100`]: [
    { number: PR, pull_request: {} }
  ],
  [`repos/${REPO}/issues?state=open&labels=agent-wip&per_page=100`]: [],
  [`repos/${REPO}/pulls/${PR}`]: {
    head: { sha: SHA, ref: BRANCH },
    draft: true,
    user: { login: author }
  },
  [`repos/${REPO}/commits/${SHA}/status`]: {
    statuses:
      state === 'absent'
        ? []
        : [
            {
              context: 'agent/pre-pass',
              state,
              description:
                state === 'failure' ? '1 blocking: a false claim' : 'Approved for human review.'
            }
          ]
  },
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
  [`repos/${REPO}/issues/${PR}/labels`]: labels.map((name) => ({ name })),
  ...(reapplyFails
    ? {}
    : {
        [`POST repos/${REPO}/issues/${PR}/labels`]: [...labels, 'awaiting-maintainer'].map(
          (name) => ({ name })
        )
      }),
  [`repos/${REPO}/issues/${PR}/events?per_page=100`]: [
    {
      event: 'labeled',
      label: { name: 'agent-pr' },
      actor: { login: agentPrBy },
      created_at: '2026-09-19T09:00:00Z'
    },
    ...(labels.includes('awaiting-maintainer')
      ? [
          {
            event: 'labeled',
            label: { name: 'awaiting-maintainer' },
            actor: { login: PIPELINE },
            created_at: parkedAt
          }
        ]
      : []),
    ...events.map(({ event, label, by, at }) => ({
      event,
      label: { name: label },
      actor: by === null ? null : { login: by },
      created_at: at
    }))
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

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pregate-'))
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const run = (fixture: Record<string, unknown>) => {
  writeFileSync(join(dir, 'fixtures.json'), JSON.stringify(fixture))
  const output = join(dir, 'output')
  const summary = join(dir, 'summary')
  writeFileSync(output, '')
  writeFileSync(summary, '')
  rmSync(join(dir, 'writes'), { force: true })
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
  const writes = join(dir, 'writes')
  return {
    status: result.status,
    stderr: result.stderr,
    outputs,
    summary: readFileSync(summary, 'utf8'),
    writes: existsSync(writes) ? readFileSync(writes, 'utf8').trim().split('\n') : []
  }
}

const PARKED = ['agent-pr', 'agent-authored', 'awaiting-maintainer']
const UNPARKED = ['agent-pr', 'agent-authored']
const IDLE = 'the slot is held and no open agent PR needs the routine'
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
  `PR #${PR} is parked, but ${by ?? 'an unrecorded account'} removed awaiting-maintainer at ${at}; applied it again and skipped`

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
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.writes).toEqual([REAPPLY])
    expect(result.summary).toContain(
      `PR #${PR} is parked, but ${COLLABORATOR} removed awaiting-maintainer at ${LABEL_AFTER_PARK}, and applying it again failed; skipped, and the next fire tries again`
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

  it('does not work a PR whose agent-pr label another account applied', () => {
    const result = run(
      fixtures({
        labels: UNPARKED,
        state: 'success',
        agentPrBy: COLLABORATOR,
        comments: [{ login: MAINTAINER, at: AFTER_HEAD }]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(
      `PR #${PR} carries agent-pr from ${COLLABORATOR}, outside the trust list; not worked`
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
    [`repos/${REPO}/issues?state=open&labels=agent-pr&per_page=100`]: [],
    [`repos/${REPO}/issues?state=open&labels=agent-wip&per_page=100`]: [{ number: 5 }],
    [`repos/${REPO}/issues/5/events?per_page=100`]: [
      {
        event: 'labeled',
        label: { name: 'agent-wip' },
        actor: { login: by },
        created_at: '2026-01-01T00:00:00Z'
      }
    ]
  })

  it('does not age out a claim label another account applied, which still holds the slot', () => {
    const result = run(claim(COLLABORATOR))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(
      `Issue #5 carries agent-wip from ${COLLABORATOR}, outside the trust list; not aged out`
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
  [`repos/${REPO}/issues?state=open&labels=agent-pr&per_page=100`]: [],
  [`repos/${REPO}/issues?state=open&labels=agent-wip&per_page=100`]: [],
  [`repos/${REPO}/issues?state=open&labels=ready-for-agent,queued&per_page=100`]: [
    { number: ISSUE, assignees: [], labels: [{ name: 'ready-for-agent' }, { name: 'queued' }] }
  ],
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
    expect(result.outputs).toEqual({
      run: 'true',
      reason: 'the slot is free and 1 unblocked queued issue(s) wait'
    })
  })

  it.each([
    [MAINTAINER, COLLABORATOR, `queued from ${COLLABORATOR}`],
    [COLLABORATOR, MAINTAINER, `ready-for-agent from ${COLLABORATOR}`],
    [PIPELINE, MAINTAINER, `ready-for-agent from ${PIPELINE}`]
  ])(
    'leaves out an issue labelled ready-for-agent by %s and queued by %s',
    (readyBy, queuedBy, named) => {
      const result = run(queue(readyBy, queuedBy))
      expect(result.status, result.stderr).toBe(0)
      expect(result.outputs).toEqual({
        run: 'false',
        reason: 'the slot is free but the queue is empty'
      })
      expect(result.summary).toContain(
        `Issue #${ISSUE} has ${named}, outside the trust list; not frontier`
      )
    }
  )
})
