/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'

function setMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
    dispatch: (m: boolean) => {
      mql.matches = m
      listeners.forEach((l) => l({ matches: m } as MediaQueryListEvent))
    }
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return mql
}

describe('useReduceMotion', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('returns false when neither OS nor setting requests reduced motion', () => {
    setMatchMedia(false)
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(false)
  })

  it('returns true when OS prefers reduced motion', () => {
    setMatchMedia(true)
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(true)
  })

  it('returns true when localStorage reduceMotion is "true"', () => {
    setMatchMedia(false)
    localStorage.setItem('reduceMotion', 'true')
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(true)
  })

  it('updates when the OS preference changes', () => {
    const mql = setMatchMedia(false)
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(false)
    act(() => mql.dispatch(true))
    expect(result.current).toBe(true)
  })

  it('updates when the storage setting changes via storage event', () => {
    setMatchMedia(false)
    const { result } = renderHook(() => useReduceMotion())
    expect(result.current).toBe(false)
    act(() => {
      localStorage.setItem('reduceMotion', 'true')
      window.dispatchEvent(new StorageEvent('storage', { key: 'reduceMotion', newValue: 'true' }))
    })
    expect(result.current).toBe(true)
  })
})
