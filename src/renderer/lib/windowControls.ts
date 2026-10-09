// The OS title bar is hidden (src/main/windowChrome.ts), so the top bar has to keep its
// content clear of the native window controls. This publishes how much room they need on
// each side as `--window-controls-left` and `--window-controls-right` on the root element,
// and TopBar.tsx insets each side by its own.
//
// On Windows and Linux Chromium paints the controls through the window-controls overlay
// and reports the area left to the page via `navigator.windowControlsOverlay`. The
// controls take whatever of the window's width lies outside that area, and that belongs to
// the desktop, not the window, so it is read when the overlay reports a geometry change and
// held between them. Reading it on every layout instead would go wrong under Playwright's
// viewport emulation, where `innerWidth` moves but the overlay rect does not
// (e2e/topbar-layout.spec.ts). The `titlebar-area-*` CSS variables share that problem,
// which is why this is script and not a `calc()`.
//
// macOS has no overlay; its traffic lights sit at the left, so the inset is fixed.

export const WINDOW_CONTROLS_LEFT_PROPERTY = '--window-controls-left'
export const WINDOW_CONTROLS_RIGHT_PROPERTY = '--window-controls-right'

// Room for the traffic lights at trafficLightPosition x 16 (windowChrome.ts).
export const MAC_TRAFFIC_LIGHT_INSET_PX = 64

interface WindowControlsOverlay extends EventTarget {
  visible: boolean
  getTitlebarAreaRect(): DOMRect
}

function overlayOf(nav: Navigator): WindowControlsOverlay | undefined {
  return (nav as Navigator & { windowControlsOverlay?: WindowControlsOverlay })
    .windowControlsOverlay
}

export interface WindowControlsInsets {
  left: number
  right: number
}

const NO_INSETS: WindowControlsInsets = { left: 0, right: 0 }

/** The insets in CSS pixels for the overlay's current geometry; 0 when it is hidden. */
export function windowControlsInsets(
  overlay: WindowControlsOverlay,
  windowWidth: number
): WindowControlsInsets {
  if (!overlay.visible) return NO_INSETS
  const { x, width } = overlay.getTitlebarAreaRect()
  // Controls on the left push the area right; on the right they shorten it. A desktop
  // that splits them does both.
  return { left: Math.max(x, 0), right: Math.max(windowWidth - x - width, 0) }
}

/**
 * Keeps `--window-controls-left` and `--window-controls-right` current on `<html>`. Returns
 * a function that stops listening; the properties are left as they were last set.
 */
export function syncWindowControlsInset(
  nav: Navigator = navigator,
  win: { innerWidth: number } = window,
  root: HTMLElement = document.documentElement
): () => void {
  const setInsets = ({ left, right }: WindowControlsInsets): void => {
    root.style.setProperty(WINDOW_CONTROLS_LEFT_PROPERTY, `${left}px`)
    root.style.setProperty(WINDOW_CONTROLS_RIGHT_PROPERTY, `${right}px`)
  }

  if (nav.platform.toLowerCase().startsWith('mac')) {
    setInsets({ left: MAC_TRAFFIC_LIGHT_INSET_PX, right: 0 })
    return () => {}
  }

  const overlay = overlayOf(nav)
  if (!overlay) {
    setInsets(NO_INSETS)
    return () => {}
  }

  const update = (): void => setInsets(windowControlsInsets(overlay, win.innerWidth))
  update()
  overlay.addEventListener('geometrychange', update)
  return () => overlay.removeEventListener('geometrychange', update)
}
