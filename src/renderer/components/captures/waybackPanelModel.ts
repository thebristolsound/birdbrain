// Everything the Wayback slide-out decides before it renders anything: which
// snapshots the filter and the date range leave, how they page, how each row reads,
// and what the calendar grid looks like for a month. Kept out of the component so
// the branchy parts are unit-testable without a DOM, as captureColumns.ts is.
//
// All of it is client-side over the snapshot set the CDX lookup already returned.
// Filtering never re-queries archive.org: the lookup is the disclosure, and
// narrowing a list the operator already has must not make a second one.

import type { WaybackSnapshot } from '@shared/types'
import { formatSnapshotDelta } from '@shared/wayback'

/** Fixed width of the panel aside. The design gives it no resize handle. */
export const WAYBACK_PANEL_WIDTH_PX = 436

export const SNAPSHOTS_PER_PAGE = 6

const DAY_MS = 86_400_000

export type WaybackPresetId = 'all' | 'around-capture' | 'capture-year'

export const WAYBACK_PRESET_IDS: readonly WaybackPresetId[] = [
  'all',
  'around-capture',
  'capture-year'
]

export interface WaybackRange {
  fromMs: number
  toMs: number
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

export const DAY_OF_WEEK_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

/**
 * UTC throughout, and deliberately so: a snapshot list read in one timezone and
 * quoted in another is the kind of discrepancy that gets an exhibit argued about.
 * Every timestamp the panel prints carries UTC beside it.
 */
export function formatUtcDate(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const date = new Date(ms)
  return `${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

export function formatUtcTime(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS_LONG[month]} ${year}`
}

export function presetLabel(id: WaybackPresetId, captureTimestamp: string): string {
  if (id === 'all') return 'All time'
  if (id === 'around-capture') return '±30 days of capture'
  const captureMs = Date.parse(captureTimestamp)
  return Number.isNaN(captureMs) ? 'Capture year' : String(new Date(captureMs).getUTCFullYear())
}

/** The range a preset stands for, or null for "all time", which filters nothing. */
export function presetRange(id: WaybackPresetId, captureTimestamp: string): WaybackRange | null {
  const captureMs = Date.parse(captureTimestamp)
  if (id === 'all' || Number.isNaN(captureMs)) return null
  if (id === 'around-capture') {
    return { fromMs: captureMs - 30 * DAY_MS, toMs: captureMs + 30 * DAY_MS }
  }
  const year = new Date(captureMs).getUTCFullYear()
  return { fromMs: Date.UTC(year, 0, 1), toMs: Date.UTC(year, 11, 31, 23, 59, 59, 999) }
}

/** Inclusive whole-day range from two calendar picks, in either order. */
export function rangeFromDays(a: number, b: number): WaybackRange {
  const [first, second] = a <= b ? [a, b] : [b, a]
  return { fromMs: startOfUtcDay(first), toMs: startOfUtcDay(second) + DAY_MS - 1 }
}

export function formatRangeLabel(range: WaybackRange | null): string {
  if (!range) return 'All time'
  return `${formatUtcDate(new Date(range.fromMs).toISOString())} – ${formatUtcDate(
    new Date(range.toMs).toISOString()
  )}`
}

/**
 * The calendar footer's name for the range in force: the preset in words, or
 * the span itself once the operator has applied days of their own.
 */
export function calendarHint(input: {
  preset: WaybackPresetId
  customRange: WaybackRange | null
  captureTimestamp: string
}): string {
  const { preset, customRange, captureTimestamp } = input
  if (customRange) return `Range: ${formatRangeLabel(customRange)}`
  if (preset === 'all') return 'Range: all snapshots'
  if (preset === 'around-capture') return 'Range: capture date ± 30d'
  return `Range: ${presetLabel(preset, captureTimestamp).toLowerCase()}`
}

/** HTTP status band, used only to colour the row. Null when the CDX row had none. */
export type StatusBand = 'ok' | 'redirect' | 'error'

export function statusBand(statusCode: number | undefined): StatusBand | null {
  if (statusCode === undefined) return null
  if (statusCode < 300) return 'ok'
  if (statusCode < 400) return 'redirect'
  return 'error'
}

export interface WaybackRowView {
  snapshot: WaybackSnapshot
  /** Stable row key. The replay URL is unique per snapshot by construction. */
  key: string
  date: string
  time: string
  /** Interval to the capture, or null when either timestamp is unparseable. */
  delta: string | null
  isClosest: boolean
  band: StatusBand | null
}

export interface WaybackListModel {
  /** The current page's rows. */
  rows: WaybackRowView[]
  /** Clamped page index — a filter that shortens the list cannot strand the view. */
  page: number
  pageCount: number
  totalCount: number
  inRangeCount: number
  /** Page holding the closest snapshot after filtering; null when it is filtered out. */
  closestPage: number | null
}

export interface WaybackListInput {
  snapshots: WaybackSnapshot[]
  closestIndex: number | null
  captureTimestamp: string
  query: string
  range: WaybackRange | null
  page: number
}

export function buildWaybackList({
  snapshots,
  closestIndex,
  captureTimestamp,
  query,
  range,
  page
}: WaybackListInput): WaybackListModel {
  const closest = closestIndex !== null ? snapshots[closestIndex] : undefined
  const needle = query.trim().toLowerCase()

  const inRange = snapshots.filter((snapshot) => {
    const ms = Date.parse(snapshot.timestamp)
    if (range && (Number.isNaN(ms) || ms < range.fromMs || ms > range.toMs)) return false
    if (!needle) return true
    return searchableText(snapshot).includes(needle)
  })

  const pageCount = Math.max(1, Math.ceil(inRange.length / SNAPSHOTS_PER_PAGE))
  const clampedPage = Math.min(Math.max(page, 0), pageCount - 1)
  const start = clampedPage * SNAPSHOTS_PER_PAGE
  const closestPosition = closest ? inRange.indexOf(closest) : -1

  return {
    rows: inRange.slice(start, start + SNAPSHOTS_PER_PAGE).map((snapshot) => ({
      snapshot,
      key: snapshot.snapshotUrl,
      date: formatUtcDate(snapshot.timestamp),
      time: formatUtcTime(snapshot.timestamp),
      delta: formatSnapshotDelta(snapshot.timestamp, captureTimestamp),
      isClosest: snapshot === closest,
      band: statusBand(snapshot.statusCode)
    })),
    page: clampedPage,
    pageCount,
    totalCount: snapshots.length,
    inRangeCount: inRange.length,
    closestPage: closestPosition < 0 ? null : Math.floor(closestPosition / SNAPSHOTS_PER_PAGE)
  }
}

/** `12 snapshots · closest 2d 3h before capture`, or the state before a lookup. */
export function summaryLine(input: {
  snapshots: WaybackSnapshot[]
  closestIndex: number | null
  captureTimestamp: string
  hasResult: boolean
}): string {
  if (!input.hasResult) return 'Not looked up yet'
  const count = input.snapshots.length
  if (count === 0) return 'No snapshots found'
  const closest = input.closestIndex !== null ? input.snapshots[input.closestIndex] : undefined
  const delta = closest ? formatSnapshotDelta(closest.timestamp, input.captureTimestamp) : null
  const plural = count === 1 ? 'snapshot' : 'snapshots'
  return delta ? `${count} ${plural} · closest ${delta}` : `${count} ${plural}`
}

/** `12 snapshots total · 4 in range · checked 2 min ago`. */
export function footerLine(input: {
  totalCount: number
  inRangeCount: number
  checkedAt: string | null
  now: number
}): string {
  const head = `${input.totalCount} snapshot${input.totalCount === 1 ? '' : 's'} total · ${
    input.inRangeCount
  } in range`
  const checked = input.checkedAt ? formatCheckedAgo(input.checkedAt, input.now) : null
  return checked ? `${head} · ${checked}` : head
}

export function formatCheckedAgo(checkedAt: string, now: number): string | null {
  const ms = Date.parse(checkedAt)
  if (Number.isNaN(ms)) return null
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000)
  if (minutes < 1) return 'checked just now'
  if (minutes < 60) return `checked ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `checked ${hours}h ago`
  return `checked ${Math.floor(hours / 24)}d ago`
}

export interface CalendarDay {
  /** Day of the month, or null for a leading blank in the first week. */
  day: number | null
  /** Midnight UTC of this day, for range maths. Null for a blank. */
  ms: number | null
  inRange: boolean
  isCaptureDay: boolean
  isEndpoint: boolean
}

/**
 * A 7-column month grid, leading blanks included so the first day lands under its
 * weekday. Trailing blanks are not emitted — the grid is a wrap, not a fixed 42.
 */
export function monthGrid(input: {
  year: number
  month: number
  range: WaybackRange | null
  captureTimestamp: string
  pendingFromMs: number | null
}): CalendarDay[] {
  const firstMs = Date.UTC(input.year, input.month, 1)
  const lead = new Date(firstMs).getUTCDay()
  const daysInMonth = new Date(Date.UTC(input.year, input.month + 1, 0)).getUTCDate()
  const captureMs = Date.parse(input.captureTimestamp)
  const captureDayMs = Number.isNaN(captureMs) ? null : startOfUtcDay(captureMs)

  const cells: CalendarDay[] = []
  for (let i = 0; i < lead; i += 1) {
    cells.push({ day: null, ms: null, inRange: false, isCaptureDay: false, isEndpoint: false })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const ms = Date.UTC(input.year, input.month, day)
    cells.push({
      day,
      ms,
      inRange:
        input.range !== null && ms + DAY_MS - 1 >= input.range.fromMs && ms <= input.range.toMs,
      isCaptureDay: captureDayMs !== null && ms === captureDayMs,
      isEndpoint: input.pendingFromMs !== null && startOfUtcDay(input.pendingFromMs) === ms
    })
  }
  return cells
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
}

function startOfUtcDay(ms: number): number {
  const date = new Date(ms)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function searchableText(snapshot: WaybackSnapshot): string {
  return [
    formatUtcDate(snapshot.timestamp),
    formatUtcTime(snapshot.timestamp),
    snapshot.mimeType ?? '',
    snapshot.statusCode !== undefined ? String(snapshot.statusCode) : ''
  ]
    .join(' ')
    .toLowerCase()
}
