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
  // Bumped by every run and every reset. A mutation callback that does not own
  // the current token belongs to a rescan the operator has moved on from:
  // without this, selecting another signal and then having the abandoned invoke
  // come back `false` or rejected paints "Rescan failed" onto the selector now
  // on screen, for a rescan nobody asked for. Only reset needs the guard — a
  // second run() replaces React Query's stored mutate callbacks, so a superseded
  // run's callbacks never fire in that case.
  const requestToken = useRef(0)

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
    requestToken.current += 1
    pendingId.current = null
    setStatus('idle')
  }

  const run = (selectorId: string): void => {
    requestToken.current += 1
    const token = requestToken.current
    pendingId.current = selectorId
    setStatus('running')
    rescan.mutate(selectorId, {
      onSuccess: (scheduled) => {
        if (requestToken.current !== token) return
        // The selector was gone by the time main read it, so no pass exists and
        // no event will ever clear 'running'. Reported as an error rather than
        // dropped quietly: the operator asked for a rescan that did not happen.
        if (!scheduled) {
          pendingId.current = null
          setStatus('error')
        }
      },
      onError: () => {
        if (requestToken.current !== token) return
        pendingId.current = null
        setStatus('error')
      }
    })
  }

  return { status, run, reset }
}
