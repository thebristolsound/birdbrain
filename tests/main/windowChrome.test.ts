import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  POP_OUT_SIZE,
  POP_OUT_TITLE_BAR_HEIGHT,
  TITLE_BAR_HEIGHT,
  popOutBackgroundColor,
  popOutTitleBarOverlay,
  popOutWindowOptions,
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

// The pop-out's bar is `bg-accent-subtle` over the window's `bg-surface`, so the overlay behind the
// window controls takes that blend, read here from the stylesheet both themes define it in.
function tokens(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/(--color-[a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value])
  )
}

function blendedTint(block: string): string {
  const colors = tokens(block)
  const [r, g, b, alpha] = (colors.get('--color-accent-subtle') ?? '').match(/[\d.]+/g)!.map(Number)
  const surface = colors.get('--color-surface') ?? ''
  const base = [1, 3, 5].map((i) => parseInt(surface.slice(i, i + 2), 16))
  return (
    '#' +
    [r, g, b]
      .map((channel, i) => Math.round(channel * alpha + base[i] * (1 - alpha)))
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')
  )
}

describe('the Capture Session pop-out', () => {
  const css = readFileSync(join(process.cwd(), 'src/renderer/styles/globals.css'), 'utf-8')
  const [light, dark] = css.split('html.dark {')

  it('is a 300-pixel window of fixed size that opens hidden', () => {
    const options = popOutWindowOptions('dark', 'linux')
    expect(options).toMatchObject({
      width: POP_OUT_SIZE.width,
      height: POP_OUT_SIZE.height,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'Birdbrain · Capture Session',
      backgroundColor: popOutBackgroundColor('dark')
    })
    expect(POP_OUT_SIZE.width).toBe(300)
  })

  it.each(['linux', 'win32'] as const)('paints the window controls into its bar on %s', (p) => {
    const options = popOutWindowOptions('light', p)
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.autoHideMenuBar).toBe(true)
    expect(options.titleBarOverlay).toEqual(popOutTitleBarOverlay('light', p))
  })

  it('insets the traffic lights into its bar on macOS', () => {
    const options = popOutWindowOptions('dark', 'darwin')
    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.trafficLightPosition).toEqual({ x: 16, y: 8 })
    expect(options.titleBarOverlay).toBeUndefined()
    expect(popOutTitleBarOverlay('dark', 'darwin')).toBeNull()
  })

  it('spans its bar, in the accent tint over the surface, per theme', () => {
    expect(popOutTitleBarOverlay('dark', 'linux')).toMatchObject({
      height: POP_OUT_TITLE_BAR_HEIGHT,
      color: blendedTint(dark)
    })
    expect(popOutTitleBarOverlay('light', 'linux')).toMatchObject({
      height: POP_OUT_TITLE_BAR_HEIGHT,
      color: blendedTint(light)
    })
    // The controls keep the main window's symbol colours.
    expect(popOutTitleBarOverlay('dark', 'linux')?.symbolColor).toBe(
      titleBarOverlay('dark', 'linux')?.symbolColor
    )
  })

  it('fills behind the page with the surface colour per theme', () => {
    expect(popOutBackgroundColor('dark')).toBe(tokens(dark).get('--color-surface'))
    expect(popOutBackgroundColor('light')).toBe(tokens(light).get('--color-surface'))
  })
})
