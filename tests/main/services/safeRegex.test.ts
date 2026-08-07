import { describe, it, expect } from 'vitest'
import { DEFAULT_REGEX_TIMEOUT_MS, safeRegexTest } from '@main/services/safeRegex'

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

  // The production budget, pinned as a value rather than as a race: every call
  // site omits the argument, so this constant is the one that decides whether an
  // ignore rule is enforced or fails open. Changing it changes evidence-path
  // behaviour and should have to change this line too.
  it('defaults to a 200 ms budget', () => {
    expect(DEFAULT_REGEX_TIMEOUT_MS).toBe(200)
  })

  // The injectable budget (#330). Same pattern, same text, two budgets, two
  // answers — which is what proves the argument reaches the vm timeout, and that
  // the false is budget expiry rather than a non-match.
  //
  // Neither direction is a close race. The evaluation costs ~100 ms warm and
  // ~560 ms cold on the container this was written on (Electron's Node 20 runtime
  // via `pnpm test`), so the sandbox would have to get ~100x faster before it
  // finished inside the 1 ms budget, and ~50x slower before it missed the 30 s
  // one. Elapsed time is never asserted.
  const BACKTRACKING_PATTERN = '(a+)+b'
  const MATCHING_TEXT = `${'a'.repeat(23)}X/aaab`

  it('honours an explicit budget: expiry answers false, room to finish answers true', () => {
    expect(safeRegexTest(BACKTRACKING_PATTERN, '', MATCHING_TEXT, 1)).toBe(false)
    expect(safeRegexTest(BACKTRACKING_PATTERN, '', MATCHING_TEXT, 30_000)).toBe(true)
  }, 60_000)
})
