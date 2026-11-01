// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { useState } from 'react'

// The hook's job is the hand-off to the panel: jsdom lays nothing out, so the panel is a
// stand-in that reports a dragged width. The callback ref holds it in state, as the
// library's does, and the panel arrives through it, as a mounting Panel hands it over.
const panel = vi.hoisted(() => ({
  collapse: vi.fn(),
  expand: vi.fn(),
  isCollapsed: vi.fn(() => false),
  resize: vi.fn(),
  getSize: vi.fn(() => ({ asPercentage: 30, inPixels: 401.6 }))
}))
vi.mock('react-resizable-panels', () => ({
  usePanelCallbackRef: () => useState(null)
}))

import {
  LIST_COLUMN_WIDTH_STORAGE_KEY,
  useListColumnWidth
} from '@renderer/hooks/useListColumnWidth'

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

function renderMounted() {
  const rendered = renderHook(() => useListColumnWidth('list'))
  act(() => rendered.result.current.panelRef(panel))
  return rendered
}

describe('useListColumnWidth', () => {
  it('sizes the mounted list panel to the saved width in pixels', () => {
    localStorage.setItem(LIST_COLUMN_WIDTH_STORAGE_KEY, '380')
    renderMounted()
    expect(panel.resize).toHaveBeenCalledWith(380)
  })

  it('saves the width a drag leaves, rounded to a pixel', () => {
    const { result } = renderMounted()
    result.current.onLayoutChanged({ list: 25, viewer: 75 }, { isUserInteraction: false })
    result.current.onLayoutChanged({ list: 30, viewer: 70 }, { isUserInteraction: true })
    expect(localStorage.getItem(LIST_COLUMN_WIDTH_STORAGE_KEY)).toBe('402')
  })

  it('ignores a layout change the operator did not make', () => {
    const { result } = renderMounted()
    result.current.onLayoutChanged({ list: 30, viewer: 70 }, { isUserInteraction: false })
    expect(localStorage.getItem(LIST_COLUMN_WIDTH_STORAGE_KEY)).toBeNull()
  })

  it('ignores a drag of another separator that leaves the list where it was', () => {
    localStorage.setItem(LIST_COLUMN_WIDTH_STORAGE_KEY, '560')
    const { result } = renderMounted()
    result.current.onLayoutChanged(
      { list: 30, viewer: 40, details: 30 },
      { isUserInteraction: false }
    )
    result.current.onLayoutChanged(
      { list: 30, viewer: 50, details: 20 },
      { isUserInteraction: true }
    )
    expect(localStorage.getItem(LIST_COLUMN_WIDTH_STORAGE_KEY)).toBe('560')
  })

  it('ignores a drag while the list panel is not in the layout', () => {
    const { result } = renderMounted()
    result.current.onLayoutChanged({ viewer: 70, details: 30 }, { isUserInteraction: true })
    expect(localStorage.getItem(LIST_COLUMN_WIDTH_STORAGE_KEY)).toBeNull()
  })
})
