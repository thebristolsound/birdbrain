import { describe, it, expect } from 'vitest'
import { safeRegexTest } from '@main/services/safeRegex'

describe('safeRegexTest', () => {
  it('returns true for a simple matching pattern', () => {
    expect(safeRegexTest('hello', '', 'hello world')).toBe(true)
  })

  it('returns false for a simple non-matching pattern', () => {
    expect(safeRegexTest('xyz', '', 'hello world')).toBe(false)
  })

  it('honors flags (case-insensitive match with "i")', () => {
    expect(safeRegexTest('HELLO', 'i', 'hello world')).toBe(true)
    expect(safeRegexTest('HELLO', '', 'hello world')).toBe(false)
  })

  it('returns false for an invalid regex pattern', () => {
    expect(safeRegexTest('(', '', 'whatever')).toBe(false)
  })

  it('returns false for an invalid flag string', () => {
    expect(safeRegexTest('hello', 'zzz', 'hello world')).toBe(false)
  })

  // Locks the 200ms vm.runInNewContext timeout behavior. The pattern (a+)+b
  // exhibits catastrophic backtracking against an all-'a' string with no 'b'
  // suffix — each additional 'a' roughly doubles the work, so 32 'a's takes
  // well over 200ms to fail-match (typically multiple seconds) on any modern
  // CPU. The vm timeout fires, runInNewContext throws, and safeRegexTest's
  // catch block returns false. Asserts only the boolean — never elapsed time —
  // to stay deterministic across CI hardware. If this test ever becomes flaky
  // on a very fast runner, raise the string length further, do not shorten the
  // timeout assertion.
  it('returns false when a catastrophic-backtracking pattern exceeds the timeout', () => {
    const pattern = '(a+)+b'
    const text = 'a'.repeat(32)
    expect(safeRegexTest(pattern, '', text)).toBe(false)
  })
})
