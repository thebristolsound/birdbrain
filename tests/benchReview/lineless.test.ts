import { describe, expect, it } from 'vitest'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { matchFindings } from '../../scripts/bench/review/lib/match.mjs'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { checkClaim } from '../../scripts/bench/review/lib/grade.mjs'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { parseVerdictComment } from '../../scripts/bench/review/lib/dispatch.mjs'

const defect = (id: string, file: string, line: number) => ({
  id,
  file,
  lineStart: line,
  lineEnd: line,
  blocking: true,
  category: 'other',
  description: id
})

describe('lineless findings', () => {
  it('match the only defect in a file, never one of several', () => {
    const one = { verdict: 'request changes', defects: [defect('d1', 'src/a.ts', 40)], refuted: [] }
    const r = matchFindings(
      [{ file: 'src/a.ts', line: null, summary: 's', blocking: true }],
      one,
      {}
    )
    expect(r.matchedDefectIds).toEqual(['d1'])
    const two = {
      verdict: 'request changes',
      defects: [defect('d1', 'src/a.ts', 40), defect('d2', 'src/a.ts', 90)],
      refuted: []
    }
    const r2 = matchFindings(
      [{ file: 'src/a.ts', line: null, summary: 's', blocking: true }],
      two,
      {}
    )
    expect(r2.matchedDefectIds).toEqual([])
    expect(r2.unmatched).toHaveLength(1)
  })

  it('count as a missing line in the claim check', () => {
    const read = () => 'a\nb\nc\n'
    expect(checkClaim({ file: 'src/a.ts', line: null }, 'h', read)).toBe('line-missing')
    expect(checkClaim({ file: 'src/a.ts', line: 2 }, 'h', read)).toBe('ok')
    expect(checkClaim({ file: 'PR_BODY', line: null }, 'h', read)).toBe('ok')
  })

  it('come out of report cells that name a function, a control or a range', () => {
    const c = [
      '**Review verdict: request changes**',
      '<details>',
      '| # | severity | file:line | finding |',
      '|---|---|---|---|',
      '| 1 | blocking | src/a.ts (helper, `catch`) | one |',
      '| 2 | gate | PR labels | two |',
      '| 3 | blocking | whole branch | three |',
      '| 4 | blocking | src/b.ts:129-131, 118-120 (see types.ts) | four |',
      '| 5 | advisory | PR body Summary | five |',
      '</details>'
    ].join('\n')
    const r = parseVerdictComment(c)
    expect(
      r.findings.map((f: { file: string | null; line: number | null }) => [f.file, f.line])
    ).toEqual([
      ['src/a.ts', null],
      [null, null],
      [null, null],
      ['src/b.ts', 129],
      ['PR_BODY', null]
    ])
  })
})
