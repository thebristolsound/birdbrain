import { useEffect, useState } from 'react'

/**
 * Bumps a counter every `intervalMs` so consumers that depend on the return
 * value re-render. Use with `formatRelativeTime` to keep "Saved 2m ago" surfaces
 * fresh without each one owning its own interval.
 */
export function useTimeTick(intervalMs: number): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return tick
}
