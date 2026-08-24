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
 * recent wins — the page state the operator saw last — with equal timestamps
 * broken by the lexicographically greater id. Timestamps are compared as
 * strings; every producer writes ISO-8601 UTC, and even a malformed one still
 * yields a total order, so the answer is stable for any input.
 */
export function resolveCaptureForUrl<T extends CaptureUrlCandidate>(
  url: string,
  candidates: readonly T[]
): T | null {
  const target = canonicalizeUrl(url)
  let best: T | null = null
  for (const candidate of candidates) {
    if (canonicalizeUrl(candidate.url) !== target) continue
    if (
      best === null ||
      candidate.timestamp > best.timestamp ||
      (candidate.timestamp === best.timestamp && candidate.id > best.id)
    ) {
      best = candidate
    }
  }
  return best
}
