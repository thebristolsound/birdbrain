import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PinWaybackSnapshotParams } from '@shared/ipc'
import type { WaybackLookupResult } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { confirmContact, requireContact } from '@renderer/lib/vpnWarning'

// `enabled: false` — the lookup is user-initiated (it discloses the URL to
// archive.org). The Wayback panel triggers it with refetch() on button click,
// and it passes the VPN warning first (ADR-0032). A lookup stopped there sends
// nothing and keeps the result already shown, or none, rather than failing.
export const waybackLookupQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.waybackLookup(captureId),
    queryFn: async ({ client, queryKey }): Promise<WaybackLookupResult | null> => {
      if (!(await confirmContact({ captureId }, 'site'))) {
        return client.getQueryData<WaybackLookupResult | null>(queryKey) ?? null
      }
      return window.birdbrain.wayback.lookup(captureId)
    },
    enabled: false,
    staleTime: 5 * 60 * 1000
  })

// One link of a stored page (#1737), keyed by that page's Capture and the address. Also
// user-initiated: the link menu fills the cache with fetchQuery, and the Links tab's cell
// only reads it. The answer lives here and nowhere else, so a restart drops it. It passes
// the VPN warning first. A stop there rejects rather than resolving, because fetchQuery
// would serve a resolved value for five minutes without asking the warning again.
export const waybackLinkLookupQueryOptions = (captureId: string, url: string) =>
  queryOptions({
    queryKey: queryKeys.waybackLinkLookup(captureId, url),
    queryFn: async () => {
      await requireContact({ captureId }, 'site')
      return window.birdbrain.wayback.lookupLink({ captureId, url })
    },
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
