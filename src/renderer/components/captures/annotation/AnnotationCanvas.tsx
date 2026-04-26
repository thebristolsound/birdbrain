import { Stage, Layer, Image as KonvaImage, Text } from 'react-konva'
import useImage from 'use-image'
import { useCallback } from 'react'
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
  onDraftExtend?: (patch: Partial<Omit<AnnotationShape, 'kind' | 'id'>>) => void
  onDraftCommit?: () => void
  onPinDrop?: (x: number, y: number) => void
  onPinClick?: (pinId: string) => void
  containerWidth: number
  containerHeight: number
  scale: number
  panX: number
  panY: number
  onZoomAt?: (deltaUserScale: number, cursorX: number, cursorY: number) => void
  onPan?: (dx: number, dy: number) => void
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
    containerHeight,
    scale,
    panX,
    panY,
    onZoomAt,
    onPan
  } = props
  const [image, imageStatus] = useImage(imageUrl)

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = e.target.getStage()
      if (!stage) return
      const pos = stage.getPointerPosition()
      if (!pos) return
      if (e.evt.ctrlKey || e.evt.metaKey) {
        const delta = Math.pow(1.1, -e.evt.deltaY / 100)
        onZoomAt?.(delta, pos.x, pos.y)
      } else if (e.evt.shiftKey) {
        onPan?.(-e.evt.deltaY, 0)
      } else {
        onPan?.(-e.evt.deltaX, -e.evt.deltaY)
      }
    },
    [onZoomAt, onPan]
  )

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      if (!stage) return
      if (e.target !== stage) return
      onSelect?.(null)
      if (!editable) return
      const pos = stage.getRelativePointerPosition()
      if (!pos) return
      const x = pos.x
      const y = pos.y
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
    },
    [editable, tool, color, strokeWidth, onSelect, onDraftBegin, onPinDrop]
  )

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!editable || !draft) return
      const stage = e.target.getStage()
      if (!stage) return
      const pos = stage.getRelativePointerPosition()
      if (!pos) return
      const x = pos.x
      const y = pos.y
      if (draft.kind === 'arrow') {
        onDraftExtend?.({ x2: x, y2: y })
      } else if (draft.kind === 'rect' || draft.kind === 'highlight' || draft.kind === 'redact') {
        onDraftExtend?.({ w: x - draft.x, h: y - draft.y })
      }
    },
    [editable, draft, onDraftExtend]
  )

  const handleMouseUp = useCallback(() => {
    if (!editable || !draft) return
    onDraftCommit?.()
  }, [editable, draft, onDraftCommit])

  const allShapes = draft ? [...shapes, draft] : shapes
  const redacts = allShapes.filter((s) => s.kind === 'redact')
  const markup = allShapes.filter(
    (s) => s.kind === 'rect' || s.kind === 'highlight' || s.kind === 'arrow'
  )
  const pins = allShapes.filter((s) => s.kind === 'pin')

  return (
    <Stage
      width={containerWidth}
      height={containerHeight}
      scaleX={scale}
      scaleY={scale}
      x={panX}
      y={panY}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
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
