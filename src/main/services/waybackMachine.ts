import type { WaybackSnapshot, WaybackLookupResult } from '@shared/types'

export type { WaybackSnapshot, WaybackLookupResult }

// Wayback Machine corroboration lookup (#wayback).
//
// AFTER a capture is stored, the main process queries the Internet Archive CDX
// API for archive.org's own record of the captured URL. This is CORROBORATION,
// not binding: it reports whatever snapshots archive.org holds, independent of
// the captured transaction. The lookup is always user-initiated (it discloses
// the target URL to a third party) and never alters the capture hash chain.

const CDX_BASE = 'https://web.archive.org/cdx/search/cdx'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_LIMIT = 200

// CDX timestamps are 14-digit YYYYMMDDHHMMSS in UTC. Returns epoch ms, or NaN
// if the string is not a well-formed 14-digit timestamp.
function cdxTimestampToEpoch(ts: string): number {
  if (!/^\d{14}$/.test(ts)) return NaN
  const year = Number(ts.slice(0, 4))
  const month = Number(ts.slice(4, 6))
  const day = Number(ts.slice(6, 8))
  const hour = Number(ts.slice(8, 10))
  const minute = Number(ts.slice(10, 12))
  const second = Number(ts.slice(12, 14))
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

function buildCdxUrl(url: string, limit: number): string {
  const params = new URLSearchParams({
    url,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype,digest,length',
    filter: 'statuscode:200',
    collapse: 'digest',
    limit: String(limit)
  })
  return `${CDX_BASE}?${params.toString()}`
}

export async function lookupSnapshots(
  url: string,
  captureTimestamp: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; limit?: number } = {}
): Promise<WaybackLookupResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const limit = options.limit ?? DEFAULT_LIMIT
  const checkedAt = new Date().toISOString()

  const res = await fetchImpl(buildCdxUrl(url, limit), {
    // Bound the wait: undici's default header timeout is multi-minute and would
    // hang the UI on a stalled archive.org. On abort this rejects and the
    // renderer shows the error state.
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) {
    throw new Error(`Wayback CDX responded ${res.status} ${res.statusText}`)
  }

  const rows = (await res.json()) as unknown
  // CDX returns [] for no results, or [header, ...dataRows] otherwise.
  if (!Array.isArray(rows) || rows.length <= 1) {
    return { snapshots: [], closestIndex: null, checkedAt }
  }

  const snapshots: WaybackSnapshot[] = []
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row)) continue
    const [ts, original, statuscode, mimetype, digest] = row as string[]
    const epoch = cdxTimestampToEpoch(ts)
    if (Number.isNaN(epoch) || !original) continue
    const statusNum = Number(statuscode)
    snapshots.push({
      timestamp: new Date(epoch).toISOString(),
      snapshotUrl: `https://web.archive.org/web/${ts}/${original}`,
      originalUrl: original,
      statusCode: Number.isFinite(statusNum) ? statusNum : undefined,
      mimeType: mimetype || undefined,
      digest: digest || undefined
    })
  }

  return { snapshots, closestIndex: closestIndexTo(snapshots, captureTimestamp), checkedAt }
}

function closestIndexTo(snapshots: WaybackSnapshot[], captureTimestamp: string): number | null {
  if (snapshots.length === 0) return null
  const target = Date.parse(captureTimestamp)
  if (Number.isNaN(target)) return 0
  let best = 0
  let bestDelta = Infinity
  snapshots.forEach((snap, i) => {
    const delta = Math.abs(Date.parse(snap.timestamp) - target)
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  })
  return best
}
