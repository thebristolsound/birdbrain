import { useState, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Database, ChevronRight, RefreshCw, ExternalLink } from 'lucide-react'
import { Button, Badge, ScrollArea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import {
  extractedDataCategoriesQueryOptions,
  extractedDataSubcategoriesQueryOptions,
  extractedDataItemsQueryOptions,
  extractedDataCountQueryOptions,
  useExtractedDataMutations
} from '@renderer/lib/queries'

export function DataExplorer() {
  const { caseId } = useParams({ from: '/cases/$caseId/data' })
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null)
  const [reprocessing, setReprocessing] = useState(false)

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
    window.birdbrain.captures.openExternal(url).catch(() => {})
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

      {categories.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-border bg-surface p-8 text-center">
            <Database size={32} className="mx-auto mb-3 text-text-faint" />
            <p className="text-sm font-medium text-text-secondary">No data extracted yet</p>
            <p className="mt-1 text-xs text-text-muted">
              Extraction runs automatically on new captures. Click <strong>Reprocess</strong> to
              scan existing captures.
            </p>
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
                onClick={() => {
                  setSelectedCategory(category)
                  setSelectedSubcategory(null)
                }}
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
                  onClick={() => setSelectedSubcategory(subcategory)}
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
