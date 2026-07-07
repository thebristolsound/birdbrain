import { Stage, Layer, Image as KonvaImage, Text } from 'react-konva'
import useImage from 'use-image'
import { useCallback, useRef } from 'react'
import type Konva from 'konva'
import type { AnnotationShape } from '@shared/types'
import type { AnnotationTool } from '@renderer/components/captures/annotation/useAnnotationEditor'
import { RectShape } from '@renderer/components/captures/annotation/shapes/RectShape'
import { ArrowShape } from '@renderer/components/captures/annotation/shapes/ArrowShape'
import { RedactShape } from '@renderer/components/captures/annotation/shapes/RedactShape'
import { PinShape } from '@renderer/components/captures/annotation/shapes/PinShape'

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
  onResetView?: () => void
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
    onPan,
    onResetView
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

  const panStateRef = useRef<{ x: number; y: number } | null>(null)

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      if (!stage) return
      const isMiddle = e.evt.button === 1
      const isHand = tool === 'hand'
      if (isMiddle || (isHand && e.evt.button === 0)) {
        e.evt.preventDefault()
        panStateRef.current = { x: e.evt.clientX, y: e.evt.clientY }
        return
      }
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
      if (panStateRef.current) {
        const dx = e.evt.clientX - panStateRef.current.x
        const dy = e.evt.clientY - panStateRef.current.y
        panStateRef.current = { x: e.evt.clientX, y: e.evt.clientY }
        onPan?.(dx, dy)
        return
      }
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
        const nextX = Math.min(draft.x, x)
        const nextY = Math.min(draft.y, y)
        onDraftExtend?.({
          x: nextX,
          y: nextY,
          w: Math.abs(x - draft.x),
          h: Math.abs(y - draft.y)
        })
      }
    },
    [editable, draft, onDraftExtend, onPan]
  )

  const handleMouseUp = useCallback(() => {
    if (panStateRef.current) {
      panStateRef.current = null
      return
    }
    if (!editable || !draft) return
    onDraftCommit?.()
  }, [editable, draft, onDraftCommit])

  const handleDblClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      if (!stage) return
      if (e.target !== stage) return
      onResetView?.()
    },
    [onResetView]
  )

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
      onDblClick={handleDblClick}
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
            selected={selectedId === s.id}
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
                selected={selectedId === s.id}
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
              selected={selectedId === s.id}
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
            selected={selectedId === s.id}
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
