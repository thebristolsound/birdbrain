import type { Capture } from '@shared/types'

export type SortOption = 'newest' | 'oldest' | 'title-az' | 'url-az'
export type FormatFilter = 'all' | 'html' | 'mhtml'
export type DateFilter = 'all' | 'today' | '7days' | '30days'

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title-az', label: 'Title A–Z' },
  { value: 'url-az', label: 'URL A–Z' }
]

export const FORMAT_OPTIONS: { value: FormatFilter; label: string }[] = [
  { value: 'all', label: 'All formats' },
  { value: 'html', label: 'HTML' },
  { value: 'mhtml', label: 'MHTML' }
]

export const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7days', label: 'Last 7 days' },
  { value: '30days', label: 'Last 30 days' }
]

const DATE_CUTOFFS_MS: Record<Exclude<DateFilter, 'all'>, number> = {
  today: 24 * 60 * 60 * 1000,
  '7days': 7 * 24 * 60 * 60 * 1000,
  '30days': 30 * 24 * 60 * 60 * 1000
}

export interface CaptureListFilters {
  sortBy: SortOption
  formatFilter: FormatFilter
  dateFilter: DateFilter
  favoritesOnly: boolean
}

export interface DisplayInput {
  captures: Capture[]
  /** Selector-filter intersection (capture ids), or null when no selector filter is active. */
  filteredCaptureIds: string[] | null
  favorites: ReadonlySet<string>
  filters: CaptureListFilters
}

export function sortCaptures(captures: Capture[], sort: SortOption): Capture[] {
  const sorted = [...captures]
  switch (sort) {
    case 'newest':
      return sorted.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
    case 'oldest':
      return sorted.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
    case 'title-az':
      return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    case 'url-az':
      return sorted.sort((a, b) => a.url.localeCompare(b.url))
  }
}

export function countActiveFilters({
  formatFilter,
  dateFilter,
  favoritesOnly
}: CaptureListFilters) {
  return (formatFilter !== 'all' ? 1 : 0) + (dateFilter !== 'all' ? 1 : 0) + (favoritesOnly ? 1 : 0)
}

// `now` is injected (defaulting to wall-clock) so the date-cutoff filter is
// deterministic under test.
export function computeDisplayedCaptures(
  { captures, filteredCaptureIds, favorites, filters }: DisplayInput,
  now = Date.now()
): Capture[] {
  const { sortBy, formatFilter, dateFilter, favoritesOnly } = filters
  return sortCaptures(
    (filteredCaptureIds ? captures.filter((c) => filteredCaptureIds.includes(c.id)) : captures)
      .filter((c) => {
        if (formatFilter !== 'all' && c.format !== formatFilter) return false
        if (favoritesOnly && !favorites.has(c.id)) return false
        return true
      })
      .filter((c) => {
        if (dateFilter === 'all') return true
        return new Date(c.timestamp).getTime() >= now - DATE_CUTOFFS_MS[dateFilter]
      }),
    sortBy
  )
}
