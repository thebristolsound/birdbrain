import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { WaybackLinkBatchResult } from '@shared/ipc'
import type { KnownEgress } from '@shared/types'
import { waybackLinkLookupQueryOptions } from '@renderer/lib/api/wayback'
import { notify } from '@renderer/lib/notify'

/** A row's batch state while it has no answer in the cache to show instead. */
export type BatchCellState = { state: 'checking' } | { state: 'failed'; error: string; at: number }

export interface WaybackLinkBatch {
  cells: ReadonlyMap<string, BatchCellState>
  running: boolean
  /** How many addresses of the running or last batch were answered or failed. */
  done: number
  total: number
  outcome: WaybackLinkBatchResult | null
  startError: string | null
  /** Sends `send`, the list the confirmation showed, as it is. */
  start: (send: string[], egress: KnownEgress) => void
  cancel: () => void
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * A Wayback batch over the Links tab of `captureId` (#1738, plan S4). Answers land in the
 * same cache the single-link lookup fills, keyed by Capture and address, so an answer
 * reaches every row that holds its address. Leaving the tab cancels a running batch: no
 * batch runs where the Operator cannot see it or stop it.
 */
export function useWaybackLinkBatch(captureId: string): WaybackLinkBatch {
  const queryClient = useQueryClient()
  const [cells, setCells] = useState<ReadonlyMap<string, BatchCellState>>(new Map())
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [outcome, setOutcome] = useState<WaybackLinkBatchResult | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const runningRef = useRef(false)

  useEffect(
    () =>
      window.birdbrain.onWaybackLinkProgress((update) => {
        if (update.captureId !== captureId) return
        const { url } = update
        if (update.state === 'answered') {
          queryClient.setQueryData(
            waybackLinkLookupQueryOptions(captureId, url).queryKey,
            update.result
          )
        }
        if (update.state === 'answered' || update.state === 'failed') setDone((n) => n + 1)
        setCells((prev) => {
          const next = new Map(prev)
          if (update.state === 'checking') next.set(url, { state: 'checking' })
          else if (update.state === 'failed') {
            next.set(url, { state: 'failed', error: update.error, at: Date.now() })
          } else next.delete(url)
          return next
        })
      }),
    [captureId, queryClient]
  )

  useEffect(
    () => () => {
      if (!runningRef.current) return
      window.birdbrain.wayback.cancelLookupLinks(captureId).catch((cause: unknown) => {
        notify.error('The Wayback batch could not be cancelled', { cause })
      })
    },
    [captureId]
  )

  const start = useCallback(
    (send: string[], egress: KnownEgress) => {
      runningRef.current = true
      setRunning(true)
      setCells(new Map())
      setDone(0)
      setTotal(send.length)
      setOutcome(null)
      setStartError(null)
      window.birdbrain.wayback
        .lookupLinks({ captureId, urls: send, egress })
        .then(setOutcome, (cause: unknown) => setStartError(messageOf(cause)))
        .finally(() => {
          runningRef.current = false
          setRunning(false)
          // No answer arrives for a row still marked checking once the batch has ended.
          setCells((prev) => new Map([...prev].filter(([, cell]) => cell.state !== 'checking')))
        })
    },
    [captureId]
  )

  const cancel = useCallback(() => {
    window.birdbrain.wayback
      .cancelLookupLinks(captureId)
      .catch((cause: unknown) => setStartError(`Could not cancel: ${messageOf(cause)}`))
  }, [captureId])

  return { cells, running, done, total, outcome, startError, start, cancel }
}
