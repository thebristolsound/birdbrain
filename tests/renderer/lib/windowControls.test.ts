// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import {
  MAC_TRAFFIC_LIGHT_INSET_PX,
  WINDOW_CONTROLS_LEFT_PROPERTY,
  WINDOW_CONTROLS_RIGHT_PROPERTY,
  syncWindowControlsInset,
  windowControlsInsets
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

describe('windowControlsInsets', () => {
  it('puts the width the controls take on the side they sit on', () => {
    expect(windowControlsInsets(fakeOverlay(true, { x: 0, width: 883 }), 922)).toEqual({
      left: 0,
      right: 39
    })
    expect(windowControlsInsets(fakeOverlay(true, { x: 39, width: 883 }), 922)).toEqual({
      left: 39,
      right: 0
    })
  })

  it('pads each side by its own share when the desktop splits the controls', () => {
    expect(windowControlsInsets(fakeOverlay(true, { x: 30, width: 800 }), 922)).toEqual({
      left: 30,
      right: 92
    })
  })

  it('is zero while the overlay is hidden, as in fullscreen', () => {
    expect(windowControlsInsets(fakeOverlay(false, { x: 0, width: 883 }), 922)).toEqual({
      left: 0,
      right: 0
    })
  })
})

describe('syncWindowControlsInset', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(WINDOW_CONTROLS_LEFT_PROPERTY)
    document.documentElement.style.removeProperty(WINDOW_CONTROLS_RIGHT_PROPERTY)
  })

  const read = () => {
    const { style } = document.documentElement
    return [
      style.getPropertyValue(WINDOW_CONTROLS_LEFT_PROPERTY),
      style.getPropertyValue(WINDOW_CONTROLS_RIGHT_PROPERTY)
    ]
  }

  it('publishes the inset and follows geometry changes', () => {
    const overlay = fakeOverlay(true, { x: 0, width: 883 })
    const win = { innerWidth: 922 }
    const stop = syncWindowControlsInset(navigatorWith(overlay), win)
    expect(read()).toEqual(['0px', '39px'])

    overlay.rect = { x: 0, width: 784 }
    win.innerWidth = 922
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(read()).toEqual(['0px', '138px'])

    stop()
    overlay.rect = { x: 0, width: 922 }
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(read()).toEqual(['0px', '138px'])
  })

  it('does not re-read when only the window width moves', () => {
    // Viewport emulation changes innerWidth without a geometrychange; the held values
    // must stay, or the bar pads by the stale rect's remainder.
    const overlay = fakeOverlay(true, { x: 0, width: 883 })
    const win = { innerWidth: 922 }
    const stop = syncWindowControlsInset(navigatorWith(overlay), win)
    win.innerWidth = 1400
    expect(read()).toEqual(['0px', '39px'])
    stop()
  })

  it('uses the fixed traffic-light inset on macOS', () => {
    const stop = syncWindowControlsInset(navigatorWith(undefined, MAC_PLATFORM))
    expect(read()).toEqual([`${MAC_TRAFFIC_LIGHT_INSET_PX}px`, '0px'])
    stop()
  })

  it('publishes zero where there is no overlay API', () => {
    const stop = syncWindowControlsInset(navigatorWith(undefined))
    expect(read()).toEqual(['0px', '0px'])
    stop()
  })
})
