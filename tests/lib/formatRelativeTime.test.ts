import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-02T12:00:00Z').getTime()

  it('returns "just now" for diffs under a minute', () => {
    expect(formatRelativeTime(new Date(now - 5_000).toISOString(), now)).toBe('just now')
    expect(formatRelativeTime(new Date(now - 59_000).toISOString(), now)).toBe('just now')
  })

  it('returns minute-grained strings under an hour', () => {
    expect(formatRelativeTime(new Date(now - 60_000).toISOString(), now)).toBe('1 minute ago')
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 minutes ago')
  })

  it('returns hour-grained strings under a day', () => {
    expect(formatRelativeTime(new Date(now - 60 * 60_000).toISOString(), now)).toBe('1 hour ago')
    expect(formatRelativeTime(new Date(now - 5 * 60 * 60_000).toISOString(), now)).toBe(
      '5 hours ago'
    )
  })

  it('returns day-grained strings under a week', () => {
    expect(formatRelativeTime(new Date(now - 24 * 60 * 60_000).toISOString(), now)).toBe(
      '1 day ago'
    )
  })

  it('returns absolute date for older diffs', () => {
    const old = new Date('2025-01-15T08:00:00Z').toISOString()
    const out = formatRelativeTime(old, now)
    expect(out).toMatch(/Jan 15, 2025/)
  })

  it('handles future-dated input as "just now"', () => {
    expect(formatRelativeTime(new Date(now + 5_000).toISOString(), now)).toBe('just now')
  })
})
