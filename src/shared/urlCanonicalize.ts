/**
 * Canonical URL identity for capture lookup (#392).
 *
 * Decides which Capture a Tag or Note binds to — and whether an extension
 * attach request acquires new bytes at all — so the rules are explicit and
 * deliberately conservative: two URLs are equated only when the difference
 * cannot change what the server sent.
 *
 * - Redirects are never followed. Canonicalization is pure string work on the
 *   final URL the browser landed on; the extension reports that post-redirect
 *   URL, and a redirect source never equals its target here.
 * - The fragment is dropped: it never reaches the server.
 * - Trailing slashes on the path are dropped (`/a/` equals `/a`); the root
 *   path stays `/`.
 * - Scheme and host are lowercased and the default port dropped (WHATWG URL
 *   parsing); embedded credentials are dropped.
 * - The query string is kept verbatim: parameter order and case can change
 *   the page, so reordering or dropping parameters could bind an annotation
 *   to a page the operator never saw.
 * - `http` and `https` stay distinct, and so do hosts (`www.` is not
 *   stripped) — same conservatism as above.
 *
 * Unparseable input canonicalizes to itself (trimmed), so a lookup degrades
 * to exact match rather than throwing; the wire schemas upstream only admit
 * http(s) URLs anyway.
 */
export function canonicalizeUrl(url: string): string {
  const trimmed = url.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return trimmed
  }
  const path = parsed.pathname.replace(/\/+$/, '') || '/'
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`
}

/** The capture fields URL resolution reads. Callers may carry more. */
export interface CaptureUrlCandidate {
  id: string
  url: string
  timestamp: string
}

/**
 * The Capture a URL resolves to among `candidates`, or null.
 *
 * Deterministic when several captures share the canonical URL: the most
 * recent wins — the page state the operator saw last — with ties broken by
 * the lexicographically greater id. Recency compares parsed instants, not
 * strings: the wire schema leaves the timestamp unconstrained, so an offset
 * form like `2026-01-01T00:30:00+01:00` must not out-rank a later `Z`
 * instant lexically. A timestamp that does not parse loses to one that does,
 * and two unparseable ones fall back to string order, so the answer is still
 * total and stable for any input.
 */
export function resolveCaptureForUrl<T extends CaptureUrlCandidate>(
  url: string,
  candidates: readonly T[]
): T | null {
  const target = canonicalizeUrl(url)
  let best: T | null = null
  for (const candidate of candidates) {
    if (canonicalizeUrl(candidate.url) !== target) continue
    if (best === null || moreRecent(candidate, best)) best = candidate
  }
  return best
}

/** Whether `a` out-ranks `b`: later instant, then string order, then id. */
function moreRecent(a: CaptureUrlCandidate, b: CaptureUrlCandidate): boolean {
  const instantA = Date.parse(a.timestamp)
  const instantB = Date.parse(b.timestamp)
  const parsesA = !Number.isNaN(instantA)
  const parsesB = !Number.isNaN(instantB)
  if (parsesA !== parsesB) return parsesA
  if (parsesA && parsesB && instantA !== instantB) return instantA > instantB
  if (!parsesA && a.timestamp !== b.timestamp) return a.timestamp > b.timestamp
  return a.id > b.id
}
