import { useState, useRef, useEffect, useMemo } from 'react'
import { ArrowUpDown, Filter, Crosshair, X, Check } from 'lucide-react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { capturesQueryOptions, captureMatchingSelectorsQueryOptions } from '@renderer/lib/queries'
import { Button, Skeleton } from '@renderer/components/ui'
import { presets, STAGGER_INTERVAL, STAGGER_VISIBLE_CAP } from '@renderer/lib/motion'
import { useAppStore } from '@renderer/stores/appStore'
import { useFavorites } from '@renderer/hooks/useFavorites'
import { CaptureItem } from '@renderer/components/captures/CaptureItem'
import { CaptureListEmptyState } from '@renderer/components/captures/CaptureListEmptyState'
import { CaptureMenu } from '@renderer/components/captures/CaptureMenu'
import {
  computeDisplayedCaptures,
  SORT_OPTIONS,
  FORMAT_OPTIONS,
  DATE_OPTIONS
} from '@renderer/components/captures/captureListModel'
import { useCaptureListFilters } from '@renderer/components/captures/useCaptureListFilters'
import type { Selector } from '@shared/types'

interface CaptureListProps {
  caseId: string
}

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

export function CaptureList({ caseId }: CaptureListProps) {
  const {
    data: captures = [],
    isLoading,
    isError,
    error,
    refetch
  } = useQuery(capturesQueryOptions(caseId))
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const selectCapture = useAppStore((s) => s.selectCapture)
  const filteredCaptureIds = useAppStore((s) => s.filteredCaptureIds)
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)
  const clearSelectorFilters = useAppStore((s) => s.clearSelectorFilters)
  const { favorites, toggleFavorite } = useFavorites(caseId)

  // Batch-fetch matching selectors for all captures (avoids N+1 per CaptureItem)
  const matchingSelectorsResults = useQueries({
    queries: captures.map((cap) => captureMatchingSelectorsQueryOptions(cap.id))
  })
  const matchingSelectorsMap = useMemo(() => {
    const map = new Map<string, Selector[]>()
    captures.forEach((cap, i) => {
      map.set(cap.id, matchingSelectorsResults[i]?.data ?? [])
    })
    return map
  }, [captures, matchingSelectorsResults])

  // Sort & filter state
  const {
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
  } = useCaptureListFilters()
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)

  const sortRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const firstPaintRef = useRef(true)
  useEffect(() => {
    firstPaintRef.current = false
  }, [])
  useClickOutside(sortRef, () => setShowSortMenu(false))
  useClickOutside(filterRef, () => setShowFilterMenu(false))

  const displayedCaptures = useMemo(
    () => computeDisplayedCaptures({ captures, filteredCaptureIds, favorites, filters }),
    [captures, filteredCaptureIds, favorites, filters]
  )

  if (isLoading) {
    return (
      <aside className="flex h-full flex-1 flex-col bg-surface min-w-0">
        <AnimatePresence mode="wait">
          <motion.div
            key="skeleton"
            className="space-y-2 p-4"
            initial={presets.fadeIn.initial}
            animate={presets.fadeIn.animate}
            exit={presets.fadeIn.exit}
            transition={presets.fadeIn.transition}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </motion.div>
        </AnimatePresence>
      </aside>
    )
  }

  if (isError) {
    return (
      <aside className="flex h-full flex-1 flex-col items-center justify-center gap-2 bg-surface p-4 text-center min-w-0">
        <div className="text-xs text-red-400">
          Failed to load captures: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </aside>
    )
  }

  return (
    <aside className="flex h-full flex-1 flex-col bg-surface min-w-0">
      {/* Header: sort/filter + selector indicator */}
      <div className="border-b p-2 border-border">
        {/* Sort + Filter buttons, Capture menu on the right */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex gap-1">
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
          <CaptureMenu caseId={caseId} />
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
      <div className="flex flex-1 flex-col space-y-1 overflow-y-auto p-2">
        <AnimatePresence mode="popLayout" initial={firstPaintRef.current}>
          {displayedCaptures.map((cap, i) => (
            <motion.div
              key={cap.id}
              layout
              initial={presets.listItem.initial}
              animate={presets.listItem.animate}
              exit={presets.listItem.exit}
              transition={{
                ...presets.listItem.transition,
                delay: firstPaintRef.current && i < STAGGER_VISIBLE_CAP ? i * STAGGER_INTERVAL : 0
              }}
            >
              <CaptureItem
                capture={cap}
                isSelected={cap.id === selectedCaptureId}
                onClick={() => selectCapture(cap.id)}
                isFavorite={favorites.has(cap.id)}
                onToggleFavorite={() => toggleFavorite(cap.id)}
                matchingSelectors={matchingSelectorsMap.get(cap.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {displayedCaptures.length === 0 &&
          (filteredCaptureIds || activeFilterCount > 0 ? (
            <div className="px-3 py-4 text-center text-xs text-text-faint">
              No captures match the active filters
            </div>
          ) : (
            <CaptureListEmptyState />
          ))}
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
