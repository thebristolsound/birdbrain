import { useEffect, useState } from 'react'

export interface GuestFrameSize {
  width: number
  height: number
}

/**
 * The size an evidence `<webview>` has to be given for none of its page to be lost.
 *
 * Electron sizes a guest's *widget* from the element's box but lays the guest
 * document out against the **embedder window's** viewport. Measured on Electron 42:
 * in a 1200x800 window, a guest whose element is 422x674 still resolves `%`, `vw`,
 * `vh` and auto margins against 1200x800. So a page filling its viewport was painted
 * 1200px wide into a 422px element and the remainder was clipped — on both axes, and
 * with no scrollbar to reach it, because the host container hid its overflow and the
 * guest had none of its own to show (#465).
 *
 * Sizing the element to the window instead makes the widget as large as the layout
 * viewport, so every laid-out pixel lands inside the element and a scrollable pane
 * can reach it. It also survives Electron fixing the underlying sizing: the guest
 * would then lay out against an element that is already the window's size, which is
 * the same answer.
 *
 * `resize` is rAF-throttled for the same reason `useViewportWidth` throttles it —
 * an Electron drag-resize fires it every frame.
 */
export function useGuestFrameSize(): GuestFrameSize {
  const [size, setSize] = useState<GuestFrameSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))

  useEffect(() => {
    let frame = 0
    function onResize() {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setSize({ width: window.innerWidth, height: window.innerHeight })
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return size
}
