import { describe, it, expect } from 'vitest'
import type { Selector } from '@shared/types'
import { selectorMatchOutcome, selectorMatchesText } from '@main/services/selectorMatch'

function selector(pattern: string, isRegex: boolean): Selector {
  return {
    id: 'sel-1',
    caseId: 'case-1',
    pattern,
    isRegex,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

// The #330 pair from safeRegex.test.ts: the evaluation finishes as a match given
// 30 s and is nowhere near finished at 1 ms. Elapsed time is never asserted.
const BACKTRACKING = selector('(a+)+b', true)
const MATCHING_TEXT = `${'a'.repeat(23)}X/aaab`

describe('selectorMatchOutcome', () => {
  it('matches a substring Selector case-insensitively', () => {
    expect(selectorMatchOutcome(selector('Evil.COM', false), 'visit evil.com today')).toBe('match')
  })

  it('answers no-match when the substring is absent', () => {
    expect(selectorMatchOutcome(selector('evil.com', false), 'visit good.com today')).toBe(
      'no-match'
    )
  })

  it('reads a substring Selector literally, not as a pattern', () => {
    expect(selectorMatchOutcome(selector('a.c', false), 'abc')).toBe('no-match')
  })

  it('matches a regex Selector case-insensitively', () => {
    expect(selectorMatchOutcome(selector('EVIL\\.com', true), 'visit evil.COM today')).toBe('match')
  })

  it('answers no-match for a regex Selector that does not compile', () => {
    expect(selectorMatchOutcome(selector('(', true), 'text with a ( in it')).toBe('no-match')
  })

  it('answers timeout when the budget expires, and match with room to finish', () => {
    expect(selectorMatchOutcome(BACKTRACKING, MATCHING_TEXT, 1)).toBe('timeout')
    expect(selectorMatchOutcome(BACKTRACKING, MATCHING_TEXT, 30_000)).toBe('match')
  }, 60_000)

  // node:vm rejects a budget of 0, so the answer is no-match only when the
  // budget reaches the sandbox; the default would match. No timing involved.
  it('forwards the budget to the regex evaluation', () => {
    expect(selectorMatchOutcome(selector('hello', true), 'hello', 0)).toBe('no-match')
  })
})

describe('selectorMatchesText', () => {
  it('answers true for a match and false for no match', () => {
    expect(selectorMatchesText(selector('evil.com', false), 'visit EVIL.com')).toBe(true)
    expect(selectorMatchesText(selector('evil\\.com', true), 'visit good.com')).toBe(false)
  })

  it('answers false for a regex Selector that does not compile', () => {
    expect(selectorMatchesText(selector('(', true), 'text with a ( in it')).toBe(false)
  })

  it('answers false when the budget expires on a text it would match', () => {
    expect(selectorMatchesText(BACKTRACKING, MATCHING_TEXT, 1)).toBe(false)
    expect(selectorMatchesText(BACKTRACKING, MATCHING_TEXT, 30_000)).toBe(true)
  }, 60_000)

  it('forwards the budget to the matcher', () => {
    expect(selectorMatchesText(selector('hello', true), 'hello', 0)).toBe(false)
  })
})
