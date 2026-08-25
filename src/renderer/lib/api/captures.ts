import { queryOptions, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Capture } from '@shared/types'
import type { BatchCountResult, BatchDeleteResult, DuplicateCaptureResult } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

export const capturesQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.captures(caseId),
    queryFn: () => window.birdbrain.captures.list(caseId),
    enabled: !!caseId
  })

export const captureCountsQueryOptions = queryOptions({
  queryKey: queryKeys.captureCounts,
  queryFn: () => window.birdbrain.captures.countsByCase()
})

export const captureContentQueryOptions = (captureId: string, type: 'html' | 'png' | 'txt') =>
  queryOptions({
    queryKey: queryKeys.captureContent(captureId, type),
    queryFn: () => window.birdbrain.captures.getContent(captureId, type),
    enabled: !!captureId
  })

export const captureThumbnailQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.captureThumbnail(captureId),
    queryFn: () => window.birdbrain.captures.getThumbnail(captureId),
    enabled: !!captureId
  })

export const captureMhtmlUrlQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.captureMhtmlUrl(captureId),
    queryFn: () => window.birdbrain.captures.getMhtmlUrl(captureId),
    enabled: !!captureId
  })

export const captureMatchingSelectorsQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.captureMatchingSelectors(captureId),
    queryFn: () => window.birdbrain.captures.getMatchingSelectors(captureId),
    enabled: !!captureId
  })

export const captureFavoritesQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.captureFavorites(caseId),
    queryFn: () => window.birdbrain.captures.listFavorites(caseId),
    enabled: !!caseId
  })

export const searchQueryOptions = (caseId: string, query: string) =>
  queryOptions({
    queryKey: queryKeys.search(caseId, query),
    queryFn: () => window.birdbrain.search(caseId, query),
    enabled: !!caseId && query.trim().length > 0
  })

// Uncached counterparts to the two query factories above, for the foreground
// match preview: it walks every candidate capture's text on demand and would
// otherwise park a case's worth of capture bodies in the cache.
export function listCaptures(caseId: string): Promise<Capture[]> {
  return window.birdbrain.captures.list(caseId)
}

export function getCaptureContent(
  captureId: string,
  type: 'html' | 'png' | 'txt'
): Promise<string | null> {
  return window.birdbrain.captures.getContent(captureId, type)
}

export function useCapturesMutations(caseId: string) {
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.captures.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.captureCounts })
    },
    meta: { action: 'delete capture' }
  })

  const toggleFavorite = useMutation({
    mutationFn: (captureId: string) => window.birdbrain.captures.toggleFavorite(captureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captureFavorites(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
    },
    meta: { action: 'toggle favorite' }
  })

  // Batch delete (#394). The result is prefix-commit, so a partial failure is
  // still a success at the mutation level: the caller reads `failedIds` for the
  // retry payload and `deletedIds` for what actually went.
  const removeMany = useMutation<BatchDeleteResult, unknown, string[]>({
    mutationFn: (captureIds) => window.birdbrain.captures.deleteMany({ caseId, captureIds }),
    onSuccess: (result) => {
      // A not_found rejection means the cache showed a row that is already
      // gone (removed from another window), so it is as stale as a deletion.
      const sawStale = result.outcomes.some(
        (o) => o.status === 'rejected' && o.reason === 'not_found'
      )
      if (result.deletedIds.length === 0 && !sawStale) return
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.captureCounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.captureFavorites(caseId) })
    },
    meta: { action: 'delete captures' }
  })

  // #827. A refusal (`status: 'rejected'`) is a resolved result, not a throw,
  // so the mutation succeeds either way and the caller reads the outcome. Only
  // a real duplicate changes the list, so only that invalidates.
  const duplicate = useMutation<DuplicateCaptureResult, unknown, string>({
    mutationFn: (captureId) => window.birdbrain.captures.duplicate(captureId),
    onSuccess: (result) => {
      if (result.status !== 'duplicated') return
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.captureCounts })
    },
    meta: { action: 'duplicate the capture' }
  })

  const setFavoriteMany = useMutation<
    BatchCountResult,
    unknown,
    { captureIds: string[]; favorite: boolean }
  >({
    mutationFn: ({ captureIds, favorite }) =>
      window.birdbrain.captures.setFavoriteMany({ caseId, captureIds, favorite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captureFavorites(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
    },
    meta: { action: 'set favorites' }
  })

  return { remove, toggleFavorite, removeMany, duplicate, setFavoriteMany }
}

// Shared by ProvenanceBadge, ForensicsTab and CaptureDetailsPanel, all three
// mounted for the same capture at once. `data` on the return is exposed
// alongside the isPending/verify pair so ProvenanceBadge can render the fresh
// HashVerification result immediately, ahead of the captures list refetch.
export function useVerifyCapture(captureId: string, caseId: string) {
  const queryClient = useQueryClient()
  const mutationKey = ['verify-capture', captureId] as const

  const mutation = useMutation({
    mutationKey,
    mutationFn: () => window.birdbrain.captures.verify(captureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
    }
  })

  // useIsMutating (not mutation.isPending): pending state is keyed by
  // captureId so every observer of the same capture — the badge and both
  // detail tabs — agrees on it, not just the instance that triggered it.
  const isPending = useIsMutating({ mutationKey }) > 0

  return {
    verify: () => mutation.mutate(),
    isPending,
    error: mutation.error,
    data: mutation.data
  }
}
