import type { WaybackLinkLookupResult } from '@shared/ipc'
import type { WaybackLookupResult, WaybackSnapshot } from '@shared/types'
import { formatSnapshotDelta } from '@shared/wayback'

// The wording of a Wayback lookup for one link of a stored page (#1737, plan S1 and S6).
// The lookup asks for successful rows only, so an empty answer is "no successful snapshot",
// never "not archived". archive.org collapses only adjacent rows with the same content, so
// the rows returned can repeat a version (A, B, A, B); the count is of distinct content
// fingerprints (the CDX digest) among them.

export const WAYBACK_LINK_DISCLOSURE_HINT = 'Looking up this link discloses it to archive.org.'

/** The snapshot closest to the stored page's capture time, else the newest, else null. */
export function closestLinkSnapshot(result: WaybackLookupResult): WaybackSnapshot | null {
  const { snapshots, closestIndex } = result
  return snapshots[closestIndex ?? snapshots.length - 1] ?? null
}

/** How many different contents the rows hold. A row with no digest counts as its own. */
export function distinctVersions(snapshots: readonly WaybackSnapshot[]): number {
  return new Set(snapshots.map(({ digest, snapshotUrl }) => digest ?? snapshotUrl)).size
}

function versionCount(n: number, countIsMinimum: boolean): string {
  const count = n === 1 ? '1 version' : `${n} different versions`
  return countIsMinimum ? `at least ${count}` : count
}

/**
 * `3 different versions, closest 3d before this page was captured`, `at least 2 different
 * versions, ...` when archive.org may hold more than the answer counts, or `No successful
 * snapshot`. The delta names the stored page as its reference point: the link's
 * destination was never captured, so "before capture" would name the wrong event.
 */
export function linkLookupSummary(result: WaybackLinkLookupResult, pageCapturedAt: string): string {
  const { snapshots, closestIndex, countIsMinimum } = result
  if (snapshots.length === 0) {
    // Rows came back but none could be read, so "no successful snapshot" would be false.
    return countIsMinimum ? 'No readable snapshot' : 'No successful snapshot'
  }
  const count = versionCount(distinctVersions(snapshots), countIsMinimum)
  const closest = closestIndex === null ? undefined : snapshots[closestIndex]
  const delta = closest
    ? formatSnapshotDelta(closest.timestamp, pageCapturedAt, 'this page was captured')
    : null
  return delta ? `${count}, closest ${delta}` : count
}
