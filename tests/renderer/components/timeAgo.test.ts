import { describe, expect, it } from 'vitest'
import { timeAgo } from '@renderer/components/dashboard/timeAgo'

const NOW = Date.parse('2026-09-19T12:00:00.000Z')
const before = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// The ladder behind the card's "Updated 3 days ago" and the Older Cases age.
describe('timeAgo', () => {
  it('reads Just now under a minute', () => {
    expect(timeAgo(before(0), NOW)).toBe('Just now')
    expect(timeAgo(before(MIN - 1), NOW)).toBe('Just now')
  })

  it('counts minutes under an hour', () => {
    expect(timeAgo(before(MIN), NOW)).toBe('1 min ago')
    expect(timeAgo(before(HOUR - 1), NOW)).toBe('59 min ago')
  })

  it('counts hours under a day, singular at one', () => {
    expect(timeAgo(before(HOUR), NOW)).toBe('1 hour ago')
    expect(timeAgo(before(2 * HOUR), NOW)).toBe('2 hours ago')
    expect(timeAgo(before(DAY - 1), NOW)).toBe('23 hours ago')
  })

  it('counts days from a day on, singular at one', () => {
    expect(timeAgo(before(DAY), NOW)).toBe('1 day ago')
    expect(timeAgo(before(3 * DAY), NOW)).toBe('3 days ago')
  })
})
