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
