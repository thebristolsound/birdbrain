import { describe, it, expect } from 'vitest'
import type { WaybackLinkLookupResult } from '@shared/ipc'
import type { WaybackSnapshot } from '@shared/types'
import { formatSnapshotDelta } from '@shared/wayback'
import {
  closestLinkSnapshot,
  distinctVersions,
  linkLookupSummary
} from '@renderer/components/captures/waybackLinkModel'

// #1737, plan S1 and S6: the answer for one link, worded as the successful rows the lookup
// returns, against the time the stored page was captured. archive.org collapses only
// adjacent identical rows, so versions are counted by distinct digest.

const PAGE_AT = '2026-08-01T12:00:00.000Z'

function snap(timestamp: string, digest: string): WaybackSnapshot {
  const ts = timestamp.replace(/[-:T]/g, '').slice(0, 14)
  return {
    timestamp,
    snapshotUrl: `https://web.archive.org/web/${ts}/https://elsewhere.example/a`,
    originalUrl: 'https://elsewhere.example/a',
    statusCode: 200,
    digest
  }
}

/** `digests` gives each row's content fingerprint, one row an hour from 3 days before. */
function answer(
  digests: string[],
  { closestIndex = 0 as number | null, countIsMinimum = false } = {}
): WaybackLinkLookupResult {
  const snapshots = digests.map((digest, i) =>
    snap(new Date(Date.parse('2026-07-29T12:00:00.000Z') + i * 3_600_000).toISOString(), digest)
  )
  return {
    snapshots,
    closestIndex: digests.length ? closestIndex : null,
    checkedAt: '2026-10-26T00:00:00.000Z',
    countIsMinimum
  }
}

function distinct(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `D${i}`)
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
    expect(linkLookupSummary(answer([]), PAGE_AT)).toBe('No successful snapshot')
  })

  it('does not claim no successful snapshot when rows came back unreadable', () => {
    expect(linkLookupSummary(answer([], { countIsMinimum: true }), PAGE_AT)).toBe(
      'No readable snapshot'
    )
  })

  it('counts different versions, with the closest one against the stored page', () => {
    expect(linkLookupSummary(answer(['A']), PAGE_AT)).toBe(
      '1 version, closest 3d before this page was captured'
    )
    expect(linkLookupSummary(answer(distinct(12), { closestIndex: 2 }), PAGE_AT)).toBe(
      '12 different versions, closest 2d 22h before this page was captured'
    )
  })

  // Ranked by closeness, a page that changed once around the capture alternates A, B, A, B,
  // and archive.org's adjacent-only collapse leaves every row.
  it('counts alternating rows of two contents as two versions', () => {
    expect(distinctVersions(answer(['A', 'B', 'A', 'B']).snapshots)).toBe(2)
    expect(linkLookupSummary(answer(['A', 'B', 'A', 'B']), PAGE_AT)).toMatch(
      /^2 different versions, closest /
    )
  })

  it('says at least when archive.org may hold more than the answer counts', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => (i % 2 ? 'B' : 'A'))
    expect(linkLookupSummary(answer(twenty, { countIsMinimum: true }), PAGE_AT)).toMatch(
      /^at least 2 different versions, closest /
    )
    expect(linkLookupSummary(answer(['A'], { countIsMinimum: true }), PAGE_AT)).toMatch(
      /^at least 1 version, closest /
    )
    expect(linkLookupSummary(answer(distinct(19)), PAGE_AT)).toMatch(/^19 different versions, /)
  })

  it('counts a row with no digest as a version of its own', () => {
    const { snapshots } = answer(['A', 'A'])
    expect(distinctVersions([...snapshots, { ...snapshots[0], digest: undefined }])).toBe(2)
  })

  it('states the count alone when there is no closest snapshot to measure', () => {
    expect(linkLookupSummary(answer(distinct(3), { closestIndex: null }), PAGE_AT)).toBe(
      '3 different versions'
    )
    expect(linkLookupSummary(answer(distinct(3)), 'not-a-date')).toBe('3 different versions')
  })
})

describe('closestLinkSnapshot', () => {
  it('picks the closest snapshot, else the newest, else none', () => {
    const ranked = answer(distinct(3), { closestIndex: 1 })
    expect(closestLinkSnapshot(ranked)).toBe(ranked.snapshots[1])
    const unranked = answer(distinct(3), { closestIndex: null })
    expect(closestLinkSnapshot(unranked)).toBe(unranked.snapshots[2])
    expect(closestLinkSnapshot(answer([]))).toBeNull()
  })
})
