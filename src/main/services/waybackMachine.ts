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

// Converts an ISO 8601 timestamp to the CDX 14-digit YYYYMMDDHHMMSS (UTC) form.
// Returns null when the input is not a parseable date.
function isoToCdxTimestamp(iso: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

function buildCdxUrl(url: string, limit: number, captureTimestamp: string): string {
  const params = new URLSearchParams({
    url,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype,digest,length',
    filter: 'statuscode:200',
    collapse: 'digest',
    limit: String(limit)
  })
  // Ask the server to rank captures by proximity to the capture time so the
  // truly-closest snapshot is never truncated out of the first `limit` rows.
  // sort=closest requires matchType=exact and a `closest` target timestamp.
  const closest = isoToCdxTimestamp(captureTimestamp)
  if (closest) {
    params.set('matchType', 'exact')
    params.set('sort', 'closest')
    params.set('closest', closest)
  }
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

  const res = await fetchImpl(buildCdxUrl(url, limit, captureTimestamp), {
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

  // The CDX query is ranked by proximity (sort=closest), but the tab presents a
  // chronological timeline. Re-sort ascending by time for display; closestIndex
  // then points into that ordering.
  snapshots.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))

  return { snapshots, closestIndex: closestIndexTo(snapshots, captureTimestamp), checkedAt }
}

// Validates a snapshot + lookup time before persisting it as a pinned reference.
// The renderer supplies these over IPC, so we reject malformed or internally
// inconsistent input (a forged/garbage snapshotUrl, a non-ISO checkedAt) rather
// than trusting it blindly. This is shape validation only — it deliberately does
// NOT re-query archive.org, since a pin must never disclose the URL to a third
// party (the lookup that produced the snapshot was the user-initiated disclosure).
export function isPersistableSnapshot(snapshot: WaybackSnapshot, checkedAt: string): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false
  if (Number.isNaN(Date.parse(checkedAt))) return false
  if (Number.isNaN(Date.parse(snapshot.timestamp))) return false
  if (typeof snapshot.originalUrl !== 'string' || snapshot.originalUrl.length === 0) return false
  // snapshotUrl must be a well-formed web.archive.org replay URL whose embedded
  // 14-digit timestamp and original URL match the snapshot's own fields.
  const match = /^https:\/\/web\.archive\.org\/web\/(\d{14})\/(.+)$/.exec(snapshot.snapshotUrl ?? '')
  if (!match) return false
  const [, ts, original] = match
  if (original !== snapshot.originalUrl) return false
  return cdxTimestampToEpoch(ts) === Date.parse(snapshot.timestamp)
}

function closestIndexTo(snapshots: WaybackSnapshot[], captureTimestamp: string): number | null {
  if (snapshots.length === 0) return null
  const target = Date.parse(captureTimestamp)
  if (Number.isNaN(target)) return null
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
