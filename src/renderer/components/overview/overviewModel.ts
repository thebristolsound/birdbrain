import type { Capture, Note, Selector } from '@shared/types'
import { CHART_SERIES } from '@renderer/lib/chartColors'

export const ACTIVITY_DAYS = 14
export const DAY_MS = 86_400_000

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function dayStartMs(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export interface ComputeInput {
  captures: Capture[]
  selectors: Selector[]
  notes: Note[]
  lastVisitAt: string | null
}

// `now` is injected (defaulting to wall-clock) so the 14-day bucketing is
// deterministic under test.
export function computeOverview(
  { captures, selectors, notes, lastVisitAt }: ComputeInput,
  now = Date.now()
) {
  const hostCounts = new Map<string, number>()
  const hostFirstSeen = new Map<string, string>()
  for (const cap of captures) {
    const host = hostOf(cap.url)
    if (!host) continue
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1)
    const seen = hostFirstSeen.get(host)
    if (!seen || cap.createdAt < seen) hostFirstSeen.set(host, cap.createdAt)
  }

  const sources = [...hostCounts.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((s, i) => ({ ...s, tone: CHART_SERIES[i % CHART_SERIES.length] }))

  let verified = 0
  let tampered = 0
  for (const cap of captures) {
    const st = cap.lastVerifiedStatus
    if (st === 'verified') verified++
    else if (st === 'tampered' || st === 'chain-broken' || st === 'missing') tampered++
  }
  const unverified = captures.length - verified - tampered

  const startOfToday = dayStartMs(now)
  const cutoffMs = lastVisitAt ? new Date(lastVisitAt).getTime() : null
  const counts = new Array(ACTIVITY_DAYS).fill(0)
  for (const cap of captures) {
    const t = new Date(cap.createdAt).getTime()
    if (Number.isNaN(t)) continue
    const fromToday = Math.floor((startOfToday - dayStartMs(t)) / DAY_MS)
    if (fromToday < 0 || fromToday >= ACTIVITY_DAYS) continue
    counts[ACTIVITY_DAYS - 1 - fromToday]++
  }
  const dayBuckets = counts.map((count, i) => {
    const dayStart = startOfToday - (ACTIVITY_DAYS - 1 - i) * DAY_MS
    return { count, fresh: cutoffMs != null && dayStart + DAY_MS > cutoffMs }
  })

  const recent = [...captures]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)

  const cutoff = lastVisitAt
  const newCaptures = cutoff ? captures.filter((c) => c.createdAt > cutoff).length : 0
  const newSelectors = cutoff ? selectors.filter((s) => s.createdAt > cutoff).length : 0
  const newNotes = cutoff ? notes.filter((n) => n.createdAt > cutoff).length : 0
  let newSources = 0
  if (cutoff) {
    for (const firstSeen of hostFirstSeen.values()) {
      if (firstSeen > cutoff) newSources++
    }
  }
  const deltas = {
    captures: newCaptures,
    sources: newSources,
    selectors: newSelectors,
    notes: newNotes
  }

  return {
    sourceCount: hostCounts.size,
    sources,
    verified,
    unverified,
    tampered,
    dayBuckets,
    recent,
    deltas,
    newCount: newCaptures + newSelectors + newNotes + newSources
  }
}
