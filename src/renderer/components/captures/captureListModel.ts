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

// One wording for every control wired to `clearNarrowing`. Three controls shared
// that handler and named it three different ways (#1033); a shared constant is
// what stops them drifting apart again. "All filters" covers both the Filter
// menu's own filters and the selector filters, which the strip and the narrowed
// empty state enumerate beside the control anyway.
export const CLEAR_NARROWING_LABEL = 'Clear search and all filters'

const DATE_CUTOFFS_MS: Record<Exclude<DateFilter, 'all'>, number> = {
  today: 24 * 60 * 60 * 1000,
  '7days': 7 * 24 * 60 * 60 * 1000,
  '30days': 30 * 24 * 60 * 60 * 1000
}

export interface CaptureListFilters {
  /** Per-list text query. Narrows the loaded list by title and URL; never hits the search index. */
  query: string
  sortBy: SortOption
  formatFilter: FormatFilter
  dateFilter: DateFilter
  favoritesOnly: boolean
}

export interface DisplayInput {
  captures: Capture[]
  /** Selector-filter intersection (capture ids), or null when no selector filter is active. */
  filteredCaptureIds: string[] | null
  /**
   * Captures carrying any of the active tags (#918), or null when no tag
   * filter is active. Union within the tag set, intersected with every other
   * narrowing — picking a second tag widens, picking a format narrows.
   */
  tagFilteredCaptureIds: string[] | null
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

// Menu-scoped on purpose: this feeds the Filter button's badge, so it counts
// exactly what the Filter menu shows. Narrowings the menu does not own (the
// query, selector filters) belong to `describeNarrowings` instead. Tags are
// counted because the menu grew a Tags section (#918) — each picked tag is one
// tick in the menu, so it is one on the badge.
export function countActiveFilters(
  { formatFilter, dateFilter, favoritesOnly }: CaptureListFilters,
  tagFilterCount: number
) {
  return (
    (formatFilter !== 'all' ? 1 : 0) +
    (dateFilter !== 'all' ? 1 : 0) +
    (favoritesOnly ? 1 : 0) +
    tagFilterCount
  )
}

export function matchesQuery(capture: Capture, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    (capture.title || '').toLowerCase().includes(needle) ||
    capture.url.toLowerCase().includes(needle)
  )
}

export interface NarrowingInput {
  filters: CaptureListFilters
  selectorFilterCount: number
  tagFilterCount: number
}

/**
 * Every narrowing currently hiding rows, named. Drives the header strip and the
 * narrowed empty state so an operator staring at a short list can always see
 * what caused it.
 */
export function describeNarrowings({
  filters,
  selectorFilterCount,
  tagFilterCount
}: NarrowingInput): string[] {
  const { query, formatFilter, dateFilter, favoritesOnly } = filters
  const labels: string[] = []
  const trimmed = query.trim()
  if (trimmed) labels.push(`Search "${trimmed}"`)
  if (selectorFilterCount > 0) {
    labels.push(`${selectorFilterCount} selector filter${selectorFilterCount !== 1 ? 's' : ''}`)
  }
  // "(any)" only past one tag, where the union is a claim worth making: two
  // ticked tags widen the list rather than demanding both, and an operator who
  // read it as AND would take a longer list for a shorter one.
  if (tagFilterCount > 0) {
    labels.push(tagFilterCount === 1 ? '1 tag filter' : `${tagFilterCount} tag filters (any)`)
  }
  if (formatFilter !== 'all') {
    labels.push(FORMAT_OPTIONS.find((o) => o.value === formatFilter)?.label ?? formatFilter)
  }
  if (dateFilter !== 'all') {
    labels.push(DATE_OPTIONS.find((o) => o.value === dateFilter)?.label ?? dateFilter)
  }
  if (favoritesOnly) labels.push('Favorites only')
  return labels
}

export function isNarrowed(input: NarrowingInput): boolean {
  return describeNarrowings(input).length > 0
}

// `now` is injected (defaulting to wall-clock) so the date-cutoff filter is
// deterministic under test.
export function computeDisplayedCaptures(
  { captures, filteredCaptureIds, tagFilteredCaptureIds, favorites, filters }: DisplayInput,
  now = Date.now()
): Capture[] {
  const { query, sortBy, formatFilter, dateFilter, favoritesOnly } = filters
  const filterIdSet = filteredCaptureIds ? new Set(filteredCaptureIds) : null
  const tagIdSet = tagFilteredCaptureIds ? new Set(tagFilteredCaptureIds) : null
  return sortCaptures(
    (filterIdSet ? captures.filter((c) => filterIdSet.has(c.id)) : captures)
      .filter((c) => (tagIdSet ? tagIdSet.has(c.id) : true))
      .filter((c) => matchesQuery(c, query))
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
