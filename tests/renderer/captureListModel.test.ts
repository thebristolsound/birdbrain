import { describe, it, expect } from 'vitest'
import type { Capture } from '@shared/types'
import {
  computeDisplayedCaptures,
  countActiveFilters,
  describeNarrowings,
  isNarrowed,
  matchesQuery,
  sortCaptures,
  type CaptureListFilters
} from '@renderer/components/captures/captureListModel'

const DAY_MS = 86_400_000

// Pinned wall-clock so the date-cutoff filter is deterministic under test.
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

const NO_FILTERS: CaptureListFilters = {
  query: '',
  sortBy: 'newest',
  formatFilter: 'all',
  dateFilter: 'all',
  favoritesOnly: false
}

const BASE = {
  filteredCaptureIds: null,
  favorites: new Set<string>(),
  filters: NO_FILTERS
}

describe('sortCaptures', () => {
  const captures = [
    cap({ id: 'a', timestamp: dayAgo(2), title: 'Zebra', url: 'https://b.com' }),
    cap({ id: 'b', timestamp: dayAgo(0), title: 'Apple', url: 'https://c.com' }),
    cap({ id: 'c', timestamp: dayAgo(1), title: 'Mango', url: 'https://a.com' })
  ]

  it('sorts newest first', () => {
    expect(sortCaptures(captures, 'newest').map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts oldest first', () => {
    expect(sortCaptures(captures, 'oldest').map((c) => c.id)).toEqual(['a', 'c', 'b'])
  })

  it('sorts by title A–Z', () => {
    expect(sortCaptures(captures, 'title-az').map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts by url A–Z', () => {
    expect(sortCaptures(captures, 'url-az').map((c) => c.id)).toEqual(['c', 'a', 'b'])
  })

  it('sorts empty titles first under title A–Z without crashing', () => {
    const withUntitled = [cap({ id: 'y', title: 'Apple' }), cap({ id: 'x', title: '' })]
    expect(sortCaptures(withUntitled, 'title-az').map((c) => c.id)).toEqual(['x', 'y'])
  })

  it('returns a new array and leaves the input order untouched', () => {
    const before = captures.map((c) => c.id)
    const result = sortCaptures(captures, 'newest')
    expect(result).not.toBe(captures)
    expect(captures.map((c) => c.id)).toEqual(before)
  })
})

describe('countActiveFilters', () => {
  it('is zero when nothing is active', () => {
    expect(countActiveFilters(NO_FILTERS)).toBe(0)
  })

  it('counts format, date, and favorites independently (sort is not a filter)', () => {
    expect(countActiveFilters({ ...NO_FILTERS, formatFilter: 'html' })).toBe(1)
    expect(countActiveFilters({ ...NO_FILTERS, dateFilter: '7days' })).toBe(1)
    expect(countActiveFilters({ ...NO_FILTERS, favoritesOnly: true })).toBe(1)
    expect(countActiveFilters({ ...NO_FILTERS, sortBy: 'url-az' })).toBe(0)
    // The badge must keep meaning exactly what the Filter menu shows, and the
    // menu has no query field.
    expect(countActiveFilters({ ...NO_FILTERS, query: 'acme' })).toBe(0)
    expect(
      countActiveFilters({
        query: '',
        sortBy: 'oldest',
        formatFilter: 'mhtml',
        dateFilter: 'today',
        favoritesOnly: true
      })
    ).toBe(3)
  })
})

describe('computeDisplayedCaptures', () => {
  it('returns everything sorted newest-first when no filter is active', () => {
    const captures = [
      cap({ id: '1', timestamp: dayAgo(3) }),
      cap({ id: '2', timestamp: dayAgo(1) }),
      cap({ id: '3', timestamp: dayAgo(2) })
    ]
    const out = computeDisplayedCaptures({ ...BASE, captures }, NOW)
    expect(out.map((c) => c.id)).toEqual(['2', '3', '1'])
  })

  it('returns an empty list for empty input', () => {
    expect(computeDisplayedCaptures({ ...BASE, captures: [] }, NOW)).toEqual([])
  })

  it('keeps only ids in the selector filter when one is active', () => {
    const captures = [cap({ id: '1' }), cap({ id: '2' }), cap({ id: '3' })]
    const out = computeDisplayedCaptures({ ...BASE, captures, filteredCaptureIds: ['1', '3'] }, NOW)
    expect(out.map((c) => c.id).sort()).toEqual(['1', '3'])
  })

  it('an empty selector filter hides everything (null means no filter)', () => {
    const captures = [cap({ id: '1' }), cap({ id: '2' })]
    expect(computeDisplayedCaptures({ ...BASE, captures, filteredCaptureIds: [] }, NOW)).toEqual([])
    expect(
      computeDisplayedCaptures({ ...BASE, captures, filteredCaptureIds: null }, NOW)
    ).toHaveLength(2)
  })

  it('filters by capture format', () => {
    const captures = [cap({ id: 'h', format: 'html' }), cap({ id: 'm', format: 'mhtml' })]
    const html = computeDisplayedCaptures(
      { ...BASE, captures, filters: { ...NO_FILTERS, formatFilter: 'html' } },
      NOW
    )
    expect(html.map((c) => c.id)).toEqual(['h'])
    const mhtml = computeDisplayedCaptures(
      { ...BASE, captures, filters: { ...NO_FILTERS, formatFilter: 'mhtml' } },
      NOW
    )
    expect(mhtml.map((c) => c.id)).toEqual(['m'])
  })

  it('filters to favorites only', () => {
    const captures = [cap({ id: '1' }), cap({ id: '2' }), cap({ id: '3' })]
    const out = computeDisplayedCaptures(
      {
        ...BASE,
        captures,
        favorites: new Set(['2']),
        filters: { ...NO_FILTERS, favoritesOnly: true }
      },
      NOW
    )
    expect(out.map((c) => c.id)).toEqual(['2'])
  })

  it('applies the date cutoff against the injected now, excluding older captures', () => {
    const captures = [
      cap({ id: 'fresh', timestamp: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }),
      cap({ id: 'thisWeek', timestamp: dayAgo(5) }),
      cap({ id: 'thisMonth', timestamp: dayAgo(20) }),
      cap({ id: 'ancient', timestamp: dayAgo(45) })
    ]
    const ids = (dateFilter: CaptureListFilters['dateFilter']) =>
      computeDisplayedCaptures(
        { ...BASE, captures, filters: { ...NO_FILTERS, dateFilter } },
        NOW
      ).map((c) => c.id)
    expect(ids('today')).toEqual(['fresh'])
    expect(ids('7days')).toEqual(['fresh', 'thisWeek'])
    expect(ids('30days')).toEqual(['fresh', 'thisWeek', 'thisMonth'])
    expect(ids('all')).toEqual(['fresh', 'thisWeek', 'thisMonth', 'ancient'])
  })

  it('treats the date boundary as inclusive (>= cutoff)', () => {
    const captures = [cap({ id: 'edge', timestamp: dayAgo(7) })]
    const out = computeDisplayedCaptures(
      { ...BASE, captures, filters: { ...NO_FILTERS, dateFilter: '7days' } },
      NOW
    )
    expect(out.map((c) => c.id)).toEqual(['edge'])
  })

  it('intersects all filters and then sorts the survivors', () => {
    const captures = [
      cap({ id: 'keepB', format: 'mhtml', timestamp: dayAgo(2), title: 'Bravo' }),
      cap({ id: 'keepA', format: 'mhtml', timestamp: dayAgo(1), title: 'Alpha' }),
      cap({ id: 'wrongFormat', format: 'html', timestamp: dayAgo(1), title: 'Charlie' }),
      cap({ id: 'notFavorite', format: 'mhtml', timestamp: dayAgo(1), title: 'Delta' }),
      cap({ id: 'tooOld', format: 'mhtml', timestamp: dayAgo(10), title: 'Echo' }),
      cap({ id: 'notSelected', format: 'mhtml', timestamp: dayAgo(1), title: 'Foxtrot' })
    ]
    const out = computeDisplayedCaptures(
      {
        captures,
        filteredCaptureIds: ['keepA', 'keepB', 'wrongFormat', 'notFavorite', 'tooOld'],
        favorites: new Set(['keepA', 'keepB', 'wrongFormat', 'tooOld', 'notSelected']),
        filters: {
          query: '',
          sortBy: 'title-az',
          formatFilter: 'mhtml',
          dateFilter: '7days',
          favoritesOnly: true
        }
      },
      NOW
    )
    expect(out.map((c) => c.id)).toEqual(['keepA', 'keepB'])
  })
})

describe('matchesQuery', () => {
  const target = cap({ id: 'q', title: 'Acme Holdings', url: 'https://corp.example.com/about' })

  it('matches everything when the query is empty or whitespace', () => {
    expect(matchesQuery(target, '')).toBe(true)
    expect(matchesQuery(target, '   ')).toBe(true)
  })

  it('matches a case-insensitive substring of the title', () => {
    expect(matchesQuery(target, 'acme')).toBe(true)
    expect(matchesQuery(target, 'HOLD')).toBe(true)
  })

  it('matches a case-insensitive substring of the url', () => {
    expect(matchesQuery(target, 'corp.example')).toBe(true)
    expect(matchesQuery(target, '/ABOUT')).toBe(true)
  })

  it('trims surrounding whitespace before matching', () => {
    expect(matchesQuery(target, '  acme  ')).toBe(true)
  })

  it('rejects a substring present in neither title nor url', () => {
    expect(matchesQuery(target, 'zebra')).toBe(false)
  })

  it('tolerates an empty title', () => {
    const untitled = cap({ id: 'u', title: '', url: 'https://example.com/x' })
    expect(matchesQuery(untitled, 'example')).toBe(true)
    expect(matchesQuery(untitled, 'zebra')).toBe(false)
  })
})

describe('describeNarrowings', () => {
  it('is empty when nothing narrows the list', () => {
    const input = { filters: NO_FILTERS, selectorFilterCount: 0 }
    expect(describeNarrowings(input)).toEqual([])
    expect(isNarrowed(input)).toBe(false)
  })

  it('names the query, ignoring surrounding whitespace', () => {
    expect(
      describeNarrowings({ filters: { ...NO_FILTERS, query: '  acme ' }, selectorFilterCount: 0 })
    ).toEqual(['Search "acme"'])
    expect(isNarrowed({ filters: { ...NO_FILTERS, query: '   ' }, selectorFilterCount: 0 })).toBe(
      false
    )
  })

  it('pluralizes the selector-filter count', () => {
    expect(describeNarrowings({ filters: NO_FILTERS, selectorFilterCount: 1 })).toEqual([
      '1 selector filter'
    ])
    expect(describeNarrowings({ filters: NO_FILTERS, selectorFilterCount: 3 })).toEqual([
      '3 selector filters'
    ])
  })

  it('names the menu filters with their menu labels', () => {
    expect(
      describeNarrowings({
        filters: { ...NO_FILTERS, formatFilter: 'mhtml' },
        selectorFilterCount: 0
      })
    ).toEqual(['MHTML'])
    expect(
      describeNarrowings({
        filters: { ...NO_FILTERS, dateFilter: '7days' },
        selectorFilterCount: 0
      })
    ).toEqual(['Last 7 days'])
    expect(
      describeNarrowings({
        filters: { ...NO_FILTERS, favoritesOnly: true },
        selectorFilterCount: 0
      })
    ).toEqual(['Favorites only'])
  })

  it('names every active narrowing at once, and sort is not one', () => {
    const input = {
      filters: {
        query: 'acme',
        sortBy: 'url-az' as const,
        formatFilter: 'html' as const,
        dateFilter: 'today' as const,
        favoritesOnly: true
      },
      selectorFilterCount: 2
    }
    expect(describeNarrowings(input)).toEqual([
      'Search "acme"',
      '2 selector filters',
      'HTML',
      'Today',
      'Favorites only'
    ])
    expect(isNarrowed(input)).toBe(true)
    expect(
      isNarrowed({ filters: { ...NO_FILTERS, sortBy: 'oldest' }, selectorFilterCount: 0 })
    ).toBe(false)
  })
})

describe('computeDisplayedCaptures query filter', () => {
  const captures = [
    cap({ id: 'title', title: 'Acme quarterly', url: 'https://one.example.com' }),
    cap({ id: 'url', title: 'Unrelated', url: 'https://acme.example.com/news' }),
    cap({ id: 'neither', title: 'Unrelated', url: 'https://two.example.com' })
  ]

  it('keeps captures matching on title or url and drops the rest', () => {
    const out = computeDisplayedCaptures(
      { ...BASE, captures, filters: { ...NO_FILTERS, query: 'ACME' } },
      NOW
    )
    expect(out.map((c) => c.id).sort()).toEqual(['title', 'url'])
  })

  it('returns nothing when no capture matches', () => {
    expect(
      computeDisplayedCaptures(
        { ...BASE, captures, filters: { ...NO_FILTERS, query: 'zebra' } },
        NOW
      )
    ).toEqual([])
  })

  it('leaves the list untouched for a whitespace-only query', () => {
    expect(
      computeDisplayedCaptures({ ...BASE, captures, filters: { ...NO_FILTERS, query: ' ' } }, NOW)
    ).toHaveLength(3)
  })

  it('intersects the query with the selector filter conjunctively', () => {
    const out = computeDisplayedCaptures(
      {
        ...BASE,
        captures,
        filteredCaptureIds: ['url', 'neither'],
        filters: { ...NO_FILTERS, query: 'acme' }
      },
      NOW
    )
    expect(out.map((c) => c.id)).toEqual(['url'])
  })

  it('intersects the query with the menu filters conjunctively', () => {
    const mixed = [
      cap({ id: 'keep', title: 'Acme', format: 'mhtml' }),
      cap({ id: 'wrongFormat', title: 'Acme', format: 'html' })
    ]
    const out = computeDisplayedCaptures(
      {
        ...BASE,
        captures: mixed,
        filters: { ...NO_FILTERS, query: 'acme', formatFilter: 'mhtml' }
      },
      NOW
    )
    expect(out.map((c) => c.id)).toEqual(['keep'])
  })
})
