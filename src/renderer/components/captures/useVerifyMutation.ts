import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@renderer/lib/queries'

export function useVerifyMutation(captureId: string, caseId: string) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationKey: ['verify-capture', captureId],
    mutationFn: () => window.birdbrain.captures.verify(captureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
    }
  })

  return {
    verify: () => mutation.mutate(),
    isPending: mutation.isPending,
    error: mutation.error
  }
}
