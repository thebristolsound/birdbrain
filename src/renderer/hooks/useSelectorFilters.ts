import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { selectorMatchingCapturesQueryOptions } from '@renderer/lib/api/selectors'

export function useSelectorFilters(caseId: string | null) {
  const queryClient = useQueryClient()
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)

  useEffect(() => {
    if (!caseId || activeSelectorFilters.length === 0) {
      useAppStore.getState().setFilteredCaptureIds(null)
      return
    }

    let cancelled = false

    queryClient
      .fetchQuery(selectorMatchingCapturesQueryOptions(caseId, activeSelectorFilters))
      .then((ids) => {
        if (!cancelled) useAppStore.getState().setFilteredCaptureIds(ids)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to fetch matching captures:', err)
          useAppStore.getState().setFilteredCaptureIds(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [caseId, activeSelectorFilters, queryClient])
}
