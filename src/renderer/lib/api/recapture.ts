import { queryOptions, useMutation } from '@tanstack/react-query'
import { queryKeys } from '@renderer/lib/api/keys'

// The queue only renders inside the CaptureHealth popover, so the poll
// interval and `enabled` stay at the call site.
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

export function useRecaptureMutations(caseId: string) {
  const enqueue = useMutation({
    mutationFn: (params: { urls: string[]; supersedesCaptureId?: string }) =>
      window.birdbrain.recapture.enqueue({
        urls: params.urls,
        caseId,
        supersedesCaptureId: params.supersedesCaptureId
      }),
    meta: { action: 'queue recapture' }
  })
  // No cache invalidation here: completion arrives via the NEW_CAPTURE event,
  // which useServerStatus already folds into the captures cache.
  return { enqueue }
}
