import { Stage, Layer, Image as KonvaImage, Text } from 'react-konva'
import useImage from 'use-image'
import { useMemo } from 'react'
import type Konva from 'konva'
import type { AnnotationShape } from '@shared/types'
import type { AnnotationTool } from './useAnnotationEditor'
import { RectShape } from './shapes/RectShape'
import { ArrowShape } from './shapes/ArrowShape'
import { RedactShape } from './shapes/RedactShape'
import { PinShape } from './shapes/PinShape'

interface Props {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  shapes: AnnotationShape[]
  draft: AnnotationShape | null
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onShapeChange?: (next: AnnotationShape) => void
  editable?: boolean
  tool?: AnnotationTool
  color?: string
  strokeWidth?: number
  onDraftBegin?: (shape: AnnotationShape) => void
  onDraftExtend?: (patch: Partial<AnnotationShape>) => void
  onDraftCommit?: () => void
  onPinDrop?: (x: number, y: number) => void
  onPinClick?: (pinId: string) => void
  containerWidth: number
  containerHeight: number
}

function uid(): string {
  return crypto.randomUUID()
}

export function AnnotationCanvas(props: Props) {
  const {
    imageUrl,
    imageWidth,
    imageHeight,
    shapes,
    draft,
    selectedId = null,
    onSelect,
    onShapeChange,
    editable = false,
    tool = 'select',
    color = '#ef4444',
    strokeWidth = 3,
    onDraftBegin,
    onDraftExtend,
    onDraftCommit,
    onPinDrop,
    onPinClick,
    containerWidth,
    containerHeight
  } = props
  const [image, imageStatus] = useImage(imageUrl)

  const scale = useMemo(() => {
    if (!imageWidth || !imageHeight || !containerWidth || !containerHeight) return 1
    return Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
  }, [containerWidth, containerHeight, imageWidth, imageHeight])

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    if (e.target !== stage) return
    onSelect?.(null)
    if (!editable) return
    const pos = stage.getPointerPosition()
    if (!pos) return
    const x = pos.x / scale
    const y = pos.y / scale
    if (tool === 'pin') {
      onPinDrop?.(x, y)
      return
    }
    if (tool === 'rect') {
      onDraftBegin?.({
        kind: 'rect',
        id: uid(),
        x,
        y,
        w: 0,
        h: 0,
        stroke: color,
        strokeWidth
      })
    } else if (tool === 'highlight') {
      onDraftBegin?.({ kind: 'highlight', id: uid(), x, y, w: 0, h: 0, color })
    } else if (tool === 'redact') {
      onDraftBegin?.({ kind: 'redact', id: uid(), x, y, w: 0, h: 0, mode: 'solid' })
    } else if (tool === 'arrow') {
      onDraftBegin?.({
        kind: 'arrow',
        id: uid(),
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        stroke: color,
        strokeWidth
      })
    }
  }

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!editable || !draft) return
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getPointerPosition()
    if (!pos) return
    const x = pos.x / scale
    const y = pos.y / scale
    if (draft.kind === 'arrow') {
      onDraftExtend?.({ x2: x, y2: y })
    } else if (draft.kind === 'rect' || draft.kind === 'highlight' || draft.kind === 'redact') {
      onDraftExtend?.({ w: x - draft.x, h: y - draft.y })
    }
  }

  const handleMouseUp = () => {
    if (!editable || !draft) return
    onDraftCommit?.()
  }

  const allShapes = draft ? [...shapes, draft] : shapes
  const redacts = allShapes.filter((s) => s.kind === 'redact')
  const markup = allShapes.filter(
    (s) => s.kind === 'rect' || s.kind === 'highlight' || s.kind === 'arrow'
  )
  const pins = allShapes.filter((s) => s.kind === 'pin')

  return (
    <Stage
      width={imageWidth * scale}
      height={imageHeight * scale}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <Layer listening={false}>
        {image && <KonvaImage image={image} x={0} y={0} width={imageWidth} height={imageHeight} />}
        {imageStatus === 'failed' && (
          <Text
            text="Failed to load image"
            x={0}
            y={imageHeight / 2 - 10}
            width={imageWidth}
            align="center"
            fontSize={20}
            fill="#ef4444"
          />
        )}
      </Layer>
      <Layer>
        {redacts.map((s) => (
          <RedactShape
            key={s.id}
            shape={s as Extract<AnnotationShape, { kind: 'redact' }>}
            listening={editable}
            draggable={editable && selectedId === s.id}
            onSelect={() => onSelect?.(s.id)}
            onChange={onShapeChange}
          />
        ))}
        {markup.map((s) => {
          if (s.kind === 'arrow') {
            return (
              <ArrowShape
                key={s.id}
                shape={s}
                listening={editable}
                draggable={editable && selectedId === s.id}
                onSelect={() => onSelect?.(s.id)}
                onChange={onShapeChange}
              />
            )
          }
          return (
            <RectShape
              key={s.id}
              shape={s}
              listening={editable}
              draggable={editable && selectedId === s.id}
              onSelect={() => onSelect?.(s.id)}
              onChange={onShapeChange}
            />
          )
        })}
        {pins.map((s) => (
          <PinShape
            key={s.id}
            shape={s as Extract<AnnotationShape, { kind: 'pin' }>}
            listening={true}
            draggable={editable && selectedId === s.id}
            onSelect={() => {
              onSelect?.(s.id)
              if (s.kind === 'pin') onPinClick?.(s.pinId)
            }}
            onChange={onShapeChange}
          />
        ))}
      </Layer>
    </Stage>
  )
}
