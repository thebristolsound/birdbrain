import { describe, expect, it } from 'vitest'
import {
  checkClaim,
  consistency,
  errorRow,
  gradeRow,
  nullRow,
  oracleRow,
  selfCheck,
  summarize
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/lib/grade.mjs'

const sha = 'b'.repeat(40)
const content = 'line one\nconst guard = resolve(a) !== resolve(b)\nline three\n'
const readFile = (_sha: string, path: string) => (path === 'src/x.ts' ? content : null)
const truth = {
  verdict: 'request changes',
  defects: [
    {
      id: 'd1',
      file: 'src/x.ts',
      lineStart: 2,
      lineEnd: 2,
      category: 'removed-guard',
      blocking: true,
      description: 'guard'
    },
    {
      id: 'd2',
      file: 'src/x.ts',
      lineStart: 30,
      lineEnd: 31,
      category: 'off-by-one',
      blocking: false,
      description: 'off'
    }
  ],
  refuted: [{ file: 'src/y.ts', lineStart: 5, lineEnd: 5, description: 'refuted' }]
}
const kase = {
  id: 'c1',
  kind: 'mutation',
  source: { pr: 1, base: sha, head: sha },
  tags: [],
  truth
}
const row = (over: Record<string, unknown> = {}) => ({
  case: 'c1',
  model: 'm',
  harness: 'claude',
  tier: 'L1',
  effort: 'high',
  rep: 1,
  manifest: 'x',
  head: sha,
  status: 'ok',
  output: {
    verdict: 'request changes',
    findings: [
      {
        file: 'src/x.ts',
        line: 2,
        quote: 'resolve(a)   !== resolve(b)',
        summary: 'guard gone',
        blocking: true
      },
      { file: 'src/y.ts', line: 6, summary: 'refuted one', blocking: false },
      { file: 'src/x.ts', line: 900, summary: 'nowhere', blocking: false },
      { file: null, line: null, summary: 'body claim', blocking: false }
    ]
  },
  ...over
})

describe('checkClaim', () => {
  it('classifies each finding by whether its citation holds', () => {
    expect(checkClaim({ file: 'src/x.ts', line: 2, quote: 'guard = resolve' }, sha, readFile)).toBe(
      'ok'
    )
    expect(checkClaim({ file: 'src/x.ts', line: 3 }, sha, readFile)).toBe('ok')
    expect(checkClaim({ file: 'src/nope.ts', line: 1 }, sha, readFile)).toBe('missing-file')
    expect(checkClaim({ file: 'src/x.ts', line: 99 }, sha, readFile)).toBe('line-out-of-range')
    expect(checkClaim({ file: 'src/x.ts', line: 1, quote: 'not here' }, sha, readFile)).toBe(
      'quote-mismatch'
    )
    expect(checkClaim({ summary: 'no file' }, sha, readFile)).toBe('unverifiable')
  })
})

describe('gradeRow', () => {
  it('scores verdict, recall, false positives and claims', () => {
    const g = gradeRow(row(), truth, { readFile })
    expect(g).toMatchObject({
      status: 'ok',
      verdictCorrect: true,
      findings: 4,
      overCap: 0,
      defectsTotal: 2,
      defectsMatched: 1,
      blockersTotal: 1,
      blockersMatched: 1,
      unmatched: 2,
      refutedHits: 1,
      matchedDefectIds: ['d1'],
      claims: {
        ok: 1,
        'missing-file': 1,
        'line-out-of-range': 1,
        'quote-mismatch': 0,
        unverifiable: 1
      }
    })
    expect(g.findingKeys).toEqual(['src/x.ts:0', 'src/y.ts:0', 'src/x.ts:90', ':-'])
  })
  it('passes a failed row through unscored', () => {
    const g = gradeRow(row({ status: 'error', output: undefined }), truth, { readFile })
    expect(g).toEqual({
      case: 'c1',
      model: 'm',
      harness: 'claude',
      tier: 'L1',
      effort: 'high',
      rep: 1,
      manifest: 'x',
      status: 'error'
    })
  })
})

describe('consistency', () => {
  it('needs two reps and reports majority agreement and mean overlap', () => {
    expect(consistency([{ verdict: 'a', findingKeys: [] }])).toEqual({
      verdictAgreement: null,
      findingOverlap: null
    })
    const reps = [
      { verdict: 'request changes', findingKeys: ['a:1', 'b:2'] },
      { verdict: 'request changes', findingKeys: ['a:1'] },
      { verdict: 'approve for human review', findingKeys: [] }
    ]
    const c = consistency(reps)
    expect(c.verdictAgreement).toBeCloseTo(2 / 3)
    expect(c.findingOverlap).toBeCloseTo((0.5 + 0 + 0) / 3)
    expect(
      consistency([
        { verdict: 'x', findingKeys: [] },
        { verdict: 'x', findingKeys: [] }
      ]).findingOverlap
    ).toBe(1)
  })
})

describe('summarize', () => {
  it('groups by config, counts statuses and averages over ok rows', () => {
    const graded = [
      gradeRow(row(), truth, { readFile }),
      gradeRow(
        row({ rep: 2, output: { verdict: 'approve for human review', findings: [] } }),
        truth,
        { readFile }
      ),
      gradeRow(row({ rep: 3, status: 'rate_limited', output: undefined }), truth, { readFile }),
      gradeRow(
        row({ model: 'other', output: { verdict: 'request changes', findings: [] } }),
        truth,
        { readFile }
      )
    ]
    const s = summarize(graded)
    expect(s).toHaveLength(2)
    expect(s[0]).toMatchObject({
      config: 'claude/m/L1/high',
      rows: 3,
      statuses: { ok: 2, rate_limited: 1 },
      cases: 1,
      verdictAccuracy: 0.5,
      blockerRecall: 0.5,
      defectRecall: 0.25,
      unmatchedPerRow: 1,
      refutedHitsPerRow: 0.5,
      claimRate: 1 / 3,
      verdictAgreement: 0.5,
      findingOverlap: 0
    })
    expect(s[1]).toMatchObject({
      config: 'claude/other/L1/high',
      rows: 1,
      claimRate: null,
      verdictAgreement: null
    })
  })
})

describe('selfCheck', () => {
  it('builds oracle, null and error rows from the case', () => {
    expect(oracleRow(kase, truth).output.findings).toEqual([
      { file: 'src/x.ts', line: 2, summary: 'guard', blocking: true },
      { file: 'src/x.ts', line: 30, summary: 'off', blocking: false }
    ])
    expect(nullRow(kase)).toMatchObject({
      model: 'null',
      status: 'ok',
      output: { verdict: 'approve for human review', findings: [] }
    })
    expect(errorRow(kase)).toMatchObject({ model: 'error', status: 'error' })
    expect(errorRow(kase).output).toBeUndefined()
  })
  it('passes on a sound truth set and names what fails otherwise', () => {
    const okTruth = { ...truth, defects: [truth.defects[0]] }
    const good = selfCheck([{ ...kase, truth: okTruth }], { readFileFor: () => readFile })
    expect(good.pass).toBe(true)
    expect(good.oracle).toMatchObject({ verdictAccuracy: 1, defectRecall: 1, claimRate: 1 })
    expect(good.null).toMatchObject({ verdictAccuracy: 0, defectRecall: 0 })
    expect(good.error.statuses).toEqual({ error: 1 })
    // A defect past the end of the file is a truth file that cannot be cited.
    const bad = selfCheck([kase], { readFileFor: () => readFile })
    expect(bad.pass).toBe(false)
    expect(bad.problems).toEqual(['oracle: claim rate is not 1'])
    expect(selfCheck([], {}).problems).toContain('oracle: verdict accuracy is not 1')
  })
})
