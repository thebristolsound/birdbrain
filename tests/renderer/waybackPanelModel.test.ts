import { describe, it, expect } from 'vitest'
import type { WaybackSnapshot } from '@shared/types'
import { formatSnapshotDelta, snapshotDeltaMs } from '@shared/wayback'
import {
  buildWaybackList,
  footerLine,
  formatCheckedAgo,
  formatRangeLabel,
  formatUtcDate,
  formatUtcTime,
  monthGrid,
  monthLabel,
  nextMonth,
  presetLabel,
  presetRange,
  previousMonth,
  rangeFromDays,
  SNAPSHOTS_PER_PAGE,
  statusBand,
  summaryLine
} from '@renderer/components/captures/waybackPanelModel'

const CAPTURE_AT = '2026-06-15T12:00:00.000Z'

function snap(iso: string, extra: Partial<WaybackSnapshot> = {}): WaybackSnapshot {
  const cdx = iso.replace(/[-:TZ.]/g, '').slice(0, 14)
  return {
    timestamp: iso,
    snapshotUrl: `https://web.archive.org/web/${cdx}/https://example.com/`,
    originalUrl: 'https://example.com/',
    statusCode: 200,
    mimeType: 'text/html',
    ...extra
  }
}

// Fourteen snapshots a day apart, straddling the capture, so paging and range
// filtering both have something real to bite on.
const SNAPSHOTS = Array.from({ length: 14 }, (_, i) =>
  snap(new Date(Date.parse(CAPTURE_AT) + (i - 7) * 86_400_000).toISOString())
)
const CLOSEST_INDEX = 7

describe('formatSnapshotDelta', () => {
  it.each([
    ['2026-06-15T12:30:00.000Z', '30m after capture'],
    ['2026-06-15T11:15:00.000Z', '45m before capture'],
    ['2026-06-15T15:00:00.000Z', '3h after capture'],
    ['2026-06-15T09:30:00.000Z', '2h 30m before capture'],
    ['2026-06-18T12:00:00.000Z', '3d after capture'],
    ['2026-06-12T09:00:00.000Z', '3d 3h before capture'],
    ['2026-06-15T12:00:00.000Z', '0m after capture']
  ])('phrases %s as %s', (iso, expected) => {
    expect(formatSnapshotDelta(iso, CAPTURE_AT)).toBe(expected)
  })

  it('rounds once so a near-day boundary cannot read as 23h 60m', () => {
    expect(formatSnapshotDelta('2026-06-16T11:59:59.900Z', CAPTURE_AT)).toBe('1d after capture')
  })

  it('returns null rather than a delta it cannot compute', () => {
    expect(formatSnapshotDelta('not-a-date', CAPTURE_AT)).toBeNull()
    expect(formatSnapshotDelta(CAPTURE_AT, 'not-a-date')).toBeNull()
    expect(snapshotDeltaMs('not-a-date', CAPTURE_AT)).toBeNull()
    expect(snapshotDeltaMs('2026-06-16T12:00:00.000Z', CAPTURE_AT)).toBe(86_400_000)
  })
})

describe('UTC formatting', () => {
  it('prints dates and times in UTC regardless of the host timezone', () => {
    expect(formatUtcDate('2026-02-02T16:09:51.000Z')).toBe('Feb 2, 2026')
    expect(formatUtcTime('2026-02-02T16:09:51.000Z')).toBe('16:09:51')
  })

  it('prints nothing for an unparseable timestamp', () => {
    expect(formatUtcDate('nope')).toBe('')
    expect(formatUtcTime('nope')).toBe('')
  })

  it('labels months and steps between them across year boundaries', () => {
    expect(monthLabel(2026, 0)).toBe('January 2026')
    expect(previousMonth(2026, 0)).toEqual({ year: 2025, month: 11 })
    expect(nextMonth(2026, 11)).toEqual({ year: 2027, month: 0 })
    expect(nextMonth(2026, 5)).toEqual({ year: 2026, month: 6 })
    expect(previousMonth(2026, 5)).toEqual({ year: 2026, month: 4 })
  })
})

describe('presets and ranges', () => {
  it('labels the three presets, the last from the capture year', () => {
    expect(presetLabel('all', CAPTURE_AT)).toBe('All time')
    expect(presetLabel('around-capture', CAPTURE_AT)).toBe('±30 days of capture')
    expect(presetLabel('capture-year', CAPTURE_AT)).toBe('2026')
    expect(presetLabel('capture-year', 'nonsense')).toBe('Capture year')
  })

  it('filters nothing for all-time and brackets the capture for the others', () => {
    expect(presetRange('all', CAPTURE_AT)).toBeNull()
    expect(presetRange('capture-year', 'nonsense')).toBeNull()
    const around = presetRange('around-capture', CAPTURE_AT)!
    expect(around.toMs - around.fromMs).toBe(60 * 86_400_000)
    const year = presetRange('capture-year', CAPTURE_AT)!
    expect(new Date(year.fromMs).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(new Date(year.toMs).toISOString()).toBe('2026-12-31T23:59:59.999Z')
  })

  it('builds a whole-day range from two picks in either order', () => {
    const a = Date.UTC(2026, 5, 10)
    const b = Date.UTC(2026, 5, 12)
    expect(rangeFromDays(a, b)).toEqual(rangeFromDays(b, a))
    const range = rangeFromDays(b, a)
    expect(new Date(range.fromMs).toISOString()).toBe('2026-06-10T00:00:00.000Z')
    expect(new Date(range.toMs).toISOString()).toBe('2026-06-12T23:59:59.999Z')
  })

  it('labels a range, and all-time when there is none', () => {
    expect(formatRangeLabel(null)).toBe('All time')
    expect(formatRangeLabel(rangeFromDays(Date.UTC(2026, 5, 10), Date.UTC(2026, 5, 12)))).toBe(
      'Jun 10, 2026 – Jun 12, 2026'
    )
  })
})

describe('statusBand', () => {
  it.each([
    [200, 'ok'],
    [299, 'ok'],
    [301, 'redirect'],
    [399, 'redirect'],
    [404, 'error'],
    [503, 'error']
  ])('bands %i as %s', (code, band) => {
    expect(statusBand(code)).toBe(band)
  })

  it('has no band for a CDX row with no status', () => {
    expect(statusBand(undefined)).toBeNull()
  })
})

describe('buildWaybackList', () => {
  const base = {
    snapshots: SNAPSHOTS,
    closestIndex: CLOSEST_INDEX,
    captureTimestamp: CAPTURE_AT,
    query: '',
    range: null,
    page: 0
  }

  it('pages the full set six at a time', () => {
    const first = buildWaybackList(base)
    expect(first.rows).toHaveLength(SNAPSHOTS_PER_PAGE)
    expect(first.pageCount).toBe(3)
    expect(first.totalCount).toBe(14)
    expect(first.inRangeCount).toBe(14)
    expect(buildWaybackList({ ...base, page: 2 }).rows).toHaveLength(2)
  })

  it('marks the closest snapshot and reports the page holding it', () => {
    const model = buildWaybackList({ ...base, page: 1 })
    expect(model.closestPage).toBe(1)
    expect(model.rows.find((row) => row.isClosest)?.snapshot).toBe(SNAPSHOTS[CLOSEST_INDEX])
  })

  it('clamps a page the filter has emptied rather than showing nothing', () => {
    const model = buildWaybackList({ ...base, page: 2, range: presetRange('all', CAPTURE_AT) })
    expect(model.page).toBe(2)
    const narrowed = buildWaybackList({
      ...base,
      page: 2,
      range: rangeFromDays(Date.parse(CAPTURE_AT), Date.parse(CAPTURE_AT))
    })
    expect(narrowed.page).toBe(0)
    expect(narrowed.rows).toHaveLength(1)
  })

  it('filters on the text the row shows: date, time, mime and status', () => {
    const withMime = [
      snap('2026-06-14T00:00:00.000Z', { mimeType: 'application/pdf', statusCode: 404 }),
      ...SNAPSHOTS
    ]
    const byMime = buildWaybackList({ ...base, snapshots: withMime, query: 'pdf' })
    expect(byMime.rows).toHaveLength(1)
    const byStatus = buildWaybackList({ ...base, snapshots: withMime, query: '404' })
    expect(byStatus.rows).toHaveLength(1)
    const byDate = buildWaybackList({ ...base, snapshots: withMime, query: 'jun 14' })
    expect(byDate.inRangeCount).toBe(2)
    const nothing = buildWaybackList({ ...base, snapshots: withMime, query: 'zzz' })
    expect(nothing.rows).toHaveLength(0)
    // Nothing survives the filter, so the Closest jump has nowhere to go.
    expect(nothing.closestPage).toBeNull()
  })

  it('reports no closest page when the range excludes the closest snapshot', () => {
    const early = rangeFromDays(
      Date.parse(SNAPSHOTS[0].timestamp),
      Date.parse(SNAPSHOTS[1].timestamp)
    )
    const model = buildWaybackList({ ...base, range: early })
    expect(model.inRangeCount).toBe(2)
    expect(model.closestPage).toBeNull()
  })

  it('drops a snapshot whose timestamp will not parse once a range is set', () => {
    const broken = { ...snap('2026-06-14T00:00:00.000Z'), timestamp: 'nonsense' }
    const model = buildWaybackList({
      ...base,
      snapshots: [broken, ...SNAPSHOTS],
      range: presetRange('capture-year', CAPTURE_AT)
    })
    expect(model.inRangeCount).toBe(14)
  })

  it('carries no closest row when the lookup reported no closest index', () => {
    const model = buildWaybackList({ ...base, closestIndex: null })
    expect(model.rows.some((row) => row.isClosest)).toBe(false)
    expect(model.closestPage).toBeNull()
  })
})

describe('summary and footer lines', () => {
  it('states the pre-lookup, empty and populated cases distinctly', () => {
    expect(
      summaryLine({ snapshots: [], closestIndex: null, captureTimestamp: CAPTURE_AT, hasResult: false })
    ).toBe('Not looked up yet')
    expect(
      summaryLine({ snapshots: [], closestIndex: null, captureTimestamp: CAPTURE_AT, hasResult: true })
    ).toBe('No snapshots found')
    expect(
      summaryLine({
        snapshots: SNAPSHOTS,
        closestIndex: CLOSEST_INDEX,
        captureTimestamp: CAPTURE_AT,
        hasResult: true
      })
    ).toBe('14 snapshots · closest 0m after capture')
    expect(
      summaryLine({
        snapshots: [SNAPSHOTS[0]],
        closestIndex: null,
        captureTimestamp: CAPTURE_AT,
        hasResult: true
      })
    ).toBe('1 snapshot')
  })

  it('counts the total, the filtered subset and the lookup age', () => {
    const now = Date.parse('2026-06-16T12:00:00.000Z')
    expect(
      footerLine({ totalCount: 14, inRangeCount: 4, checkedAt: '2026-06-16T11:58:00.000Z', now })
    ).toBe('14 snapshots total · 4 in range · checked 2 min ago')
    expect(footerLine({ totalCount: 1, inRangeCount: 1, checkedAt: null, now })).toBe(
      '1 snapshot total · 1 in range'
    )
  })

  it.each([
    ['2026-06-16T11:59:40.000Z', 'checked just now'],
    ['2026-06-16T11:30:00.000Z', 'checked 30 min ago'],
    ['2026-06-16T09:00:00.000Z', 'checked 3h ago'],
    ['2026-06-13T12:00:00.000Z', 'checked 3d ago']
  ])('ages %s as %s', (checkedAt, expected) => {
    expect(formatCheckedAgo(checkedAt, Date.parse('2026-06-16T12:00:00.000Z'))).toBe(expected)
  })

  it('says nothing about an unparseable lookup time', () => {
    expect(formatCheckedAgo('nope', Date.now())).toBeNull()
  })
})

describe('monthGrid', () => {
  const grid = monthGrid({
    year: 2026,
    month: 5,
    range: rangeFromDays(Date.UTC(2026, 5, 10), Date.UTC(2026, 5, 12)),
    captureTimestamp: CAPTURE_AT,
    pendingFromMs: Date.UTC(2026, 5, 10)
  })

  it('leads with blanks so the first day lands under its weekday', () => {
    // 1 June 2026 is a Monday, so exactly one leading blank.
    expect(grid.slice(0, 1).every((cell) => cell.day === null)).toBe(true)
    expect(grid[1].day).toBe(1)
    // June 2026 has 30 days and begins on a Monday.
    expect(grid).toHaveLength(30 + 1)
  })

  it('marks the days inside the range, the capture day and the pending endpoint', () => {
    const dayOf = (n: number) => grid.find((cell) => cell.day === n)!
    expect(dayOf(9).inRange).toBe(false)
    expect(dayOf(10).inRange).toBe(true)
    expect(dayOf(12).inRange).toBe(true)
    expect(dayOf(13).inRange).toBe(false)
    expect(dayOf(15).isCaptureDay).toBe(true)
    expect(dayOf(14).isCaptureDay).toBe(false)
    expect(dayOf(10).isEndpoint).toBe(true)
    expect(dayOf(11).isEndpoint).toBe(false)
  })

  it('marks nothing in range when there is no range, and no capture day for a bad timestamp', () => {
    const bare = monthGrid({
      year: 2026,
      month: 5,
      range: null,
      captureTimestamp: 'nonsense',
      pendingFromMs: null
    })
    expect(bare.some((cell) => cell.inRange)).toBe(false)
    expect(bare.some((cell) => cell.isCaptureDay)).toBe(false)
    expect(bare.some((cell) => cell.isEndpoint)).toBe(false)
  })
})
