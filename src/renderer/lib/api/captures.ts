import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
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

export const searchQueryOptions = (query: string) =>
  queryOptions({
    queryKey: queryKeys.search(query),
    queryFn: () => window.birdbrain.search(query),
    enabled: query.trim().length > 0
  })

export function useCapturesMutations(caseId: string) {
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.captures.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.captureCounts })
    }
  })

  const toggleFavorite = useMutation({
    mutationFn: (captureId: string) => window.birdbrain.captures.toggleFavorite(captureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.captureFavorites(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
    }
  })

  return { remove, toggleFavorite }
}

export function useRecaptureMutations(caseId: string) {
  const enqueue = useMutation({
    mutationFn: (params: { urls: string[]; supersedesCaptureId?: string }) =>
      window.birdbrain.recapture.enqueue({
        urls: params.urls,
        caseId,
        supersedesCaptureId: params.supersedesCaptureId
      })
  })
  // No cache invalidation here: completion arrives via the NEW_CAPTURE event,
  // which useServerStatus already folds into the captures cache.
  return { enqueue }
}
