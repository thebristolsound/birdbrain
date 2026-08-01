import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { captureFavoritesQueryOptions, useCapturesMutations } from '@renderer/lib/queries'

// Shared empty default so the `data = []` fallback does not mint a new array
// (and therefore a new Set) on every render while the query has no data yet.
const NO_FAVORITE_IDS: string[] = []

export function useFavorites(caseId: string) {
  const { data: favoriteIds = NO_FAVORITE_IDS, isLoading } = useQuery(
    captureFavoritesQueryOptions(caseId)
  )
  const { toggleFavorite: toggleFavoriteMutation } = useCapturesMutations(caseId)

  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds])

  const toggleFavorite = async (captureId: string) => {
    await toggleFavoriteMutation.mutateAsync(captureId)
  }

  return { favorites, toggleFavorite, isLoading }
}
