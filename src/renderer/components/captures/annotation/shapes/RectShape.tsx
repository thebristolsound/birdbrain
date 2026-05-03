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
  selected?: boolean
}

export const RectShape = forwardRef<Konva.Rect, Props>(function RectShape(
  { shape, listening = true, onSelect, draggable = false, onChange, selected = false },
  ref
) {
  if (shape.kind === 'highlight') {
    return (
      <>
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
        {selected && (
          <Rect
            x={shape.x - 2}
            y={shape.y - 2}
            width={shape.w + 4}
            height={shape.h + 4}
            stroke="#3b82f6"
            strokeWidth={1.5}
            dash={[4, 4]}
            listening={false}
          />
        )}
      </>
    )
  }
  return (
    <>
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
      {selected && (
        <Rect
          x={shape.x - 2}
          y={shape.y - 2}
          width={shape.w + 4}
          height={shape.h + 4}
          stroke="#3b82f6"
          strokeWidth={1.5}
          dash={[4, 4]}
          listening={false}
        />
      )}
    </>
  )
})
