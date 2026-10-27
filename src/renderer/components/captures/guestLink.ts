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

/** Shortens a string from the middle, keeping both ends, to at most `max` characters. */
export function middleTruncate(value: string, max: number): string {
  if (value.length <= max) return value
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  return `${value.slice(0, head)}…${value.slice(value.length - (keep - head))}`
}
