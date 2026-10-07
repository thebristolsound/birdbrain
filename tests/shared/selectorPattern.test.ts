import { describe, it, expect } from 'vitest'
import { regexPatternError } from '@shared/selectorPattern'

describe('regexPatternError', () => {
  it('returns null for patterns the matcher can compile', () => {
    for (const pattern of ['acme', 'bc1[a-z0-9]{20,}', 'order \\d{5}', '(?:a|b)+']) {
      expect(regexPatternError(pattern)).toBeNull()
    }
  })

  it('returns the reason for patterns that do not compile', () => {
    for (const pattern of ['(unclosed', '[a-', 'a{2,1}', '*lead']) {
      expect(regexPatternError(pattern)).toEqual(expect.any(String))
    }
  })
})
