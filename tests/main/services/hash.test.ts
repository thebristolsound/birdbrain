import { describe, it, expect } from 'vitest'
import { hashContent, verifyHash } from '@main/services/hash'

describe('hashContent', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = hashContent('hello world')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns consistent hash for same input', () => {
    const hash1 = hashContent('test content')
    const hash2 = hashContent('test content')
    expect(hash1).toBe(hash2)
  })

  it('returns different hash for different input', () => {
    const hash1 = hashContent('content A')
    const hash2 = hashContent('content B')
    expect(hash1).not.toBe(hash2)
  })

  it('handles empty string', () => {
    const hash = hashContent('')
    expect(hash).toHaveLength(64)
  })

  it('handles unicode content', () => {
    const hash = hashContent('こんにちは世界 🌍')
    expect(hash).toHaveLength(64)
  })
})

describe('verifyHash', () => {
  it('returns true when hash matches', () => {
    const content = 'test content'
    const hash = hashContent(content)
    expect(verifyHash(content, hash)).toBe(true)
  })

  it('returns false when hash does not match', () => {
    expect(verifyHash('content', 'badhash')).toBe(false)
  })
})
