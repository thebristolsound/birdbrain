import { describe, it, expect } from 'vitest'
import type { WaybackLookupResult, WaybackSnapshot } from '@shared/types'
import { formatSnapshotDelta } from '@shared/wayback'
import {
  closestLinkSnapshot,
  linkLookupSummary
} from '@renderer/components/captures/waybackLinkModel'

// #1737, plan S1 and S6: the answer for one link, worded as the 200-only, digest-collapsed
// result the lookup returns, against the time the stored page was captured.

const PAGE_AT = '2026-08-01T12:00:00.000Z'

function snap(timestamp: string): WaybackSnapshot {
  const ts = timestamp.replace(/[-:T]/g, '').slice(0, 14)
  return {
    timestamp,
    snapshotUrl: `https://web.archive.org/web/${ts}/https://elsewhere.example/a`,
    originalUrl: 'https://elsewhere.example/a',
    statusCode: 200
  }
}

function result(count: number, closestIndex: number | null = 0): WaybackLookupResult {
  const snapshots = Array.from({ length: count }, (_, i) =>
    snap(new Date(Date.parse('2026-07-29T12:00:00.000Z') + i * 3_600_000).toISOString())
  )
  return {
    snapshots,
    closestIndex: count ? closestIndex : null,
    checkedAt: '2026-10-26T00:00:00.000Z'
  }
}

describe('formatSnapshotDelta with a named reference point', () => {
  it('names the stored page rather than a capture of the link', () => {
    expect(formatSnapshotDelta('2026-07-29T12:00:00.000Z', PAGE_AT, 'this page was captured')).toBe(
      '3d before this page was captured'
    )
    expect(formatSnapshotDelta('2026-08-01T14:30:00.000Z', PAGE_AT, 'this page was captured')).toBe(
      '2h 30m after this page was captured'
    )
  })

  it('keeps the capture wording when no reference is named', () => {
    expect(formatSnapshotDelta('2026-07-29T12:00:00.000Z', PAGE_AT)).toBe('3d before capture')
  })
})

describe('linkLookupSummary', () => {
  it('says no successful snapshot, never not archived, for an empty answer', () => {
    expect(linkLookupSummary(result(0), PAGE_AT)).toBe('No successful snapshot')
  })

  it('counts versions, with the closest one against the stored page', () => {
    expect(linkLookupSummary(result(1), PAGE_AT)).toBe(
      '1 version, closest 3d before this page was captured'
    )
    expect(linkLookupSummary(result(12, 2), PAGE_AT)).toBe(
      '12 versions, closest 2d 22h before this page was captured'
    )
  })

  it('says 20 or more at the limit the lookup asks for', () => {
    expect(linkLookupSummary(result(19), PAGE_AT)).toMatch(/^19 versions, /)
    expect(linkLookupSummary(result(20), PAGE_AT)).toMatch(/^20 or more versions, closest /)
  })

  it('states the count alone when there is no closest snapshot to measure', () => {
    expect(linkLookupSummary(result(3, null), PAGE_AT)).toBe('3 versions')
    expect(linkLookupSummary(result(3), 'not-a-date')).toBe('3 versions')
  })
})

describe('closestLinkSnapshot', () => {
  it('picks the closest snapshot, else the newest, else none', () => {
    const answer = result(3, 1)
    expect(closestLinkSnapshot(answer)).toBe(answer.snapshots[1])
    const unranked = result(3, null)
    expect(closestLinkSnapshot(unranked)).toBe(unranked.snapshots[2])
    expect(closestLinkSnapshot(result(0))).toBeNull()
  })
})
