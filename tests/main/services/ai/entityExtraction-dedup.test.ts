import { describe, it, expect } from 'vitest'
import { shouldSkipEntity } from '../../../../src/main/services/ai/entityExtraction'

describe('AI entity dedup', () => {
  it('skips entity when same type+value exists in rule-based results', () => {
    const existing = [{ type: 'email', value: 'test@example.com' }]
    expect(shouldSkipEntity('email', 'test@example.com', existing)).toBe(true)
  })

  it('does not skip entity when type+value differs', () => {
    const existing = [{ type: 'email', value: 'other@example.com' }]
    expect(shouldSkipEntity('email', 'test@example.com', existing)).toBe(false)
  })

  it('does not skip entity when no rule entities exist', () => {
    expect(shouldSkipEntity('email', 'test@example.com', [])).toBe(false)
  })
})
