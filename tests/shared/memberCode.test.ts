import { describe, it, expect } from 'vitest'
import { suggestMemberCode } from '@shared/memberCode'
import { MEMBER_CODE_PATTERN } from '@shared/schemas'

// The Member Code the Owner is offered (#1810): initials of up to three
// words, accents removed, in the shape MEMBER_CODE_PATTERN admits, and a
// fallback when that is empty or taken.

describe('suggestMemberCode', () => {
  it('takes the initials of up to three words, upper-cased', () => {
    expect(suggestMemberCode('Alice Owner', [])).toBe('AO')
    expect(suggestMemberCode('bob', [])).toBe('B')
    expect(suggestMemberCode('  Mary Jane Watson Parker ', [])).toBe('MJW')
    expect(suggestMemberCode('r2 d2', [])).toBe('RD')
  })

  it('removes accents and drops characters outside A-Z and 0-9', () => {
    expect(suggestMemberCode('Élodie Ångström', [])).toBe('EA')
    expect(suggestMemberCode('Zoë Ünal', [])).toBe('ZU')
    // The first character of each word is taken before the filter runs.
    expect(suggestMemberCode('#1 Fan', [])).toBe('F')
    expect(suggestMemberCode('1st Fan', [])).toBe('1F')
  })

  it('falls back to M, then M2 to M9, when the name has no Latin letter or the code is taken', () => {
    expect(suggestMemberCode('李雷', [])).toBe('M')
    expect(suggestMemberCode('', [])).toBe('M')
    expect(suggestMemberCode('Alice Owner', ['AO'])).toBe('M')
    expect(suggestMemberCode('Alice Owner', ['ao', 'M'])).toBe('M2')
    expect(suggestMemberCode('李雷', ['M', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'])).toBe('M9')
  })

  it('returns the empty string when every fallback is taken, which the writer refuses', () => {
    const taken = ['M', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9']
    expect(suggestMemberCode('', taken)).toBe('')
    expect(MEMBER_CODE_PATTERN.test('')).toBe(false)
  })

  it('offers only codes the pattern admits', () => {
    for (const name of ['Alice Owner', 'Élodie', 'x y z w', '李雷', 'a-b c_d']) {
      expect(suggestMemberCode(name, [])).toMatch(MEMBER_CODE_PATTERN)
    }
  })
})
