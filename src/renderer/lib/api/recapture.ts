import { queryOptions, useMutation } from '@tanstack/react-query'
import { queryKeys } from '@renderer/lib/api/keys'

export const recaptureQueueStatusQueryOptions = queryOptions({
  queryKey: queryKeys.recaptureQueue,
  queryFn: () => window.birdbrain.recapture.queueStatus()
})

export function usePipelineTests() {
  const testPipeline = useMutation({
    mutationFn: () => window.birdbrain.testPipeline()
  })

  const testHttp = useMutation({
    mutationFn: () => window.birdbrain.testHttp()
  })

  return { testPipeline, testHttp }
}
