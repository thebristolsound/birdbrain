import { Rect } from 'react-konva'
import { forwardRef } from 'react'
import type Konva from 'konva'
import type { AnnotationShape } from '@shared/types'

interface Props {
  shape: Extract<AnnotationShape, { kind: 'rect' | 'highlight' }>
  listening?: boolean
  onSelect?: () => void
  draggable?: boolean
  onChange?: (next: AnnotationShape) => void
}

export const RectShape = forwardRef<Konva.Rect, Props>(function RectShape(
  { shape, listening = true, onSelect, draggable = false, onChange },
  ref
) {
  if (shape.kind === 'highlight') {
    return (
      <Rect
        ref={ref}
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        fill={shape.color}
        opacity={0.4}
        listening={listening}
        draggable={draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          if (!onChange) return
          onChange({ ...shape, x: e.target.x(), y: e.target.y() })
        }}
      />
    )
  }
  return (
    <Rect
      ref={ref}
      x={shape.x}
      y={shape.y}
      width={shape.w}
      height={shape.h}
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      fill={shape.fill}
      listening={listening}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        if (!onChange) return
        onChange({ ...shape, x: e.target.x(), y: e.target.y() })
      }}
    />
  )
})
