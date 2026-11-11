import { spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  MAX_COMMENTS,
  MAX_SOURCES,
  MAX_SOURCES_BYTES,
  bareReferences,
  prepareInputs,
  sourcesFile,
  trustedAccounts,
  trustedComments
  // @ts-expect-error - workflow script with no declarations
} from '../.github/scripts/review-fleet/inputs.mjs'
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
    // The pull request the sentence names by number is read too, after the comment.
    expect(seen).toEqual(
      ['issues/comments/6763346891', 'issues/2151'].map((p) => `repos/${repo}/${p}`)
    )
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

  // A number pointer does not say which kind of comment it names. `answers` maps a path to its
  // source, to an error the read throws, or to nothing: the reader's null for a 404.
  const pointer = (
    answers: Record<string, unknown>,
    body = 'The review is comment 3963807921.'
  ) => {
    const seen: string[] = []
    const run = () =>
      prepareInputs({ body }, repo, (path: string) => {
        const short = path.replace(`repos/${repo}/`, '')
        seen.push(short)
        if (answers[short] instanceof Error) throw answers[short]
        return answers[short] ?? null
      }).map((s: { path: string }) => s.path)
    return { seen, run }
  }
  const asIssue = 'issues/comments/3963807921'
  const asInline = 'pulls/comments/3963807921'

  it('reads a number pointer an issue comment answers, and looks no further', () => {
    const { seen, run } = pointer({
      [asIssue]: { body: 'Issue.' },
      [asInline]: { body: 'Inline.' }
    })
    expect(run()).toEqual([asIssue])
    expect(seen).toEqual([asIssue])
  })

  it('reads a number pointer only an inline review comment answers', () => {
    const { seen, run } = pointer({ [asInline]: { body: 'Inline.' } })
    expect(run()).toEqual([asInline])
    expect(seen).toEqual([asIssue, asInline])
  })

  it('fails a number pointer neither kind of comment answers, after trying both', () => {
    const { seen, run } = pointer({})
    expect(run).toThrow(`could not read required source ${asIssue} or ${asInline}`)
    expect(seen).toEqual([asIssue, asInline])
  })

  it('fails on any other error from the issue comment read, without trying the inline one', () => {
    const { seen, run } = pointer({ [asIssue]: new Error('HTTP 502'), [asInline]: { body: 'I.' } })
    expect(run).toThrow('HTTP 502')
    expect(seen).toEqual([asIssue])
  })

  it('fails an issue comment with an empty body, without trying the inline one', () => {
    const { seen, run } = pointer({ [asIssue]: { body: ' ' }, [asInline]: { body: 'Inline.' } })
    expect(run).toThrow('could not read required source')
    expect(seen).toEqual([asIssue])
  })

  it('reads a comment once when a link and a number pointer both name it', () => {
    const link = `https://github.com/${repo}/pull/9#discussion_r3963807921`
    const { seen, run } = pointer(
      { [asInline]: { body: 'Inline.' } },
      `See ${link}, which is comment 3963807921 and again comment 3963807921.`
    )
    expect(run()).toEqual([asInline])
    expect(seen).toEqual([asInline])
  })

  it('still fails a link to an issue comment that a number pointer found only inline', () => {
    const link = `https://github.com/${repo}/pull/9#issuecomment-3963807921`
    const { seen, run } = pointer(
      { 'issues/12': { body: `See ${link}` }, [asInline]: { body: 'Inline.' } },
      'Closes #12\nThe review is comment 3963807921.'
    )
    expect(run).toThrow(`could not read required source ${asIssue}`)
    expect(seen).toEqual(['issues/12', asIssue, asInline, asIssue])
  })

  it('counts sources, not reads, toward the limit', () => {
    const closes = (n: number) =>
      `Closes ${Array.from({ length: n }, (_, i) => `#${i + 1}`).join(', ')}`
    const issues = (n: number) =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`issues/${i + 1}`, { body: 'Text.' }])
      )
    const inline = { [asInline]: { body: 'Inline.' } }
    const under = MAX_SOURCES - 1
    const fits = pointer(
      { ...issues(under), ...inline },
      `${closes(under)}\nSee comment 3963807921.`
    )
    expect(fits.run()).toHaveLength(MAX_SOURCES)
    expect(fits.seen).toHaveLength(MAX_SOURCES + 1)
    const over = pointer(
      { ...issues(MAX_SOURCES), ...inline },
      `${closes(MAX_SOURCES)}\nSee comment 3963807921.`
    )
    expect(over.run).toThrow('too many referenced source contracts')
    expect(over.seen).toHaveLength(MAX_SOURCES)
  })

  // A browser decodes a fragment before it looks for the comment.
  it.each([
    ['pull/9#issue%63omment-5', 'issues/comments/5'],
    ['pull/9#discussion%5Fr5', 'pulls/comments/5'],
    ['pull/9/files#%725', 'pulls/comments/5'],
    ['pull/9#pullrequest%72eview-5', 'pulls/9/reviews/5'],
    ['pull/9#:~:text=50%25%20done', 'pulls/9']
  ])('reads a percent-encoded fragment as a browser does: %s', (link, path) => {
    expect(reads(`Contract: https://github.com/${repo}/${link}`)).toEqual([path])
  })

  it.each(['pull/9#discussion%5Fr-5', 'pull/9#%zz', 'pull/9#100%'])(
    'fails a fragment that is malformed once decoded, or does not decode: %s',
    (link) => {
      expect(() => reads(`Contract: https://github.com/${repo}/${link}`)).toThrow(
        `malformed source link: https://github.com/${repo}/${link}`
      )
    }
  )

  it('stops at the source limit, naming it, instead of reading without limit', () => {
    const closes = (n: number) =>
      `Closes ${Array.from({ length: n }, (_, i) => `#${i + 1}`).join(', ')}`
    expect(MAX_SOURCES).toBe(60)
    expect(reads(closes(MAX_SOURCES))).toHaveLength(MAX_SOURCES)
    const seen: string[] = []
    expect(() =>
      prepareInputs({ body: closes(MAX_SOURCES + 1) }, repo, (path: string) => {
        seen.push(path)
        return { body: 'The source contract.' }
      })
    ).toThrow(`too many referenced source contracts: the limit is ${MAX_SOURCES}`)
    expect(seen).toHaveLength(MAX_SOURCES)
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

describe('who wrote a source, and when', () => {
  it('records the author and the creation time of each source', () => {
    const sources = prepareInputs(
      { body: `Closes #12\nSee https://github.com/${repo}/pull/9#pullrequestreview-456` },
      repo,
      (path: string) =>
        path.endsWith('issues/12')
          ? {
              title: 'The brief',
              body: 'Do the thing.',
              user: { login: 'thebristolsound' },
              created_at: '2026-08-20T10:00:00Z',
              comments: 3
            }
          : {
              body: 'Review.',
              user: { login: 'birdbrain-agent' },
              submitted_at: '2026-11-09T21:56:02Z'
            }
    )
    expect(sources).toEqual([
      {
        path: 'issues/12',
        title: 'The brief',
        author: 'thebristolsound',
        created_at: '2026-08-20T10:00:00Z',
        body: 'Do the thing.',
        comments_total: 3
      },
      {
        path: 'pulls/9/reviews/456',
        title: '',
        author: 'birdbrain-agent',
        created_at: '2026-11-09T21:56:02Z',
        body: 'Review.'
      }
    ])
  })

  it('records null, not a guess, for a source that names no author or time', () => {
    const [source] = prepareInputs({ body: 'Closes #12' }, repo, () => ({ body: 'Text.' }))
    expect(source).toMatchObject({ author: null, created_at: null, comments_total: null })
  })
})

describe('bare references in the description', () => {
  it.each([
    ['See #12 and (#13), then #14.', [12, 13, 14]],
    ['#7 at the start, #7 again', [7]],
    ['Fixes the bug in #1318: the walker.', [1318]],
    ['PR#12, a#13 and 1#14 are inside words', []],
    ['An entity &#123; and a zero #0 and #012', []],
    [`A link https://github.com/${repo}/pull/9#issuecomment-5 and /page#33`, []],
    ['An anchor [here](#12-the-section) and other/repo#15', []],
    ['A span `#21` and ``#22`` stay code, #23 does not', [23]],
    ['Before\n```\n#31 in a fence\n```\nafter #32', [32]],
    ['~~~\n#41\n~~~\n#42\n```sh\n#43 never closed', [42]],
    ['````\n```\n#51 inside the longer fence\n```\n````\n#52', [52]],
    ['```#61``` is a span on one line, so #62 is read', [62]]
  ])('finds the numbers GitHub would link in: %j', (text, numbers) => {
    expect(bareReferences(text)).toEqual(numbers)
  })

  // `answers` maps a path to its source; anything else is the reader's null for a 404.
  const loaded = (body: string, answers: Record<string, unknown> = {}) => {
    const seen: string[] = []
    const run = () =>
      prepareInputs({ body }, repo, (path: string) => {
        const short = path.replace(`repos/${repo}/`, '')
        seen.push(short)
        return short in answers ? answers[short] : { body: `Text of ${short}.` }
      }).map((s: { path: string }) => s.path)
    return { seen, run }
  }

  it('reads the issue or pull request each bare reference names', () => {
    const { seen, run } = loaded('This follows #1069 and #2164, which changed the worker.')
    expect(run()).toEqual(['issues/1069', 'issues/2164'])
    expect(seen).toEqual(['issues/1069', 'issues/2164'])
  })

  it('does not follow what a bare reference names any further', () => {
    const { seen, run } = loaded('Part two of #2176.', {
      'issues/2176': {
        body: `Closes #5. See #6 and https://github.com/${repo}/issues/7 and comment 3963807921.`
      }
    })
    expect(run()).toEqual(['issues/2176'])
    expect(seen).toEqual(['issues/2176'])
  })

  it('still follows the links of a linked source, and reads bare references last', () => {
    const { run } = loaded(`Bare #30. Contract: https://github.com/${repo}/issues/20`, {
      'issues/20': { body: `See https://github.com/${repo}/issues/21 and #22.` }
    })
    expect(run()).toEqual(['issues/20', 'issues/21', 'issues/30'])
  })

  it('reads an item once when a closing line, a link and a bare reference name it', () => {
    const { seen, run } = loaded(
      `Closes #12\nSee #12, https://github.com/${repo}/pull/9 and #9, and #12 again.`
    )
    expect(run()).toEqual(['issues/12', 'pulls/9'])
    expect(seen).toEqual(['issues/12', 'pulls/9'])
  })

  it('fails a bare reference that nothing answers', () => {
    const { run } = loaded('See #999999.', { 'issues/999999': null })
    expect(run).toThrow('could not read required source issues/999999')
  })

  it('counts bare references toward the source limit', () => {
    const refs = (n: number) => Array.from({ length: n }, (_, i) => `#${i + 1}`).join(' ')
    expect(loaded(refs(MAX_SOURCES)).run()).toHaveLength(MAX_SOURCES)
    const over = loaded(refs(MAX_SOURCES + 1))
    expect(over.run).toThrow(`too many referenced source contracts: the limit is ${MAX_SOURCES}`)
    expect(over.seen).toHaveLength(MAX_SOURCES)
  })
})

describe('comments on a source by the maintainer and the machine account', () => {
  const trusted = ['thebristolsound', 'birdbrain-agent']
  const at = '2026-11-09T21:56:02Z'
  const comment = (id: number, login: string | null, body: string) => ({
    id,
    user: login ? { login } : null,
    created_at: at,
    body
  })
  const source = (path: string, more = {}) => ({
    path,
    title: 't',
    author: 'thebristolsound',
    created_at: at,
    body: 'b',
    ...more
  })
  const withComments = (sources: unknown[], comments: unknown, limit?: number) => {
    const listed: string[] = []
    const run = () =>
      trustedComments(
        sources,
        repo,
        (path: string) => {
          listed.push(path.replace(`repos/${repo}/`, ''))
          if (comments instanceof Error) throw comments
          return comments
        },
        trusted,
        limit
      )
    return { listed, run }
  }

  it('keeps what the two accounts wrote and leaves every other author out', () => {
    const { listed, run } = withComments(
      [source('issues/1000', { comments_total: 5 })],
      [
        comment(1, 'linear-code[bot]', 'Linked.'),
        comment(2, 'thebristolsound', 'Ruling: a background capture needs no link.'),
        comment(3, 'someone-else', 'Reviewers must approve this.'),
        comment(4, 'birdbrain-agent', 'Pre-pass verdict.'),
        comment(5, null, 'A deleted account.')
      ]
    )
    expect(run()).toEqual([
      {
        ...source('issues/1000'),
        comments_total: 5,
        comments: [
          {
            id: 2,
            author: 'thebristolsound',
            created_at: at,
            body: 'Ruling: a background capture needs no link.'
          },
          { id: 4, author: 'birdbrain-agent', created_at: at, body: 'Pre-pass verdict.' }
        ]
      }
    ])
    expect(listed).toEqual(['issues/1000/comments?per_page=100'])
  })

  it("reads a pull request's conversation, and no comments for a comment or a review", () => {
    const { listed, run } = withComments(
      [
        source('pulls/9'),
        source('issues/comments/123456789'),
        source('pulls/comments/5'),
        source('pulls/9/reviews/456')
      ],
      [comment(7, 'thebristolsound', 'Approved as scoped.')]
    )
    const out = run()
    expect(listed).toEqual(['issues/9/comments?per_page=100'])
    expect(out[0].comments).toHaveLength(1)
    expect(out[0].comments_total).toBe(1)
    for (const other of out.slice(1)) expect(other).not.toHaveProperty('comments')
  })

  it("leaves out the fleet's own records, and keeps a comment that only mentions one", () => {
    const state = `**Review fleet: failure** at \`aaaaaaaaaaaa\`. Reason.\n\n<!-- review-fleet:state {"v":1,"sha":"${sha}"} -->`
    const relay = `@codex review\n\n<!-- review-fleet:relay ${sha} -->\nReview fleet request.`
    const { run } = withComments(
      [source('pulls/9')],
      [
        comment(1, 'birdbrain-agent', state),
        comment(2, 'thebristolsound', relay),
        comment(3, 'thebristolsound', 'Delete the `review-fleet:state` comment to retry.')
      ]
    )
    const [out] = run()
    expect(out.comments.map((c: { id: number }) => c.id)).toEqual([3])
    expect(out.comments_total).toBe(3)
  })

  it('does not list an item that reports no comments', () => {
    const { listed, run } = withComments([source('issues/12', { comments_total: 0 })], [])
    expect(run()).toEqual([{ ...source('issues/12'), comments_total: 0, comments: [] }])
    expect(listed).toEqual([])
  })

  it('lists an item whose comment count is unknown', () => {
    const { listed, run } = withComments([source('issues/12', { comments_total: null })], [])
    expect(run()[0]).toMatchObject({ comments_total: 0, comments: [] })
    expect(listed).toEqual(['issues/12/comments?per_page=100'])
  })

  it.each([
    [new Error('HTTP 502'), 'HTTP 502'],
    [{ message: 'Not Found' }, 'could not read the comments of issues/12'],
    [null, 'could not read the comments of issues/12']
  ])('fails when the comments cannot be read: %j', (answer, message) => {
    expect(withComments([source('issues/12')], answer).run).toThrow(message)
  })

  it('fails over the comment limit, naming it, instead of dropping some', () => {
    expect(MAX_COMMENTS).toBe(200)
    const three = [1, 2, 3].map((id) => comment(id, 'thebristolsound', 'Text.'))
    const sources = [source('issues/1'), source('issues/2')]
    expect(withComments(sources, three, 6).run()).toHaveLength(2)
    expect(withComments(sources, three, 5).run).toThrow(
      'too many comments on the referenced sources: the limit is 5'
    )
  })
})

describe('the accounts and the size the inputs are held to', () => {
  it('names the two accounts from the environment', () => {
    expect(
      trustedAccounts({ MAINTAINER: 'thebristolsound', MACHINE: ' birdbrain-agent ' })
    ).toEqual(['thebristolsound', 'birdbrain-agent'])
  })

  it.each([
    [{}],
    [{ MAINTAINER: 'thebristolsound' }],
    [{ MACHINE: 'birdbrain-agent' }],
    [{ MAINTAINER: 'thebristolsound', MACHINE: ' ' }]
  ])('fails when either account is unset: %j', (env) => {
    expect(() => trustedAccounts(env)).toThrow('MAINTAINER and MACHINE must both be set')
  })

  it('fails over the size limit, naming it, instead of cutting the sources', () => {
    expect(MAX_SOURCES_BYTES).toBe(1024 * 1024)
    const sources = [{ path: 'issues/1', title: '', body: 'é'.repeat(40) }]
    const text = sourcesFile(sources, 200)
    expect(JSON.parse(text)).toEqual(sources)
    expect(Buffer.byteLength(text)).toBeGreaterThan(text.length)
    expect(() => sourcesFile(sources, Buffer.byteLength(text) - 1)).toThrow(
      `sources.json would be ${Buffer.byteLength(text)} bytes: the limit is ${Buffer.byteLength(text) - 1}`
    )
    expect(sourcesFile(sources, Buffer.byteLength(text))).toBe(text)
  })
})

// The literal command leg.sh runs, with a `gh` that answers each comment endpoint with the HTTP
// status the case names, in the output GitHub CLI prints for it.
describe('the input preparation command', () => {
  const INPUTS = join(__dirname, '..', '.github', 'scripts', 'review-fleet', 'inputs.mjs')
  const GH = `#!/usr/bin/env bash
echo "$2" >> "$GH_LOG"
case "$2" in
  */issues/comments/*) code="$ISSUE_COMMENT" ;;
  */pulls/comments/*) code="$REVIEW_COMMENT" ;;
  */comments\\?per_page=100) code="$LISTING" ;;
  *) code="$OTHER" ;;
esac
if [ "$code" = 200 ] && [ "\${3:-}" = --paginate ]; then cat "$COMMENTS"; exit 0; fi
if [ "$code" = 200 ]; then printf '{"body":"Text at %s."}\\n' "$2"; exit 0; fi
if [ "$code" = 404 ]; then
  echo '{"message":"Not Found","status":"404"}'
  echo 'gh: Not Found (HTTP 404)' >&2
  exit 1
fi
echo "gh: Server Error (HTTP $code)" >&2
exit 1
`
  // `more` sets the listing's HTTP status (LISTING), the pages it answers with (comments), and
  // any environment variable by name; an empty value unsets the account it names.
  const prepare = (
    body: string,
    issueComment: number,
    reviewComment: number,
    other = 200,
    timeout?: number,
    more: { comments?: unknown; env?: Record<string, string> } = {}
  ) => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-inputs-'))
    try {
      writeFileSync(join(dir, 'gh'), GH)
      chmodSync(join(dir, 'gh'), 0o755)
      writeFileSync(join(dir, 'log'), '')
      writeFileSync(join(dir, 'comments.json'), JSON.stringify(more.comments ?? [[]]))
      writeFileSync(join(dir, 'pr.json'), JSON.stringify({ title: 't', body, commits: [] }))
      const result = spawnSync('node', [INPUTS, repo, dir], {
        encoding: 'utf8',
        timeout,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GH_LOG: join(dir, 'log'),
          COMMENTS: join(dir, 'comments.json'),
          ISSUE_COMMENT: String(issueComment),
          REVIEW_COMMENT: String(reviewComment),
          OTHER: String(other),
          LISTING: '200',
          MAINTAINER: 'thebristolsound',
          MACHINE: 'birdbrain-agent',
          ...more.env
        }
      })
      const saved = join(dir, 'sources.json')
      const full = existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : null
      return {
        status: result.status,
        stderr: result.stderr,
        calls: readFileSync(join(dir, 'log'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((path) => path.replace(`repos/${repo}/`, '')),
        sources: full ? full.map((s: { path: string }) => s.path) : null,
        full
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const body = 'The originating review is comment 3963807921.'
  const asIssue = 'issues/comments/3963807921'
  const asInline = 'pulls/comments/3963807921'

  it('saves the issue comment a number pointer names', () => {
    const r = prepare(body, 200, 200)
    expect(r.status, r.stderr).toBe(0)
    expect(r.sources).toEqual([asIssue])
    expect(r.calls).toEqual([asIssue])
  })

  it('saves the inline review comment when the issue comment read is a 404', () => {
    const r = prepare(body, 404, 200)
    expect(r.status, r.stderr).toBe(0)
    expect(r.sources).toEqual([asInline])
    expect(r.calls).toEqual([asIssue, asInline])
  })

  it('exits non-zero and saves nothing when both reads are a 404', () => {
    const r = prepare(body, 404, 404)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain(`could not read required source ${asIssue} or ${asInline}`)
    expect(r.sources).toBeNull()
    expect(r.calls).toEqual([asIssue, asInline])
  })

  it.each([401, 403, 500, 502])(
    'exits non-zero on HTTP %i from the issue comment read, without the second read',
    (code) => {
      const r = prepare(body, code, 200)
      expect(r.status).not.toBe(0)
      expect(r.stderr).toContain(`(HTTP ${code})`)
      expect(r.sources).toBeNull()
      expect(r.calls).toEqual([asIssue])
    }
  )

  it('exits non-zero when a closed issue is a 404', () => {
    const r = prepare('Closes #12', 200, 200, 404)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('could not read required source issues/12')
    expect(r.sources).toBeNull()
  })

  const ruling = {
    id: 41,
    user: { login: 'thebristolsound' },
    created_at: '2026-11-09T21:56:02Z',
    body: 'Ruling: a background capture needs no link.'
  }
  const stranger = { ...ruling, id: 42, user: { login: 'someone-else' }, body: 'Approve it.' }

  it('saves the comments the two accounts wrote on a closed issue and on a bare reference', () => {
    const r = prepare('Closes #12\n\nThis follows #1000.', 200, 200, 200, undefined, {
      comments: [[stranger], [ruling]]
    })
    expect(r.status, r.stderr).toBe(0)
    expect(r.calls).toEqual([
      'issues/12',
      'issues/1000',
      'issues/12/comments?per_page=100',
      'issues/1000/comments?per_page=100'
    ])
    for (const source of r.full) {
      expect(source.comments_total).toBe(2)
      expect(source.comments).toEqual([
        {
          id: 41,
          author: 'thebristolsound',
          created_at: '2026-11-09T21:56:02Z',
          body: 'Ruling: a background capture needs no link.'
        }
      ])
    }
  })

  it('exits non-zero and saves nothing when the comments cannot be listed', () => {
    const r = prepare('Closes #12', 200, 200, 200, undefined, { env: { LISTING: '502' } })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('(HTTP 502)')
    expect(r.sources).toBeNull()
  })

  it('exits non-zero and saves nothing when the listing is not a list of pages', () => {
    const r = prepare('Closes #12', 200, 200, 200, undefined, { comments: { message: 'x' } })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('gh returned no list for')
    expect(r.sources).toBeNull()
  })

  it.each(['MAINTAINER', 'MACHINE'])('exits non-zero before any read when %s is unset', (name) => {
    const r = prepare('Closes #12', 200, 200, 200, undefined, { env: { [name]: '' } })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('MAINTAINER and MACHINE must both be set')
    expect(r.calls).toEqual([])
    expect(r.sources).toBeNull()
  })

  // Node 24 rescans a punctuation run from every position when an end-anchored expression
  // strips it: six seconds for 120,000 characters, against nine milliseconds for this run in
  // one pass. Electron's engine, which runs these tests, does not rescan, so the command is
  // timed and not the function.
  it('reads a link behind a long run of punctuation within twenty seconds', () => {
    const body = `https://github.com/${repo}/pull/9#event-5${'.'.repeat(1_000_000)}x`
    const r = prepare(body, 200, 200, 200, 20_000)
    expect(r.status, r.stderr).toBe(0)
    expect(r.sources).toEqual(['pulls/9'])
  }, 30_000)
})
