import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PinArchiveSnapshotParams } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

// `enabled: false` — the lookup is user-initiated (it discloses the URL to
// archive.org). The ArchiveTab triggers it with refetch() on button click.
export const archiveLookupQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.archiveLookup(captureId),
    queryFn: () => window.birdbrain.archive.lookup(captureId),
    enabled: false,
    staleTime: 5 * 60 * 1000
  })

export const archivePinsQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.archivePins(captureId),
    queryFn: () => window.birdbrain.archive.list(captureId),
    enabled: !!captureId
  })

export function useArchiveMutations(captureId: string) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.archivePins(captureId) })
  }

  const pin = useMutation({
    mutationFn: (params: PinArchiveSnapshotParams) => window.birdbrain.archive.pin(params),
    onSuccess: invalidate
  })

  const unpin = useMutation({
    mutationFn: (refId: string) => window.birdbrain.archive.unpin(refId),
    onSuccess: invalidate
  })

  return { pin, unpin }
}
