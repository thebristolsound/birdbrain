import { useCallback, useMemo, useState } from 'react'
import {
  countActiveFilters,
  describeNarrowings,
  type CaptureListFilters,
  type DateFilter,
  type FormatFilter,
  type SortOption
} from '@renderer/components/captures/captureListModel'
import { useAppStore } from '@renderer/stores/appStore'

export function useCaptureListFilters() {
  // The query is list-local: it narrows what is already on screen, unlike
  // SearchBar, which runs a case-wide FTS query through the store.
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)
  const clearSelectorFilters = useAppStore((s) => s.clearSelectorFilters)
  const activeTagFilters = useAppStore((s) => s.activeTagFilters)
  const addTagFilter = useAppStore((s) => s.addTagFilter)
  const removeTagFilter = useAppStore((s) => s.removeTagFilter)
  const clearTagFilters = useAppStore((s) => s.clearTagFilters)

  // Memoized so consumers can use `filters` as a useMemo/useEffect dependency:
  // a fresh object literal here would defeat any memo keyed on it.
  const filters: CaptureListFilters = useMemo(
    () => ({ query, sortBy, formatFilter, dateFilter, favoritesOnly }),
    [query, sortBy, formatFilter, dateFilter, favoritesOnly]
  )
  const activeFilterCount = countActiveFilters(filters, activeTagFilters.length)
  const narrowings = useMemo(
    () =>
      describeNarrowings({
        filters,
        selectorFilterCount: activeSelectorFilters.length,
        tagFilterCount: activeTagFilters.length
      }),
    [filters, activeSelectorFilters, activeTagFilters]
  )

  // One handler behind every clear affordance, so the operator can never clear
  // one narrowing and be left staring at a list still hidden by another.
  const clearNarrowing = useCallback(() => {
    setQuery('')
    setFormatFilter('all')
    setDateFilter('all')
    setFavoritesOnly(false)
    clearSelectorFilters()
    clearTagFilters()
  }, [clearSelectorFilters, clearTagFilters])

  const toggleTagFilter = useCallback(
    (tagId: string) => {
      if (useAppStore.getState().activeTagFilters.includes(tagId)) removeTagFilter(tagId)
      else addTagFilter(tagId)
    },
    [addTagFilter, removeTagFilter]
  )

  return {
    filters,
    activeFilterCount,
    narrowings,
    isNarrowed: narrowings.length > 0,
    clearNarrowing,
    activeTagFilters,
    toggleTagFilter,
    query,
    setQuery,
    sortBy,
    setSortBy,
    formatFilter,
    setFormatFilter,
    dateFilter,
    setDateFilter,
    favoritesOnly,
    setFavoritesOnly
  }
}
