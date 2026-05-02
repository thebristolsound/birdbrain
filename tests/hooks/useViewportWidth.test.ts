// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useViewportWidth } from '@renderer/hooks/useViewportWidth'

describe('useViewportWidth', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1280 })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns initial window.innerWidth synchronously', () => {
    const { result } = renderHook(() => useViewportWidth())
    expect(result.current).toBe(1280)
  })

  it('updates when the window emits resize', () => {
    const { result } = renderHook(() => useViewportWidth())
    act(() => {
      Object.defineProperty(window, 'innerWidth', { writable: true, value: 800 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(800)
  })

  it('detaches resize listener on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useViewportWidth())
    unmount()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})
