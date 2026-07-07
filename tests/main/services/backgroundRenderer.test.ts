import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import { trimTrailingBackground } from '@main/services/backgroundRenderer'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: vi.fn(() => '/tmp') }
}))

vi.mock('@main/services/consentBlocker', () => ({
  getConsentBlocker: vi.fn(async () => null)
}))

type Rgb = { r: number; g: number; b: number }
const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const DARK: Rgb = { r: 24, g: 24, b: 24 }
const RED: Rgb = { r: 255, g: 0, b: 0 }

// A page-like image: `background` everywhere, with a solid `content` band
// covering rows [0, contentHeight).
async function pageWithTrailingBackground(
  width: number,
  height: number,
  contentHeight: number,
  background: Rgb,
  content: Rgb
): Promise<Buffer> {
  const band = await sharp({
    create: { width, height: contentHeight, channels: 3, background: content }
  })
    .png()
    .toBuffer()
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: band, left: 0, top: 0 }])
    .png()
    .toBuffer()
}

async function heightOf(png: Buffer): Promise<number> {
  return (await sharp(png).metadata()).height ?? -1
}

describe('trimTrailingBackground', () => {
  it('crops the trailing background band below the last content row', async () => {
    const png = await pageWithTrailingBackground(400, 3000, 1000, WHITE, RED)
    const out = await trimTrailingBackground(png)
    // Last content row (999) + 1 + 8px padding.
    expect(await heightOf(out)).toBe(1008)
  })

  it('adapts to a non-white page background', async () => {
    const png = await pageWithTrailingBackground(400, 3000, 1000, DARK, WHITE)
    const out = await trimTrailingBackground(png)
    expect(await heightOf(out)).toBe(1008)
  })

  it('leaves a page that fills to the bottom untouched', async () => {
    const png = await pageWithTrailingBackground(400, 1000, 1000, WHITE, RED)
    const out = await trimTrailingBackground(png)
    expect(out).toBe(png)
  })

  it('leaves an all-background (blank) capture untouched', async () => {
    const png = await sharp({
      create: { width: 400, height: 2000, channels: 3, background: WHITE }
    })
      .png()
      .toBuffer()
    const out = await trimTrailingBackground(png)
    expect(out).toBe(png)
  })

  it('preserves interior background gaps between content blocks', async () => {
    // Content at top, a big gap, then a second block — only rows past the
    // SECOND block may be cropped.
    const width = 400
    const top = await sharp({
      create: { width, height: 300, channels: 3, background: RED }
    })
      .png()
      .toBuffer()
    const bottom = await sharp({
      create: { width, height: 100, channels: 3, background: RED }
    })
      .png()
      .toBuffer()
    const png = await sharp({ create: { width, height: 4000, channels: 3, background: WHITE } })
      .composite([
        { input: top, left: 0, top: 0 },
        { input: bottom, left: 0, top: 2500 }
      ])
      .png()
      .toBuffer()

    const out = await trimTrailingBackground(png)
    expect(await heightOf(out)).toBe(2608)
  })

  it('returns the original buffer on undecodable input (fail-soft)', async () => {
    const junk = Buffer.from('not a png at all')
    const out = await trimTrailingBackground(junk)
    expect(out).toBe(junk)
  })

  it('ignores sub-threshold speckle when deciding what counts as content', async () => {
    // A handful of noisy pixels deep in the trailing band must not stop the
    // crop: minContentPx = max(4, 0.4% of width) → 4 for a 400px-wide image.
    const width = 400
    const content = await sharp({
      create: { width, height: 500, channels: 3, background: RED }
    })
      .png()
      .toBuffer()
    const speck = await sharp({
      create: { width: 3, height: 1, channels: 3, background: DARK }
    })
      .png()
      .toBuffer()
    const png = await sharp({ create: { width, height: 3000, channels: 3, background: WHITE } })
      .composite([
        { input: content, left: 0, top: 0 },
        { input: speck, left: 200, top: 2000 }
      ])
      .png()
      .toBuffer()

    const out = await trimTrailingBackground(png)
    expect(await heightOf(out)).toBe(508)
  })
})
