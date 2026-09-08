import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import sharp from 'sharp'
import { createCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import { getThumbnail, renderThumbnail, THUMB_WIDTH, THUMB_HEIGHT } from '@main/services/thumbnails'

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
    const tall = await renderThumbnail(await png(1280, 11200, WHITE))
    const short = await renderThumbnail(await png(1280, 260, WHITE))
    const square = await renderThumbnail(await png(600, 600, WHITE))

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

    const thumb = await renderThumbnail(page)

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

    const thumb = await renderThumbnail(withRightEdge)

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

    const thumb = await renderThumbnail(page)

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

    const first = await renderThumbnail(page)
    const second = await renderThumbnail(page)

    expect(createHash('sha256').update(first).digest('hex')).toBe(
      createHash('sha256').update(second).digest('hex')
    )
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
