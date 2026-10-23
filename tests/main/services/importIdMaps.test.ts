import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { canonicalStringify } from '@shared/verify'
import {
  carriedIdMapName,
  composeIdMaps,
  isIdMapDigest,
  parseIdMap
} from '@main/services/importIdMaps'

// The rules that decide whether an import's id map counts, and how a chain of
// them resolves an entry's id to the row it now names (#1017).

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf-8').digest('hex')

const entryFor = (text: string, caseId = 'case-2', sourceCaseId = 'case-1') => ({
  caseId,
  sourceCaseId,
  idMapSha256: sha256(text)
})

const canonical = (remapped: Record<string, unknown>, caseId = 'case-2', sourceCaseId = 'case-1') =>
  canonicalStringify({ sourceCaseId, caseId, remapped })

const parsed = (remapped: Record<string, unknown>) => {
  const text = canonical(remapped)
  return parseIdMap(text, entryFor(text), { canonical: true })
}

describe('isIdMapDigest and carriedIdMapName', () => {
  it('accepts only 64 lower-case hex characters', () => {
    expect(isIdMapDigest('a'.repeat(64))).toBe(true)
    expect(isIdMapDigest('A'.repeat(64))).toBe(false)
    expect(isIdMapDigest('a'.repeat(63))).toBe(false)
    expect(isIdMapDigest(`${'a'.repeat(31)}/${'a'.repeat(32)}`)).toBe(false)
    expect(isIdMapDigest(`../${'a'.repeat(61)}`)).toBe(false)
  })

  it('names a carried map by its digest under the id map directory', () => {
    expect(carriedIdMapName('b'.repeat(64))).toBe(`import-id-maps/${'b'.repeat(64)}.json`)
  })
})

describe('parseIdMap', () => {
  it('reads a canonical map whose bytes hash to its entry and whose ids are the entry ids', () => {
    expect(parsed({ a: 'x', b: 'y' })).toEqual(
      new Map([
        ['a', 'x'],
        ['b', 'y']
      ])
    )
    expect(parsed({})).toEqual(new Map())
  })

  it('refuses bytes that do not hash to the entry', () => {
    const text = canonical({ a: 'x' })
    expect(parseIdMap(text, entryFor(canonical({ a: 'y' })), { canonical: true })).toBeUndefined()
  })

  it('refuses a carried map that is not canonical, even when the entry hashes its canonical form', () => {
    const text = JSON.stringify({ sourceCaseId: 'case-1', caseId: 'case-2', remapped: {} }, null, 2)
    const entry = { ...entryFor(text), idMapSha256: sha256(canonical({})) }
    expect(parseIdMap(text, entry, { canonical: false })).toEqual(new Map())
    expect(parseIdMap(text, entry, { canonical: true })).toBeUndefined()
  })

  it("reads the importer's own pretty map by the canonical hash of what it parses to", () => {
    const pretty = JSON.stringify({
      sourceCaseId: 'case-1',
      caseId: 'case-2',
      remapped: { a: 'x' }
    })
    const entry = { ...entryFor(pretty), idMapSha256: sha256(canonical({ a: 'x' })) }
    expect(parseIdMap(pretty, entry, { canonical: false })).toEqual(new Map([['a', 'x']]))
    expect(parseIdMap(pretty, entry, { canonical: true })).toBeUndefined()
  })

  it.each([
    ['names another case', canonical({}, 'case-9')],
    ['names another source case', canonical({}, 'case-2', 'case-9')],
    ['is not JSON', 'not json'],
    ['is an array', canonicalStringify([])],
    ['lacks the remapped key', canonicalStringify({ sourceCaseId: 'case-1', caseId: 'case-2' })],
    [
      'carries another key',
      canonicalStringify({ sourceCaseId: 'case-1', caseId: 'case-2', remapped: {}, extra: 1 })
    ],
    ['remaps an id to a number', canonical({ a: 1 })],
    [
      'has remapped as an array',
      canonicalStringify({ sourceCaseId: 'case-1', caseId: 'case-2', remapped: [] })
    ]
  ])('refuses a map that %s', (_, text) => {
    expect(
      parseIdMap(text, entryFor(text, 'case-2', 'case-1'), { canonical: true })
    ).toBeUndefined()
  })

  it.each([
    ['renames two ids onto one', { a: 'v', b: 'v' }],
    ['maps an id to itself', { a: 'a' }],
    ['renames onto one of its own keys', { a: 'b', b: 'c' }]
  ])('refuses a map that %s', (_, remapped) => {
    expect(parsed(remapped)).toBeUndefined()
  })
})

describe('composeIdMaps', () => {
  const map = (pairs: Record<string, string>) => new Map(Object.entries(pairs))

  it('folds the maps in chain order', () => {
    const composed = composeIdMaps([map({ o: 'r', n: 'm' }), map({ r: 's' }), map({ s: 't' })])!
    expect(composed.resolve('o')).toBe('t')
    expect(composed.resolve('r')).toBe('t')
    expect(composed.resolve('n')).toBe('m')
    expect(composed.resolve('elsewhere')).toBe('elsewhere')
    expect(composed.record).toEqual({ o: 't', n: 'm', r: 't', s: 't' })
  })

  it('applies an earlier map before a later one, not the other way round', () => {
    expect(composeIdMaps([map({ r: 's' }), map({ o: 'r' })])!.resolve('o')).toBe('r')
  })

  it('refuses a value two positions hold, one digest at two imports included', () => {
    expect(composeIdMaps([map({ a: 'v' }), map({ b: 'v' })])).toBeUndefined()
    const shared = map({ a: 'v' })
    expect(composeIdMaps([shared, shared])).toBeUndefined()
    const empty = map({})
    expect(composeIdMaps([empty, empty])).toEqual({
      resolve: expect.any(Function),
      trail: expect.any(Function),
      record: {}
    })
  })

  it('lists every id an id takes along the maps, the id itself first', () => {
    const composed = composeIdMaps([map({ o: 'r' }), map({ n: 'm' }), map({ r: 's' })])!
    expect(composed.trail('o')).toEqual(['o', 'r', 's'])
    expect(composed.trail('r')).toEqual(['r', 's'])
    expect(composed.trail('elsewhere')).toEqual(['elsewhere'])
  })

  it('never resolves an id through the prototype', () => {
    const composed = composeIdMaps([
      new Map([
        ['__proto__', 'p'],
        ['a', 'b']
      ])
    ])!
    expect(composed.resolve('constructor')).toBe('constructor')
    expect(composed.resolve('__proto__')).toBe('p')
    expect(Object.hasOwn(composed.record, '__proto__')).toBe(true)
    expect(composed.record.__proto__).toBe('p')
    expect(Object.hasOwn(composed.record, 'constructor')).toBe(false)
  })
})
