import { useState, useRef, useEffect } from 'react'
import { Search, ArrowUpDown, Filter, Crosshair, X, Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { capturesQueryOptions } from '@renderer/lib/queries'
import { useAppStore } from '@renderer/stores/appStore'
import { useFavorites } from '@renderer/hooks/useFavorites'
import { CaptureItem } from './CaptureItem'
import type { Capture } from '@shared/types'

interface CaptureListProps {
  caseId: string
}

type SortOption = 'newest' | 'oldest' | 'title-az' | 'url-az'
type FormatFilter = 'all' | 'html' | 'mhtml'
type DateFilter = 'all' | 'today' | '7days' | '30days'

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title-az', label: 'Title A–Z' },
  { value: 'url-az', label: 'URL A–Z' }
]

const FORMAT_OPTIONS: { value: FormatFilter; label: string }[] = [
  { value: 'all', label: 'All formats' },
  { value: 'html', label: 'HTML' },
  { value: 'mhtml', label: 'MHTML' }
]

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7days', label: 'Last 7 days' },
  { value: '30days', label: 'Last 30 days' }
]

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [ref, onClose])
}

function sortCaptures(captures: Capture[], sort: SortOption): Capture[] {
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

export function CaptureList({ caseId }: CaptureListProps) {
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const filteredCaptureIds = useAppStore((s) => s.filteredCaptureIds)
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)
  const clearSelectorFilters = useAppStore((s) => s.clearSelectorFilters)
  const { favorites, toggleFavorite } = useFavorites(caseId)
  const [searchQuery, setSearchQuery] = useState('')

  // Sort & filter state
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)

  const sortRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  useClickOutside(sortRef, () => setShowSortMenu(false))
  useClickOutside(filterRef, () => setShowFilterMenu(false))

  const activeFilterCount =
    (formatFilter !== 'all' ? 1 : 0) + (dateFilter !== 'all' ? 1 : 0) + (favoritesOnly ? 1 : 0)

  const displayedCaptures = sortCaptures(
    (filteredCaptureIds ? captures.filter((c) => filteredCaptureIds.includes(c.id)) : captures)
      .filter((c) => {
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        return c.title?.toLowerCase().includes(q) || c.url.toLowerCase().includes(q)
      })
      .filter((c) => {
        if (formatFilter !== 'all' && c.format !== formatFilter) return false
        if (favoritesOnly && !favorites.has(c.id)) return false
        return true
      })
      .filter((c) => {
        if (dateFilter === 'all') return true
        const cutoffs = {
          today: 24 * 60 * 60 * 1000,
          '7days': 7 * 24 * 60 * 60 * 1000,
          '30days': 30 * 24 * 60 * 60 * 1000
        }
        return new Date(c.timestamp).getTime() >= Date.now() - cutoffs[dateFilter]
      }),
    sortBy
  )

  function clearAllFilters() {
    setFormatFilter('all')
    setDateFilter('all')
    setFavoritesOnly(false)
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r bg-surface border-border">
      {/* Header: search + sort/filter + selector indicator */}
      <div className="border-b p-2 border-border">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search captures..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-7 pr-2 text-xs text-text-secondary placeholder:text-text-faint outline-none focus:border-accent/30"
          />
        </div>
        {/* Sort + Filter buttons */}
        <div className="mt-1.5 flex gap-1">
          {/* Sort dropdown */}
          <div ref={sortRef} className="relative">
            <button
              onClick={() => {
                setShowSortMenu(!showSortMenu)
                setShowFilterMenu(false)
              }}
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] hover:bg-elevated ${
                sortBy !== 'newest' ? 'text-accent' : 'text-text-muted hover:text-text-muted'
              }`}
            >
              <ArrowUpDown className="h-3 w-3" />
              {SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? 'Sort'}
            </button>
            {showSortMenu && (
              <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-lg border border-border bg-card py-1 shadow-lg">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSortBy(opt.value)
                      setShowSortMenu(false)
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-elevated ${
                      sortBy === opt.value ? 'text-accent' : 'text-text-secondary'
                    }`}
                  >
                    <Check
                      className={`h-3 w-3 shrink-0 ${sortBy === opt.value ? 'opacity-100' : 'opacity-0'}`}
                    />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Filter dropdown */}
          <div ref={filterRef} className="relative">
            <button
              onClick={() => {
                setShowFilterMenu(!showFilterMenu)
                setShowSortMenu(false)
              }}
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] hover:bg-elevated ${
                activeFilterCount > 0 ? 'text-accent' : 'text-text-muted hover:text-text-muted'
              }`}
            >
              <Filter className="h-3 w-3" />
              Filter
              {activeFilterCount > 0 && (
                <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-medium text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {showFilterMenu && (
              <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-card py-1 shadow-lg">
                {/* Format section */}
                <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                  Format
                </div>
                {FORMAT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFormatFilter(opt.value)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-elevated ${
                      formatFilter === opt.value ? 'text-accent' : 'text-text-secondary'
                    }`}
                  >
                    <Check
                      className={`h-3 w-3 shrink-0 ${formatFilter === opt.value ? 'opacity-100' : 'opacity-0'}`}
                    />
                    {opt.label}
                  </button>
                ))}
                {/* Divider */}
                <div className="my-1 border-t border-border" />
                {/* Date section */}
                <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                  Date
                </div>
                {DATE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDateFilter(opt.value)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-elevated ${
                      dateFilter === opt.value ? 'text-accent' : 'text-text-secondary'
                    }`}
                  >
                    <Check
                      className={`h-3 w-3 shrink-0 ${dateFilter === opt.value ? 'opacity-100' : 'opacity-0'}`}
                    />
                    {opt.label}
                  </button>
                ))}
                {/* Divider */}
                <div className="my-1 border-t border-border" />
                {/* Favorites toggle */}
                <button
                  onClick={() => setFavoritesOnly(!favoritesOnly)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-elevated ${
                    favoritesOnly ? 'text-accent' : 'text-text-secondary'
                  }`}
                >
                  <Check
                    className={`h-3 w-3 shrink-0 ${favoritesOnly ? 'opacity-100' : 'opacity-0'}`}
                  />
                  Favorites only
                </button>
                {/* Clear all */}
                {activeFilterCount > 0 && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={() => {
                        clearAllFilters()
                        setShowFilterMenu(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-400 hover:bg-elevated"
                    >
                      <X className="h-3 w-3 shrink-0" />
                      Clear all filters
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {/* Selector filter indicator */}
        {activeSelectorFilters.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 rounded-md border border-accent/20 bg-accent-subtle px-2 py-1 text-[11px] text-accent">
            <Crosshair className="h-3 w-3" />
            <span>
              {activeSelectorFilters.length} selector filter
              {activeSelectorFilters.length !== 1 ? 's' : ''} active
            </span>
            <button onClick={clearSelectorFilters} className="ml-auto hover:text-accent">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Scrollable capture list */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {displayedCaptures.map((cap) => (
          <CaptureItem
            key={cap.id}
            capture={cap}
            isSelected={cap.id === selectedCaptureId}
            onClick={() => selectCapture(cap.id)}
            isFavorite={favorites.has(cap.id)}
            onToggleFavorite={() => toggleFavorite(cap.id)}
          />
        ))}
        {displayedCaptures.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-text-faint">
            {filteredCaptureIds || activeFilterCount > 0
              ? 'No captures match the active filters'
              : 'No captures yet'}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t p-3 bg-surface border-border">
        <div className="text-center text-[11px] text-text-muted">
          Showing {displayedCaptures.length} of {captures.length} captures
        </div>
      </div>
    </aside>
  )
}
