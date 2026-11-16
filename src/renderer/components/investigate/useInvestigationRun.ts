import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useInvestigationMutations } from '@renderer/lib/api/investigation'
import { queryKeys } from '@renderer/lib/api/keys'
import type { RunRequest, RunStatus } from '@shared/investigation'

type InquiryRequest = Omit<Extract<RunRequest, { from: 'inquiry' }>, 'caseId'>

/**
 * Starts a run and reports when it ends.
 *
 * `investigation:startRun` resolves with the run id while the run is still reading, so its
 * pending state says nothing about the outcome. The run's last progress event, the one whose
 * status is not `running`, is what ends `running` here and makes the view read the Case again.
 */
export function useInvestigationRun(caseId: string, onEnded: (status: RunStatus) => void) {
  const queryClient = useQueryClient()
  const { startRun } = useInvestigationMutations(caseId)
  const [running, setRunning] = useState(false)
  // Refs, not state: the subscription is installed once per Case, and an event can arrive before
  // `startRun` resolves with the id it belongs to.
  const pendingId = useRef<string | null>(null)
  const endedEarly = useRef(new Map<string, RunStatus>())
  const onEndedRef = useRef(onEnded)

  useEffect(() => {
    onEndedRef.current = onEnded
  })

  const finish = (status: RunStatus): void => {
    pendingId.current = null
    setRunning(false)
    void queryClient.invalidateQueries({ queryKey: queryKeys.investigationView(caseId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.investigationRevision(caseId) })
    onEndedRef.current(status)
  }

  useEffect(
    () =>
      window.birdbrain.onInvestigationProgress((event) => {
        if (event.caseId !== caseId || event.status === 'running') return
        if (pendingId.current === event.runId) finish(event.status)
        else endedEarly.current.set(event.runId, event.status)
      }),
    [caseId]
  )

  const run = (request: InquiryRequest): void => {
    setRunning(true)
    startRun.mutate(request, {
      onSuccess: (runId) => {
        const status = endedEarly.current.get(runId)
        endedEarly.current.delete(runId)
        if (status) finish(status)
        else pendingId.current = runId
      },
      onError: () => setRunning(false)
    })
  }

  return { running, run }
}
