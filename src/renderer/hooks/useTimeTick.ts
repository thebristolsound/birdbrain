import { useEffect, useState } from 'react'

/**
 * The current time in milliseconds, refreshed every `intervalMs`. Pass it to
 * `formatRelativeTime` as `nowMs` to keep "Saved 2m ago" surfaces fresh without
 * each one owning its own interval. Returning the time rather than a counter is
 * what lets a compiled component see it change: a `Date.now()` read during
 * render is cached by the React Compiler on the component's other inputs.
 */
export function useTimeTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
