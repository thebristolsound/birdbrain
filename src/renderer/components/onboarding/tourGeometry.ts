/**
 * Coach-mark layout maths (#404).
 *
 * Every number the tour paints is computed here, from a measured rect and the
 * viewport, with no DOM access of its own. That keeps the flip rule, the edge
 * clamps and the missing-anchor fallback testable as arithmetic instead of as
 * screenshots.
 */

export interface TourRect {
  top: number
  left: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

export const TOOLTIP_WIDTH = 296
export const SCREEN_CARD_WIDTH = 400
export const SCREEN_CARD_HEIGHT = 190

/** Space the tooltip needs below the target before it stops flipping above it. */
const FLIP_CLEARANCE = 250
/** Gap between the target and the tooltip. */
const TOOLTIP_GAP = 10
/** How far the ring is inflated past the target on each side. */
const RING_INSET = 4
/** How far the screen card's nav ring is inflated past the rail button. */
const NAV_RING_INSET = 5
const VIEWPORT_MARGIN = 12

export interface MarkLayout {
  ring: TourRect
  badge: { top: number; left: number }
  tooltip: { top: number; left: number; flipped: boolean }
  arrow: { below: boolean; marginLeft: number }
}

/**
 * Ring, badge, tooltip and arrow for one coach mark.
 *
 * The tooltip sits below the target when there is room for it and flips above
 * when there is not; `flipped` means the caller must pull it up by its own
 * height, which is the only part of the position that cannot be computed
 * without measuring the card.
 */
export function markLayout(rect: TourRect, viewport: Viewport): MarkLayout {
  const below = rect.top + rect.height + FLIP_CLEARANCE < viewport.height
  const left = clamp(
    rect.left - 8,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, viewport.width - TOOLTIP_WIDTH - VIEWPORT_MARGIN - 4)
  )
  return {
    ring: {
      top: rect.top - RING_INSET,
      left: rect.left - RING_INSET,
      width: rect.width + RING_INSET * 2,
      height: rect.height + RING_INSET * 2
    },
    badge: { top: rect.top - 13, left: rect.left + rect.width - 5 },
    tooltip: {
      top: below ? rect.top + rect.height + TOOLTIP_GAP : rect.top - TOOLTIP_GAP,
      left,
      flipped: !below
    },
    arrow: { below, marginLeft: clamp(rect.left - left + 14, VIEWPORT_MARGIN, 260) }
  }
}

export interface ScreenLayout {
  card: { top: number; left: number }
  /** Offset of the notch down the card's left edge. */
  notchTop: number
  ring: TourRect | null
}

/**
 * The screen card, notched off a sidebar rail button.
 *
 * With no rail button to anchor to — which is the state a slipped anchor leaves
 * — the card centres itself and the notch goes away, rather than being drawn
 * pointing at nothing.
 */
export function screenLayout(rect: TourRect | null, viewport: Viewport): ScreenLayout {
  if (!rect) {
    return {
      card: {
        top: (viewport.height - SCREEN_CARD_HEIGHT) / 2,
        left: (viewport.width - SCREEN_CARD_WIDTH) / 2
      },
      notchTop: 0,
      ring: null
    }
  }
  const top = clamp(
    rect.top + rect.height / 2 - 56,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, viewport.height - SCREEN_CARD_HEIGHT - VIEWPORT_MARGIN)
  )
  return {
    card: { top, left: rect.left + rect.width + 18 },
    notchTop: rect.top + rect.height / 2 - top - 5,
    ring: {
      top: rect.top - NAV_RING_INSET,
      left: rect.left - NAV_RING_INSET,
      width: rect.width + NAV_RING_INSET * 2,
      height: rect.height + NAV_RING_INSET * 2
    }
  }
}

/**
 * Opacity of the flat dim layer.
 *
 * Zero once a rect is measured, because the ring's 100vmax spread shadow is
 * doing the dimming and a second layer over it reads as a double dim. The other
 * two values are the fallbacks for the states that have no ring: the welcome
 * card, and an anchor the tour could not find.
 */
export function dimOpacity(kind: 'welcome' | 'mark' | 'screen', anchored: boolean): number {
  if (kind === 'welcome') return 0.5
  if (anchored) return 0
  return kind === 'screen' ? 0.45 : 0.38
}

/** Whether a re-measurement has moved enough to be worth re-rendering for. */
export function rectMoved(previous: TourRect | null, next: TourRect): boolean {
  if (!previous) return true
  return (
    Math.abs(previous.top - next.top) > 1 ||
    Math.abs(previous.left - next.left) > 1 ||
    Math.abs(previous.width - next.width) > 1 ||
    Math.abs(previous.height - next.height) > 1
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
