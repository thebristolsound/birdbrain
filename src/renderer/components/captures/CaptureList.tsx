import { useState } from 'react'
import { Search, ArrowUpDown, Filter, Crosshair, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { capturesQueryOptions } from '@renderer/lib/queries'
import { useAppStore } from '@renderer/stores/appStore'
import { useFavorites } from '@renderer/hooks/useFavorites'
import { CaptureItem } from './CaptureItem'

interface CaptureListProps {
  caseId: string
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

  const displayedCaptures = (
    filteredCaptureIds ? captures.filter((c) => filteredCaptureIds.includes(c.id)) : captures
  ).filter((c) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return c.title?.toLowerCase().includes(q) || c.url.toLowerCase().includes(q)
  })

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
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-7 pr-2 text-xs text-text-secondary placeholder-text-faint outline-none focus:border-accent/30"
          />
        </div>
        {/* Sort + Filter buttons */}
        <div className="mt-1.5 flex gap-1">
          <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-text-muted hover:bg-elevated hover:text-text-muted">
            <ArrowUpDown className="h-3 w-3" />
            Sort
          </button>
          <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-text-muted hover:bg-elevated hover:text-text-muted">
            <Filter className="h-3 w-3" />
            Filter
          </button>
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
            {filteredCaptureIds ? 'No captures match the active filters' : 'No captures yet'}
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
