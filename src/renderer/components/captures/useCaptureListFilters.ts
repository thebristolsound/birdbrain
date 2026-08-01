import { useState } from 'react'
import {
  countActiveFilters,
  type CaptureListFilters,
  type DateFilter,
  type FormatFilter,
  type SortOption
} from '@renderer/components/captures/captureListModel'

export function useCaptureListFilters() {
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  const filters: CaptureListFilters = { sortBy, formatFilter, dateFilter, favoritesOnly }
  const activeFilterCount = countActiveFilters(filters)

  function clearAllFilters() {
    setFormatFilter('all')
    setDateFilter('all')
    setFavoritesOnly(false)
  }

  return {
    filters,
    activeFilterCount,
    clearAllFilters,
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
