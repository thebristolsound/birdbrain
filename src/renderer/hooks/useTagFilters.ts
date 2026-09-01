import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { listCaptureIdsWithAnyTag } from '@renderer/lib/api/tags'

// The tag half of useSelectorFilters (#918): resolves the active tag ids to
// the capture ids they cover and publishes them for the capture list. Kept a
// separate hook writing a separate store slot, because this one and the
// selector one both null their slot when their own filter list empties.
export function useTagFilters(caseId: string | null) {
  const activeTagFilters = useAppStore((s) => s.activeTagFilters)

  useEffect(() => {
    if (!caseId || activeTagFilters.length === 0) {
      useAppStore.getState().setTagFilteredCaptureIds(null)
      return
    }

    let cancelled = false

    listCaptureIdsWithAnyTag(caseId, activeTagFilters)
      .then((ids) => {
        if (!cancelled) useAppStore.getState().setTagFilteredCaptureIds(ids)
      })
      .catch((err) => {
        // Null, not an empty list: an empty list would hide every capture and
        // read as "no capture carries this tag", which is a claim this failed
        // lookup cannot make.
        if (!cancelled) {
          console.error('Failed to fetch captures for the tag filter:', err)
          useAppStore.getState().setTagFilteredCaptureIds(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [caseId, activeTagFilters])
}
