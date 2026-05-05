import { Arrow, Line } from 'react-konva'
import { forwardRef } from 'react'
import type Konva from 'konva'
import type { AnnotationShape } from '@shared/types'

interface Props {
  shape: Extract<AnnotationShape, { kind: 'arrow' }>
  listening?: boolean
  onSelect?: () => void
  draggable?: boolean
  onChange?: (next: AnnotationShape) => void
  selected?: boolean
}

export const ArrowShape = forwardRef<Konva.Arrow, Props>(function ArrowShape(
  { shape, listening = true, onSelect, draggable = false, onChange, selected = false },
  ref
) {
  return (
    <>
      {selected && (
        <Line
          points={[shape.x1, shape.y1, shape.x2, shape.y2]}
          stroke="#3b82f6"
          strokeWidth={shape.strokeWidth + 4}
          opacity={0.4}
          listening={false}
          lineCap="round"
        />
      )}
      <Arrow
        ref={ref}
        x={0}
        y={0}
        points={[shape.x1, shape.y1, shape.x2, shape.y2]}
        stroke={shape.stroke}
        fill={shape.stroke}
        strokeWidth={shape.strokeWidth}
        pointerLength={Math.max(8, shape.strokeWidth * 4)}
        pointerWidth={Math.max(8, shape.strokeWidth * 4)}
        listening={listening}
        draggable={draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          if (!onChange) return
          const dx = e.target.x()
          const dy = e.target.y()
          e.target.position({ x: 0, y: 0 })
          onChange({
            ...shape,
            x1: shape.x1 + dx,
            y1: shape.y1 + dy,
            x2: shape.x2 + dx,
            y2: shape.y2 + dy
          })
        }}
      />
    </>
  )
})
