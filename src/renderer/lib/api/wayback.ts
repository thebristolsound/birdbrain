import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PinWaybackSnapshotParams } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

// `enabled: false` — the lookup is user-initiated (it discloses the URL to
// archive.org). The WaybackTab triggers it with refetch() on button click.
export const waybackLookupQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.waybackLookup(captureId),
    queryFn: () => window.birdbrain.wayback.lookup(captureId),
    enabled: false,
    staleTime: 5 * 60 * 1000
  })

export const waybackPinsQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.waybackPins(captureId),
    queryFn: () => window.birdbrain.wayback.list(captureId),
    enabled: !!captureId
  })

export function useWaybackMutations(captureId: string) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.waybackPins(captureId) })
  }

  const pin = useMutation({
    mutationFn: (params: PinWaybackSnapshotParams) => window.birdbrain.wayback.pin(params),
    onSuccess: invalidate,
    meta: { action: 'pin wayback snapshot' }
  })

  const unpin = useMutation({
    mutationFn: (refId: string) => window.birdbrain.wayback.unpin(refId),
    onSuccess: invalidate,
    meta: { action: 'unpin wayback snapshot' }
  })

  return { pin, unpin }
}
