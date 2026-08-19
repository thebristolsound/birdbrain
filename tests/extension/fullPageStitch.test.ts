// @vitest-environment jsdom
//
// Known-answer test for full-page stitching geometry: the final slice is
// scroll-clamped by the browser, so it must be placed at the *actual* scrollY
// and blitted 1:1 (never rescaled), and geometry must follow the returned
// bitmap size rather than devicePixelRatio (fractional-DPR Windows displays).
import { describe, it, expect, beforeAll, vi } from 'vitest'

type SendResponse = (response?: unknown) => void
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown

const listeners: Listener[] = []
const VIEWPORT_W = 1000
const VIEWPORT_H = 700
const DPR = 1.25
const PAGE_H = 2000
const BITMAP_W = Math.round(VIEWPORT_W * DPR)
const BITMAP_H = Math.round(VIEWPORT_H * DPR)

const scrollRequests: number[] = []
const drawCalls: number[][] = []
let canvasDims: { w: number; h: number } | null = null
let scrollY = 0

function dispatchAsync(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    for (const listener of listeners) listener(message, {}, resolve)
  })
}

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      sendMessage: vi.fn(async (message: { type: string }) =>
        message.type === 'REQUEST_VIEWPORT_CAPTURE'
          ? { dataUrl: `data:image/png;base64,${scrollY}` }
          : {}
      )
    }
  })
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(w: number, h: number) {
        canvasDims = { w, h }
      }
      getContext(): { drawImage: (...args: unknown[]) => void } {
        return { drawImage: (...args) => drawCalls.push(args.slice(1) as number[]) }
      }
      convertToBlob(): Promise<Blob> {
        return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
      }
    }
  )
  vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob(['x']) }))
  vi.stubGlobal('createImageBitmap', async () => ({
    width: BITMAP_W,
    height: BITMAP_H,
    close: () => {}
  }))
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => VIEWPORT_W })
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => VIEWPORT_H })
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => DPR })
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => PAGE_H
  })
  // Browser semantics: scroll requests past the end clamp to the last viewport
  window.scrollTo = ((_x: number, y: number) => {
    scrollRequests.push(y)
    scrollY = Math.max(0, Math.min(y, PAGE_H - VIEWPORT_H))
  }) as typeof window.scrollTo
  window.scrollBy = () => {}
  await import('../../extension/src/content')
})

describe('full-page stitching geometry', () => {
  it('places the clamped final slice at its real offset and never rescales', async () => {
    const response = (await dispatchAsync({ type: 'CAPTURE_FULL_PAGE' })) as {
      screenshot?: string
      error?: string
    }
    expect(response.error).toBeUndefined()
    expect(response.screenshot).toMatch(/^data:image\/png/)

    // 3 slices requested at 0/700/1400; the last is clamped to 1300
    expect(scrollRequests.slice(0, 3)).toEqual([0, 700, 1400])
    expect(canvasDims).toEqual({ w: BITMAP_W, h: Math.round(PAGE_H * DPR) })

    expect(drawCalls.length).toBe(3)
    for (const [sx, sy, sw, sh, , , dw, dh] of drawCalls) {
      expect([sx, sy]).toEqual([0, 0])
      expect(dw).toBe(sw)
      expect(dh).toBe(sh)
      expect(sw).toBe(BITMAP_W)
    }
    const destYs = drawCalls.map((c) => c[5])
    expect(destYs).toEqual([0, BITMAP_H, Math.round(1300 * DPR)])
    // Last slice is a full-height blit that ends exactly at the canvas bottom
    const last = drawCalls[2]
    expect(last[3]).toBe(BITMAP_H)
    expect(last[5] + last[7]).toBe(Math.round(PAGE_H * DPR))
  })
})
