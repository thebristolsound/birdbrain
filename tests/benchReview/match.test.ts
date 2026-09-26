import { describe, expect, it } from 'vitest'
import {
  matchFindings,
  normalizePath
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/lib/match.mjs'

const truth = {
  verdict: 'request changes',
  defects: [
    {
      id: 'd1',
      file: 'src/a.ts',
      lineStart: 100,
      lineEnd: 102,
      category: 'removed-guard',
      blocking: true,
      description: ''
    },
    {
      id: 'd2',
      file: 'src/a.ts',
      lineStart: 200,
      lineEnd: 200,
      category: 'off-by-one',
      blocking: false,
      description: ''
    },
    { id: 'd3', file: 'PR_BODY', category: 'overclaim', blocking: true, description: '' }
  ],
  refuted: [{ file: 'src/b.ts', lineStart: 10, lineEnd: 12, description: 'skeptic refuted' }]
}
const f = (file: string | null, line: number | null) => ({
  file,
  line,
  summary: 's',
  blocking: true
})

describe('normalizePath', () => {
  it('strips diff and relative prefixes', () => {
    expect(normalizePath('a/src/a.ts')).toBe('src/a.ts')
    expect(normalizePath('./src/a.ts')).toBe('src/a.ts')
    expect(normalizePath(undefined)).toBe('')
  })
})

describe('matchFindings', () => {
  it('matches on file and a widened line range, nearest defect first', () => {
    const r = matchFindings([f('src/a.ts', 105), f('b/src/a.ts', 196), f('src/a.ts', 150)], truth)
    expect(r.matches).toEqual([
      { defectId: 'd1', findingIndex: 0 },
      { defectId: 'd2', findingIndex: 1 }
    ])
    expect(r.unmatched).toEqual([2])
    expect(r.matchedDefectIds).toEqual(['d1', 'd2'])
  })
  it('matches a defect with no line range on file alone, and needs a line otherwise', () => {
    const r = matchFindings([f('PR_BODY', null), f('src/a.ts', null)], truth)
    expect(r.matches).toEqual([{ defectId: 'd3', findingIndex: 0 }])
    expect(r.unmatched).toEqual([1])
  })
  it('counts hits on refuted findings separately from unmatched ones', () => {
    const r = matchFindings([f('src/b.ts', 11), f('src/b.ts', 40)], truth)
    expect(r.refutedHits).toEqual([{ refutedIndex: 0, findingIndex: 0 }])
    expect(r.unmatched).toEqual([1])
  })
  it('counts only the first five findings and reports the overflow', () => {
    const many = Array.from({ length: 7 }, (_, i) => f('src/a.ts', 101 + i * 0))
    const r = matchFindings(many, truth)
    expect(r.matches).toHaveLength(5)
    expect(r.matchedDefectIds).toEqual(['d1'])
    expect(r.overCap).toBe(2)
    expect(matchFindings(many, truth, { cap: 7 }).overCap).toBe(0)
  })
  it('honours a custom window', () => {
    expect(matchFindings([f('src/a.ts', 110)], truth).unmatched).toEqual([0])
    expect(matchFindings([f('src/a.ts', 110)], truth, { window: 10 }).matches).toHaveLength(1)
  })
})
