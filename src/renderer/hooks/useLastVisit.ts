import { useEffect, useRef, useState } from 'react'

const KEY_PREFIX = 'birdbrain:lastVisit:'

/**
 * Per-case "since your last visit" marker, persisted in localStorage (no DB
 * migration). On first mount for a case it reads the previously stored visit
 * timestamp — the value the rest of the Overview compares against — then stamps
 * the current time so the next visit sees a fresh baseline. The returned value
 * stays pinned to the *prior* visit for the lifetime of the mount.
 *
 * Returns null on the very first visit to a case (nothing to compare against).
 */
export function useLastVisit(caseId: string): string | null {
  const [previousVisit, setPreviousVisit] = useState<string | null>(null)
  const stampedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!caseId) return
    if (stampedFor.current === caseId) return
    stampedFor.current = caseId

    const key = KEY_PREFIX + caseId
    const prior = localStorage.getItem(key)
    localStorage.setItem(key, new Date().toISOString())
    setPreviousVisit(prior)
  }, [caseId])

  return previousVisit
}
