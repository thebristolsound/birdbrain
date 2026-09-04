import { useState, useRef, useEffect, useMemo } from 'react'
import {
  ArrowUpDown,
  Filter,
  Crosshair,
  X,
  Check,
  ChevronLeft,
  LayoutGrid,
  List as ListIcon,
  Search
} from 'lucide-react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { capturesQueryOptions, captureMatchingSelectorsQueryOptions } from '@renderer/lib/queries'
import { tagsQueryOptions, tagUsageCountsForCaseQueryOptions } from '@renderer/lib/api/tags'
import { Button, Skeleton } from '@renderer/components/ui'
import { presets, STAGGER_INTERVAL, STAGGER_VISIBLE_CAP } from '@renderer/lib/motion'
import { useAppStore } from '@renderer/stores/appStore'
import { useFavorites } from '@renderer/hooks/useFavorites'
import { CaptureItem } from '@renderer/components/captures/CaptureItem'
import { CaptureListEmptyState } from '@renderer/components/captures/CaptureListEmptyState'
import { CaptureMenu } from '@renderer/components/captures/CaptureMenu'
import { CaptureSelectionBar } from '@renderer/components/captures/CaptureSelectionBar'
import { useCaptureSelection } from '@renderer/components/captures/useCaptureSelection'
import { useCaptureContextMenu } from '@renderer/components/captures/useCaptureContextMenu'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import {
  computeDisplayedCaptures,
  CLEAR_NARROWING_LABEL,
  SORT_OPTIONS,
  FORMAT_OPTIONS,
  DATE_OPTIONS
} from '@renderer/components/captures/captureListModel'
import { useCaptureListFilters } from '@renderer/components/captures/useCaptureListFilters'
import { useTimeTick } from '@renderer/hooks/useTimeTick'
import type { CaptureView } from '@renderer/components/captures/useCaptureView'
import type { Selector } from '@shared/types'

interface CaptureListProps {
  caseId: string
  view: CaptureView
  onChangeView: (view: CaptureView) => void
  onCollapse: () => void
  // The route owns the batch-delete confirm/result dialogs so they survive
  // the bar unmounting once the selection empties.
  onDeleteSelection: (ids: string[]) => void
  // The other two route-owned actions a row's context menu reaches: opening a
  // capture's page in the browser, and the note composer. Both live on the
  // route because both are also the details panel's, and a row menu must not
  // grow a second copy of either (#701).
  onOpenExternal: (url: string) => void
  onQuoteIntoNote: (captureId: string) => void
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

export function CaptureList({
  caseId,
  view,
  onChangeView,
  onCollapse,
  onDeleteSelection,
  onOpenExternal,
  onQuoteIntoNote
}: CaptureListProps) {
  const {
    data: captures = [],
    isLoading,
    isError,
    error,
    refetch
  } = useQuery(capturesQueryOptions(caseId))
  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
  const filteredCaptureIds = useAppStore((s) => s.filteredCaptureIds)
  const tagFilteredCaptureIds = useAppStore((s) => s.tagFilteredCaptureIds)
  const { favorites, toggleFavorite } = useFavorites(caseId)
  // Rows carry relative times; one interval here keeps every row current
  // instead of each owning its own.
  const nowTick = useTimeTick(60_000)
  const nowMs = useMemo(() => Date.now(), [nowTick])

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
    narrowings,
    isNarrowed,
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

  // The Filter menu's Tags section (#918). Offers the tags this case actually
  // uses, not every tag in the app — a tag no capture here carries would filter
  // the list to nothing — plus any already-picked tag, so a filter can never
  // become unreachable to untick after its last capture loses it.
  const { data: allTags = [] } = useQuery(tagsQueryOptions)
  const { data: tagUsage = {} } = useQuery(tagUsageCountsForCaseQueryOptions(caseId))
  const filterableTags = useMemo(
    () => allTags.filter((t) => (tagUsage[t.id] ?? 0) > 0 || activeTagFilters.includes(t.id)),
    [allTags, tagUsage, activeTagFilters]
  )

  const displayedCaptures = useMemo(
    () =>
      computeDisplayedCaptures({
        captures,
        filteredCaptureIds,
        tagFilteredCaptureIds,
        favorites,
        filters
      }),
    [captures, filteredCaptureIds, tagFilteredCaptureIds, favorites, filters]
  )

  const displayedIds = useMemo(() => displayedCaptures.map((c) => c.id), [displayedCaptures])
  const {
    selectedCaptureIds,
    visibleSelectedIds,
    allVisibleSelected,
    selectionActive,
    handleRowClick,
    handleCheckboxClick,
    toggleSelectAll,
    clearSelection
  } = useCaptureSelection(displayedIds)

  const buildMenuTarget = useCaptureContextMenu({
    caseId,
    visibleSelectedIds,
    favorites,
    // The rejection is already reported by the mutation cache's onError; the
    // catch is only so a failed toggle is not also an unhandled rejection.
    onToggleFavorite: (id) => void toggleFavorite(id).catch(() => undefined),
    onDeleteSelection,
    onOpenExternal,
    onQuoteIntoNote
  })

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
      {/* Header row 1: per-list search, collapse, capture menu. */}
      <div className="border-b p-2 border-border">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search captures…"
              aria-label="Filter captures in this list"
              data-testid="capture-list-search"
              className="w-full rounded border border-border-strong bg-canvas py-1.5 pl-7 pr-2.5 text-xs text-text-primary outline-none placeholder:text-text-faint"
            />
          </div>
          <button
            onClick={onCollapse}
            title="Collapse list"
            data-testid="capture-list-collapse"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <CaptureMenu caseId={caseId} />
        </div>
        {/* Header row 2: sort, filter, view toggle. */}
        <div className="mt-1 flex items-center gap-1">
          <div className="flex min-w-0 gap-1">
            {/* Sort dropdown */}
            <div ref={sortRef} className="relative">
              <button
                onClick={() => {
                  setShowSortMenu(!showSortMenu)
                  setShowFilterMenu(false)
                }}
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] hover:bg-elevated ${
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
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] hover:bg-elevated ${
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
                <div
                  data-testid="capture-list-filter-menu"
                  className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-card py-1 shadow-lg"
                >
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
                  {/* Tags section (#918). Multi-select and a union: ticking a
                      second tag widens the list to captures carrying either. */}
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                    Tags
                  </div>
                  {filterableTags.length === 0 ? (
                    <div
                      data-testid="capture-list-filter-no-tags"
                      className="px-3 py-1.5 text-[11px] text-text-faint"
                    >
                      No tags in this case
                    </div>
                  ) : (
                    <div className="max-h-36 overflow-y-auto">
                      {filterableTags.map((tag) => {
                        const active = activeTagFilters.includes(tag.id)
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTagFilter(tag.id)}
                            aria-pressed={active}
                            data-testid={`capture-list-filter-tag-${tag.id}`}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-elevated ${
                              active ? 'text-accent' : 'text-text-secondary'
                            }`}
                          >
                            <Check
                              className={`h-3 w-3 shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`}
                            />
                            <span className="truncate">{tag.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
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
                  {/* Clear all: the same handler as the strip and the empty state,
                      so it clears every narrowing rather than only this menu's. */}
                  {isNarrowed && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <button
                        onClick={() => {
                          clearNarrowing()
                          setShowFilterMenu(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-400 hover:bg-elevated"
                      >
                        <X className="h-3 w-3 shrink-0" />
                        {CLEAR_NARROWING_LABEL}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <span className="flex-1" />
          <div
            role="group"
            aria-label="List view"
            className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-canvas p-0.5"
          >
            <button
              onClick={() => onChangeView('detailed')}
              title="Detailed view"
              aria-pressed={view === 'detailed'}
              className={`flex h-5 w-[22px] items-center justify-center rounded ${
                view === 'detailed' ? 'bg-card text-text-primary' : 'text-text-faint'
              }`}
            >
              <LayoutGrid className="h-3 w-3" />
            </button>
            <button
              onClick={() => onChangeView('list')}
              title="List view"
              aria-pressed={view === 'list'}
              className={`flex h-5 w-[22px] items-center justify-center rounded ${
                view === 'list' ? 'bg-card text-text-primary' : 'text-text-faint'
              }`}
            >
              <ListIcon className="h-3 w-3" />
            </button>
          </div>
        </div>
        {/* Narrowing strip: names every narrowing hiding rows, with one control
            that clears all of them. */}
        {isNarrowed && (
          <div
            data-testid="capture-list-narrowing"
            className="mt-1.5 flex items-center gap-1 rounded-md border border-accent/20 bg-accent-subtle px-2 py-1 text-[11px] text-accent"
          >
            <Crosshair className="h-3 w-3 shrink-0" />
            <span className="truncate">{narrowings.join(' · ')}</span>
            <button
              onClick={clearNarrowing}
              aria-label={CLEAR_NARROWING_LABEL}
              title={CLEAR_NARROWING_LABEL}
              className="ml-auto shrink-0 hover:text-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Inline selection bar: rises whenever the visible multi-set is non-empty */}
      {selectionActive && (
        <CaptureSelectionBar
          caseId={caseId}
          selectedIds={visibleSelectedIds}
          allSelected={allVisibleSelected}
          onToggleSelectAll={toggleSelectAll}
          onClear={clearSelection}
          onDeleteSelection={onDeleteSelection}
        />
      )}

      {/* Scrollable capture list */}
      <div className="flex flex-1 flex-col gap-[var(--d-listgap)] overflow-y-auto px-2 pb-[18px] pt-[var(--d-listgap)]">
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
              {/* Inside the animated element, not around it: AnimatePresence
                  reads its direct children for the exit animation, and a menu
                  wrapper between them would take the row's place. */}
              <EntityContextMenu target={buildMenuTarget(cap)}>
                <CaptureItem
                  capture={cap}
                  view={view}
                  nowMs={nowMs}
                  isSelected={cap.id === selectedCaptureId}
                  isMultiSelected={selectedCaptureIds.has(cap.id)}
                  showCheckbox={selectionActive}
                  onClick={(e) => handleRowClick(cap.id, e)}
                  onToggleMultiSelect={(e) => handleCheckboxClick(cap.id, e)}
                  isFavorite={favorites.has(cap.id)}
                  onToggleFavorite={() => toggleFavorite(cap.id)}
                  matchingSelectors={matchingSelectorsMap.get(cap.id)}
                />
              </EntityContextMenu>
            </motion.div>
          ))}
        </AnimatePresence>
        {/* A case with no captures at all gets the first-run guidance whatever is
            typed in the list search: nothing is being hidden, and the narrowed
            copy would both say so falsely and displace the onboarding state. */}
        {displayedCaptures.length === 0 &&
          (isNarrowed && captures.length > 0 ? (
            <div
              data-testid="capture-list-narrowed-empty"
              className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 py-8 text-center"
            >
              <div className="text-xs font-semibold text-text-secondary">No captures match</div>
              <p className="max-w-[220px] text-[11px] leading-relaxed text-text-faint">
                {captures.length} capture{captures.length !== 1 ? 's' : ''} in this case
                {captures.length !== 1 ? ' are' : ' is'} hidden by {narrowings.join(' · ')}.
              </p>
              <Button variant="outline" size="sm" onClick={clearNarrowing}>
                {CLEAR_NARROWING_LABEL}
              </Button>
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
