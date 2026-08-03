import { useMutation } from '@tanstack/react-query'

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
