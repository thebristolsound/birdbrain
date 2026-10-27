// What a right-click or a hover in the stored-page guest reports, and the rules the
// link menu applies to it (#1708). Pure, so each rule has a known-answer test.

import type { GuestKeyModifier, GuestMouseButton } from '@shared/ipc'
import {
  canonicalizeUrl,
  resolveCaptureForUrl,
  type CaptureUrlCandidate
} from '@shared/urlCanonicalize'

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

/** A press or release in the guest, with the hover destination it happened on. */
export interface GuestPointer {
  /** The destination `update-target-url` last reported, or empty when on no link. */
  url: string
  button: GuestMouseButton | null
}

/**
 * The link a press and the release after it clicked, or null when they were not a
 * click on a link (#1735). A drag from one link to another, a release off the link,
 * a middle click and a click with a modifier key held are not plain clicks on one
 * link, so the viewer leaves them alone.
 */
export function classifyGuestClick(
  press: GuestPointer | null,
  release: GuestPointer & { modifiers: readonly GuestKeyModifier[] }
): string | null {
  if (!press || !press.url || press.url !== release.url) return null
  if (press.button !== 'left' || release.button !== 'left') return null
  return release.modifiers.length === 0 ? release.url : null
}

export type LinkClickOutcome =
  { kind: 'open'; captureId: string } | { kind: 'not-in-case'; url: string } | { kind: 'none' }

/**
 * What a click on a link to `url` does in the viewer of `viewed` (#1735, plan A2).
 * A web address the Case holds opens its newest Capture, the same lookup "Open
 * captured copy" uses. The viewed Capture's own address, a fragment of it, and any
 * scheme other than http(s) do nothing.
 */
export function linkClickOutcome(
  url: string,
  viewed: CaptureUrlCandidate | undefined,
  captures: readonly CaptureUrlCandidate[]
): LinkClickOutcome {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return { kind: 'none' }
  }
  if (protocol !== 'http:' && protocol !== 'https:') return { kind: 'none' }
  if (viewed && canonicalizeUrl(viewed.url) === canonicalizeUrl(url)) return { kind: 'none' }
  const held = resolveCaptureForUrl(url, captures)
  return held ? { kind: 'open', captureId: held.id } : { kind: 'not-in-case', url }
}
