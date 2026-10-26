import { lookupSnapshots } from '@main/services/waybackMachine'
import type {
  WaybackLinkBatchResult,
  WaybackLinkBatchStop,
  WaybackLinkLookupResult
} from '@shared/ipc'
import type { EgressSetting, KnownEgress } from '@shared/types'
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

/**
 * The pause between two lookups of a batch (#1738, plan S4). archive.org publishes no
 * limit for the CDX API that this can cite. Measured 2026-10-26 over a direct connection:
 * six lookups shaped like the batch's (20 rows, sort=closest), each sent 2 s after the
 * previous answer, all answered 200 in 0.32 s to 1.79 s, with no Retry-After header. No
 * shorter pause was tried, so 2 s is the shortest pause seen to pass, not archive.org's
 * limit.
 */
export const WAYBACK_LINK_BATCH_PAUSE_MS = 2_000

/** The statuses that mean archive.org wants fewer requests: the batch stops on either. */
const THROTTLED = new Set([429, 503])

export type LinkBatchUpdate =
  | { url: string; state: 'checking' }
  | { url: string; state: 'answered'; result: WaybackLinkLookupResult }
  | { url: string; state: 'failed'; error: string }
  | { url: string; state: 'not-checked' }

export interface LinkBatchRun {
  urls: readonly string[]
  pageCapturedAt: string
  fetchImpl: typeof fetch
  signal: AbortSignal
  /** Read before each request: false stops the batch with nothing more sent. */
  routeHolds: () => boolean
  onUpdate: (update: LinkBatchUpdate) => void
  pauseMs?: number
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })
}

/**
 * Looks `urls` up one at a time, with a fixed pause between requests. A cancel takes
 * effect before the next request; a request already sent is answered and kept.
 */
export async function runLinkBatch({
  urls,
  pageCapturedAt,
  fetchImpl,
  signal,
  routeHolds,
  onUpdate,
  pauseMs = WAYBACK_LINK_BATCH_PAUSE_MS
}: LinkBatchRun): Promise<WaybackLinkBatchResult> {
  let answered = 0
  let failed = 0
  const finish = (
    stopped: WaybackLinkBatchStop | null,
    status?: number
  ): WaybackLinkBatchResult => ({
    answered,
    failed,
    notChecked: urls.length - answered - failed,
    stopped,
    ...(status === undefined ? {} : { status })
  })

  for (const [i, url] of urls.entries()) {
    if (i > 0) await pause(pauseMs, signal)
    if (signal.aborted) return finish('cancelled')
    if (!routeHolds()) return finish('route-changed')
    let throttled: number | undefined
    const watching: typeof fetch = async (input, init) => {
      const res = await fetchImpl(input, init)
      if (THROTTLED.has(res.status)) throttled = res.status
      return res
    }
    onUpdate({ url, state: 'checking' })
    try {
      const result = await lookupLinkSnapshots(url, pageCapturedAt, watching)
      answered += 1
      onUpdate({ url, state: 'answered', result })
    } catch (err) {
      if (throttled !== undefined) {
        onUpdate({ url, state: 'not-checked' })
        return finish('rate-limited', throttled)
      }
      failed += 1
      onUpdate({ url, state: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return finish(null)
}

/**
 * Whether the Egress setting still routes as the confirmed one did: the same kind and,
 * for a proxy, the same proxy. An unreadable setting never matches, so a batch fails
 * closed with it.
 */
export function egressRouteMatches(current: EgressSetting, confirmed: KnownEgress): boolean {
  if (current.kind === 'unavailable' || current.kind !== confirmed.kind) return false
  if (current.kind === 'direct' || confirmed.kind === 'direct') return true
  return current.proxyUrl === confirmed.proxyUrl
}
