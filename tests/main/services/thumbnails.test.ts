import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import sharp from 'sharp'
import { createCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import { getThumbnail, renderThumbnail, THUMB_WIDTH, THUMB_HEIGHT } from '@main/services/thumbnails'
import type { ThumbnailParameters } from '@main/services/thumbnails'

const WHITE = { r: 255, g: 255, b: 255 }
const RED = { r: 220, g: 30, b: 30 }
const BLUE = { r: 30, g: 30, b: 220 }
const NEAR_BLACK = { r: 12, g: 12, b: 12 }

type Rgb = { r: number; g: number; b: number }

// A PNG of `width`x`height` in `background`, with `bands` composited on top.
async function png(
  width: number,
  height: number,
  background: Rgb,
  bands: { top: number; height: number; colour: Rgb }[] = []
): Promise<Buffer> {
  const composite = await Promise.all(
    bands.map(async (band) => ({
      input: await sharp({
        create: { width, height: band.height, channels: 3, background: band.colour }
      })
        .png()
        .toBuffer(),
      top: band.top,
      left: 0
    }))
  )
  return sharp({ create: { width, height, channels: 3, background } })
    .composite(composite)
    .png()
    .toBuffer()
}

// A column of `width`x`height` in `colour`, composited at `left`.
async function column(
  page: Buffer,
  left: number,
  width: number,
  height: number,
  colour: Rgb
): Promise<Buffer> {
  const bar = await sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer()
  return sharp(page)
    .composite([{ input: bar, top: 0, left }])
    .png()
    .toBuffer()
}

// The RGB of one pixel of a rendered thumbnail.
async function pixelAt(jpeg: Buffer, x: number, y: number): Promise<Rgb> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * info.channels
  return { r: data[at], g: data[at + 1], b: data[at + 2] }
}

// JPEG at quality 75 shifts values, so colours are compared by nearest match
// rather than by equality.
function nearest(actual: Rgb, candidates: { name: string; rgb: Rgb }[]): string {
  const distance = (c: Rgb): number =>
    (actual.r - c.r) ** 2 + (actual.g - c.g) ** 2 + (actual.b - c.b) ** 2
  return candidates.reduce((best, c) => (distance(c.rgb) < distance(best.rgb) ? c : best)).name
}

describe('renderThumbnail', () => {
  it('renders the fixed box whatever shape the screenshot is', async () => {
    const { bytes: tall } = await renderThumbnail(await png(1280, 11200, WHITE))
    const { bytes: short } = await renderThumbnail(await png(1280, 260, WHITE))
    const { bytes: square } = await renderThumbnail(await png(600, 600, WHITE))

    for (const thumb of [tall, short, square]) {
      const meta = await sharp(thumb).metadata()
      expect({ width: meta.width, height: meta.height }).toEqual({
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT
      })
      expect(meta.format).toBe('jpeg')
    }
  })

  it('previews the top of a tall page, not an arbitrary mid-page band', async () => {
    // A 1280x11200 recapture whose first 2000px are the masthead.
    const page = await png(1280, 11200, WHITE, [{ top: 0, height: 2000, colour: RED }])

    const { bytes: thumb } = await renderThumbnail(page)

    // 11200px scaled by 160/1280 is 1400px, so the whole 120px box is masthead.
    const swatches = [
      { name: 'masthead', rgb: RED },
      { name: 'body', rgb: WHITE }
    ]
    expect(nearest(await pixelAt(thumb, 80, 4), swatches)).toBe('masthead')
    expect(nearest(await pixelAt(thumb, 80, THUMB_HEIGHT - 4), swatches)).toBe('masthead')
  })

  it('keeps the full page width on a short, wide screenshot (#470)', async () => {
    // What trimTrailingBackground leaves for a page like example.com: wide and
    // short. A cover fit scaled this to the box HEIGHT and cropped the width to
    // the centre, so the preview was a zoomed column of whatever sat mid-page.
    const base = await png(1280, 260, WHITE)
    const page = await column(base, 0, 120, 260, RED)
    const withRightEdge = await column(page, 1160, 120, 260, BLUE)

    const { bytes: thumb } = await renderThumbnail(withRightEdge)

    // 1280 scales to 160, so the left and right edge markers are 15px wide and
    // both inside the box. Under the cover fit neither survived.
    const swatches = [
      { name: 'left-edge', rgb: RED },
      { name: 'right-edge', rgb: BLUE },
      { name: 'body', rgb: WHITE }
    ]
    expect(nearest(await pixelAt(thumb, 4, 10), swatches)).toBe('left-edge')
    expect(nearest(await pixelAt(thumb, THUMB_WIDTH - 5, 10), swatches)).toBe('right-edge')
    expect(nearest(await pixelAt(thumb, 80, 10), swatches)).toBe('body')
  })

  it("pads a short page with the page's own background rather than white", async () => {
    // 1280x400 scales to 160x50, leaving 70 rows to fill. A dark page must not
    // gain a white band.
    const page = await png(1280, 400, NEAR_BLACK)

    const { bytes: thumb } = await renderThumbnail(page)

    const swatches = [
      { name: 'page', rgb: NEAR_BLACK },
      { name: 'white', rgb: WHITE }
    ]
    expect(nearest(await pixelAt(thumb, 80, THUMB_HEIGHT - 2), swatches)).toBe('page')
  })

  it('is byte-for-byte deterministic', async () => {
    // The backfill anchors these bytes in a signed derivation entry, so the
    // same parent screenshot has to keep producing the same thumbnail.
    const page = await png(1280, 2400, WHITE, [{ top: 0, height: 300, colour: BLUE }])

    const { bytes: first } = await renderThumbnail(page)
    const { bytes: second } = await renderThumbnail(page)

    expect(createHash('sha256').update(first).digest('hex')).toBe(
      createHash('sha256').update(second).digest('hex')
    )
  })
})

// The parameters `renderThumbnail` reports are what the backfill signs into a
// thumbnail's `derivation` entry (#1319), so each is checked against the bytes
// it describes rather than against a number written into the test.
describe('renderThumbnail parameters', () => {
  // The height sharp gives `screenshot` scaled to `width`, measured on its own.
  async function scaledHeightOf(screenshot: Buffer, width: number): Promise<number> {
    const { info } = await sharp(screenshot).resize({ width }).toBuffer({ resolveWithObject: true })
    return info.height
  }

  // Rebuilds a thumbnail from the screenshot and the recorded parameters alone.
  // Equal bytes mean nothing that shaped the output is missing from the record,
  // on this sharp and libvips build.
  async function fromParameters(screenshot: Buffer, p: ThumbnailParameters): Promise<Buffer> {
    const boxed = sharp(await sharp(screenshot).resize({ width: p.scaledWidth }).toBuffer())
    if (p.paddedRows > 0) {
      boxed.extend({ bottom: p.paddedRows, extendWith: p.padMethod })
    } else if (p.scaledHeight > p.outputHeight) {
      boxed.extract({ left: 0, top: 0, width: p.scaledWidth, height: p.outputHeight })
    }
    return boxed.jpeg({ quality: p.jpegQuality }).toBuffer()
  }

  const shapes = [
    { name: 'shorter than the box', width: 1280, height: 260 },
    { name: 'taller than the box', width: 1280, height: 2400 },
    { name: 'exactly the box height', width: 1280, height: 960 }
  ]

  for (const shape of shapes) {
    it(`records what produced a page ${shape.name}`, async () => {
      const page = await png(shape.width, shape.height, WHITE, [
        { top: 0, height: Math.floor(shape.height / 3), colour: BLUE }
      ])

      const { bytes, parameters } = await renderThumbnail(page)

      const output = await sharp(bytes).metadata()
      expect(parameters.outputWidth).toBe(output.width)
      expect(parameters.outputHeight).toBe(output.height)
      expect(parameters.scaledWidth).toBe(output.width)
      expect(parameters.scaledHeight).toBe(await scaledHeightOf(page, output.width))
      // Zero, never absent, when the scaled page fills the box.
      expect(parameters.paddedRows).toBe(Math.max(0, output.height - parameters.scaledHeight))
      expect(parameters.sharpVersion).toBe(sharp.versions.sharp)
      expect(parameters.libvipsVersion).toBe(sharp.versions.vips)
      expect((await fromParameters(page, parameters)).equals(bytes)).toBe(true)
    })
  }

  it('reports padded rows only for a page shorter than the box', async () => {
    const short = await renderThumbnail(await png(1280, 260, WHITE))
    const tall = await renderThumbnail(await png(1280, 2400, WHITE))
    const exact = await renderThumbnail(await png(1280, 960, WHITE))

    expect(short.parameters.paddedRows).toBeGreaterThan(0)
    expect(short.parameters.scaledHeight + short.parameters.paddedRows).toBe(
      short.parameters.outputHeight
    )
    expect(tall.parameters.scaledHeight).toBeGreaterThan(tall.parameters.outputHeight)
    expect(tall.parameters.paddedRows).toBe(0)
    expect(exact.parameters.scaledHeight).toBe(exact.parameters.outputHeight)
    expect(exact.parameters.paddedRows).toBe(0)
  })
})

describe('getThumbnail', () => {
  let tempDir: string
  let store: CaptureStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-thumbs-'))
    store = createCaptureStore({ getRoot: () => tempDir })
    mkdirSync(store.caseDir('case-1'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns null when there is no screenshot to render from', async () => {
    expect(await getThumbnail('case-1', 'cap-1', store)).toBeNull()
    expect(existsSync(store.thumbnailPaths('case-1', 'cap-1').abs)).toBe(false)
  })

  it('renders from the screenshot and caches the result on disk', async () => {
    store.writeScreenshot('case-1', 'cap-1', await png(1280, 2400, WHITE))

    const thumb = await getThumbnail('case-1', 'cap-1', store)

    const onDisk = readFileSync(store.thumbnailPaths('case-1', 'cap-1').abs)
    expect(thumb?.toString('base64')).toBe(onDisk.toString('base64'))
    const meta = await sharp(onDisk).metadata()
    expect({ width: meta.width, height: meta.height }).toEqual({
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT
    })
  })

  it('serves the cached thumbnail without re-rendering', async () => {
    store.writeScreenshot('case-1', 'cap-1', await png(1280, 2400, WHITE))
    store.writeThumbnail('case-1', 'cap-1', Buffer.from('already on disk'))

    const thumb = await getThumbnail('case-1', 'cap-1', store)

    expect(thumb?.toString()).toBe('already on disk')
  })

  it('returns null and does not throw when the screenshot is not an image', async () => {
    store.writeScreenshot('case-1', 'cap-1', Buffer.from('not a png'))

    expect(await getThumbnail('case-1', 'cap-1', store)).toBeNull()
  })
})
