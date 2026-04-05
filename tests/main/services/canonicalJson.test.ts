import { describe, it, expect } from 'vitest'
import { canonicalStringify } from '@main/services/canonicalJson'

describe('canonicalStringify', () => {
  it('sorts object keys alphabetically', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('produces identical output regardless of insertion order', () => {
    const a = canonicalStringify({ b: 1, a: 2, c: 3 })
    const b = canonicalStringify({ c: 3, a: 2, b: 1 })
    expect(a).toBe(b)
  })

  it('handles nested objects deterministically', () => {
    expect(canonicalStringify({ y: { d: 1, c: 2 }, x: 1 })).toBe('{"x":1,"y":{"c":2,"d":1}}')
  })

  it('handles arrays preserving order', () => {
    expect(canonicalStringify({ items: [3, 1, 2] })).toBe('{"items":[3,1,2]}')
  })

  it('emits valid JSON for primitives', () => {
    expect(canonicalStringify('hi')).toBe('"hi"')
    expect(canonicalStringify(42)).toBe('42')
    expect(canonicalStringify(null)).toBe('null')
    expect(canonicalStringify(true)).toBe('true')
  })

  it('contains no whitespace', () => {
    const out = canonicalStringify({ a: 1, b: { c: 2 } })
    expect(out).not.toMatch(/\s/)
  })
})
