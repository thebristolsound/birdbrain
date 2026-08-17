import { describe, it, expect } from 'vitest'
import { resolveWindowSize, DEFAULT_WINDOW_SIZE, MIN_WINDOW_SIZE } from '@main/windowSize'

describe('resolveWindowSize', () => {
  it('returns the default when no override is set', () => {
    expect(resolveWindowSize(undefined, true)).toEqual(DEFAULT_WINDOW_SIZE)
  })

  it('honours a well-formed override at or above the minimum', () => {
    expect(resolveWindowSize('1600x1000', true)).toEqual({ width: 1600, height: 1000 })
    expect(resolveWindowSize('900x600', true)).toEqual(MIN_WINDOW_SIZE)
  })

  // Table of the inputs the previous inline regex accepted and passed straight to
  // BrowserWindow. Each is now answered with the default instead: Electron enforces
  // minWidth/minHeight at construction, so a smaller request cannot produce the window a
  // layout charter believes it is testing.
  it.each([
    ['0x0', 'zero'],
    ['899x600', 'one pixel under the minimum width'],
    ['900x599', 'one pixel under the minimum height'],
    ['1x1', 'far under the minimum'],
    ['100000x100000', 'absurdly large'],
    ['1600x', 'missing height'],
    ['x1000', 'missing width'],
    ['1600X1000', 'uppercase separator'],
    ['1600x1000 ', 'trailing whitespace'],
    ['-1600x-1000', 'negative'],
    ['1600x1000x900', 'three components'],
    ['not-a-size', 'not a size at all'],
    ['', 'empty']
  ])('falls back to the default for %s (%s)', (value) => {
    expect(resolveWindowSize(value, true)).toEqual(DEFAULT_WINDOW_SIZE)
  })

  it('ignores the override entirely when the app is packaged', () => {
    expect(resolveWindowSize('1600x1000', false)).toEqual(DEFAULT_WINDOW_SIZE)
  })

  it('returns a fresh object so a caller cannot mutate the shared default', () => {
    const first = resolveWindowSize(undefined, true)
    first.width = 1
    expect(resolveWindowSize(undefined, true)).toEqual({ width: 1200, height: 800 })
    expect(DEFAULT_WINDOW_SIZE).toEqual({ width: 1200, height: 800 })
  })
})
