import { useEffect, useState, type RefObject } from 'react'

// The width of the element itself, from a ResizeObserver: the view's arrangement follows the room
// it has beside the sidebar, which `window.innerWidth` does not measure. The observer reports the
// element's size when it starts observing, so no first read is needed here.
export function useViewWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}
