import type { WaybackLookupResult, WaybackSnapshot } from '@shared/types'
import { WAYBACK_LINK_LOOKUP_LIMIT, formatSnapshotDelta } from '@shared/wayback'

// The wording of a Wayback lookup for one link of a stored page (#1737, plan S1 and S6).
// The lookup asks for successful, digest-collapsed rows only, so an empty answer is "no
// successful snapshot", never "not archived", and the count is of distinct versions.

export const WAYBACK_LINK_DISCLOSURE_HINT = 'Looking up this link discloses it to archive.org.'

/** The snapshot closest to the stored page's capture time, else the newest, else null. */
export function closestLinkSnapshot(result: WaybackLookupResult): WaybackSnapshot | null {
  const { snapshots, closestIndex } = result
  return snapshots[closestIndex ?? snapshots.length - 1] ?? null
}

function versionCount(n: number): string {
  if (n >= WAYBACK_LINK_LOOKUP_LIMIT) return `${WAYBACK_LINK_LOOKUP_LIMIT} or more versions`
  return n === 1 ? '1 version' : `${n} versions`
}

/**
 * `12 versions, closest 3d before this page was captured`, or `No successful snapshot`.
 * The delta names the stored page as its reference point: the link's destination was
 * never captured, so "before capture" would name the wrong event.
 */
export function linkLookupSummary(result: WaybackLookupResult, pageCapturedAt: string): string {
  const { snapshots, closestIndex } = result
  if (snapshots.length === 0) return 'No successful snapshot'
  const count = versionCount(snapshots.length)
  const closest = closestIndex === null ? undefined : snapshots[closestIndex]
  const delta = closest
    ? formatSnapshotDelta(closest.timestamp, pageCapturedAt, 'this page was captured')
    : null
  return delta ? `${count}, closest ${delta}` : count
}
