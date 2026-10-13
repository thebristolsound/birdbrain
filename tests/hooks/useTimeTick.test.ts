// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTimeTick } from '@renderer/hooks/useTimeTick'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useTimeTick', () => {
  it('returns the current time and refreshes it every interval', () => {
    const start = Date.now()
    const { result } = renderHook(() => useTimeTick(60_000))
    expect(result.current).toBe(start)
    act(() => {
      vi.advanceTimersByTime(59_999)
    })
    expect(result.current).toBe(start)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(start + 60_000)
  })
})
