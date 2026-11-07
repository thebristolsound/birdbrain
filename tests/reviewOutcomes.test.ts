import { describe, expect, it } from 'vitest'
import {
  formatReport,
  parseArgs,
  parseReplies,
  parseVerdict,
  summarize,
  tallyPullRequest
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/review-outcomes.mjs'

// A verdict in the shape of .claude/skills/post-comment/template.md, with the findings table
// and the test pass's table, whose severity sits in the third column.
const verdict = (head: string, rows: string[], testRows: string[] = []) =>
  [
    `**Review verdict: ${head}**`,
    '',
    '1. One plain sentence.',
    '',
    '<details>',
    '<summary>Full report</summary>',
    '',
    '| # | severity | file:line | finding |',
    '|---|---|---|---|',
    ...rows,
    '',
    '| Mutant | Line | Killed by |',
    '|---|---|---|',
    '| Drop the flag | 319 | `:1140` |',
    '',
    '| # | Location | Severity | Claim |',
    '|---|---|---|---|',
    ...testRows,
    '',
    '</details>'
  ].join('\n')

const comment = (id: number, body: string, login = 'birdbrain-agent') => ({
  id,
  body,
  user: { login }
})

const finding = (id: string, severity: string) => ({
  id,
  severity,
  carried: false,
  preExisting: false
})

describe('parseVerdict', () => {
  it('reads the verdict and each finding row with its severity', () => {
    const parsed = parseVerdict(
      verdict(
        'request changes',
        [
          '| 1 | blocking | src/a.ts:1 | Wrong. |',
          '| 2 | advisory (carried) | src/b.ts:2 | Still open. |',
          '| 3 | advisory (pre-existing) | src/c.ts:3 | Old. |',
          '| 4 | non-blocking | src/d.ts:4 | Older spelling. |',
          '| 5 | gate | PR body | No attribution. |'
        ],
        ['| T1 | `src/e.ts:5` | advisory | A claim. |']
      )
    )
    expect(parsed.verdict).toBe('request changes')
    expect(parsed.findings).toEqual([
      finding('1', 'blocking'),
      { ...finding('2', 'advisory'), carried: true },
      { ...finding('3', 'advisory'), preExisting: true },
      finding('4', 'advisory'),
      finding('5', 'gate'),
      finding('T1', 'advisory')
    ])
  })

  it('reads a verdict under the disclosure lines a maintainer-account comment opens with', () => {
    const body = `> <sub>**Written by a model on behalf of Matt.**</sub>\n\n${verdict('request changes', ['| 1 | blocking | a | x |'])}`
    expect(parseVerdict(body)).toMatchObject({ verdict: 'request changes' })
  })

  it.each([
    ['**Reviewer pre-pass (6931485e): request changes**', 'request changes'],
    ['**Reviewer pre-pass (`ed0150c`): approve for human review** - 2 of 2 reporters', 'approve'],
    ['**Reviewer pre-pass round 2 (497a68dd): request changes**', 'request changes'],
    ['## Reviewer re-pass — `request changes`', 'request changes'],
    [
      '## Reviewer pre-pass\n\n**Head sha:** `fa78cbec`\n**Verdict: approve for human review.**',
      'approve'
    ],
    [
      '## Reviewer pre-pass — full report\n\nReviewed at head.\n\n### Verdict: request changes',
      'request changes'
    ],
    ['## `agent/pre-pass` — #940 @ `cd8040fb`\n\n**Verdict: approve for human review.**', 'approve']
  ])('reads the older verdict shape %j', (body, expected) => {
    expect(parseVerdict(body)?.verdict).toBe(expected)
  })

  it('reads findings from the numbered list and heading shapes of older verdicts', () => {
    const body = [
      '**Reviewer pre-pass (`d77f6b9a`): request changes**',
      '',
      '## Findings',
      '',
      '1. **Blocking — the PR changes wire behavior.** Detail.',
      '2. **advisory** `a.ts:38` - a guard is pinned only at the boundary.',
      '',
      '### Finding 3 (gate) — the attribution line is missing',
      '',
      '### Gate compliance',
      '',
      '- **Evidence gate did not fire.** Not a finding.',
      '',
      '### Blocking — the corrected rationale is still not complete',
      '',
      '## Blocking',
      '',
      '**F1. `--d-row` is inert at the default step.** Detail.',
      '**Fix:** not a finding.',
      '',
      '## Findings',
      '',
      '**4. A claim does not reproduce.** Detail.',
      '**5. Nit: two mocks render the same text.** Detail.',
      '',
      '## Verified as claimed',
      '',
      '**The pre-existing failure claim holds.** Not a finding.'
    ].join('\n')
    expect(parseVerdict(body).findings).toEqual([
      finding('1', 'blocking'),
      finding('2', 'advisory'),
      finding('3', 'gate'),
      finding('h1', 'blocking'),
      finding('F1', 'blocking'),
      finding('4', 'advisory'),
      finding('5', 'advisory')
    ])
  })

  it('reads an approval, and returns null for any other comment', () => {
    expect(parseVerdict(verdict('approve for human review', [])).verdict).toBe('approve')
    expect(parseVerdict('Applied.')).toBeNull()
    expect(parseVerdict('## Reviewer pre-pass\n\nNo verdict line here.')).toBeNull()
    expect(parseVerdict(undefined)).toBeNull()
  })
})

describe('parseReplies', () => {
  it('reads keyed entries with the finding ids their keys name', () => {
    const body = [
      'Replies from the feedback round to the earlier review of this pull request.',
      '',
      '**6674744829-finding-1-receipt**',
      '',
      'Not applied: the receipt check is outside the checks the issue lists.',
      '',
      '**6674744829-finding-3-and-T3-plain-head**',
      '',
      'Applied.',
      '',
      '**6675862177-1-T1-multi-file**',
      '',
      'No action: deferred to #2101.'
    ].join('\n')
    expect(parseReplies(body).keyed).toEqual([
      {
        verdictId: '6674744829',
        ids: ['1'],
        outcome: 'disputed',
        reason: 'the receipt check is outside the checks the issue lists.'
      },
      { verdictId: '6674744829', ids: ['3', 'T3'], outcome: 'applied', reason: '' },
      {
        verdictId: '6675862177',
        ids: ['1', 'T1'],
        outcome: 'deferred',
        reason: 'deferred to #2101.'
      }
    ])
  })

  it('reads a reply per numbered line in each shape the dispatcher has used', () => {
    const body = [
      'Round-1 findings dispositioned at `93f0827d`.',
      '',
      '1. applied `93f0827d`',
      '2. Not applied: recorded in the PR body instead.',
      '| 3 | applied ddf4f558 — the comment now states what the code does |',
      '**4 — false justification comment.** Applied in `5c6abb5c`.',
      '- **Finding 5:** Not applied: filed as #1047.',
      '- **Pre-pass #6** (rollback truncate throws) — applied, `1144dfb`.',
      '7. Earlier review, finding 1: a summary line, not a reply.'
    ].join('\n')
    expect(parseReplies(body).numbered).toEqual([
      { ids: ['1'], outcome: 'applied', reason: '' },
      { ids: ['2'], outcome: 'disputed', reason: 'recorded in the PR body instead.' },
      { ids: ['3'], outcome: 'applied', reason: '' },
      { ids: ['4'], outcome: 'applied', reason: '' },
      { ids: ['5'], outcome: 'deferred', reason: 'filed as #1047.' },
      { ids: ['6'], outcome: 'applied', reason: '' }
    ])
  })

  it('reads a one-reply comment, with the finding its sentence names', () => {
    expect(parseReplies('Applied.\n\n<details>x</details>').single).toEqual({
      outcome: 'applied',
      reason: '',
      ids: [],
      first: false
    })
    expect(
      parseReplies('Not applied: finding 2 of the first verdict is a property of the format.')
        .single
    ).toMatchObject({ outcome: 'disputed', ids: ['2'], first: true })
    expect(parseReplies('A note from the maintainer.')).toEqual({
      keyed: [],
      numbered: [],
      single: null
    })
  })
})

describe('tallyPullRequest', () => {
  const tally = (state: string, comments: ReturnType<typeof comment>[]) =>
    tallyPullRequest({
      number: 7,
      state,
      createdAt: '2026-10-03T10:00:00Z',
      trusted: ['birdbrain-agent', 'owner'],
      comments
    })
  const outcomes = (t: { findings: { round: number; id: string; outcome: string }[] }) =>
    t.findings.map((f) => `${f.round}:${f.id}:${f.outcome}`)

  const first = comment(
    100001,
    verdict('request changes', [
      '| 1 | blocking | a | x |',
      '| 2 | advisory | b | y |',
      '| 3 | advisory | c | z |',
      '| 4 | advisory | d | w |'
    ])
  )
  const keyed = comment(
    100002,
    [
      '**100001-finding-1**',
      'Applied.',
      '**100001-finding-2**',
      'Not applied: intentional.',
      '**100001-finding-3**',
      'Not applied: filed as #12.',
      '**999999-finding-4**',
      'Applied.'
    ].join('\n')
  )
  const second = comment(100003, verdict('request changes', ['| 1 | blocking (carried) | a | x |']))

  it('gives each finding its outcome, and fixed only when a later round reviewed it', () => {
    const t = tally('MERGED', [first, keyed, second, comment(100004, '1. applied `abc1234`')])
    expect(outcomes(t)).toEqual([
      '1:1:fixed',
      '1:2:disputed',
      '1:3:deferred',
      '1:4:no reply',
      '2:1:applied'
    ])
    expect(t.month).toBe('2026-10')
  })

  it('counts an unanswered finding in a merged PR whose last verdict requests changes as overridden', () => {
    expect(outcomes(tally('MERGED', [first, keyed, second]))).toContain('2:1:overridden')
    expect(outcomes(tally('OPEN', [first, keyed, second]))).toContain('2:1:no reply')
  })

  it('joins a numbered reply to the verdict before it, and ignores other authors', () => {
    const t = tally('OPEN', [
      first,
      comment(100004, '2. Applied.'),
      comment(100005, verdict('request changes', ['| 1 | blocking | a | x |']), 'someone-else'),
      comment(100006, '1. Not applied: from someone else.', 'someone-else')
    ])
    expect(t.rounds).toHaveLength(1)
    expect(outcomes(t)).toEqual(['1:1:no reply', '1:2:applied', '1:3:no reply', '1:4:no reply'])
  })

  it('joins a one-reply comment by the finding it names, and counts a bare one as unmatched', () => {
    const t = tally('OPEN', [
      first,
      second,
      comment(100004, 'Not applied: finding 3 of the first verdict is out of scope.'),
      comment(100005, 'Applied.')
    ])
    expect(outcomes(t)).toContain('1:3:disputed')
    expect(t.unmatchedReplies).toEqual(['applied'])
  })
})

describe('summarize and formatReport', () => {
  const pr = tallyPullRequest({
    number: 7,
    state: 'MERGED',
    createdAt: '2026-10-03T10:00:00Z',
    trusted: ['birdbrain-agent'],
    comments: [
      comment(
        1000001,
        verdict('request changes', ['| 1 | blocking | a | x |', '| 2 | advisory | b | y |'])
      ),
      comment(1000002, '1. Applied.\n2. Not applied: intentional.'),
      comment(1000003, verdict('approve for human review', ['| 1 | advisory (carried) | b | y |'])),
      comment(1000004, 'Applied.'),
      comment(
        1000005,
        '**Reviewer pre-pass (abc1234): request changes** - carried forward, not re-run.'
      )
    ]
  })
  const unreviewed = tallyPullRequest({ number: 8, state: 'OPEN', trusted: [], comments: [] })

  it('sums rounds, findings and outcomes across PRs', () => {
    const s = summarize([pr, unreviewed])
    expect(s).toMatchObject({
      prs: 2,
      reviewed: 1,
      rounds: {
        total: 3,
        median: 3,
        max: 3,
        approvedFirstRound: 0,
        endedRequestingChanges: 1,
        unreadable: 1
      },
      findings: { blocking: 1, gate: 0, advisory: 2, carried: 1, preExisting: 0 },
      outcomes: {
        blocking: { fixed: 1, 'no reply': 0 },
        advisory: { disputed: 1, 'no reply': 1 }
      },
      unmatchedReplies: { applied: 1, other: 0 },
      reasons: [{ outcome: 'disputed', reason: 'intentional.' }]
    })
    expect(s.months).toEqual([
      {
        month: '2026-10',
        prs: 1,
        outcomes: { fixed: 1, applied: 0, disputed: 1, deferred: 0, overridden: 0, 'no reply': 1 }
      }
    ])
    expect(s.perPr).toEqual([
      { number: 7, state: 'MERGED', verdicts: 'RAR', blocking: 1, advisory: 2, carried: 1 }
    ])
  })

  it('reports zero rounds when no PR was reviewed', () => {
    expect(summarize([]).rounds).toMatchObject({ total: 0, median: 0, max: 0 })
  })

  it('formats the summary as Markdown, with the month table only when asked', () => {
    const s = summarize([pr])
    const text = formatReport(s, { since: '2026-10-01' })
    expect(text).toContain('# Reviewer pre-pass outcomes since 2026-10-01')
    expect(text).toContain('1 of 1 agent PRs had a pre-pass verdict, across 3 rounds.')
    expect(text).toContain('| 1 | 0 | 2 | 1 | 0 |')
    expect(text).toContain('| Blocking and gate | 1 | 0 | 0 | 0 | 0 | 0 |')
    expect(text).toContain('count against none: 1 applied, 0 not applied.')
    expect(text).toContain('- disputed: intentional.')
    expect(text).toContain('| #7 | merged | RAR | 1 | 2 | 1 |')
    expect(text).not.toContain('## By month opened')
    expect(formatReport(s, { byMonth: true })).toContain('| 2026-10 (1) | 1 | 0 | 1 | 0 | 0 | 1 |')
  })

  it('leaves out the reasons list when nothing was disputed or deferred', () => {
    const text = formatReport(summarize([]))
    expect(text).toContain('# Reviewer pre-pass outcomes\n')
    expect(text).not.toContain('to sort by hand')
  })
})

describe('parseArgs', () => {
  it('reads every flag', () => {
    expect(parseArgs(['--repo', 'o/r', '--since', '2026-10-01', '--by-month', '--json'])).toEqual({
      repo: 'o/r',
      since: '2026-10-01',
      byMonth: true,
      json: true
    })
  })

  it('defaults to this repository with no filter', () => {
    expect(parseArgs([])).toEqual({
      repo: 'thebristolsound/birdbrain',
      since: null,
      byMonth: false,
      json: false
    })
  })

  it.each([
    [['--since', '10/01/2026'], '--since takes YYYY-MM-DD'],
    [['--repo', 'birdbrain'], '--repo takes owner/name'],
    [['--verbose'], 'unknown argument: --verbose']
  ])('refuses %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message)
  })
})
