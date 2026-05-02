const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' })

const ABSOLUTE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
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
