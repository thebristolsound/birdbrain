import { useQuery } from '@tanstack/react-query'
import { captureFavoritesQueryOptions, useCapturesMutations } from '@renderer/lib/queries'

export function useFavorites(caseId: string) {
  const { data: favoriteIds = [], isLoading } = useQuery(captureFavoritesQueryOptions(caseId))
  const { toggleFavorite: toggleFavoriteMutation } = useCapturesMutations(caseId)

  const favorites = new Set(favoriteIds)

  const toggleFavorite = async (captureId: string) => {
    await toggleFavoriteMutation.mutateAsync(captureId)
  }

  return { favorites, toggleFavorite, isLoading }
}
