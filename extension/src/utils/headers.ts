// Normalizes Chrome webRequest responseHeaders into a deterministic
// Record<string, string>: keys are lowercased; values for a repeated header are
// joined with ', '. Determinism matters because these headers are anchored into
// the signed, hash-chained manifest — the same response must always yield the
// same bytes (canonicalStringify sorts keys, but value joining is on us).
export interface RawHeader {
  name: string
  value?: string
}

export function normalizeResponseHeaders(headers: RawHeader[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const h of headers) {
    if (!h || typeof h.name !== 'string') continue
    const key = h.name.toLowerCase()
    const value = typeof h.value === 'string' ? h.value : ''
    out[key] = key in out ? `${out[key]}, ${value}` : value
  }
  return out
}

// What the background worker caches for one tab's latest main-frame response.
export interface CachedResponse {
  url: string
  headers: Record<string, string>
  // Absent when webRequest reported no usable status — nothing is invented to
  // fill it.
  status?: number
}

// What a capture may attest about the response it is capturing (R7, #797).
// Both facts come from the SAME cached main-frame response and are handed over
// only when that response's URL is still the URL being captured, so a tab that
// navigated between onHeadersReceived and the capture contributes nothing
// rather than another page's status.
//
// The status is sent so the app can anchor it into the signed manifest entry
// instead of the constant 200 every capture request used to carry. A capture
// whose response was never seen — the extension started after the page loaded,
// or a same-document navigation served no new response — sends no status at
// all, and the app records the status as unknown. That is the honest reading:
// an absent status means this build could not observe one.
export interface CaptureResponseFacts {
  headers?: Record<string, string>
  httpStatus?: number
}

export function responseFactsForCapture(
  cached: CachedResponse | undefined,
  url: string
): CaptureResponseFacts {
  if (!cached || cached.url !== url) return {}
  const facts: CaptureResponseFacts = {}
  if (Object.keys(cached.headers).length > 0) facts.headers = cached.headers
  if (typeof cached.status === 'number' && Number.isInteger(cached.status)) {
    facts.httpStatus = cached.status
  }
  return facts
}
