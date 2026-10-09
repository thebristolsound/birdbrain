// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import {
  MAC_TRAFFIC_LIGHT_INSET_PX,
  WINDOW_CONTROLS_INSET_PROPERTY,
  syncWindowControlsInset,
  windowControlsInset
} from '@renderer/lib/windowControls'
import { MAC_PLATFORM } from '../platformStub'

function fakeOverlay(visible: boolean, rect: { x: number; width: number }) {
  const target = new EventTarget()
  return Object.assign(target, {
    visible,
    rect,
    getTitlebarAreaRect() {
      return { x: this.rect.x, width: this.rect.width } as DOMRect
    }
  })
}

function navigatorWith(overlay: unknown, platform = 'Linux x86_64'): Navigator {
  return { platform, windowControlsOverlay: overlay } as unknown as Navigator
}

describe('windowControlsInset', () => {
  it('is the width the controls take, whichever side they sit on', () => {
    expect(windowControlsInset(fakeOverlay(true, { x: 0, width: 883 }), 922)).toBe(39)
    expect(windowControlsInset(fakeOverlay(true, { x: 39, width: 883 }), 922)).toBe(39)
  })

  it('pads by the larger side when the desktop splits the controls', () => {
    expect(windowControlsInset(fakeOverlay(true, { x: 30, width: 800 }), 922)).toBe(92)
  })

  it('is zero while the overlay is hidden, as in fullscreen', () => {
    expect(windowControlsInset(fakeOverlay(false, { x: 0, width: 883 }), 922)).toBe(0)
  })
})

describe('syncWindowControlsInset', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(WINDOW_CONTROLS_INSET_PROPERTY)
  })

  const read = () => document.documentElement.style.getPropertyValue(WINDOW_CONTROLS_INSET_PROPERTY)

  it('publishes the inset and follows geometry changes', () => {
    const overlay = fakeOverlay(true, { x: 0, width: 883 })
    const win = { innerWidth: 922 }
    const stop = syncWindowControlsInset(navigatorWith(overlay), win)
    expect(read()).toBe('39px')

    overlay.rect = { x: 0, width: 784 }
    win.innerWidth = 922
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(read()).toBe('138px')

    stop()
    overlay.rect = { x: 0, width: 922 }
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(read()).toBe('138px')
  })

  it('does not re-read when only the window width moves', () => {
    // Viewport emulation changes innerWidth without a geometrychange; the held value
    // must stay, or the bar pads by the stale rect's remainder.
    const overlay = fakeOverlay(true, { x: 0, width: 883 })
    const win = { innerWidth: 922 }
    const stop = syncWindowControlsInset(navigatorWith(overlay), win)
    win.innerWidth = 1400
    expect(read()).toBe('39px')
    stop()
  })

  it('uses the fixed traffic-light inset on macOS', () => {
    const stop = syncWindowControlsInset(navigatorWith(undefined, MAC_PLATFORM))
    expect(read()).toBe(`${MAC_TRAFFIC_LIGHT_INSET_PX}px`)
    stop()
  })

  it('publishes zero where there is no overlay API', () => {
    const stop = syncWindowControlsInset(navigatorWith(undefined))
    expect(read()).toBe('0px')
    stop()
  })
})
