import { Stage, Layer, Image as KonvaImage, Text } from 'react-konva'
import useImage from 'use-image'
import { useMemo } from 'react'
import type { AnnotationShape } from '@shared/types'
import { RectShape } from './shapes/RectShape'
import { ArrowShape } from './shapes/ArrowShape'
import { RedactShape } from './shapes/RedactShape'
import { PinShape } from './shapes/PinShape'

interface Props {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  shapes: AnnotationShape[]
  containerWidth: number
  containerHeight: number
  onPinClick?: (pinId: string) => void
}

export function AnnotationCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  shapes,
  containerWidth,
  containerHeight,
  onPinClick
}: Props) {
  const [image, imageStatus] = useImage(imageUrl)

  const scale = useMemo(() => {
    if (!imageWidth || !imageHeight || !containerWidth || !containerHeight) return 1
    return Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
  }, [containerWidth, containerHeight, imageWidth, imageHeight])

  const redacts = shapes.filter((s) => s.kind === 'redact')
  const markup = shapes.filter(
    (s) => s.kind === 'rect' || s.kind === 'highlight' || s.kind === 'arrow'
  )
  const pins = shapes.filter((s) => s.kind === 'pin')

  return (
    <Stage width={imageWidth * scale} height={imageHeight * scale} scaleX={scale} scaleY={scale}>
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
            listening={false}
          />
        ))}
        {markup.map((s) => {
          if (s.kind === 'arrow') return <ArrowShape key={s.id} shape={s} listening={false} />
          return <RectShape key={s.id} shape={s} listening={false} />
        })}
        {pins.map((s) => (
          <PinShape
            key={s.id}
            shape={s as Extract<AnnotationShape, { kind: 'pin' }>}
            listening={true}
            onSelect={() => {
              if (s.kind === 'pin') onPinClick?.(s.pinId)
            }}
          />
        ))}
      </Layer>
    </Stage>
  )
}
