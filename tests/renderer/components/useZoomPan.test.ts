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
