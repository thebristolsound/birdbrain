import { describe, it, expect } from 'vitest'
import {
  dimOpacity,
  isRectVisible,
  markLayout,
  rectMoved,
  screenLayout,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  TOOLTIP_WIDTH
} from '@renderer/components/onboarding/tourGeometry'

const VIEWPORT = { width: 1280, height: 800 }

describe('markLayout', () => {
  it('inflates the ring four pixels past the target on every side', () => {
    const { ring } = markLayout({ top: 100, left: 200, width: 120, height: 40 }, VIEWPORT)
    expect(ring).toEqual({ top: 96, left: 196, width: 128, height: 48 })
  })

  it("hangs the badge off the target's top-right corner", () => {
    const { badge } = markLayout({ top: 100, left: 200, width: 120, height: 40 }, VIEWPORT)
    expect(badge).toEqual({ top: 87, left: 315 })
  })

  it('sits the tooltip below a target with room under it', () => {
    const { tooltip, arrow } = markLayout(
      { top: 100, left: 200, width: 120, height: 40 },
      VIEWPORT
    )
    expect(tooltip.top).toBe(150)
    expect(tooltip.flipped).toBe(false)
    expect(arrow.below).toBe(true)
  })

  it('flips above a target too close to the bottom edge', () => {
    const { tooltip, arrow } = markLayout(
      { top: 600, left: 200, width: 120, height: 40 },
      VIEWPORT
    )
    expect(tooltip.top).toBe(590)
    expect(tooltip.flipped).toBe(true)
    expect(arrow.below).toBe(false)
  })

  it('flips at exactly the clearance boundary', () => {
    const justFits = markLayout({ top: 500, left: 0, width: 10, height: 49 }, VIEWPORT)
    const justDoesNot = markLayout({ top: 500, left: 0, width: 10, height: 50 }, VIEWPORT)
    expect(justFits.tooltip.flipped).toBe(false)
    expect(justDoesNot.tooltip.flipped).toBe(true)
  })

  it('clamps the tooltip inside the left edge', () => {
    const { tooltip } = markLayout({ top: 100, left: 2, width: 40, height: 20 }, VIEWPORT)
    expect(tooltip.left).toBe(12)
  })

  it('clamps the tooltip inside the right edge', () => {
    const { tooltip } = markLayout({ top: 100, left: 1260, width: 20, height: 20 }, VIEWPORT)
    expect(tooltip.left).toBe(VIEWPORT.width - TOOLTIP_WIDTH - 16)
  })

  it('keeps the arrow pointing at the target after the tooltip is clamped', () => {
    const rect = { top: 100, left: 2, width: 40, height: 20 }
    const { tooltip, arrow } = markLayout(rect, VIEWPORT)
    expect(arrow.marginLeft).toBe(Math.max(rect.left - tooltip.left + 14, 12))
  })

  it('clamps the arrow inside the tooltip at both ends', () => {
    const farLeft = markLayout({ top: 100, left: 0, width: 10, height: 10 }, VIEWPORT)
    expect(farLeft.arrow.marginLeft).toBe(12)
    const wide = markLayout({ top: 100, left: 400, width: 900, height: 10 }, VIEWPORT)
    expect(wide.arrow.marginLeft).toBeLessThanOrEqual(260)
    expect(wide.arrow.marginLeft).toBeGreaterThanOrEqual(12)
  })

  it('never clamps the tooltip off-screen on a viewport narrower than it is', () => {
    const { tooltip } = markLayout(
      { top: 10, left: 0, width: 10, height: 10 },
      { width: 200, height: 400 }
    )
    expect(tooltip.left).toBe(12)
  })
})

describe('screenLayout', () => {
  const rail = { top: 120, left: 4, width: 40, height: 40 }

  it('notches the card off the right of the rail button', () => {
    const layout = screenLayout(rail, VIEWPORT)
    expect(layout.card.left).toBe(62)
    expect(layout.card.top).toBe(84)
    expect(layout.notchTop).toBe(51)
    expect(layout.ring).toEqual({ top: 115, left: -1, width: 50, height: 50 })
  })

  it('keeps the card inside the top edge for a rail button near the top', () => {
    const layout = screenLayout({ ...rail, top: 0 }, VIEWPORT)
    expect(layout.card.top).toBe(12)
  })

  it('keeps the card inside the bottom edge for a rail button near the bottom', () => {
    const layout = screenLayout({ ...rail, top: 780 }, VIEWPORT)
    expect(layout.card.top).toBe(VIEWPORT.height - SCREEN_CARD_HEIGHT - 12)
  })

  // A slipped nav anchor is the failure the rest of the redesign makes likely.
  // The card centres rather than being drawn pointing at nothing.
  it('centres the card and drops the ring when the rail button is missing', () => {
    const layout = screenLayout(null, VIEWPORT)
    expect(layout.ring).toBeNull()
    expect(layout.card).toEqual({
      top: (VIEWPORT.height - SCREEN_CARD_HEIGHT) / 2,
      left: (VIEWPORT.width - SCREEN_CARD_WIDTH) / 2
    })
    expect(layout.notchTop).toBe(0)
  })

  it('does not push the card off a viewport shorter than the card', () => {
    const layout = screenLayout(rail, { width: 1280, height: 100 })
    expect(layout.card.top).toBe(12)
  })
})

describe('dimOpacity', () => {
  it('dims for the welcome card, which has nothing to spotlight', () => {
    expect(dimOpacity('welcome', false)).toBe(0.5)
  })

  it('leaves the dimming to the ring once an anchor is measured', () => {
    expect(dimOpacity('mark', true)).toBe(0)
    expect(dimOpacity('screen', true)).toBe(0)
  })

  it('falls back to a flat dim when there is no ring to do it', () => {
    expect(dimOpacity('mark', false)).toBe(0.38)
    expect(dimOpacity('screen', false)).toBe(0.45)
  })
})

describe('isRectVisible', () => {
  it('accepts an anchor inside the viewport', () => {
    expect(isRectVisible({ top: 100, left: 200, width: 120, height: 40 }, VIEWPORT)).toBe(true)
  })

  it('accepts an anchor only partly in view, which the flip rule still handles', () => {
    expect(isRectVisible({ top: 780, left: 0, width: 120, height: 40 }, VIEWPORT)).toBe(true)
    expect(isRectVisible({ top: -20, left: 0, width: 120, height: 40 }, VIEWPORT)).toBe(true)
  })

  // The extension banner sits below the fold on a dashboard with anything above
  // it, which is what took the tooltip off screen with it.
  it('rejects an anchor below the fold', () => {
    expect(isRectVisible({ top: 900, left: 200, width: 120, height: 40 }, VIEWPORT)).toBe(false)
  })

  it('rejects an anchor scrolled off the top or off either side', () => {
    expect(isRectVisible({ top: -60, left: 200, width: 120, height: 40 }, VIEWPORT)).toBe(false)
    expect(isRectVisible({ top: 100, left: 1400, width: 120, height: 40 }, VIEWPORT)).toBe(false)
    expect(isRectVisible({ top: 100, left: -200, width: 120, height: 40 }, VIEWPORT)).toBe(false)
  })

  // A hidden element measures all-zero, which this rejects; a zero-size element
  // at a real position is still on screen and gets its ring.
  it('rejects a hidden anchor', () => {
    expect(isRectVisible({ top: 0, left: 0, width: 0, height: 0 }, VIEWPORT)).toBe(false)
  })
})

describe('rectMoved', () => {
  const base = { top: 10, left: 10, width: 100, height: 20 }

  it('treats a first measurement as movement', () => {
    expect(rectMoved(null, base)).toBe(true)
  })

  it('ignores sub-pixel drift', () => {
    expect(rectMoved(base, { ...base, top: 10.5, left: 9.5 })).toBe(false)
  })

  it('reports movement on any edge', () => {
    expect(rectMoved(base, { ...base, top: 20 })).toBe(true)
    expect(rectMoved(base, { ...base, left: 20 })).toBe(true)
    expect(rectMoved(base, { ...base, width: 200 })).toBe(true)
    expect(rectMoved(base, { ...base, height: 40 })).toBe(true)
  })
})
