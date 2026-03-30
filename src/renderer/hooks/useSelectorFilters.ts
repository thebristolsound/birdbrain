import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'

export function useSelectorFilters(caseId: string | null) {
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)
  const setFilteredCaptureIds = useAppStore((s) => s.setFilteredCaptureIds)

  useEffect(() => {
    if (!caseId || activeSelectorFilters.length === 0) {
      setFilteredCaptureIds(null)
      return
    }

    let cancelled = false

    window.birdbrain.selectors
      .matchingCaptures(caseId, activeSelectorFilters)
      .then((ids) => {
        if (!cancelled) setFilteredCaptureIds(ids)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to fetch matching captures:', err)
          setFilteredCaptureIds(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [caseId, activeSelectorFilters, setFilteredCaptureIds])
}
