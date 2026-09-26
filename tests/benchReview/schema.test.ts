import { describe, expect, it } from 'vitest'
import {
  validateCaseSpec,
  validateResultRow,
  validateTruth,
  configKey
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/lib/schema.mjs'

const sha = 'a'.repeat(40)
const mutation = {
  id: 'd1',
  file: 'src/x.ts',
  find: 'a',
  replace: 'b',
  category: 'removed-guard',
  blocking: true,
  description: 'why'
}
const spec = {
  id: 'm01-x',
  kind: 'mutation',
  source: { pr: 1, base: sha, head: sha },
  tags: ['t'],
  mutations: [mutation]
}
const truth = {
  verdict: 'request changes',
  defects: [
    {
      id: 'd1',
      file: 'src/x.ts',
      lineStart: 1,
      lineEnd: 2,
      category: 'off-by-one',
      blocking: true,
      description: 'd'
    }
  ],
  refuted: [{ file: 'src/y.ts', description: 'r' }]
}

describe('validateCaseSpec', () => {
  it('accepts a mutation spec and a real spec', () => {
    expect(validateCaseSpec(spec)).toEqual([])
    expect(
      validateCaseSpec({ id: 'r1', kind: 'real', source: spec.source, tags: [], truth })
    ).toEqual([])
  })
  it('names every problem', () => {
    const bad = validateCaseSpec({
      id: 'Bad_Id',
      kind: 'mutation',
      source: { pr: 'x', base: 'short', head: sha },
      tags: 'no',
      mutations: [{ ...mutation, category: 'nope', blocking: 'yes' }],
      truth
    })
    expect(validateCaseSpec({ ...spec, kind: 'other' })).toEqual(['kind: one of mutation | real'])
    expect(bad).toEqual(
      expect.arrayContaining([
        'id: lowercase letters, digits and dashes',
        'source.pr: integer',
        'source.base: 40-hex sha',
        'tags: array of strings',
        expect.stringContaining('mutations[0].category'),
        'mutations[0].blocking: boolean'
      ])
    )
    expect(validateCaseSpec({ ...spec, truth })).toContain(
      'truth: derived for mutation cases, do not set'
    )
    expect(validateCaseSpec({ ...spec, mutations: [] })).toContain('mutations: non-empty array')
    expect(validateCaseSpec({ ...spec, kind: 'real', truth })).toContain(
      'mutations: only on mutation cases'
    )
    expect(validateCaseSpec(null)).toEqual(['spec: not an object'])
    expect(validateCaseSpec({ ...spec, source: undefined })).toContain('source: required')
  })
})

describe('validateTruth', () => {
  it('checks defects and refuted entries', () => {
    expect(validateTruth(truth)).toEqual([])
    const bad = validateTruth({
      verdict: 'maybe',
      defects: [
        { id: 'd', file: 'f', lineStart: 5, lineEnd: 2, category: 'x', blocking: 1 },
        { id: 'd', file: 'f', category: 'off-by-one', blocking: true, description: 'x' },
        null
      ],
      refuted: [{ lineStart: 'a' }, null]
    })
    expect(bad).toEqual(
      expect.arrayContaining([
        expect.stringContaining('truth.verdict'),
        'truth.defects[0]: lineEnd before lineStart',
        'truth.defects[0].description: required',
        'truth.defects[2]: not an object',
        'truth.defects: duplicate id d',
        'truth.refuted[0].file: required',
        'truth.refuted[0].lineStart: integer',
        'truth.refuted[1]: not an object'
      ])
    )
    expect(validateTruth(undefined)).toEqual(['truth: not an object'])
    expect(validateTruth({ verdict: 'request changes', defects: 'x', refuted: 'y' })).toEqual([
      'truth.defects: array',
      'truth.refuted: array'
    ])
  })
})

describe('validateResultRow', () => {
  const row = {
    case: 'm01-x',
    model: 'claude-opus-5',
    harness: 'claude',
    tier: 'L1',
    effort: 'high',
    rep: 1,
    manifest: 'abc',
    status: 'ok',
    output: {
      verdict: 'request changes',
      findings: [{ file: 'src/x.ts', line: 3, summary: 's', blocking: true }]
    }
  }
  it('accepts an ok row and a status-only row', () => {
    expect(validateResultRow(row)).toEqual([])
    expect(validateResultRow({ ...row, status: 'rate_limited', output: undefined })).toEqual([])
    expect(configKey(row)).toBe('claude/claude-opus-5/L1/high')
  })
  it('rejects output on a failed row and malformed findings', () => {
    expect(validateResultRow({ ...row, status: 'error' })).toEqual([
      'output: must be absent when status is error'
    ])
    expect(validateResultRow({ ...row, output: undefined })).toContain(
      'output: required when status is ok'
    )
    const bad = validateResultRow({
      ...row,
      harness: 'gemini',
      tier: 'L9',
      rep: 0,
      output: {
        verdict: 'ship it',
        findings: [{ file: 3, line: 'x', quote: 1, blocking: 'y' }, 'no']
      }
    })
    expect(bad).toEqual(
      expect.arrayContaining([
        expect.stringContaining('harness:'),
        expect.stringContaining('tier:'),
        'rep: positive integer',
        expect.stringContaining('output.verdict'),
        'output.findings[0].file: string',
        'output.findings[0].line: integer',
        'output.findings[0].quote: string',
        'output.findings[0].summary: required',
        'output.findings[0].blocking: boolean',
        'output.findings[1]: not an object'
      ])
    )
    expect(validateResultRow(null)).toEqual(['row: not an object'])
    expect(
      validateResultRow({ ...row, output: { verdict: 'request changes', findings: 'x' } })
    ).toContain('output.findings: array')
  })
})
