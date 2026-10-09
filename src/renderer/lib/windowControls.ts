// The OS title bar is hidden (src/main/windowChrome.ts), so the top bar has to keep its
// content clear of the native window controls. This publishes how much room they need as
// `--window-controls-inset` on the root element; TopBar.tsx pads both sides by it.
//
// On Windows and Linux Chromium paints the controls through the window-controls overlay
// and reports the area left to the page via `navigator.windowControlsOverlay`. The
// controls' width is the window's width less that area, and it belongs to the desktop,
// not the window, so it is read when the overlay reports a geometry change and held
// between them. Reading it on every layout instead would go wrong under Playwright's
// viewport emulation, where `innerWidth` moves but the overlay rect does not
// (e2e/topbar-layout.spec.ts). The `titlebar-area-*` CSS variables share that problem,
// which is why this is script and not a `calc()`.
//
// macOS has no overlay; its traffic lights sit at the left, so the inset is fixed.

export const WINDOW_CONTROLS_INSET_PROPERTY = '--window-controls-inset'

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

/** The inset in CSS pixels for the overlay's current geometry; 0 when it is hidden. */
export function windowControlsInset(overlay: WindowControlsOverlay, windowWidth: number): number {
  if (!overlay.visible) return 0
  const { x, width } = overlay.getTitlebarAreaRect()
  // Controls on the left push the area right; on the right they shorten it. A desktop
  // that splits them does both, and the larger side is what the bar pads by.
  return Math.max(x, windowWidth - x - width, 0)
}

/**
 * Keeps `--window-controls-inset` current on `<html>`. Returns a function that stops
 * listening; the property is left as it was last set.
 */
export function syncWindowControlsInset(
  nav: Navigator = navigator,
  win: { innerWidth: number } = window,
  root: HTMLElement = document.documentElement
): () => void {
  const setInset = (px: number): void => {
    root.style.setProperty(WINDOW_CONTROLS_INSET_PROPERTY, `${px}px`)
  }

  if (nav.platform.toLowerCase().startsWith('mac')) {
    setInset(MAC_TRAFFIC_LIGHT_INSET_PX)
    return () => {}
  }

  const overlay = overlayOf(nav)
  if (!overlay) {
    setInset(0)
    return () => {}
  }

  const update = (): void => setInset(windowControlsInset(overlay, win.innerWidth))
  update()
  overlay.addEventListener('geometrychange', update)
  return () => overlay.removeEventListener('geometrychange', update)
}
