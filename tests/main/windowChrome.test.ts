import { describe, it, expect } from 'vitest'
import {
  TITLE_BAR_HEIGHT,
  titleBarOptions,
  titleBarOverlay,
  windowBackgroundColor
} from '@main/windowChrome'

describe('titleBarOptions', () => {
  it('keeps native traffic lights on macOS, inset into the top bar', () => {
    const options = titleBarOptions('dark', 'darwin')
    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.trafficLightPosition).toEqual({ x: 16, y: 16 })
    expect(options.titleBarOverlay).toBeUndefined()
    expect(options.autoHideMenuBar).toBeUndefined()
  })

  it.each(['linux', 'win32'] as const)('uses the controls overlay on %s', (platform) => {
    const options = titleBarOptions('dark', platform)
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.autoHideMenuBar).toBe(true)
    expect(options.titleBarOverlay).toEqual(titleBarOverlay('dark', platform))
  })
})

describe('titleBarOverlay', () => {
  it('spans the top bar and carries its surface colour per theme', () => {
    const dark = titleBarOverlay('dark', 'linux')
    const light = titleBarOverlay('light', 'linux')
    expect(dark).toMatchObject({ height: TITLE_BAR_HEIGHT, color: '#0e0e11' })
    expect(light).toMatchObject({ height: TITLE_BAR_HEIGHT, color: '#f4f4f5' })
    expect(dark?.symbolColor).not.toBe(light?.symbolColor)
  })

  it('is absent on macOS', () => {
    expect(titleBarOverlay('dark', 'darwin')).toBeNull()
  })
})

describe('windowBackgroundColor', () => {
  it('follows the theme canvas', () => {
    expect(windowBackgroundColor('dark')).toBe('#090a0b')
    expect(windowBackgroundColor('light')).toBe('#fafafa')
  })
})
