// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useZoomPan } from '@renderer/components/captures/annotation/useZoomPan'

describe('useZoomPan — fitToWidth', () => {
  it('initializes at fit-width for a tall image', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 1000, imageHeight: 8000, containerWidth: 500, containerHeight: 800 })
    )
    expect(result.current.userScale).toBe(1)
    expect(result.current.fitScale).toBeCloseTo(0.5, 5)
    expect(result.current.scale).toBeCloseTo(0.5, 5)
    expect(result.current.panX).toBe(0)
    expect(result.current.panY).toBe(0)
  })

  it('caps fitScale at 1 for an image smaller than the container', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 200, imageHeight: 200, containerWidth: 800, containerHeight: 800 })
    )
    expect(result.current.fitScale).toBe(1)
    expect(result.current.scale).toBe(1)
    expect(result.current.panX).toBe(300)
    expect(result.current.panY).toBe(300)
  })
})

describe('useZoomPan — zoomAt', () => {
  it('keeps the image pixel under the cursor stationary', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 1000, imageHeight: 8000, containerWidth: 500, containerHeight: 800 })
    )
    // fitScale = 0.5; scale = 0.5; pan = (0, 0)
    // Image pixel under cursor (250, 400) is at imagePx = (500, 800).
    const cursorX = 250
    const cursorY = 400
    const imagePxX = (cursorX - result.current.panX) / result.current.scale
    const imagePxY = (cursorY - result.current.panY) / result.current.scale

    act(() => result.current.zoomAt(2, cursorX, cursorY))

    // After zoom, the image pixel under the cursor must still be (imagePxX, imagePxY).
    const imagePxXAfter = (cursorX - result.current.panX) / result.current.scale
    const imagePxYAfter = (cursorY - result.current.panY) / result.current.scale
    expect(imagePxXAfter).toBeCloseTo(imagePxX, 5)
    expect(imagePxYAfter).toBeCloseTo(imagePxY, 5)
    expect(result.current.userScale).toBe(2)
  })

  it('clamps userScale to [MIN_USER_SCALE, MAX_ABS_SCALE / fitScale]', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 1000, imageHeight: 8000, containerWidth: 500, containerHeight: 800 })
    )
    // fitScale = 0.5; max userScale = 8 / 0.5 = 16
    act(() => result.current.zoomAt(1000, 250, 400))
    expect(result.current.userScale).toBe(16)
    expect(result.current.scale).toBe(8)

    act(() => result.current.zoomAt(0.0001, 250, 400))
    expect(result.current.userScale).toBe(0.5)
  })
})
