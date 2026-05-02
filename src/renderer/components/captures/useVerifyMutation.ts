import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@renderer/lib/queries'

export function useVerifyMutation(captureId: string, caseId: string) {
  const queryClient = useQueryClient()
  const mutationKey = ['verify-capture', captureId] as const

  const mutation = useMutation({
    mutationKey,
    mutationFn: () => window.birdbrain.captures.verify(captureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
    }
  })

  const isPending = useIsMutating({ mutationKey }) > 0

  return {
    verify: () => mutation.mutate(),
    isPending,
    error: mutation.error
  }
}
