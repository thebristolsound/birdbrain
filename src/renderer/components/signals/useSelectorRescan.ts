import { useEffect, useRef, useState } from 'react'
import { useSelectorsMutations } from '@renderer/lib/api/selectors'

export type SelectorRescanStatus = 'idle' | 'running' | 'done' | 'error'

/**
 * Drives the operator-invoked selector backfill (#829).
 *
 * `selectors:rescan` resolves as soon as the pass is scheduled, so the mutation's
 * own pending state says nothing about whether rows were written. Completion
 * arrives on `event:selector:rematched`, and that is what moves this out of
 * `running` — the button never claims a rescan finished before it did.
 */
export function useSelectorRescan(caseId: string) {
  const { rescan } = useSelectorsMutations(caseId)
  const [status, setStatus] = useState<SelectorRescanStatus>('idle')
  // A ref rather than state: the subscription is installed once, so reading the
  // pending id from a closure over state would pin it to its mount-time value.
  const pendingId = useRef<string | null>(null)

  useEffect(() => {
    return window.birdbrain.onSelectorRematched((event) => {
      const pending = pendingId.current
      if (!pending || !event.selectorIds.includes(pending)) return
      pendingId.current = null
      // 'error' is reported as-is: a pass that failed part-way may still have
      // inserted rows, and saying "done" would overstate what ran.
      setStatus(event.status === 'error' ? 'error' : 'done')
    })
  }, [])

  const reset = (): void => {
    pendingId.current = null
    setStatus('idle')
  }

  const run = (selectorId: string): void => {
    pendingId.current = selectorId
    setStatus('running')
    rescan.mutate(selectorId, {
      onSuccess: (scheduled) => {
        // The selector was gone by the time main read it, so no pass exists and
        // no event will ever clear 'running'. Reported as an error rather than
        // dropped quietly: the operator asked for a rescan that did not happen.
        if (!scheduled) {
          pendingId.current = null
          setStatus('error')
        }
      },
      onError: () => {
        pendingId.current = null
        setStatus('error')
      }
    })
  }

  return { status, run, reset }
}
