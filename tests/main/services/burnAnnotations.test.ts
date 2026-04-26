import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { burnAnnotations } from '@main/services/burnAnnotations'
import type { CaptureAnnotations } from '@shared/types'

async function makeWhitePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  })
    .png()
    .toBuffer()
}

describe('burnAnnotations', () => {
  it('returns the original PNG unchanged when there are no shapes', async () => {
    const orig = await makeWhitePng(100, 100)
    const annotations: CaptureAnnotations = {
      captureId: 'cap-1',
      schemaVersion: 1,
      shapes: [],
      imageWidth: 100,
      imageHeight: 100,
      updatedAt: new Date().toISOString(),
      updatedBy: null
    }
    const out = await burnAnnotations(orig, annotations)
    const outRaw = await sharp(out).raw().toBuffer()
    const origRaw = await sharp(orig).raw().toBuffer()
    expect(outRaw.equals(origRaw)).toBe(true)
  })

  it('burns a redact rect as solid black pixels', async () => {
    const orig = await makeWhitePng(100, 100)
    const annotations: CaptureAnnotations = {
      captureId: 'cap-1',
      schemaVersion: 1,
      shapes: [{ kind: 'redact', id: 'r', x: 20, y: 20, w: 40, h: 40, mode: 'solid' }],
      imageWidth: 100,
      imageHeight: 100,
      updatedAt: new Date().toISOString(),
      updatedBy: null
    }
    const out = await burnAnnotations(orig, annotations)
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    const pixelAt = (x: number, y: number): [number, number, number] => {
      const idx = (y * info.width + x) * info.channels
      return [data[idx], data[idx + 1], data[idx + 2]]
    }
    expect(pixelAt(40, 40)).toEqual([0, 0, 0])
    expect(pixelAt(80, 80)).toEqual([255, 255, 255])
  })
})
