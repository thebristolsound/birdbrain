/**
 * Where the selection bar and its confirm popover sit inside the editor.
 *
 * Pure, and separated from the hook that reads the DOM, because this is the
 * part with a right answer: the overlay is absolutely positioned inside the
 * scrolling editor body, so it has to be expressed in that element's own
 * coordinate space rather than the viewport's, or it drifts the moment the
 * note is long enough to scroll.
 *
 * Follows the standalone mock's `startSel` (2026-08-21 handoff, template
 * 15843-15851).
 */

/** Matches the confirm popover's fixed width in the mock (template 11423). */
export const SELECTION_POPOVER_WIDTH = 296

/** Kept clear of both editor edges so the popover never sits flush. */
const EDGE_GUTTER = 8

/** Gap between the bottom of the selected text and the top of the overlay. */
const BELOW_SELECTION_GAP = 8

/** Space left to the right of the popover, so it never touches the edge. */
const RIGHT_MARGIN = 12

export interface SelectionRect {
  left: number
  bottom: number
}

export interface SelectionHostBox {
  left: number
  top: number
  scrollLeft: number
  scrollTop: number
  clientWidth: number
}

export interface SelectionOverlayPosition {
  x: number
  y: number
}

export function selectionOverlayPosition(
  rect: SelectionRect,
  host: SelectionHostBox
): SelectionOverlayPosition {
  const rightmost = host.clientWidth - (SELECTION_POPOVER_WIDTH + RIGHT_MARGIN)
  const unclamped = rect.left - host.left + host.scrollLeft
  // Clamp before the floor, not after: on a host narrower than the popover the
  // right-edge limit goes negative, and taking it as the answer would push the
  // overlay off the left side to avoid overflowing the right.
  const clamped = unclamped > rightmost ? rightmost : unclamped
  return {
    x: Math.max(EDGE_GUTTER, Math.round(clamped)),
    y: Math.round(rect.bottom - host.top + host.scrollTop + BELOW_SELECTION_GAP)
  }
}
