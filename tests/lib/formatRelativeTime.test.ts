import { describe, it, expect } from 'vitest'
import {
  formatRelativeTime,
  formatRelativeTimeShort,
  formatCaptureTimestampFull
} from '@renderer/lib/formatRelativeTime'

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

describe('formatRelativeTimeShort', () => {
  const now = new Date('2026-05-02T12:00:00Z').getTime()
  const ago = (ms: number) => new Date(now - ms).toISOString()
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('collapses anything under a minute to "now"', () => {
    expect(formatRelativeTimeShort(ago(30_000), now)).toBe('now')
    expect(formatRelativeTimeShort(ago(59_000), now)).toBe('now')
    expect(formatRelativeTimeShort(new Date(now + 5_000).toISOString(), now)).toBe('now')
  })

  it('steps minutes, hours, days and weeks at each boundary', () => {
    expect(formatRelativeTimeShort(ago(MIN), now)).toBe('1m')
    expect(formatRelativeTimeShort(ago(59 * MIN), now)).toBe('59m')
    expect(formatRelativeTimeShort(ago(HOUR), now)).toBe('1h')
    expect(formatRelativeTimeShort(ago(23 * HOUR), now)).toBe('23h')
    expect(formatRelativeTimeShort(ago(DAY), now)).toBe('1d')
    expect(formatRelativeTimeShort(ago(6 * DAY), now)).toBe('6d')
    expect(formatRelativeTimeShort(ago(7 * DAY), now)).toBe('1w')
    expect(formatRelativeTimeShort(ago(30 * DAY), now)).toBe('4w')
  })

  it('returns an empty string for unparseable input', () => {
    expect(formatRelativeTimeShort('not-a-date', now)).toBe('')
  })
})

describe('formatCaptureTimestampFull', () => {
  // Pinned to UTC so the hover disclosure on an evidence row reads the same on
  // every machine — and so this assertion does not depend on the CI timezone.
  it('renders a fixed UTC string with the zone named', () => {
    expect(formatCaptureTimestampFull('2026-05-02T12:34:00.000Z')).toBe(
      'Sat, May 2, 2026, 12:34 PM UTC'
    )
  })

  it('returns an empty string for unparseable input', () => {
    expect(formatCaptureTimestampFull('nope')).toBe('')
  })
})
