import { Rect } from 'react-konva'
import { forwardRef } from 'react'
import type Konva from 'konva'
import type { AnnotationShape } from '@shared/types'

interface Props {
  shape: Extract<AnnotationShape, { kind: 'redact' }>
  listening?: boolean
  onSelect?: () => void
  draggable?: boolean
  onChange?: (next: AnnotationShape) => void
}

export const RedactShape = forwardRef<Konva.Rect, Props>(function RedactShape(
  { shape, listening = true, onSelect, draggable = false, onChange },
  ref
) {
  return (
    <Rect
      ref={ref}
      x={shape.x}
      y={shape.y}
      width={shape.w}
      height={shape.h}
      fill="#000"
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
