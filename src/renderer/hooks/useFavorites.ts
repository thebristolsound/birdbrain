import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export function useFavorites(caseId: string) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false
    setFavorites(new Set())

    window.birdbrain.captures
      .listFavorites(caseId)
      .then((ids) => {
        if (!cancelled) {
          setFavorites(new Set(ids))
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load favorites:', err)
        }
      })

    return () => {
      cancelled = true
    }
  }, [caseId])

  const toggleFavorite = async (captureId: string) => {
    try {
      const isFavorite = await window.birdbrain.captures.toggleFavorite(captureId)
      setFavorites((prev) => {
        const next = new Set(prev)
        if (isFavorite) {
          next.add(captureId)
        } else {
          next.delete(captureId)
        }
        return next
      })
      // Invalidate captures query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['captures', caseId] })
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
    }
  }

  return { favorites, toggleFavorite }
}
