// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import {
  CAPTURE_VIEW_STORAGE_KEY,
  readStoredCaptureView,
  useCaptureView
} from '@renderer/components/captures/useCaptureView'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('readStoredCaptureView', () => {
  it('defaults to the detailed rows when nothing is stored', () => {
    expect(readStoredCaptureView()).toBe('detailed')
  })

  it('falls back rather than throwing on an unrecognised value', () => {
    localStorage.setItem(CAPTURE_VIEW_STORAGE_KEY, 'compact-grid')
    expect(readStoredCaptureView()).toBe('detailed')
  })

  it('returns a stored value it recognises', () => {
    localStorage.setItem(CAPTURE_VIEW_STORAGE_KEY, 'list')
    expect(readStoredCaptureView()).toBe('list')
  })
})

describe('useCaptureView', () => {
  it('round-trips the toggle through localStorage', () => {
    const { result } = renderHook(() => useCaptureView())
    expect(result.current.view).toBe('detailed')

    act(() => result.current.setView('list'))

    expect(result.current.view).toBe('list')
    expect(localStorage.getItem(CAPTURE_VIEW_STORAGE_KEY)).toBe('list')
    expect(readStoredCaptureView()).toBe('list')
  })
})
