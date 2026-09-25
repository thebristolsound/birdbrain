import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useCountUpProgress, useScreenEntrance } from '@renderer/lib/motion/entrance'

let frame: FrameRequestCallback
let now: number

beforeEach(() => {
  vi.useFakeTimers()
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  )
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('screen entrance', () => {
  it('remembers a settled screen for this renderer session', () => {
    const first = renderHook(() => useScreenEntrance('settled'))
    expect(first.result.current).toBe(true)
    act(() => vi.advanceTimersByTime(900))
    expect(first.result.current).toBe(false)
    first.unmount()
    expect(renderHook(() => useScreenEntrance('settled')).result.current).toBe(false)
    expect(renderHook(() => useScreenEntrance('different-screen')).result.current).toBe(true)
  })

  it('cancels an interrupted entrance and lets it play on return', () => {
    const first = renderHook(() => useScreenEntrance('interrupted'))
    act(() => vi.advanceTimersByTime(400))
    first.unmount()
    act(() => vi.advanceTimersByTime(900))
    expect(renderHook(() => useScreenEntrance('interrupted')).result.current).toBe(true)
  })
})

describe('count-up progress', () => {
  it('uses a 700ms cubic ease and stops requesting frames at the final value', () => {
    const { result } = renderHook(() => useCountUpProgress(true))
    expect(result.current).toBe(0)
    act(() => frame(350))
    expect(result.current).toBe(0.875)
    const requests = vi.mocked(requestAnimationFrame).mock.calls.length
    act(() => frame(700))
    expect(result.current).toBe(1)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(requests)
  })

  it('settles at 900ms even when the browser delivers no animation frames', () => {
    const { result } = renderHook(() => useCountUpProgress(true))
    act(() => vi.advanceTimersByTime(899))
    expect(result.current).toBe(0)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(1)
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  })

  it('shows final values on return and never starts a new clock', () => {
    expect(renderHook(() => useCountUpProgress(false)).result.current).toBe(1)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it.each(['os', 'setting'])(
    'skips the animation for the %s reduced-motion preference',
    (source) => {
      if (source === 'os')
        vi.mocked(matchMedia).mockReturnValue({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn()
        } as unknown as MediaQueryList)
      else localStorage.setItem('reduceMotion', 'true')
      expect(renderHook(() => useCountUpProgress(true)).result.current).toBe(1)
      expect(requestAnimationFrame).not.toHaveBeenCalled()
    }
  )

  it('settles immediately when reduced motion is enabled mid-animation', () => {
    const { result } = renderHook(() => useCountUpProgress(true))
    act(() => frame(200))
    act(() => {
      localStorage.setItem('reduceMotion', 'true')
      window.dispatchEvent(new StorageEvent('storage', { key: 'reduceMotion' }))
    })
    expect(result.current).toBe(1)
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  })

  it('cleans up the frame and fallback when the component unmounts', () => {
    const { unmount } = renderHook(() => useCountUpProgress(true))
    unmount()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
