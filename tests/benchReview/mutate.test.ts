import { describe, expect, it } from 'vitest'
import {
  applyMutation,
  applyMutations,
  deriveTruth,
  MutationError
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/lib/mutate.mjs'

const file = 'a\nb\nc\nd\n'
const m = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  file: 'x.ts',
  find: 'b\nc',
  replace: 'B\nC\nC2',
  category: 'removed-guard',
  blocking: true,
  description: 'why',
  ...over
})

describe('applyMutation', () => {
  it('replaces once and reports the lines the replacement occupies', () => {
    const r = applyMutation(file, m())
    expect(r.content).toBe('a\nB\nC\nC2\nd\n')
    expect(r).toMatchObject({ lineStart: 2, lineEnd: 4 })
  })
  it('reports a deletion at the line it removed from', () => {
    const r = applyMutation(file, m({ find: 'b\n', replace: '' }))
    expect(r.content).toBe('a\nc\nd\n')
    expect(r).toMatchObject({ lineStart: 2, lineEnd: 2 })
  })
  it('refuses a find that is absent or ambiguous', () => {
    expect(() => applyMutation(file, m({ find: 'zz' }))).toThrow(MutationError)
    expect(() => applyMutation('b\nb\n', m({ find: 'b' }))).toThrow(/ambiguous/)
  })
})

describe('applyMutations', () => {
  it('chains mutations on one file and derives one defect each', () => {
    const read = (path: string) => (path === 'x.ts' ? file : null)
    const { files, defects } = applyMutations(read, [
      m(),
      m({ id: 'd2', find: 'C2', replace: 'C3', blocking: false })
    ])
    expect(files.get('x.ts')).toBe('a\nB\nC\nC3\nd\n')
    expect(
      defects.map((d: { id: string; lineStart: number; blocking: boolean }) => [
        d.id,
        d.lineStart,
        d.blocking
      ])
    ).toEqual([
      ['d1', 2, true],
      ['d2', 4, false]
    ])
  })
  it('names a file that is not at head', () => {
    expect(() => applyMutations(() => null, [m()])).toThrow(/not at head/)
  })
})

describe('deriveTruth', () => {
  it('requests changes only when a defect blocks', () => {
    expect(deriveTruth([{ blocking: false }]).verdict).toBe('approve for human review')
    expect(deriveTruth([{ blocking: false }, { blocking: true }]).verdict).toBe('request changes')
    expect(deriveTruth([]).refuted).toEqual([])
  })
})
