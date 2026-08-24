import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PinWaybackSnapshotParams } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

// `enabled: false` — the lookup is user-initiated (it discloses the URL to
// archive.org). The Wayback panel triggers it with refetch() on button click.
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

// Case-wide pins, for surfaces that show corroboration across captures — the
// export dialog's pinned-snapshots block. Reads the database only; it never
// contacts archive.org, so it is safe to run without operator intent.
export const waybackCasePinsQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.waybackCasePins(caseId),
    queryFn: () => window.birdbrain.wayback.listForCase(caseId),
    enabled: !!caseId
  })

export function useWaybackMutations(captureId: string) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.waybackPins(captureId) })
    // The export dialog reads the case-wide list, which a pin on any capture
    // changes.
    queryClient.invalidateQueries({ queryKey: ['wayback', 'casePins'] })
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
