import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCompletionCelebration } from '@renderer/hooks/useCompletionCelebration'

describe('useCompletionCelebration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with celebrating false', () => {
    const { result } = renderHook(() => useCompletionCelebration())
    expect(result.current.celebrating).toBe(false)
  })

  it('sets celebrating true when celebrate is called', () => {
    const { result } = renderHook(() => useCompletionCelebration())

    act(() => {
      result.current.celebrate()
    })

    expect(result.current.celebrating).toBe(true)
  })

  it('resets to false after holdDuration', () => {
    const holdDuration = 500
    const { result } = renderHook(() => useCompletionCelebration({ holdDuration }))

    act(() => {
      result.current.celebrate()
    })
    expect(result.current.celebrating).toBe(true)

    act(() => {
      vi.advanceTimersByTime(holdDuration)
    })
    expect(result.current.celebrating).toBe(false)
  })

  it('restarts timer on repeated calls', () => {
    const holdDuration = 500
    const { result } = renderHook(() => useCompletionCelebration({ holdDuration }))

    act(() => {
      result.current.celebrate()
    })
    expect(result.current.celebrating).toBe(true)

    // Advance halfway
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(result.current.celebrating).toBe(true)

    // Call celebrate again, restarting the timer
    act(() => {
      result.current.celebrate()
    })

    // Advance 250ms again - should still be celebrating because timer restarted
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(result.current.celebrating).toBe(true)

    // Advance the remaining time
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(result.current.celebrating).toBe(false)
  })

  it('cleans up timeout on unmount', () => {
    const { result, unmount } = renderHook(() => useCompletionCelebration())

    act(() => {
      result.current.celebrate()
    })
    expect(result.current.celebrating).toBe(true)

    unmount()

    // Advance timers - should not throw error
    act(() => {
      vi.runAllTimers()
    })
  })

  it('provides celebrationProps when celebrating', () => {
    const { result } = renderHook(() => useCompletionCelebration({ style: 'pulse' }))

    expect(result.current.celebrationProps).toEqual({})

    act(() => {
      result.current.celebrate()
    })

    expect(result.current.celebrationProps).toHaveProperty('animate')
    expect(result.current.celebrationProps).toHaveProperty('transition')
  })

  it('supports different celebration styles', () => {
    const styles = ['checkmark', 'pulse', 'ripple'] as const

    styles.forEach((style) => {
      const { result } = renderHook(() => useCompletionCelebration({ style }))

      act(() => {
        result.current.celebrate()
      })

      expect(result.current.celebrationProps).toHaveProperty('animate')
      expect(result.current.celebrationProps).toHaveProperty('transition')
    })
  })
})
