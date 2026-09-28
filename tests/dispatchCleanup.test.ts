import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { HAS_JQ } from './helpers/jq'
import { type GhRoutes, type GhStub, makeGhStub } from './helpers/ghStub'

const SCRIPT = resolve(__dirname, '..', '.github', 'scripts', 'dispatch', 'cleanup.sh')
const API = 'repos/o/r'
const PIPELINE = 'birdbrain-agent'
const MAINTAINER = 'thebristolsound'
const COLLABORATOR = 'a-collaborator'
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const STARTED = '2026-09-28T10:00:00Z'
const BEFORE = '2026-09-28T09:00:00Z'
const DURING = '2026-09-28T10:10:00Z'
const LATER = '2026-09-28T10:20:00Z'
const PENDING_TEXT = 'Reviewer pre-pass running.'

type Status = { state: string; by: string | null; at: string; description?: string }
type Comment = { by: string; at: string; body: string }
type LabelEvent = { event: 'labeled' | 'unlabeled'; by: string; at: string }

// Agent PR #7, which closes issue #5, with its head's agent/pre-pass statuses newest first,
// the comments on #5, and issue #6 claimed under agent-wip with its label events.
const routes = ({
  statuses = [],
  comments = [],
  wipEvents
}: {
  statuses?: Status[]
  comments?: Comment[]
  wipEvents?: LabelEvent[]
}): GhRoutes => ({
  [`${API}/issues?state=open&labels=agent-pr&per_page=100`]: [{ number: 7, pull_request: {} }],
  [`${API}/pulls/7`]: { head: { sha: SHA }, body: 'Closes #5\n\nBody.' },
  [`${API}/commits/${SHA}/statuses?per_page=100`]: statuses.map(
    ({ by, at, description = '', ...rest }) => ({
      context: 'agent/pre-pass',
      ...rest,
      description,
      creator: by === null ? null : { login: by },
      created_at: at
    })
  ),
  [`${API}/statuses/${SHA}`]: {},
  [`${API}/issues/5/comments?per_page=100`]: comments.map(({ by, at, body }) => ({
    user: { login: by },
    created_at: at,
    body
  })),
  [`${API}/issues/5/comments`]: {},
  [`${API}/issues?state=open&labels=agent-wip&per_page=100`]:
    wipEvents === undefined ? [] : [{ number: 6 }],
  [`${API}/issues/6/events?per_page=100`]: (wipEvents ?? []).map(({ event, by, at }) => ({
    event,
    label: { name: 'agent-wip' },
    actor: { login: by },
    created_at: at
  })),
  [`${API}/issues/6/comments`]: {},
  [`${API}/issues/6/labels/agent-wip`]: []
})

let stub: GhStub | undefined

afterEach(() => {
  stub?.cleanup()
  stub = undefined
})

const cleanup = (r: GhRoutes, jobStatus = 'cancelled') => {
  stub = makeGhStub(r)
  const result = spawnSync('bash', [SCRIPT], {
    cwd: stub.dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: stub.path,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_STEP_SUMMARY: '/dev/null',
      STARTED,
      LOGIN: PIPELINE,
      JOB_STATUS: jobStatus,
      RUN_URL: 'https://example.test/run/1'
    }
  })
  // Every call that writes: a -X method, or -f/-F fields, which make gh api POST.
  const writes = stub
    .calls()
    .filter((c) => / -X | -f | -F /.test(` ${c} `))
    .map((c) => c.replace(/^api /, ''))
  return { ...result, writes }
}

const POSTED_FAILURE = `${API}/statuses/${SHA} -f state=failure -f context=agent/pre-pass`
const RELEASED = `${API}/issues/5/comments -X POST -F body=@.dispatch-release.md`
const CLEARED = `${API}/issues/6/labels/agent-wip -X DELETE`

const pendingBy = (by: string | null, at = DURING): Status => ({
  state: 'pending',
  by,
  at,
  description: PENDING_TEXT
})
const verdict: Status = {
  state: 'failure',
  by: PIPELINE,
  at: BEFORE,
  description: '1 blocking: a false claim'
}

describe.skipIf(!HAS_JQ)('cleanup.sh counts only what the maintainer or the pipeline wrote', () => {
  it("turns this run's own pending into a failure", () => {
    const result = cleanup(routes({ statuses: [pendingBy(PIPELINE), verdict] }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.writes.filter((w) => w.startsWith(POSTED_FAILURE))).toHaveLength(1)
  })

  it.each([
    [COLLABORATOR, COLLABORATOR],
    ['github-actions[bot]', 'github-actions[bot]'],
    ['no recorded account', null]
  ])('leaves a pending posted by %s during the run alone', (_label, by) => {
    const result = cleanup(routes({ statuses: [pendingBy(by), verdict] }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.writes).toEqual([])
  })

  it("still fails this run's pending when another account posted a newer status over it", () => {
    const newer: Status = { state: 'success', by: COLLABORATOR, at: LATER }
    const result = cleanup(routes({ statuses: [newer, pendingBy(PIPELINE)] }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.writes.filter((w) => w.startsWith(POSTED_FAILURE))).toHaveLength(1)
  })

  it('releases a claim this run took when only another account posted a release', () => {
    const comments = [
      { by: PIPELINE, at: DURING, body: 'Cycle claim: PR #7\nWorking.' },
      { by: COLLABORATOR, at: LATER, body: 'Cycle release: PR #7\nNot really.' }
    ]
    const result = cleanup(routes({ comments }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.writes).toEqual([RELEASED])
  })

  it.each([PIPELINE, MAINTAINER])('does not release a claim %s already released', (by) => {
    const comments = [
      { by: PIPELINE, at: DURING, body: 'Cycle claim: PR #7\nWorking.' },
      { by, at: LATER, body: 'Cycle release: PR #7\nDone.' }
    ]
    const result = cleanup(routes({ comments }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.writes).toEqual([])
  })

  it('clears an agent-wip claim the pipeline took during a run that failed', () => {
    const result = cleanup(
      routes({ wipEvents: [{ event: 'labeled', by: PIPELINE, at: DURING }] }),
      'failure'
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.writes).toContain(CLEARED)
  })

  it('keeps an older claim another account took off and put back during the run', () => {
    const wipEvents: LabelEvent[] = [
      { event: 'labeled', by: PIPELINE, at: BEFORE },
      { event: 'unlabeled', by: COLLABORATOR, at: DURING },
      { event: 'labeled', by: COLLABORATOR, at: LATER }
    ]
    const result = cleanup(routes({ wipEvents }), 'failure')
    expect(result.status, result.stderr).toBe(0)
    expect(result.writes).toEqual([])
  })
})
