import { Circle, Group, Text } from 'react-konva'
import type { AnnotationShape } from '@shared/types'

interface Props {
  shape: Extract<AnnotationShape, { kind: 'pin' }>
  listening?: boolean
  onSelect?: () => void
  draggable?: boolean
  onChange?: (next: AnnotationShape) => void
}

const RADIUS = 14

export function PinShape({
  shape,
  listening = true,
  onSelect,
  draggable = false,
  onChange
}: Props) {
  const label = shape.number > 0 ? String(shape.number) : '…'
  return (
    <Group
      x={shape.x}
      y={shape.y}
      listening={listening}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        if (!onChange) return
        onChange({ ...shape, x: e.target.x(), y: e.target.y() })
      }}
    >
      <Circle radius={RADIUS} fill="#ef4444" stroke="#fff" strokeWidth={2} />
      <Text
        text={label}
        fontSize={14}
        fontStyle="bold"
        fill="#fff"
        align="center"
        verticalAlign="middle"
        width={RADIUS * 2}
        height={RADIUS * 2}
        offsetX={RADIUS}
        offsetY={RADIUS}
      />
    </Group>
  )
}
