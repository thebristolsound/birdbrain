import type { CSSProperties } from 'react'
import type { AnnotationShape } from '@shared/types'

export type PinAnnotation = Extract<AnnotationShape, { kind: 'pin' }>

// The drawn pin's radius in image pixels. The popover offset reads it too, so
// the popover clears the pin at every zoom.
export const PIN_RADIUS = 14

// Half the popover's 224px width plus a margin, so it never hangs off an edge.
const POPOVER_HALF_WIDTH = 112
const POPOVER_EDGE = 8
// Past this share of the image height the popover opens above the pin.
const FLIP_ABOVE_AT = 0.55
const POPOVER_GAP = 6

export function isPin(shape: AnnotationShape): shape is PinAnnotation {
  return shape.kind === 'pin'
}

// The pin is drawn inside the zoomed Konva stage and the popover outside it,
// so the popover keeps its size at every zoom and only its anchor moves.
export function pinPopoverStyle(
  shape: PinAnnotation,
  view: { scale: number; panX: number; panY: number },
  imageHeight: number,
  containerWidth: number
): CSSProperties {
  const { scale, panX, panY } = view
  const x = shape.x * scale + panX
  const minX = POPOVER_HALF_WIDTH + POPOVER_EDGE
  const maxX = containerWidth - minX
  const left = maxX > minX ? Math.min(Math.max(x, minX), maxX) : x
  const offset = PIN_RADIUS * scale + POPOVER_GAP
  const above = shape.y > imageHeight * FLIP_ABOVE_AT
  return {
    left,
    top: shape.y * scale + panY,
    transform: above ? `translate(-50%, calc(-100% - ${offset}px))` : `translate(-50%, ${offset}px)`
  }
}
