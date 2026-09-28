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
// Any account outside the trust list, another write collaborator included.
const COLLABORATOR = 'a-collaborator'
const PR = 7
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const BRANCH = 'agent/7-fix'

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

type Comment = { login: string; at: string; type?: 'User' | 'Bot' }

const HEAD_AT = '2026-09-20T10:00:00Z'
const VERDICT_AT = '2026-09-20T11:00:00Z'
const PARKED_AT = '2026-09-20T11:05:00Z'
const PUSHED_AT = '2026-09-20T10:01:00Z'

type LabelEvent = { event: 'labeled' | 'unlabeled'; label: string; by: string; at: string }

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
  events = []
}: {
  labels: string[]
  comments: Comment[]
  reviewComments?: Comment[]
  reviews?: Comment[]
  state?: 'success' | 'failure' | 'absent'
  author?: string
  agentPrBy?: string
  pusher?: string | null
  events?: LabelEvent[]
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
  [`repos/${REPO}/activity?ref=refs/heads/${BRANCH}&per_page=100`]:
    pusher === null
      ? []
      : [{ activity_type: 'push', after: SHA, actor: { login: pusher }, timestamp: PUSHED_AT }],
  [`repos/${REPO}/commits/${SHA}`]: { commit: { committer: { date: HEAD_AT } } },
  [`repos/${REPO}/issues/${PR}/labels`]: labels.map((name) => ({ name })),
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
            created_at: PARKED_AT
          }
        ]
      : []),
    ...events.map(({ event, label, by, at }) => ({
      event,
      label: { name: label },
      actor: { login: by },
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

  it('keeps a parked PR skipped when only a bot comments after the label', () => {
    const result = run(
      fixtures({
        labels: PARKED,
        comments: [
          { login: PIPELINE, at: VERDICT_AT },
          { login: 'coderabbitai[bot]', at: '2026-09-21T08:00:00Z', type: 'Bot' },
          { login: 'chatgpt-codex-connector[bot]', at: '2026-09-21T09:00:00Z', type: 'Bot' }
        ]
      })
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs.run).toBe('false')
  })

  it('runs for a parked PR once the maintainer comments after the label', () => {
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

  it('keeps a parked PR skipped when another collaborator comments after the label', () => {
    const at = '2026-09-21T08:00:00Z'
    const result = run(fixtures({ labels: PARKED, comments: [{ login: COLLABORATOR, at }] }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs.run).toBe('false')
    expect(result.summary).toContain(
      `PR #${PR} has activity from outside the trust list, not counted: ${COLLABORATOR} at ${at}`
    )
  })
})

// The spend ruling on #1310: only the maintainer, the pipeline and, on a PR the
// pipeline opened, the named review bots may start a cycle.
const AFTER_HEAD = '2026-09-20T12:00:00Z'
const UNPARKED = ['agent-pr', 'agent-authored']
const IDLE = 'the slot is held and no open agent PR needs the routine'
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

  const unparked = (by: string) =>
    fixtures({
      labels: UNPARKED,
      comments: [{ login: PIPELINE, at: VERDICT_AT }],
      events: [
        { event: 'labeled', label: 'awaiting-maintainer', by: PIPELINE, at: PARKED_AT },
        { event: 'unlabeled', label: 'awaiting-maintainer', by, at: '2026-09-21T08:00:00Z' }
      ]
    })

  it('keeps a PR parked when another account removed the label', () => {
    const result = run(unparked(COLLABORATOR))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(
      `PR #${PR}: ${COLLABORATOR} removed awaiting-maintainer at 2026-09-21T08:00:00Z, outside the trust list; still parked`
    )
    expect(result.summary).toContain(`PR #${PR} is parked for the maintainer since ${PARKED_AT}`)
  })

  it.each([MAINTAINER, PIPELINE])('un-parks a PR when %s removed the label', (by) => {
    const result = run(unparked(by))
    expect(result.outputs).toEqual({
      run: 'true',
      reason: `PR #${PR} has activity at ${VERDICT_AT} newer than its head (${HEAD_AT})`
    })
  })

  // Round 2 of the review on #1629: the maintainer answers a PR whose label another account
  // removed, and the round he asked for pushes and approves. The skill has no label left to
  // remove, so nothing but that push records the resume.
  const LABELLED_BEFORE_HEAD = '2026-09-20T09:30:00Z'
  const resumed = (state: 'success' | 'failure') =>
    fixtures({
      labels: UNPARKED,
      state,
      comments: [
        { login: MAINTAINER, at: '2026-09-20T09:50:00Z' },
        { login: PIPELINE, at: VERDICT_AT }
      ],
      events: [
        { event: 'labeled', label: 'awaiting-maintainer', by: PIPELINE, at: LABELLED_BEFORE_HEAD },
        {
          event: 'unlabeled',
          label: 'awaiting-maintainer',
          by: COLLABORATOR,
          at: '2026-09-20T09:40:00Z'
        }
      ]
    })

  it('does not run again once a trusted push resumes a PR another account unlabelled', () => {
    const result = run(resumed('success'))
    expect(result.status, result.stderr).toBe(0)
    expect(result.outputs).toEqual({ run: 'false', reason: IDLE })
    expect(result.summary).toContain(
      `PR #${PR}: ${COLLABORATOR} removed awaiting-maintainer at 2026-09-20T09:40:00Z, outside the trust list; resumed by a push at ${PUSHED_AT}`
    )
  })

  it('applies the unlabelled rules to that PR once resumed', () => {
    const result = run(resumed('failure'))
    expect(result.outputs).toEqual({
      run: 'true',
      reason: `PR #${PR} has activity at ${VERDICT_AT} newer than its head (${HEAD_AT})`
    })
  })

  it('runs for the maintainer on a PR another account unlabelled, before any resume', () => {
    const answered = '2026-09-21T09:00:00Z'
    const fixture = unparked(COLLABORATOR)
    const key = `repos/${REPO}/issues/${PR}/comments?per_page=100`
    const result = run({
      ...fixture,
      [key]: [...fixture[key], { user: { login: MAINTAINER, type: 'User' }, created_at: answered }]
    })
    expect(result.outputs).toEqual({
      run: 'true',
      reason: `PR #${PR} is parked for the maintainer and has activity at ${answered} newer than the label (${PARKED_AT})`
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
