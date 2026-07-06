import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import type { WebContents } from 'electron'
import { captureStitchedScreenshot } from '@main/services/backgroundRenderer'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: vi.fn(() => '/tmp') }
}))

vi.mock('@main/services/consentBlocker', () => ({
  getConsentBlocker: vi.fn(async () => null)
}))

const VIEWPORT = { width: 1280, height: 900 }

type Rgb = { r: number; g: number; b: number }
const RED: Rgb = { r: 255, g: 0, b: 0 }
const GREEN: Rgb = { r: 0, g: 255, b: 0 }
const BLUE: Rgb = { r: 0, g: 0, b: 255 }

function solidPng(width: number, height: number, color: Rgb): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: color }
  })
    .png()
    .toBuffer()
}

// Only the WebContents surface captureStitchedScreenshot actually calls. Typing
// the mock against this (instead of a blanket `as unknown as WebContents`) makes
// a wrong mock shape a compile error rather than a silent runtime mismatch; the
// single widening cast to the full interface stays at the return boundary.
type StitchWebContents = Pick<WebContents, 'executeJavaScript'> & {
  debugger: Pick<WebContents['debugger'], 'sendCommand'>
}

// Emulates the page side of the stitched-capture protocol: a scrollable
// document of the given content height, and one solid-color viewport surface
// shot per scroll position (sized by dpr, as Page.captureScreenshot returns
// device pixels).
function fakeWebContents(contentHeight: number, strips: Buffer[]): WebContents {
  let shotIndex = 0
  const maxY = Math.max(0, contentHeight - VIEWPORT.height)
  const mock: StitchWebContents = {
    executeJavaScript: async (script: string) => {
      if (script.includes("overflow = 'visible'")) return null
      if (script.includes('const prior =')) return undefined
      const match = script.match(/setScrollTop\(root, (\d+)\)/)
      if (!match) throw new Error(`unexpected script: ${script.slice(0, 80)}`)
      return { y: Math.min(Number(match[1]), maxY), viewportHeight: VIEWPORT.height }
    },
    debugger: {
      sendCommand: async (method: string) => {
        if (method !== 'Page.captureScreenshot') throw new Error(`unexpected command: ${method}`)
        const png = strips[Math.min(shotIndex, strips.length - 1)]
        shotIndex++
        return { data: png.toString('base64') }
      }
    }
  }
  return mock as unknown as WebContents
}

async function pixelAt(image: Buffer, x: number, y: number): Promise<Rgb> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
  const idx = (y * info.width + x) * info.channels
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2] }
}

describe('captureStitchedScreenshot', () => {
  // Regression: strips depict the viewport's CSS width. Sizing the canvas from
  // a wider content width stretched each strip's height by width/1280 while
  // `top` spacing stayed viewport-based, so every seam was overpainted.
  it('tiles strips without overlap when content is wider than the viewport', async () => {
    const dims = { width: 1920, height: 2700, scale: 1 }
    const strips = await Promise.all(
      [RED, GREEN, BLUE].map((c) => solidPng(VIEWPORT.width, VIEWPORT.height, c))
    )
    const wc = fakeWebContents(dims.height, strips)

    const out = await captureStitchedScreenshot(wc, dims)

    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(VIEWPORT.width)
    expect(meta.height).toBe(dims.height)

    // Mid-strip samples plus both sides of each seam (±3px for resize rounding).
    expect(await pixelAt(out, 10, 450)).toEqual(RED)
    expect(await pixelAt(out, 10, 897)).toEqual(RED)
    expect(await pixelAt(out, 10, 903)).toEqual(GREEN)
    expect(await pixelAt(out, 10, 1350)).toEqual(GREEN)
    expect(await pixelAt(out, 10, 1797)).toEqual(GREEN)
    expect(await pixelAt(out, 10, 1803)).toEqual(BLUE)
    expect(await pixelAt(out, 10, 2250)).toEqual(BLUE)
  })

  it('folds the device scale factor out of viewport surface shots', async () => {
    const dims = { width: 1280, height: 2700, scale: 1 }
    const strips = await Promise.all(
      [RED, GREEN, BLUE].map((c) => solidPng(VIEWPORT.width * 2, VIEWPORT.height * 2, c))
    )
    const wc = fakeWebContents(dims.height, strips)

    const out = await captureStitchedScreenshot(wc, dims)

    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(VIEWPORT.width)
    expect(meta.height).toBe(dims.height)
    expect(await pixelAt(out, 10, 450)).toEqual(RED)
    expect(await pixelAt(out, 10, 1350)).toEqual(GREEN)
    expect(await pixelAt(out, 10, 2250)).toEqual(BLUE)
  })
})
