import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { notify } from '@renderer/lib/notify'
import {
  selectorMatchingCapturesQueryOptions,
  selectorsQueryOptions
} from '@renderer/lib/api/selectors'

// Resolves the active selector ids to the capture ids they match and publishes
// them for the capture list. Resolved through React Query (#1203) so that a
// recapture, a selector edit or a rescan refreshes the list through the
// matching-captures key; a one-shot read only re-resolved on a re-pick and
// left a stale list under a strip claiming the filter was current. The shape
// is useTagFilters', and its comments carry the reasoning for each effect.
export function useSelectorFilters(caseId: string | null) {
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)
  const active = !!caseId && activeSelectorFilters.length > 0

  const { data, isError, isFetching, error } = useQuery(
    selectorMatchingCapturesQueryOptions(caseId ?? '', activeSelectorFilters)
  )
  const { data: selectors } = useQuery({
    ...selectorsQueryOptions(caseId ?? ''),
    enabled: active
  })

  useEffect(() => {
    const store = useAppStore.getState()
    if (!active) {
      store.setFilteredCaptureIds(null)
      return
    }
    store.setFilteredCaptureIds(data ?? [])
  }, [active, data])

  useEffect(() => {
    if (!active || !isError || isFetching) return
    notify.error("Couldn't apply the selector filter.", { code: 'query.failed', cause: error })
    useAppStore.getState().clearSelectorFilters()
  }, [active, isError, isFetching, error])

  useEffect(() => {
    if (!active || !selectors) return
    const known = new Set(selectors.map((s) => s.id))
    for (const id of activeSelectorFilters) {
      if (!known.has(id)) useAppStore.getState().removeSelectorFilter(id)
    }
  }, [active, selectors, activeSelectorFilters])
}
