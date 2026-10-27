import { lookupSnapshots } from '@main/services/waybackMachine'
import type { WaybackLinkLookupResult } from '@shared/ipc'
import { WAYBACK_LINK_LOOKUP_LIMIT } from '@shared/wayback'

/**
 * Looks up one link of a stored page (#1737), ranked against the time that page was
 * captured. `lookupSnapshots` returns only the rows it could read, so the response is
 * counted here on its way through: the count of versions is a minimum when archive.org
 * returned as many rows as were asked for, or when a row was dropped as malformed.
 * `fetchImpl` is the only route out; the caller passes the Egress-following fetch.
 */
export async function lookupLinkSnapshots(
  url: string,
  pageCapturedAt: string,
  fetchImpl: typeof fetch
): Promise<WaybackLinkLookupResult> {
  let rowsReturned = 0
  const counting: typeof fetch = async (input, init) => {
    const res = await fetchImpl(input, init)
    if (res.ok) {
      const rows: unknown = await res
        .clone()
        .json()
        .catch(() => null)
      // CDX returns [] for no results, or [header, ...dataRows] otherwise.
      if (Array.isArray(rows)) rowsReturned = Math.max(0, rows.length - 1)
    }
    return res
  }
  const result = await lookupSnapshots(url, pageCapturedAt, {
    fetchImpl: counting,
    limit: WAYBACK_LINK_LOOKUP_LIMIT
  })
  const countIsMinimum =
    rowsReturned >= WAYBACK_LINK_LOOKUP_LIMIT || rowsReturned > result.snapshots.length
  return { ...result, countIsMinimum }
}
