import { useState, useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Database, ChevronRight, RefreshCw, ExternalLink, Search, Crosshair } from 'lucide-react'
import { Button, Badge, ScrollArea, Input } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { CreateSelectorPopover } from '@renderer/components/selectors/CreateSelectorPopover'
import {
  extractedDataCategoriesQueryOptions,
  extractedDataSubcategoriesQueryOptions,
  extractedDataItemsQueryOptions,
  extractedDataCountQueryOptions,
  extractedDataSearchQueryOptions,
  useExtractedDataMutations
} from '@renderer/lib/queries'
import { openCaptureExternal } from '@renderer/lib/api/system'
import { notify } from '@renderer/lib/notify'

// The extracted-data (IOC) browser: the whole of the pre-#1149 Data screen,
// now the Indicators group of the rail (R21, X39). The selection is the rail's,
// so a pick in either place shows in both. Its own search and the whole-case
// Reprocess trigger stay in its header (Q12); there is no per-file re-extract.
export function IndicatorsView({
  caseId,
  category: selectedCategory,
  subcategory: selectedSubcategory,
  onSelect
}: {
  caseId: string
  category: string | null
  subcategory: string | null
  onSelect: (category: string, subcategory: string | null) => void
}) {
  const [reprocessing, setReprocessing] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [popoverFor, setPopoverFor] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  // Search results hide the columns, so a pick made in the rail during a search
  // would otherwise not show. Leaving search mode lets the rail and view agree.
  useEffect(() => {
    setSearchInput('')
    setDebouncedQuery('')
  }, [selectedCategory, selectedSubcategory])

  const { data: searchResults = [], isFetching: searching } = useQuery(
    extractedDataSearchQueryOptions(caseId, debouncedQuery)
  )

  const isSearching = debouncedQuery.length > 0

  const { data: categories = [], isLoading: loadingCategories } = useQuery(
    extractedDataCategoriesQueryOptions(caseId)
  )
  const { data: subcategories = [], isLoading: loadingSubcategories } = useQuery(
    extractedDataSubcategoriesQueryOptions(caseId, selectedCategory ?? '')
  )
  const { data: items = [], isLoading: loadingItems } = useQuery(
    extractedDataItemsQueryOptions(caseId, selectedCategory ?? '', selectedSubcategory ?? '')
  )
  const { data: totalCount = 0 } = useQuery(extractedDataCountQueryOptions(caseId))
  const { reprocess } = useExtractedDataMutations(caseId)

  async function handleReprocess() {
    setReprocessing(true)
    try {
      await reprocess.mutateAsync()
    } catch (err) {
      console.error('Reprocess failed:', err)
    } finally {
      setReprocessing(false)
    }
  }

  function handleSourceUrlClick(url: string) {
    openCaptureExternal(url).catch((cause) => {
      notify.error("Couldn't open the link in your browser", { cause })
    })
  }

  if (loadingCategories) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        Loading extracted data...
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-6 py-3">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-text-muted" />
          <span className="text-sm text-text-muted">
            {totalCount === 0
              ? 'No extracted data yet'
              : `${totalCount.toLocaleString()} indicator${totalCount !== 1 ? 's' : ''} extracted`}
          </span>
        </div>
        <div className="relative mx-4 max-w-xs flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search indicators..."
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReprocess}
          disabled={reprocessing}
          className="gap-1.5"
          title="Re-run extraction on all captured files for this case"
        >
          <RefreshCw size={12} strokeWidth={1.8} className={reprocessing ? 'animate-spin' : ''} />
          {reprocessing ? 'Processing...' : 'Reprocess'}
        </Button>
      </div>

      {isSearching ? (
        <div className="min-h-0 flex-1">
          {searching && searchResults.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              Searching…
            </div>
          ) : searchResults.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              No indicators match “{debouncedQuery}”.
            </div>
          ) : (
            <ScrollArea className="h-full">
              {searchResults.map((r, idx) => {
                const key = `${idx}::${r.category}::${r.subcategory}::${r.value}`
                return (
                  <div
                    key={key}
                    className="group relative border-b border-border px-4 py-3 last:border-b-0 hover:bg-elevated"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-0.5 text-[11px] uppercase tracking-wide text-text-faint">
                          {r.category} · {r.subcategory}
                        </div>
                        <span className="break-all font-mono text-sm text-text-primary">
                          {r.value}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-text-muted">
                          {r.pageCount} page{r.pageCount !== 1 ? 's' : ''}
                        </span>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setPopoverFor((cur) => (cur === key ? null : key))}
                            className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-xs text-text-muted hover:text-accent"
                            title="Create selector from this indicator"
                          >
                            <Crosshair size={12} strokeWidth={1.8} />
                            To selector
                          </button>
                          {popoverFor === key && (
                            <CreateSelectorPopover
                              caseId={caseId}
                              defaultValue={r.value}
                              defaultLabel={r.subcategory}
                              onClose={() => setPopoverFor(null)}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                    {r.sourceUrls.length > 0 && (
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        {r.sourceUrls.map((url) => (
                          <button
                            key={url}
                            type="button"
                            onClick={() => handleSourceUrlClick(url)}
                            className="flex items-center gap-1 truncate text-left text-xs text-accent hover:underline"
                            title={url}
                          >
                            <ExternalLink size={10} strokeWidth={1.8} className="shrink-0" />
                            <span className="truncate">{url}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </ScrollArea>
          )}
        </div>
      ) : categories.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-border bg-surface p-8 text-center">
            <Database size={32} className="mx-auto mb-3 text-text-faint" />
            <p className="text-sm font-medium text-text-secondary">No data extracted yet</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 divide-x divide-border">
          {/* Column 1: Categories */}
          <Column title="Categories" className="w-64 shrink-0">
            {categories.map(({ category, count }) => (
              <DirRow
                key={category}
                selected={selectedCategory === category}
                onClick={() => onSelect(category, null)}
              >
                <span className="flex-1 truncate text-sm font-medium">{category}</span>
                <Badge variant={selectedCategory === category ? 'accent' : 'secondary'}>
                  {count.toLocaleString()}
                </Badge>
                <ChevronRight size={12} strokeWidth={1.8} className="shrink-0 text-text-faint" />
              </DirRow>
            ))}
          </Column>

          {/* Column 2: Subcategories */}
          <Column title={selectedCategory ?? 'Subcategories'} className="w-64 shrink-0">
            {!selectedCategory ? (
              <EmptyState>Select a category</EmptyState>
            ) : loadingSubcategories ? (
              <EmptyState>Loading…</EmptyState>
            ) : subcategories.length === 0 ? (
              <EmptyState>No subcategories</EmptyState>
            ) : (
              subcategories.map(({ subcategory, count }) => (
                <DirRow
                  key={subcategory}
                  selected={selectedSubcategory === subcategory}
                  onClick={() => onSelect(selectedCategory, subcategory)}
                >
                  <span className="flex-1 truncate text-sm">{subcategory}</span>
                  <Badge variant={selectedSubcategory === subcategory ? 'accent' : 'secondary'}>
                    {count.toLocaleString()}
                  </Badge>
                  <ChevronRight size={12} strokeWidth={1.8} className="shrink-0 text-text-faint" />
                </DirRow>
              ))
            )}
          </Column>

          {/* Column 3: Items */}
          <Column
            title={selectedSubcategory ?? 'Items'}
            subtitle={
              selectedCategory && selectedSubcategory && !loadingItems && items.length > 0
                ? `${items.length.toLocaleString()} unique`
                : undefined
            }
            className="min-w-0 flex-1"
          >
            {!selectedCategory || !selectedSubcategory ? (
              <EmptyState>Select a subcategory</EmptyState>
            ) : loadingItems ? (
              <EmptyState>Loading…</EmptyState>
            ) : items.length === 0 ? (
              <EmptyState>No items found.</EmptyState>
            ) : (
              items.map(({ value, pageCount, sourceUrls }) => (
                <div
                  key={value}
                  className="border-b border-border px-4 py-3 last:border-b-0 hover:bg-elevated"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="break-all font-mono text-sm text-text-primary">{value}</span>
                    <span className="shrink-0 text-xs text-text-muted">
                      {pageCount} page{pageCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {sourceUrls.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5">
                      {sourceUrls.map((url) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => handleSourceUrlClick(url)}
                          className="flex items-center gap-1 truncate text-left text-xs text-accent hover:underline"
                          title={url}
                        >
                          <ExternalLink size={10} strokeWidth={1.8} className="shrink-0" />
                          <span className="truncate">{url}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </Column>
        </div>
      )}
    </div>
  )
}

function Column({
  title,
  subtitle,
  className = '',
  children
}: {
  title: string
  subtitle?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2.5">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-text-muted">
          {title}
        </span>
        {subtitle && (
          <span className="shrink-0 text-xs font-normal normal-case text-text-faint">
            {subtitle}
          </span>
        )}
      </div>
      <ScrollArea className="flex-1">{children}</ScrollArea>
    </div>
  )
}

function DirRow({
  selected,
  onClick,
  children
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 border-b border-border px-4 py-2.5 text-left transition-colors last:border-b-0',
        selected ? 'bg-accent-subtle text-accent' : 'text-text-primary hover:bg-elevated'
      )}
    >
      {children}
    </button>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-6 text-center text-xs text-text-muted">{children}</div>
}
