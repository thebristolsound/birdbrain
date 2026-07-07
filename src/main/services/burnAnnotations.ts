import sharp from 'sharp'
import type { CaptureAnnotations } from '@shared/types'
import { renderAnnotationsSvg } from '@main/services/renderAnnotationsSvg'

export async function burnAnnotations(
  pngBuffer: Buffer,
  annotations: CaptureAnnotations
): Promise<Buffer> {
  if (annotations.shapes.length === 0) return pngBuffer
  const svg = renderAnnotationsSvg(
    annotations.shapes,
    annotations.imageWidth,
    annotations.imageHeight
  )
  return sharp(pngBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
}
