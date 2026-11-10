import { describe, expect, it } from 'vitest'
// @ts-expect-error - workflow script with no declarations
import { prepareInputs } from '../.github/scripts/review-fleet/inputs.mjs'
import {
  decide,
  mergeFinders,
  mergeVerify,
  readState,
  renderState
  // @ts-expect-error - workflow script with no declarations
} from '../.github/scripts/review-fleet/fleet.mjs'

const sha = 'a'.repeat(40)
const repo = 'thebristolsound/birdbrain'
const complete = {
  contract_version: 2,
  source_review_complete: true,
  not_checked: [],
  runtime_limitations: []
}
const output = { ...complete, findings: [] }
const outputs = { correctness: output, claims: output, contract: output, tests: output }
const state = { v: 1, sha, startedAt: '2026-11-10T11:00:00Z' }
const judge = (s: unknown) =>
  decide({
    state: s,
    now: '2026-11-10T12:00:00Z',
    codexDone: true,
    relay: { at: '2026-11-10T11:30:00Z' },
    codexTimeout: 45,
    rulings: {},
    codexFindings: []
  })
const review = (o: unknown = output) => mergeFinders(state, { ...outputs, contract: o })

describe('completed source review contract', () => {
  it('preserves runtime limits in storage and the public report while source work succeeds', () => {
    const limits = [
      'Tests were not run.',
      'External editor behavior was not observed.\u2028Still unverified.'
    ]
    const s = review({ ...output, runtime_limitations: limits })
    expect(judge(s).status).toBe('success')
    const rendered = renderState(s, judge(s))
    for (const limit of limits) expect(rendered).toContain(limit)
    expect(rendered).toContain('Runtime limitations, not verified')
    const saved = readState(
      [{ id: 1, user: { login: 'birdbrain-agent' }, body: rendered }],
      'birdbrain-agent',
      sha
    )
    expect(saved.state.claude.runtimeLimitations.contract).toEqual(limits)
  })

  it.each([
    { ...output, not_checked: ['Referenced review could not be read.'] },
    {
      ...output,
      not_checked: ['Caller/race trace unfinished.'],
      runtime_limitations: ['No test execution.']
    },
    { ...output, source_review_complete: false },
    { findings: [], not_checked: ['Tests could not be run.'] },
    { findings: [], not_checked: [] },
    { ...output, not_checked: [''] },
    { ...output, runtime_limitations: null },
    { ...output, findings: [{ severity: 'invented' }] },
    { ...output, source_review_complete: 'true' }
  ])('fails incomplete, legacy or malformed required output: %j', (o) => {
    expect(judge(review(o)).status).toBe('failure')
  })

  it('fails malformed saved claims instead of waiting forever', () => {
    expect(judge({ sha }).status).toBe('failure')
    expect(judge({ ...state, startedAt: 'invalid' }).status).toBe('failure')
    const s = review()
    expect(judge({ ...s, claude: { ...s.claude, runtimeLimitations: null } }).status).toBe(
      'failure'
    )
    expect(judge({ ...state, claude: { contractVersion: 2, legs: {} } }).status).toBe('failure')
  })

  it('does not reinterpret or clear an old saved mixed unchecked list', () => {
    const legacy = {
      ...state,
      claude: {
        legs: Object.fromEntries(Object.keys(outputs).map((leg) => [leg, 'done'])),
        findings: [],
        notChecked: { contract: ['Test runs and caller trace were not checked.'] }
      }
    }
    const before = JSON.stringify(legacy)
    expect(judge(legacy).status).toBe('failure')
    expect(JSON.stringify(legacy)).toBe(before)
  })

  it('keeps verification runtime limits without allowing unfinished source rulings to pass', () => {
    const base = review()
    const limits = ['No external platform check was performed.']
    const s = mergeVerify(
      base,
      {
        ...complete,
        rulings: [{ id: 1, ruling: 'REFUTED', reason: 'Guard at a.ts:1.' }],
        runtime_limitations: limits
      },
      [1]
    )
    expect(s.verifyRuntimeLimitations).toEqual(limits)
    expect(renderState(s, judge(s))).toContain(limits[0])
    const incomplete = mergeVerify(
      base,
      {
        ...complete,
        source_review_complete: false,
        not_checked: ['Guard not traced.'],
        runtime_limitations: limits,
        rulings: []
      },
      [1]
    )
    expect(incomplete.verifyFailedFor).toBe('1')
    expect(renderState(incomplete, judge(incomplete))).toContain('Guard not traced.')
    expect(incomplete.verifyRuntimeLimitations).toEqual(limits)
  })
})

describe('source contract preparation before the paid call', () => {
  it('supplies all closed issues and referenced review text, including nested source pointers', () => {
    const read: string[] = []
    const sources = prepareInputs(
      {
        body: `Closes #12, #13\nContract: https://github.com/${repo}/pull/9#issuecomment-123456789`
      },
      repo,
      (path: string) => {
        read.push(path)
        return {
          body: path.endsWith('123456789')
            ? `Required: https://github.com/${repo}/pull/9#pullrequestreview-456`
            : 'The source contract.'
        }
      }
    )
    expect(read).toEqual(
      ['issues/12', 'issues/13', 'issues/comments/123456789', 'pulls/9/reviews/456'].map(
        (p) => `repos/${repo}/${p}`
      )
    )
    expect(sources).toHaveLength(4)
  })

  it('fetches the older plain-number review pointer used by this repair', () => {
    const seen: string[] = []
    prepareInputs(
      { body: 'The originating review is comment 6763346891 on #2151.' },
      repo,
      (path: string) => {
        seen.push(path)
        return { body: 'Review text.' }
      }
    )
    expect(seen).toEqual([`repos/${repo}/issues/comments/6763346891`])
  })

  // GitHub writes an inline review comment's anchor with no hyphen: `#discussion_r123`.
  it('fetches an inline review comment a contract links, not the pull request around it', () => {
    const seen: string[] = []
    prepareInputs(
      { body: `Contract: https://github.com/${repo}/pull/357#discussion_r3726451446` },
      repo,
      (path: string) => {
        seen.push(path)
        return { body: 'Review text.' }
      }
    )
    expect(seen).toEqual([`repos/${repo}/pulls/comments/3726451446`])
  })

  it('reads the comment a link ends a sentence with', () => {
    const seen: string[] = []
    prepareInputs(
      { body: `See https://github.com/${repo}/pull/9#issuecomment-123456789.` },
      repo,
      (path: string) => {
        seen.push(path)
        return { body: 'Review text.' }
      }
    )
    expect(seen).toEqual([`repos/${repo}/issues/comments/123456789`])
  })

  // The paths one description makes the pass read, in order, without the repository prefix.
  const reads = (body: string) => {
    const seen: string[] = []
    prepareInputs({ body }, repo, (path: string) => {
      seen.push(path.replace(`repos/${repo}/`, ''))
      return { body: 'Review text.' }
    })
    return seen
  }

  // The Files changed view links an inline review comment as `/files#r<id>` or `/changes#r<id>`.
  it.each([
    ['pull/9/files#r5', 'pulls/comments/5'],
    ['pull/9/changes#r5', 'pulls/comments/5'],
    ['pull/9#r5', 'pulls/comments/5'],
    ['pull/9/files?diff=split&w=1#r5', 'pulls/comments/5'],
    ['pull/9/files#discussion_r5', 'pulls/comments/5'],
    ['pull/9?notification_referrer_id=x#discussion_r5', 'pulls/comments/5'],
    ['pull/9/#discussion_r5', 'pulls/comments/5'],
    ['issues/9?x=1#issuecomment-5', 'issues/comments/5'],
    ['pull/9/files#pullrequestreview-5', 'pulls/9/reviews/5']
  ])('fetches the comment a link names behind a path or query: %s', (link, path) => {
    expect(reads(`Contract: https://github.com/${repo}/${link}`)).toEqual([path])
  })

  // A link that names a comment it cannot identify must not read as the pull request instead.
  it.each([
    'pull/9#discussion_r-123',
    'pull/9#issuecomment123',
    'pull/9#pullrequestreview456',
    'pull/9#issuecomment-',
    'pull/9#issuecomment_5',
    'pull/9#issuecomment-new',
    'pull/9#discussion-r5',
    'pull/9#Discussion_r5',
    'pull/9#discussion_r5abc',
    'pull/9#discussion_r',
    'pull/9#pullrequestreview-5-extra',
    'pull/9/files#discussion-r5',
    'pull/9/files#r-5',
    'pull/9/files#R5',
    'pull/9/files#r5x',
    'pull/9/files#r',
    'pull/9#comment-5',
    'pull/9#review-5',
    'pull/9#discussioncomment-5'
  ])('fails a comment link whose anchor is malformed: %s', (link) => {
    const seen: string[] = []
    expect(() =>
      prepareInputs(
        { body: `Contract: https://github.com/${repo}/${link}` },
        repo,
        (path: string) => {
          seen.push(path)
          return { body: 'The pull request description.' }
        }
      )
    ).toThrow(`malformed source link: https://github.com/${repo}/${link}`)
    expect(seen).toEqual([])
  })

  it.each([
    ['pull/9#discussion_bucket', 'pulls/9'],
    ['pull/9#issue-123', 'pulls/9'],
    ['pull/9#event-5', 'pulls/9'],
    ['pull/9#ref-commit-abc123', 'pulls/9'],
    ['pull/9/files#diff-0a1b2cR10', 'pulls/9'],
    ['pull/9/files', 'pulls/9'],
    ['pull/9/commits/abc123', 'pulls/9'],
    ['issues/9#event-5', 'issues/9']
  ])('reads the issue or pull request for a link that names no comment: %s', (link, path) => {
    expect(reads(`Contract: https://github.com/${repo}/${link}`)).toEqual([path])
  })

  it.each([
    'See LINK.',
    'See LINK, then the rest.',
    'See [the comment](LINK).',
    '_See LINK_',
    '**LINK**',
    'Is it LINK?'
  ])('reads a files-view comment link that sentence punctuation follows: %s', (sentence) => {
    const link = `https://github.com/${repo}/pull/9/files#r5`
    expect(reads(sentence.replace('LINK', link))).toEqual(['pulls/comments/5'])
  })

  it('reads both of two links written with no space between them', () => {
    const link = `https://github.com/${repo}/pull`
    expect(reads(`${link}/9/files,${link}/10/files#r5`)).toEqual(['pulls/9', 'pulls/comments/5'])
  })

  // A short number after the word is prose ("comment 3"), and reading it would fail on a 404.
  it('reads a comment-number pointer only from eight digits up', () => {
    expect(reads('See comment 3 and comment 1234567, then comment 12345678.')).toEqual([
      'issues/comments/12345678'
    ])
  })

  it('stops at the thirtieth source instead of reading without limit', () => {
    const closes = (n: number) =>
      `Closes ${Array.from({ length: n }, (_, i) => `#${i + 1}`).join(', ')}`
    expect(reads(closes(30))).toHaveLength(30)
    const seen: string[] = []
    expect(() =>
      prepareInputs({ body: closes(31) }, repo, (path: string) => {
        seen.push(path)
        return { body: 'The source contract.' }
      })
    ).toThrow('too many referenced source contracts')
    expect(seen).toHaveLength(30)
  })

  it('reads a link that spells this repository in another letter case', () => {
    const seen: string[] = []
    prepareInputs(
      { body: 'Contract: https://github.com/TheBristolSound/Birdbrain/issues/12' },
      repo,
      (path: string) => {
        seen.push(path)
        return { body: 'The source contract.' }
      }
    )
    expect(seen).toEqual([`repos/${repo}/issues/12`])
  })

  it('fails missing, unreadable or outside-repository source contracts', () => {
    expect(() => prepareInputs({ body: 'Closes #12' }, repo, () => ({ body: '' }))).toThrow(
      'required source'
    )
    expect(() =>
      prepareInputs({ body: 'Closes #12' }, repo, () => {
        throw new Error('HTTP 502')
      })
    ).toThrow('HTTP 502')
    expect(() =>
      prepareInputs({ body: 'https://github.com/other/repo/issues/1' }, repo, () => null)
    ).toThrow('outside')
  })
})
