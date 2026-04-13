import { describe, it, expect } from 'vitest'
import { truncateForContext } from '../../../src/main/services/openrouter'

describe('openrouter', () => {
  describe('truncateForContext', () => {
    it('returns short text unchanged', () => {
      const text = 'Hello world'
      expect(truncateForContext(text, 100)).toBe(text)
    })

    it('truncates text exceeding max chars', () => {
      const text = 'a'.repeat(200)
      const result = truncateForContext(text, 100)
      expect(result.length).toBeLessThan(200)
      expect(result).toContain('[Content truncated')
      expect(result.startsWith('a'.repeat(100))).toBe(true)
    })

    it('does not truncate text at exactly max chars', () => {
      const text = 'b'.repeat(100)
      expect(truncateForContext(text, 100)).toBe(text)
    })
  })
})
