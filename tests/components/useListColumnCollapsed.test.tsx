// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import {
  LIST_COLUMN_COLLAPSED_STORAGE_KEY,
  readStoredListCollapsed,
  useListColumnCollapsed
} from '@renderer/hooks/useListColumnCollapsed'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('useListColumnCollapsed', () => {
  it('defaults to expanded', () => {
    expect(readStoredListCollapsed()).toBe(false)
    const { result } = renderHook(() => useListColumnCollapsed())
    expect(result.current.collapsed).toBe(false)
  })

  it('round-trips the collapsed flag through localStorage', () => {
    const { result } = renderHook(() => useListColumnCollapsed())

    act(() => result.current.setCollapsed(true))

    expect(result.current.collapsed).toBe(true)
    expect(localStorage.getItem(LIST_COLUMN_COLLAPSED_STORAGE_KEY)).toBe('true')
    expect(readStoredListCollapsed()).toBe(true)

    act(() => result.current.setCollapsed(false))
    expect(readStoredListCollapsed()).toBe(false)
  })

  // The Captures and Notes screens each mount their own copy; the second must open the
  // way the first left it.
  it('opens a later mount the way an earlier one left it', () => {
    const first = renderHook(() => useListColumnCollapsed())
    act(() => first.result.current.setCollapsed(true))
    first.unmount()

    const second = renderHook(() => useListColumnCollapsed())
    expect(second.result.current.collapsed).toBe(true)
  })

  it('keeps the key the Captures list used before the lists shared it', () => {
    expect(LIST_COLUMN_COLLAPSED_STORAGE_KEY).toBe('captureListCollapsed')
  })
})
