import { describe, expect, it } from 'vitest'
import {
  applyMutant,
  describeMutant,
  findMutants,
  selectMutants
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/test-reliability/lib/mutants.mjs'

type Mutant = {
  path: string
  line: number
  start: number
  end: number
  original: string
  replacement: string
  operator: string
}

const allLines = (text: string) => new Set(text.split('\n').map((_, i) => i + 1))

const mutate = (text: string, path = 'src/a.ts'): Mutant[] =>
  findMutants({ path, text, lines: allLines(text) })

const variants = (text: string) => mutate(text).map((mutant) => applyMutant(text, mutant))

describe('findMutants', () => {
  it('swaps each comparison, logical and arithmetic operator', () => {
    expect(variants('a === b')).toEqual(['a !== b'])
    expect(variants('a !== b')).toEqual(['a === b'])
    expect(variants('a == b')).toEqual(['a != b'])
    expect(variants('a != b')).toEqual(['a == b'])
    expect(variants('a < b')).toEqual(['a <= b'])
    expect(variants('a <= b')).toEqual(['a < b'])
    expect(variants('a > b')).toEqual(['a >= b'])
    expect(variants('a >= b')).toEqual(['a > b'])
    expect(variants('a && b')).toEqual(['a || b'])
    expect(variants('a || b')).toEqual(['a && b'])
    expect(variants('a + b')).toEqual(['a - b'])
    expect(variants('a - b')).toEqual(['a + b'])
    expect(variants('a * b')).toEqual(['a / b'])
    expect(variants('a / b')).toEqual(['a * b'])
  })

  it('leaves string concatenation and unlisted operators alone', () => {
    expect(mutate("'id-' + n")).toEqual([])
    expect(mutate('`${a}` + b')).toEqual([])
    expect(mutate('a ?? b')).toEqual([])
    expect(mutate('a = b')).toEqual([])
  })

  it('swaps boolean literals but not literal types', () => {
    expect(variants('const on = true')).toEqual(['const on = false'])
    expect(variants('const off = false')).toEqual(['const off = true'])
    expect(mutate('type On = true')).toEqual([])
  })

  it('drops a negation', () => {
    expect(variants('const x = !ready')).toEqual(['const x = ready'])
    expect(mutate('const n = -x')).toEqual([])
  })

  it('negates an if condition and swaps the operator inside it', () => {
    expect(variants('if (a < b) go()')).toEqual([
      'if (!(a < b)) go()',
      'if (a <= b) go()',
      'if (a < b) void 0'
    ])
  })

  it('replaces a returned value with undefined, except when it already is', () => {
    expect(variants('function f() { return x }')).toEqual(['function f() { return undefined }'])
    expect(mutate('function f() { return undefined }')).toEqual([])
    expect(mutate('function f() { return }')).toEqual([])
  })

  it('deletes call statements, awaited ones included, but not logging', () => {
    expect(variants('save(row)')).toEqual(['void 0'])
    expect(variants('async function f() { await save(row) }')).toEqual([
      'async function f() { void 0 }'
    ])
    expect(mutate('console.log(row)')).toEqual([])
    expect(mutate('log.warn(row)')).toEqual([])
    expect(mutate('logger.info(row)')).toEqual([])
    expect(mutate('x = 1')).toEqual([])
  })

  it('only reports sites that start on a changed line', () => {
    const text = 'const a = x === y\nconst b = p === q\n'
    const found = findMutants({ path: 'src/a.ts', text, lines: new Set([2]) })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      line: 2,
      original: '===',
      replacement: '!==',
      operator: 'operator'
    })
  })

  it('parses TSX', () => {
    const text = 'export const A = () => <div>{open && <span />}</div>\n'
    const found = findMutants({ path: 'src/A.tsx', text, lines: allLines(text) })
    expect(found.map((mutant: Mutant) => mutant.replacement)).toEqual(['||'])
  })
})

describe('describeMutant', () => {
  const base = { path: 'src/a.ts', line: 1, start: 0, end: 0 }

  it('reads as a sentence for each operator', () => {
    expect(
      describeMutant({ ...base, operator: 'operator', original: '===', replacement: '!==' })
    ).toBe('replaced `===` with `!==`')
    expect(
      describeMutant({ ...base, operator: 'call', original: 'save(row)', replacement: 'void 0' })
    ).toBe('deleted the call `save(row)`')
    expect(
      describeMutant({ ...base, operator: 'return', original: 'x', replacement: 'undefined' })
    ).toBe('returned `undefined` in place of `x`')
    expect(
      describeMutant({ ...base, operator: 'condition', original: 'ok', replacement: '!(ok)' })
    ).toBe('negated the condition `ok`')
  })

  it('shortens code longer than 60 characters', () => {
    const exact = 'x'.repeat(60)
    expect(
      describeMutant({ ...base, operator: 'call', original: exact, replacement: 'void 0' })
    ).toBe(`deleted the call \`${exact}\``)
    const original = 'x'.repeat(61)
    expect(describeMutant({ ...base, operator: 'call', original, replacement: 'void 0' })).toBe(
      `deleted the call \`${'x'.repeat(57)}...\``
    )
  })

  it('shows code on one line with no backtick, so it cannot end the code span', () => {
    expect(
      describeMutant({
        ...base,
        operator: 'call',
        original: 'save(\n  `${id}`,\n  row\n)',
        replacement: 'void 0'
      })
    ).toBe("deleted the call `save( '${id}', row )`")
    const original = `f(\`${'x'.repeat(70)}\`)`
    expect(describeMutant({ ...base, operator: 'call', original, replacement: 'void 0' })).toBe(
      `deleted the call \`f('${'x'.repeat(54)}...\``
    )
  })
})

describe('selectMutants', () => {
  const list = Array.from({ length: 10 }, (_, i) => i)

  it('keeps every mutant under the cap', () => {
    expect(selectMutants(list, 10)).toEqual(list)
  })

  it('spreads a capped selection across the whole list', () => {
    expect(selectMutants(list, 3)).toEqual([0, 3, 6])
    expect(selectMutants(list, 5)).toEqual([0, 2, 4, 6, 8])
  })
})
