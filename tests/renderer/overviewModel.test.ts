import { describe, it, expect } from 'vitest'
import type { Capture, Note, Selector } from '@shared/types'
import {
  ACTIVITY_DAYS,
  DAY_MS,
  computeOverview,
  dayStartMs,
  hostOf
} from '@renderer/components/overview/overviewModel'
import { CHART_SERIES } from '@renderer/lib/chartColors'

// Pinned wall-clock: local noon on a fixed June day (no DST transition that
// month in any zone), so whole-day offsets map to exact bucket indices.
const NOW = new Date('2026-06-16T12:00:00').getTime()
const dayAgo = (k: number): string => new Date(NOW - k * DAY_MS).toISOString()

function cap(over: Partial<Capture>): Capture {
  return {
    id: 'c',
    caseId: 'case1',
    url: 'https://example.com',
    title: 'Untitled',
    hash: 'deadbeef',
    timestamp: dayAgo(0),
    createdAt: dayAgo(0),
    format: 'mhtml',
    method: 'extension',
    ...over
  }
}

function sel(over: Partial<Selector>): Selector {
  return {
    id: 's',
    caseId: 'case1',
    pattern: 'pat',
    isRegex: false,
    enabled: true,
    createdAt: dayAgo(0),
    ...over
  }
}

function note(over: Partial<Note>): Note {
  return {
    id: 'n',
    caseId: 'case1',
    title: 'Note',
    body: 'body',
    createdAt: dayAgo(0),
    updatedAt: dayAgo(0),
    ...over
  }
}

const EMPTY = { captures: [], selectors: [], notes: [], lastVisitAt: null }

describe('hostOf', () => {
  it('extracts the hostname from a valid url', () => {
    expect(hostOf('https://sub.example.com/path?q=1')).toBe('sub.example.com')
  })

  it('returns an empty string for a malformed url', () => {
    expect(hostOf('not a url')).toBe('')
    expect(hostOf('')).toBe('')
  })
})

describe('dayStartMs', () => {
  it('truncates a timestamp to local midnight of that day', () => {
    const mid = new Date('2026-06-16T15:30:45').getTime()
    expect(dayStartMs(mid)).toBe(new Date('2026-06-16T00:00:00').getTime())
  })
})

describe('computeOverview', () => {
  it('returns a fully zeroed model for empty input (no crash on empty case)', () => {
    const m = computeOverview(EMPTY, NOW)
    expect(m.sourceCount).toBe(0)
    expect(m.sources).toEqual([])
    expect(m.verified).toBe(0)
    expect(m.unverified).toBe(0)
    expect(m.tampered).toBe(0)
    expect(m.chainBroken).toBe(0)
    expect(m.missing).toBe(0)
    expect(m.recent).toEqual([])
    expect(m.deltas).toEqual({ captures: 0, sources: 0, selectors: 0, notes: 0 })
    expect(m.newCount).toBe(0)
    expect(m.dayBuckets).toHaveLength(ACTIVITY_DAYS)
    expect(m.dayBuckets.every((b) => b.count === 0)).toBe(true)
  })

  it('counts distinct sources, ranks them, and drops malformed urls', () => {
    const m = computeOverview(
      {
        ...EMPTY,
        captures: [
          cap({ id: '1', url: 'https://example.com/a' }),
          cap({ id: '2', url: 'https://example.com/b' }),
          cap({ id: '3', url: 'https://test.org/c' }),
          cap({ id: '4', url: 'garbage://::' })
        ]
      },
      NOW
    )
    expect(m.sourceCount).toBe(2)
    expect(m.sources.map((s) => s.host)).toEqual(['example.com', 'test.org'])
    expect(m.sources[0].count).toBe(2)
  })

  it('reconciles verify status, lumping legacy/undefined into unverified', () => {
    const m = computeOverview(
      {
        ...EMPTY,
        captures: [
          cap({ id: '1', lastVerifiedStatus: 'verified' }),
          cap({ id: '2', lastVerifiedStatus: 'verified' }),
          cap({ id: '3', lastVerifiedStatus: 'tampered' }),
          cap({ id: '4', lastVerifiedStatus: 'chain-broken' }),
          cap({ id: '5', lastVerifiedStatus: 'missing' }),
          cap({ id: '6', lastVerifiedStatus: 'legacy' }),
          cap({ id: '7', lastVerifiedStatus: undefined })
        ]
      },
      NOW
    )
    expect(m.verified).toBe(2)
    expect(m.tampered).toBe(1)
    expect(m.chainBroken).toBe(1)
    expect(m.missing).toBe(1)
    expect(m.unverified).toBe(2)
    expect(m.verified + m.tampered + m.chainBroken + m.missing + m.unverified).toBe(7)
  })

  // Verification returns missing and chain-broken before it compares the page bytes with the
  // record, so neither says the bytes changed and neither may be counted as Tampered.
  it.each([
    ['missing', { tampered: 0, chainBroken: 0, missing: 1 }],
    ['chain-broken', { tampered: 0, chainBroken: 1, missing: 0 }],
    ['tampered', { tampered: 1, chainBroken: 0, missing: 0 }]
  ] as const)('counts one %s capture under its own status only', (status, expected) => {
    const m = computeOverview(
      {
        ...EMPTY,
        captures: [
          cap({ id: '1', lastVerifiedStatus: 'verified' }),
          cap({ id: '2', lastVerifiedStatus: status }),
          cap({ id: '3', lastVerifiedStatus: undefined })
        ]
      },
      NOW
    )
    const { tampered, chainBroken, missing } = m
    expect({ tampered, chainBroken, missing }).toEqual(expected)
    expect(m.verified).toBe(1)
    expect(m.unverified).toBe(1)
    expect(m.verified + tampered + chainBroken + missing + m.unverified).toBe(3)
  })

  it('counts verifier-too-old as unverified, never as tampered (X25)', () => {
    const m = computeOverview(
      {
        ...EMPTY,
        captures: [
          cap({ id: '1', lastVerifiedStatus: 'verified' }),
          cap({ id: '2', lastVerifiedStatus: 'verifier-too-old' })
        ]
      },
      NOW
    )
    expect(m.verified).toBe(1)
    expect(m.tampered).toBe(0)
    expect(m.unverified).toBe(1)
  })

  it('buckets captures into the activity window and excludes out-of-range/invalid dates', () => {
    const m = computeOverview(
      {
        ...EMPTY,
        captures: [
          cap({ id: '1', createdAt: dayAgo(0) }),
          cap({ id: '2', createdAt: dayAgo(0) }),
          cap({ id: '3', createdAt: dayAgo(3) }),
          cap({ id: '4', createdAt: dayAgo(20) }), // older than the window
          cap({ id: '5', createdAt: dayAgo(-5) }), // future
          cap({ id: '6', createdAt: 'not-a-date' }) // NaN
        ]
      },
      NOW
    )
    expect(m.dayBuckets).toHaveLength(ACTIVITY_DAYS)
    expect(m.dayBuckets[ACTIVITY_DAYS - 1].count).toBe(2) // today
    expect(m.dayBuckets[ACTIVITY_DAYS - 1 - 3].count).toBe(1) // three days ago
    const total = m.dayBuckets.reduce((sum, b) => sum + b.count, 0)
    expect(total).toBe(3)
  })

  it('computes since-last-visit deltas relative to the cutoff', () => {
    const m = computeOverview(
      {
        captures: [
          cap({ id: '1', url: 'https://example.com/x', createdAt: dayAgo(0) }), // new
          cap({ id: '2', url: 'https://example.com/y', createdAt: dayAgo(5) }), // old, same host
          cap({ id: '3', url: 'https://fresh.org/z', createdAt: dayAgo(0) }) // new host
        ],
        selectors: [
          sel({ id: 's1', createdAt: dayAgo(1) }), // new
          sel({ id: 's2', createdAt: dayAgo(10) }) // old
        ],
        notes: [note({ id: 'n1', createdAt: dayAgo(0) })], // new
        lastVisitAt: dayAgo(2)
      },
      NOW
    )
    expect(m.deltas).toEqual({ captures: 2, sources: 1, selectors: 1, notes: 1 })
    expect(m.newCount).toBe(5)
  })

  it('reports zero deltas when there is no last visit', () => {
    const m = computeOverview(
      {
        ...EMPTY,
        captures: [cap({ id: '1', createdAt: dayAgo(0) }), cap({ id: '2', createdAt: dayAgo(1) })]
      },
      NOW
    )
    expect(m.deltas).toEqual({ captures: 0, sources: 0, selectors: 0, notes: 0 })
    expect(m.newCount).toBe(0)
  })

  it('returns the six newest captures, newest first', () => {
    const captures = Array.from({ length: 8 }, (_, i) => cap({ id: `c${i}`, createdAt: dayAgo(i) }))
    const m = computeOverview({ ...EMPTY, captures }, NOW)
    expect(m.recent).toHaveLength(6)
    expect(m.recent[0].id).toBe('c0') // most recent (dayAgo(0))
    expect(m.recent[5].id).toBe('c5')
  })

  it('assigns source tones from the chart palette by rank', () => {
    const m = computeOverview(
      {
        ...EMPTY,
        captures: [
          cap({ id: '1', url: 'https://aaa.com/1' }),
          cap({ id: '2', url: 'https://aaa.com/2' }),
          cap({ id: '3', url: 'https://bbb.com/1' })
        ]
      },
      NOW
    )
    expect(m.sources[0].tone).toBe(CHART_SERIES[0])
    expect(m.sources[1].tone).toBe(CHART_SERIES[1])
  })
})
