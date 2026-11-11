import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { EnqueueResult, HeldBatch, LinkedFrom, RecaptureJobTarget } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'
import { notify } from '@renderer/lib/notify'
import { requireContact } from '@renderer/lib/vpnWarning'

// The status group and the capture log each decide when to poll, so the interval
// stays at the call site.
export const recaptureQueueQueryOptions = queryOptions({
  queryKey: queryKeys.recaptureQueue,
  queryFn: () => window.birdbrain.recapture.queueStatus()
})

// Two top-level bridge commands rather than members of the recapture
// namespace, but they exercise the recapture path end to end and CaptureHealth
// is their only caller.
export function testCapturePipeline(): Promise<{
  success: boolean
  durationMs: number
  error?: string
}> {
  return window.birdbrain.testPipeline()
}

export function testCaptureHttp(): Promise<{
  success: boolean
  durationMs: number
  error?: string
}> {
  return window.birdbrain.testHttp()
}

// Every recapture and added URL contacts a site, so each passes the VPN warning first
// (ADR-0032). A contact stopped there rejects with ContactStoppedError, which the mutation
// cache does not toast.
export function useRecaptureMutations(caseId: string) {
  const queryClient = useQueryClient()
  const enqueue = useMutation({
    mutationFn: async (params: {
      urls: string[]
      supersedesCaptureId?: string
      linkedFrom?: LinkedFrom
    }) => {
      await requireContact({ caseId }, 'site')
      return window.birdbrain.recapture.enqueue({
        urls: params.urls,
        caseId,
        supersedesCaptureId: params.supersedesCaptureId,
        linkedFrom: params.linkedFrom
      })
    },
    meta: { action: 'queue recapture' }
  })
  // No cache invalidation here: completion arrives via the NEW_CAPTURE event,
  // which useServerStatus already folds into the captures cache.

  // Batch recapture (#394): one job per capture, each superseding itself.
  const enqueueCaptures = useMutation<EnqueueResult, unknown, string[]>({
    mutationFn: async (captureIds) => {
      await requireContact({ caseId }, 'site')
      return window.birdbrain.recapture.enqueueCaptures({ caseId, captureIds })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recaptureQueue })
    },
    meta: { action: 'queue recapture' }
  })
  return { enqueue, enqueueCaptures }
}

export async function enqueueEventRecapture(
  caseId: string,
  captureId: string
): Promise<EnqueueResult> {
  await requireContact({ caseId }, 'site')
  return window.birdbrain.recapture.enqueueCaptures({ caseId, captureIds: [captureId] })
}

// A held Batch sends its requests once resumed, so resuming passes the VPN warning first, as
// queueing it did in its own session.
export function useResumeHeldBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ caseId, batchId }: HeldBatch) => {
      await requireContact({ caseId }, 'site')
      return window.birdbrain.recapture.resume({ batchId })
    },
    // The queue refuses a resume while no operator name is set, as it refuses a new Batch.
    onSuccess: ({ reason }) => {
      if (reason) notify.warn(`Resume rejected: ${reason}`)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recaptureQueue })
    },
    meta: { action: 'resume held captures' }
  })
}

// Cancel sends nothing, so it asks no warning.
export function useCancelBackgroundJobs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (target: RecaptureJobTarget) => window.birdbrain.recapture.cancel(target),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recaptureQueue })
    },
    meta: { action: 'cancel background captures' }
  })
}

// A retry sends its requests again, so it passes the VPN warning for the jobs' Case first.
export function useRetryBackgroundJobs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ caseId, target }: { caseId: string; target: RecaptureJobTarget }) => {
      await requireContact({ caseId }, 'site')
      return window.birdbrain.recapture.retry(target)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recaptureQueue })
    },
    meta: { action: 'retry background captures' }
  })
}
