import { describe, expect, it } from 'vitest'
import {
  LABEL,
  changeComment,
  publish,
  uncomparedComment
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/repo-health/lib/publish.mjs'
import {
  buildReport,
  decodeState,
  renderMarkdown
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/repo-health/lib/report.mjs'

type Row = { id: string; label: string; value: number | null; reason?: string | null }

const result = ({ id, label, value, reason = null }: Row) => ({
  id,
  family: 'code',
  label,
  unit: 'count',
  better: 'lower',
  budget: 10,
  needs: 'tree',
  value,
  note: null,
  reason
})

const reportOf = (measuredAt: string, ...rows: Row[]) =>
  buildReport({ commit: 'abc1234', dirty: false, measuredAt, results: rows.map(result) })

const LAST_WEEK = reportOf(
  '2026-11-16T09:13:00.000Z',
  { id: 'a', label: 'Alpha', value: 8 },
  { id: 'b', label: 'Beta', value: 10 },
  { id: 'c', label: 'Gamma', value: 12 }
)
const THIS_WEEK_SAME = reportOf(
  '2026-11-23T09:13:00.000Z',
  { id: 'a', label: 'Alpha', value: 8 },
  { id: 'b', label: 'Beta', value: 10 },
  { id: 'c', label: 'Gamma', value: 12 }
)
const THIS_WEEK_MOVED = reportOf(
  '2026-11-23T09:13:00.000Z',
  { id: 'a', label: 'Alpha', value: 3 },
  { id: 'b', label: 'Beta', value: 9 },
  { id: 'c', label: 'Gamma', value: 40 }
)
const THIS_WEEK_CHANGED = reportOf(
  '2026-11-23T09:13:00.000Z',
  { id: 'a', label: 'Alpha', value: 11 },
  { id: 'b', label: 'Beta', value: null, reason: 'knip is not installed' },
  { id: 'c', label: 'Gamma', value: 9 }
)

const ISSUES = `repos/o/r/issues?state=open&labels=${LABEL}&per_page=100`
const LABEL_READ = `repos/o/r/labels/${LABEL}`

type Write = { method: string; endpoint: string; payload: Record<string, unknown> }

// A recording gh: reads answer from `reads`, writes are logged with their payload.
const fakeGh = (reads: Record<string, unknown>) => {
  const writes: Write[] = []
  const gh = (args: string[], input?: string) => {
    const method = args[0] === '-X' ? args[1] : 'GET'
    const endpoint = method === 'GET' ? args[0] : args[2]
    if (method === 'GET') {
      if (!(endpoint in reads)) throw new Error(`gh api ${endpoint} failed (exit 1): Not Found`)
      return reads[endpoint]
    }
    expect(args.slice(3)).toEqual(['--input', '-'])
    writes.push({ method, endpoint, payload: JSON.parse(input ?? 'null') })
    return {}
  }
  return { gh, writes }
}

const issue = (number: number, body: string, over: Record<string, unknown> = {}) => ({
  number,
  body,
  user: { login: 'github-actions[bot]' },
  ...over
})

const run = (
  report: unknown,
  reads: Record<string, unknown>,
  over: Record<string, unknown> = {}
) => {
  const { gh, writes } = fakeGh(reads)
  const outcome = publish({
    gh,
    repo: 'o/r',
    owner: 'thebristolsound',
    report,
    runUrl: 'https://example.com/run/9',
    dryRun: false,
    ...over
  })
  return { outcome, writes }
}

describe('with no open issue', () => {
  it('creates the label, then opens the issue with both labels and the owner assigned', () => {
    const { outcome, writes } = run(THIS_WEEK_SAME, { [ISSUES]: [] })
    expect(writes.map((write) => `${write.method} ${write.endpoint}`)).toEqual([
      'POST repos/o/r/labels',
      'POST repos/o/r/issues'
    ])
    expect(writes[0].payload).toMatchObject({ name: 'repo-health' })
    expect(writes[1].payload).toMatchObject({
      title: 'Repository health: 1 outside budget, 0 not measured (3 signals)',
      labels: ['repo-health', 'process'],
      assignees: ['thebristolsound']
    })
    expect(outcome).toMatchObject({ issue: null, commented: false, dryRun: false, state: null })
    expect(outcome.writes).toEqual(['create the repo-health label', 'open the repo-health issue'])
  })

  it('posts no comment: opening the issue is the notification', () => {
    const { writes } = run(THIS_WEEK_CHANGED, { [ISSUES]: [] })
    expect(writes.some((write) => write.endpoint.endsWith('/comments'))).toBe(false)
  })

  it('says in the body that it compared with nothing, and carries a readable state block', () => {
    const { writes } = run(THIS_WEEK_SAME, { [ISSUES]: [] })
    const body = String(writes[1].payload.body)
    expect(body).toContain('Compared with: nothing (no previous report was found)')
    expect(body).toContain('Run: https://example.com/run/9')
    expect(decodeState(body).state.signals.c).toEqual({ value: 12, status: 'outside' })
  })

  it('does not create a label that already exists', () => {
    const { writes } = run(THIS_WEEK_SAME, { [ISSUES]: [], [LABEL_READ]: { name: 'repo-health' } })
    expect(writes.map((write) => write.endpoint)).toEqual(['repos/o/r/issues'])
  })

  it('assigns nobody when the owner is unknown', () => {
    const { writes } = run(THIS_WEEK_SAME, { [ISSUES]: [] }, { owner: null })
    expect(writes[1].payload.assignees).toEqual([])
  })

  it('opens a fresh issue with no previous values after someone closed the last one', () => {
    // A closed issue is not in the open list, so its state block is never read.
    const { outcome, writes } = run(THIS_WEEK_MOVED, {
      [ISSUES]: [],
      [LABEL_READ]: { name: 'repo-health' }
    })
    expect(outcome.state).toBeNull()
    expect(String(writes[0].payload.body)).toContain('| - | no previous value |')
  })
})

describe('with an open issue', () => {
  const previous = issue(41, renderMarkdown(LAST_WEEK))

  it('rewrites the body and title and posts no comment when no status changed', () => {
    const { outcome, writes } = run(THIS_WEEK_SAME, { [ISSUES]: [previous] })
    expect(writes.map((write) => `${write.method} ${write.endpoint}`)).toEqual([
      'PATCH repos/o/r/issues/41'
    ])
    expect(Object.keys(writes[0].payload).sort()).toEqual(['body', 'title'])
    expect(String(writes[0].payload.body)).toContain(
      'Compared with: the run of 2026-11-16T09:13:00.000Z'
    )
    expect(outcome).toMatchObject({ issue: 41, commented: false, changes: [] })
  })

  it('posts no comment when values moved but every status held', () => {
    const { outcome, writes } = run(THIS_WEEK_MOVED, { [ISSUES]: [previous] })
    expect(writes).toHaveLength(1)
    expect(String(writes[0].payload.body)).toContain(
      '| code | Alpha | 3 | <= 10 | 8 | better by 5 |'
    )
    expect(outcome.commented).toBe(false)
  })

  it('posts one comment naming a crossing, a lost reading and a recovery', () => {
    const { outcome, writes } = run(THIS_WEEK_CHANGED, { [ISSUES]: [previous] })
    expect(writes.map((write) => `${write.method} ${write.endpoint}`)).toEqual([
      'POST repos/o/r/issues/41/comments',
      'PATCH repos/o/r/issues/41'
    ])
    const comment = String(writes[0].payload.body)
    expect(comment).toContain('Status changed in the run of 2026-11-23T09:13:00.000Z:')
    expect(comment).toContain('- **Alpha:** within -> outside (11, budget <= 10)')
    expect(comment).toContain('- **Beta:** within -> not measured (knip is not installed)')
    expect(comment).toContain('- **Gamma:** outside -> within (9, budget <= 10)')
    expect(comment).toContain('Run: https://example.com/run/9')
    expect(outcome.commented).toBe(true)
    expect(outcome.changes).toHaveLength(3)
  })

  it('posts nothing a second time once the new statuses are the stored ones', () => {
    const first = run(THIS_WEEK_CHANGED, { [ISSUES]: [previous] })
    const stored = issue(41, String(first.writes[1].payload.body))
    const second = run(THIS_WEEK_CHANGED, { [ISSUES]: [stored] })
    expect(second.writes.map((write) => write.method)).toEqual(['PATCH'])
  })

  it('says it could not compare when the state block is unreadable, and lists what needs a look', () => {
    const edited = issue(41, 'Someone replaced this body by hand.')
    const { outcome, writes } = run(THIS_WEEK_CHANGED, { [ISSUES]: [edited] })
    expect(writes.map((write) => write.method)).toEqual(['POST', 'PATCH'])
    const comment = String(writes[0].payload.body)
    expect(comment).toContain(
      'could not compare with the previous report: the previous report has no state block.'
    )
    expect(comment).toContain('- **Alpha:** outside (11, budget <= 10)')
    expect(comment).toContain('- **Beta:** not measured (knip is not installed)')
    expect(comment).not.toContain('Gamma')
    expect(outcome).toMatchObject({ state: null, commented: true, changes: [] })
    expect(String(writes[1].payload.body)).toContain(
      'Compared with: nothing (the previous report has no state block)'
    )
  })

  it('treats an issue with no body at all as nothing to compare with', () => {
    const { outcome, writes } = run(THIS_WEEK_SAME, { [ISSUES]: [issue(41, null as never)] })
    expect(outcome.stateReason).toBe('no previous report was found')
    expect(writes.map((write) => write.method)).toEqual(['POST', 'PATCH'])
  })

  it('uses the lowest-numbered issue when two are open, and reports the other', () => {
    const { outcome, writes } = run(THIS_WEEK_SAME, {
      [ISSUES]: [issue(77, 'newer duplicate'), previous]
    })
    expect(writes[0].endpoint).toBe('repos/o/r/issues/41')
    expect(outcome).toMatchObject({ issue: 41, duplicates: [77], commented: false })
  })

  it('never rewrites a labelled issue someone else opened, and opens its own beside it', () => {
    const filed = issue(30, renderMarkdown(LAST_WEEK), { user: { login: 'thebristolsound' } })
    const { outcome, writes } = run(THIS_WEEK_CHANGED, {
      [ISSUES]: [filed, issue(31, 'no author', { user: null })],
      [LABEL_READ]: { name: 'repo-health' }
    })
    expect(writes.map((write) => `${write.method} ${write.endpoint}`)).toEqual([
      'POST repos/o/r/issues'
    ])
    expect(outcome).toMatchObject({ issue: null, duplicates: [], state: null })
  })

  it('rewrites its own issue when a lower-numbered labelled one belongs to someone else', () => {
    const filed = issue(30, 'a person filed this', { user: { login: 'thebristolsound' } })
    const { outcome, writes } = run(THIS_WEEK_SAME, { [ISSUES]: [filed, previous] })
    expect(writes.map((write) => `${write.method} ${write.endpoint}`)).toEqual([
      'PATCH repos/o/r/issues/41'
    ])
    expect(outcome).toMatchObject({ issue: 41, duplicates: [] })
  })

  it('ignores pull requests and malformed entries in the issue list', () => {
    const { outcome } = run(THIS_WEEK_SAME, {
      [ISSUES]: [issue(12, 'a pull request', { pull_request: {} }), { body: 'no number' }, previous]
    })
    expect(outcome).toMatchObject({ issue: 41, duplicates: [] })
  })
})

describe('dry run', () => {
  it('writes nothing and says what it would write, for a new issue', () => {
    const { outcome, writes } = run(THIS_WEEK_SAME, { [ISSUES]: [] }, { dryRun: true })
    expect(writes).toEqual([])
    expect(outcome.dryRun).toBe(true)
    expect(outcome.writes).toEqual(['create the repo-health label', 'open the repo-health issue'])
  })

  it('writes nothing for an existing issue with a status change', () => {
    const previous = issue(41, renderMarkdown(LAST_WEEK))
    const { outcome, writes } = run(THIS_WEEK_CHANGED, { [ISSUES]: [previous] }, { dryRun: true })
    expect(writes).toEqual([])
    expect(outcome.writes).toEqual(['comment on issue #41', 'rewrite issue #41'])
  })

  it('is the default when the caller does not say', () => {
    const { gh, writes } = fakeGh({ [ISSUES]: [] })
    const outcome = publish({ gh, repo: 'o/r', owner: 'x', report: THIS_WEEK_SAME })
    expect(outcome.dryRun).toBe(true)
    expect(writes).toEqual([])
  })
})

describe('when GitHub cannot be read or written', () => {
  it('throws on a failed issue list, and never opens a second issue on a guess', () => {
    const { gh, writes } = fakeGh({})
    expect(() =>
      publish({ gh, repo: 'o/r', owner: 'x', report: THIS_WEEK_SAME, dryRun: false })
    ).toThrow('gh api repos/o/r/issues')
    expect(writes).toEqual([])
  })

  it('throws when the issue list is not a list', () => {
    const { gh } = fakeGh({ [ISSUES]: { message: 'Bad credentials' } })
    expect(() =>
      publish({ gh, repo: 'o/r', owner: 'x', report: THIS_WEEK_SAME, dryRun: false })
    ).toThrow('GitHub returned no issue list')
  })

  it('throws when a write fails', () => {
    const gh = (args: string[]) => {
      if (args[0] === '-X') throw new Error('gh api repos/o/r/issues/41 failed (exit 1): HTTP 403')
      return [issue(41, renderMarkdown(LAST_WEEK))]
    }
    expect(() =>
      publish({ gh, repo: 'o/r', owner: 'x', report: THIS_WEEK_SAME, dryRun: false })
    ).toThrow('HTTP 403')
  })
})

describe('a write that fails partway', () => {
  const previous = issue(41, renderMarkdown(LAST_WEEK))
  const failing = (method: string) => {
    const sent: string[] = []
    const gh = (args: string[]) => {
      if (args[0] !== '-X') return [previous]
      if (args[1] === method) throw new Error(`gh api ${args[2]} failed (exit 1): HTTP 502`)
      sent.push(args[1])
      return {}
    }
    return { gh, sent }
  }

  it('leaves the stored statuses alone when the comment fails, so the next run comments', () => {
    const { gh, sent } = failing('POST')
    expect(() =>
      publish({ gh, repo: 'o/r', owner: 'x', report: THIS_WEEK_CHANGED, dryRun: false })
    ).toThrow('HTTP 502')
    expect(sent).toEqual([])
  })

  it('has already commented when the rewrite fails, so a retry repeats the comment', () => {
    const { gh, sent } = failing('PATCH')
    expect(() =>
      publish({ gh, repo: 'o/r', owner: 'x', report: THIS_WEEK_CHANGED, dryRun: false })
    ).toThrow('HTTP 502')
    expect(sent).toEqual(['POST'])
  })
})

describe('comments', () => {
  it('marks a signal the last run did not have as new', () => {
    const comment = changeComment({
      report: THIS_WEEK_CHANGED,
      changes: [{ id: 'a', label: 'Alpha', from: null, to: 'outside' }],
      runUrl: null
    })
    expect(comment).toContain('- **Alpha:** new -> outside (11, budget <= 10)')
    expect(comment).not.toContain('Run: ')
  })

  it('says every signal is within budget when nothing needs a look after an unreadable block', () => {
    const calm = reportOf('2026-11-23T09:13:00.000Z', { id: 'a', label: 'Alpha', value: 1 })
    const comment = uncomparedComment({
      report: calm,
      reason: 'the state block is not JSON',
      runUrl: null
    })
    expect(comment).toContain(
      'could not compare with the previous report: the state block is not JSON.'
    )
    expect(comment).toContain('Every signal is within its budget now.')
    expect(comment).not.toContain('- **')
  })
})
