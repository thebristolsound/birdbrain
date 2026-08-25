import { describe, it, expect } from 'vitest'
import {
  selectionOverlayPosition,
  SELECTION_POPOVER_WIDTH
} from '@renderer/components/notes/selection/noteSelectionGeometry'

const host = {
  left: 100,
  top: 200,
  scrollLeft: 0,
  scrollTop: 0,
  clientWidth: 600
}

describe('selectionOverlayPosition', () => {
  it('expresses the selection in the host’s own coordinates, below the text', () => {
    expect(selectionOverlayPosition({ left: 140, bottom: 260 }, host)).toEqual({ x: 40, y: 68 })
  })

  it('adds the host’s scroll offsets, so a scrolled note still lands on the passage', () => {
    // The overlay is absolutely positioned inside the scrolling body, so the
    // viewport rect alone would drift by exactly the scroll distance.
    expect(
      selectionOverlayPosition(
        { left: 140, bottom: 260 },
        { ...host, scrollLeft: 15, scrollTop: 300 }
      )
    ).toEqual({ x: 55, y: 368 })
  })

  it('keeps the popover clear of the left edge', () => {
    expect(selectionOverlayPosition({ left: 100, bottom: 260 }, host).x).toBe(8)
    // A selection starting left of the host (a range that begins off-screen)
    // is pinned to the gutter rather than given a negative offset.
    expect(selectionOverlayPosition({ left: 20, bottom: 260 }, host).x).toBe(8)
  })

  it('pulls the popover in so its full width fits', () => {
    const rightmost = host.clientWidth - (SELECTION_POPOVER_WIDTH + 12)
    expect(selectionOverlayPosition({ left: 100 + 590, bottom: 260 }, host).x).toBe(rightmost)
  })

  it('falls back to the gutter when the host is narrower than the popover', () => {
    // The right-edge limit goes negative here. Clamping to it before flooring
    // is what stops the overlay being pushed off the LEFT side to avoid
    // overflowing the right.
    const narrow = { ...host, clientWidth: 200 }
    expect(selectionOverlayPosition({ left: 150, bottom: 260 }, narrow).x).toBe(8)
  })

  it('rounds to whole pixels', () => {
    expect(selectionOverlayPosition({ left: 140.6, bottom: 260.4 }, host)).toEqual({
      x: 41,
      y: 68
    })
  })
})
