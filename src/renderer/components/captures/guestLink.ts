// What a right-click or a hover in the stored-page guest reports, and the rules the
// link menu applies to it (#1708). Pure, so each rule has a known-answer test.

/** The fields of a guest `context-menu` the link menu reads. */
export interface GuestLinkHit {
  linkUrl: string
  linkText: string
  /** The image's address when the right-click hit one, else empty. */
  imageUrl: string
  selectionText: string
  /** Where Electron reports the right-click, in window coordinates (see MhtmlViewer). */
  x: number
  y: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function coordinate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Reads a `<webview>` `context-menu` event. Electron puts the data on
 * `event.params`, not on the event itself. Returns null when the right-click hit
 * nothing the menu acts on: no link, no image and no selection.
 */
export function readGuestContextMenu(event: unknown): GuestLinkHit | null {
  const params = (event as { params?: Record<string, unknown> } | null)?.params
  if (!params || typeof params !== 'object') return null
  const hit: GuestLinkHit = {
    linkUrl: text(params.linkURL),
    linkText: text(params.linkText).trim(),
    imageUrl: params.mediaType === 'image' ? text(params.srcURL) : '',
    selectionText: text(params.selectionText),
    x: coordinate(params.x),
    y: coordinate(params.y)
  }
  if (!hit.linkUrl && !hit.imageUrl && !hit.selectionText) return null
  return hit
}

function ipv4Class(host: string): string | null {
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return null
  }
  const [a, b] = octets
  if (a === 127) return 'a loopback address'
  if (a === 0) return 'an unspecified address'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return 'a private address'
  }
  if (a === 169 && b === 254) return 'a link-local address'
  return null
}

function ipv6Class(host: string): string | null {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (bare === '::1') return 'a loopback address'
  if (bare === '::') return 'an unspecified address'
  // `URL` writes an IPv4-mapped address as two hex groups: ::ffff:7f00:1.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare)
  if (mapped) {
    const high = parseInt(mapped[1], 16)
    const low = parseInt(mapped[2], 16)
    return ipv4Class(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  const first = parseInt(bare.split(':')[0] || '0', 16)
  if ((first & 0xfe00) === 0xfc00) return 'a private address'
  if ((first & 0xffc0) === 0xfe80) return 'a link-local address'
  return null
}

/**
 * Why Capture link is unavailable for a URL, or null when it is available (D9).
 * The page's author chose these URLs, so the menu refuses the ones that would aim
 * the background renderer at the Operator's own machine or network. Only literal
 * addresses are caught: a public name that resolves to a private address is not.
 */
export function captureLinkBlockReason(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Not a web address'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Not a web address'
  // A trailing dot names the same host: `localhost.` is localhost.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return 'Points at this computer'
  const kind = host.startsWith('[') ? ipv6Class(host) : ipv4Class(host)
  return kind ? `Points at ${kind}` : null
}

/** Shortens a string from the middle, keeping both ends, to at most `max` characters. */
export function middleTruncate(value: string, max: number): string {
  if (value.length <= max) return value
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  return `${value.slice(0, head)}…${value.slice(value.length - (keep - head))}`
}
