import { describe, expect, it } from 'vitest'
import {
  formatReport,
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
      { id: '1', severity: 'blocking', carried: false, preExisting: false },
      { id: '2', severity: 'advisory', carried: true, preExisting: false },
      { id: '3', severity: 'advisory', carried: false, preExisting: true },
      { id: '4', severity: 'advisory', carried: false, preExisting: false },
      { id: '5', severity: 'gate', carried: false, preExisting: false },
      { id: 'T1', severity: 'advisory', carried: false, preExisting: false }
    ])
  })

  it('reads an approval, and returns null for any other comment', () => {
    expect(parseVerdict(verdict('approve for human review', [])).verdict).toBe('approve')
    expect(parseVerdict('Applied.')).toBeNull()
    expect(parseVerdict(undefined)).toBeNull()
  })
})

describe('parseReplies', () => {
  it('reads keyed entries with their verdict id and outcome', () => {
    const body = [
      'Replies from the feedback round to the earlier review of this pull request.',
      '',
      '**6674744829-finding-1-receipt**',
      '',
      'Not applied: the receipt check is outside the checks the issue lists.',
      '',
      '**6674744829-finding-2-deleted-file**',
      '',
      'Applied.',
      '',
      'd086ec27'
    ].join('\n')
    expect(parseReplies(body)).toEqual({
      keyed: [
        {
          verdictId: '6674744829',
          key: 'finding-1-receipt',
          outcome: 'not applied',
          reason: 'the receipt check is outside the checks the issue lists.'
        },
        { verdictId: '6674744829', key: 'finding-2-deleted-file', outcome: 'applied', reason: '' }
      ],
      loose: null
    })
  })

  it('reads a bare reply as unkeyed, and anything else as neither', () => {
    expect(parseReplies('Applied.\n\n<details>x</details>').loose).toEqual({
      outcome: 'applied',
      reason: ''
    })
    expect(parseReplies('Not applied: out of scope.').loose).toEqual({
      outcome: 'not applied',
      reason: 'out of scope.'
    })
    expect(parseReplies('A note from the maintainer.')).toEqual({ keyed: [], loose: null })
  })
})

describe('tallyPullRequest and summarize', () => {
  const first = comment(
    100001,
    verdict('request changes', ['| 1 | blocking | a | x |', '| 2 | advisory | b | y |'])
  )
  const replies = comment(
    100002,
    '**100001-finding-1**\n\nApplied.\n\n**100001-finding-2**\n\nNot applied: intentional.\n\n**999999-other**\n\nApplied.'
  )
  const second = comment(
    100003,
    verdict('approve for human review', ['| 1 | advisory (carried) | b | y |'])
  )

  const pr = tallyPullRequest({
    number: 7,
    state: 'MERGED',
    trusted: ['birdbrain-agent', 'owner'],
    comments: [
      first,
      replies,
      comment(100004, 'Not applied: wrong.'),
      second,
      comment(100005, verdict('request changes', ['| 1 | blocking | a | x |']), 'someone-else')
    ]
  })

  it('takes rounds only from trusted authors, and keyed replies only for its own verdicts', () => {
    expect(pr.rounds.map((r: { verdict: string }) => r.verdict)).toEqual([
      'request changes',
      'approve'
    ])
    expect(pr.keyed).toHaveLength(2)
    expect(pr.loose).toEqual([{ outcome: 'not applied', reason: 'wrong.' }])
  })

  it('sums rounds, findings and replies across PRs', () => {
    const unreviewed = tallyPullRequest({ number: 8, state: 'OPEN', trusted: [], comments: [] })
    const s = summarize([pr, unreviewed])
    expect(s).toMatchObject({
      prs: 2,
      reviewed: 1,
      rounds: { total: 2, median: 2, max: 2, approvedFirstRound: 0, endedRequestingChanges: 0 },
      findings: { blocking: 1, gate: 0, advisory: 2, carried: 1, preExisting: 0 },
      replies: {
        keyedApplied: 1,
        keyedNotApplied: 1,
        unkeyedApplied: 0,
        unkeyedNotApplied: 1,
        notAppliedReasons: ['intentional.', 'wrong.']
      }
    })
    expect(s.perPr).toEqual([
      { number: 7, state: 'MERGED', verdicts: 'RA', blocking: 1, advisory: 2, carried: 1 }
    ])
  })

  it('reports zero rounds when no PR was reviewed', () => {
    expect(summarize([]).rounds).toMatchObject({ total: 0, median: 0, max: 0 })
  })

  it('formats the summary as Markdown', () => {
    const text = formatReport(summarize([pr]), '2026-10-01')
    expect(text).toContain('# Reviewer pre-pass outcomes since 2026-10-01')
    expect(text).toContain('1 of 1 agent PRs had a pre-pass verdict, across 2 rounds.')
    expect(text).toContain('| 1 | 0 | 2 | 1 | 0 |')
    expect(text).toContain('| Keyed to a pre-pass finding | 1 | 1 |')
    expect(text).toContain('- intentional.')
    expect(text).toContain('| #7 | merged | RA | 1 | 2 | 1 |')
  })

  it('leaves out the reasons list when nothing was refused', () => {
    const text = formatReport(summarize([]), null)
    expect(text).toContain('# Reviewer pre-pass outcomes\n')
    expect(text).not.toContain('to sort by hand')
  })
})
