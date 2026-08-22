const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' })

const ABSOLUTE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
})

// Pinned to UTC for the same reason ABSOLUTE_FMT is: this string is the hover
// disclosure on an evidence row, so it must not read differently depending on
// where the machine happens to be. The ` UTC` suffix says which zone it is.
const FULL_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC'
})

export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const diffMs = nowMs - ts
  if (diffMs < 60_000) return 'just now'
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 60) return rtf.format(-diffMin, 'minute')
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return rtf.format(-diffHr, 'hour')
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return rtf.format(-diffDay, 'day')
  return ABSOLUTE_FMT.format(ts)
}

/**
 * The compact ladder the list view uses: `now` / `5m` / `3h` / `2d` / `1w`.
 * Deliberately terse — it sits in a 38px column beside a 9px clock icon.
 */
export function formatRelativeTimeShort(iso: string, nowMs: number = Date.now()): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const diffMs = nowMs - ts
  if (diffMs < 60_000) return 'now'
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return `${Math.floor(diffDay / 7)}w`
}

/** The unabbreviated capture time, for the hover title behind a relative one. */
export function formatCaptureTimestampFull(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  return `${FULL_FMT.format(ts)} UTC`
}
