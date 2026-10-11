// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  LIST_COLUMN_WIDTH_STORAGE_KEY,
  readStoredListWidth
} from '@renderer/hooks/useListColumnWidth'

beforeEach(() => {
  localStorage.clear()
})

describe('readStoredListWidth', () => {
  it('opens at the design width until a drag has saved one', () => {
    expect(readStoredListWidth()).toBe(316)
  })

  it('reads a saved width back in pixels', () => {
    localStorage.setItem(LIST_COLUMN_WIDTH_STORAGE_KEY, '402')
    expect(readStoredListWidth()).toBe(402)
  })

  it('falls back to the design width for a value outside the drag bounds', () => {
    for (const value of ['120', '900', 'wide']) {
      localStorage.setItem(LIST_COLUMN_WIDTH_STORAGE_KEY, value)
      expect(readStoredListWidth()).toBe(316)
    }
  })
})
