import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SessionStateEvent } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

// Session control moved from the localhost HTTP server to IPC (#228); the
// server is extension-only now. Every mutation returns the new snapshot, so
// the cache is set from the response rather than refetched.
export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.session,
    queryFn: () => window.birdbrain.session.snapshot()
  })

export function useSessionMutations() {
  const queryClient = useQueryClient()
  const write = (snapshot: SessionStateEvent): void => {
    queryClient.setQueryData(queryKeys.session, snapshot)
  }

  const activateCase = useMutation({
    mutationFn: (caseId: string) => window.birdbrain.session.activateCase(caseId),
    onSuccess: write
  })

  const start = useMutation({
    mutationFn: () => window.birdbrain.session.start(),
    onSuccess: write
  })

  const stop = useMutation({
    mutationFn: () => window.birdbrain.session.stop(),
    onSuccess: write
  })

  return { activateCase, start, stop }
}
