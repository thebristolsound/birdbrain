import { spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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
    const fits = pointer({ ...issues(29), ...inline }, `${closes(29)}\nSee comment 3963807921.`)
    expect(fits.run()).toHaveLength(30)
    expect(fits.seen).toHaveLength(31)
    const over = pointer({ ...issues(30), ...inline }, `${closes(30)}\nSee comment 3963807921.`)
    expect(over.run).toThrow('too many referenced source contracts')
    expect(over.seen).toHaveLength(30)
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

// The literal command leg.sh runs, with a `gh` that answers each comment endpoint with the HTTP
// status the case names, in the output GitHub CLI prints for it.
describe('the input preparation command', () => {
  const INPUTS = join(__dirname, '..', '.github', 'scripts', 'review-fleet', 'inputs.mjs')
  const GH = `#!/usr/bin/env bash
echo "$2" >> "$GH_LOG"
case "$2" in
  */issues/comments/*) code="$ISSUE_COMMENT" ;;
  */pulls/comments/*) code="$REVIEW_COMMENT" ;;
  *) code="$OTHER" ;;
esac
if [ "$code" = 200 ]; then printf '{"body":"Text at %s."}\\n' "$2"; exit 0; fi
if [ "$code" = 404 ]; then
  echo '{"message":"Not Found","status":"404"}'
  echo 'gh: Not Found (HTTP 404)' >&2
  exit 1
fi
echo "gh: Server Error (HTTP $code)" >&2
exit 1
`
  const prepare = (body: string, issueComment: number, reviewComment: number, other = 200) => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-inputs-'))
    try {
      writeFileSync(join(dir, 'gh'), GH)
      chmodSync(join(dir, 'gh'), 0o755)
      writeFileSync(join(dir, 'log'), '')
      writeFileSync(join(dir, 'pr.json'), JSON.stringify({ title: 't', body, commits: [] }))
      const result = spawnSync('node', [INPUTS, repo, dir], {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GH_LOG: join(dir, 'log'),
          ISSUE_COMMENT: String(issueComment),
          REVIEW_COMMENT: String(reviewComment),
          OTHER: String(other)
        }
      })
      const saved = join(dir, 'sources.json')
      return {
        status: result.status,
        stderr: result.stderr,
        calls: readFileSync(join(dir, 'log'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((path) => path.replace(`repos/${repo}/`, '')),
        sources: existsSync(saved)
          ? JSON.parse(readFileSync(saved, 'utf8')).map((s: { path: string }) => s.path)
          : null
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

  // Node 24 rescans a punctuation run from every position when an end-anchored expression
  // strips it. Electron's engine, which runs these tests, does not, so the command is timed.
  it('reads a link behind a long run of punctuation before the five-second limit', () => {
    const r = prepare(`https://github.com/${repo}/pull/9#event-5${'.'.repeat(200_000)}x`, 200, 200)
    expect(r.status, r.stderr).toBe(0)
    expect(r.sources).toEqual(['pulls/9'])
  })
})
