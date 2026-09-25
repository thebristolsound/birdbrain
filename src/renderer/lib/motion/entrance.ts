import { useEffect, useState } from 'react'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'

const seenScreens = new Set<string>()

/** Renderer-session state: returning to a settled screen does not replay its entrance. */
export function useScreenEntrance(screen: string): boolean {
  const [entering, setEntering] = useState(() => !seenScreens.has(screen))

  useEffect(() => {
    if (!entering) return
    const settle = window.setTimeout(() => {
      seenScreens.add(screen)
      setEntering(false)
    }, 900)
    return () => window.clearTimeout(settle)
  }, [screen, entering])

  return entering
}

/** A shared progress clock keeps all five metrics together, including late query results. */
export function useCountUpProgress(entering: boolean): number {
  const reduce = useReduceMotion()
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!entering || reduce) return
    const start = performance.now()
    let frame: number
    const step = (now: number) => {
      const elapsed = Math.min(1, Math.max(0, (now - start) / 700))
      setProgress(1 - Math.pow(1 - elapsed, 3))
      if (elapsed < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    // A hidden window may stop delivering animation frames entirely.
    const settle = window.setTimeout(() => {
      cancelAnimationFrame(frame)
      setProgress(1)
    }, 900)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
    }
  }, [entering, reduce])

  return !entering || reduce ? 1 : progress
}
