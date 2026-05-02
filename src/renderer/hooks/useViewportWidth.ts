import { useEffect, useState } from 'react'

/**
 * Returns the current viewport width, lazily initialized from `window.innerWidth`
 * (no flash on first paint) and updated on `resize` via a rAF-throttled handler
 * so Electron drag-resize doesn't fire setState every frame.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() => window.innerWidth)

  useEffect(() => {
    let frame = 0
    function onResize() {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setWidth(window.innerWidth)
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return width
}
