import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { EnqueueResult, LinkedFrom } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'
import { requireContact } from '@renderer/lib/vpnWarning'

// CaptureHealth is the only reader and decides when to poll, so the interval
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
