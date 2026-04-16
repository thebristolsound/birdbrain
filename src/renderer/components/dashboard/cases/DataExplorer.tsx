import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  extractedDataCategoriesQueryOptions,
  extractedDataCountQueryOptions,
  extractedDataItemsQueryOptions,
  extractedDataSubcategoriesQueryOptions,
  useExtractedDataMutations
} from '@renderer/lib/queries'
import { Button } from '@renderer/components/ui'
import { Database, Link2, RefreshCw } from 'lucide-react'

export function DataExplorer() {
  const { caseId } = useParams({ from: '/cases/$caseId/data' })
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null)

  const { data: categories = [], isFetching: loadingCategories } = useQuery(
    extractedDataCategoriesQueryOptions(caseId)
  )
  const { data: subcategories = [], isFetching: loadingSubcategories } = useQuery(
    extractedDataSubcategoriesQueryOptions(caseId, selectedCategory ?? '')
  )
  const { data: items = [], isFetching: loadingItems } = useQuery(
    extractedDataItemsQueryOptions(caseId, selectedCategory ?? '', selectedSubcategory ?? '')
  )
  const { data: totalCount = 0 } = useQuery(extractedDataCountQueryOptions(caseId))
  const { reprocess } = useExtractedDataMutations(caseId)

  useEffect(() => {
    if (!categories.length) {
      setSelectedCategory(null)
      setSelectedSubcategory(null)
      return
    }
    if (!selectedCategory || !categories.find((c) => c.category === selectedCategory)) {
      setSelectedCategory(categories[0].category)
      setSelectedSubcategory(null)
    }
  }, [categories, selectedCategory])

  useEffect(() => {
    if (!selectedCategory) {
      setSelectedSubcategory(null)
      return
    }
    if (!subcategories.length) {
      setSelectedSubcategory(null)
      return
    }
    if (!selectedSubcategory || !subcategories.find((s) => s.subcategory === selectedSubcategory)) {
      setSelectedSubcategory(subcategories[0].subcategory)
    }
  }, [selectedCategory, subcategories, selectedSubcategory])

  const itemsTitle = useMemo(() => {
    if (!selectedCategory) return 'Items'
    if (!selectedSubcategory) return selectedCategory
    return `${selectedCategory} · ${selectedSubcategory}`
  }, [selectedCategory, selectedSubcategory])

  function openSource(url: string) {
    window.birdbrain.captures.openExternal(url).catch((err) => {
      console.error('Failed to open URL', url, err)
    })
  }

  async function handleReprocess() {
    await reprocess.mutateAsync()
    setSelectedCategory(null)
    setSelectedSubcategory(null)
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-text-primary">
            <Database size={18} strokeWidth={1.8} />
            <h1 className="font-display text-lg font-semibold">Extracted Data</h1>
            {totalCount > 0 && (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                {totalCount}
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted">
            Rule-based indicators pulled from captured pages. Select a category to drill down.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedCategory(null)
              setSelectedSubcategory(null)
            }}
            disabled={loadingCategories || loadingSubcategories}
          >
            Reset
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReprocess}
            disabled={reprocess.isPending || !caseId}
            className="gap-1.5"
          >
            <RefreshCw
              size={14}
              strokeWidth={1.8}
              className={reprocess.isPending ? 'animate-spin' : undefined}
            />
            {reprocess.isPending ? 'Reprocessing...' : 'Reprocess'}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
        <Panel title="Categories" loading={loadingCategories}>
          {categories.length === 0 ? (
            <EmptyState message="No data extracted yet" />
          ) : (
            <div className="space-y-1">
              {categories.map((cat) => {
                const active = selectedCategory === cat.category
                return (
                  <button
                    key={cat.category}
                    onClick={() => setSelectedCategory(cat.category)}
                    className={[
                      'flex w-full items-center justify-between rounded px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-accent/10 text-text-primary'
                        : 'text-text-secondary hover:bg-elevated'
                    ].join(' ')}
                  >
                    <span className="truncate">{cat.category}</span>
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted ring-1 ring-border">
                      {cat.count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel title="Subcategories" loading={loadingSubcategories}>
          {!selectedCategory ? (
            <EmptyState message="Select a category" />
          ) : subcategories.length === 0 ? (
            <EmptyState message="No subcategories found" />
          ) : (
            <div className="space-y-1">
              {subcategories.map((sub) => {
                const active = selectedSubcategory === sub.subcategory
                return (
                  <button
                    key={sub.subcategory}
                    onClick={() => setSelectedSubcategory(sub.subcategory)}
                    className={[
                      'flex w-full items-center justify-between rounded px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-accent/10 text-text-primary'
                        : 'text-text-secondary hover:bg-elevated'
                    ].join(' ')}
                  >
                    <span className="truncate">{sub.subcategory}</span>
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted ring-1 ring-border">
                      {sub.count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel title={itemsTitle} loading={loadingItems}>
          {!selectedCategory || !selectedSubcategory ? (
            <EmptyState message="Select a subcategory" />
          ) : items.length === 0 ? (
            <EmptyState message="No items found" />
          ) : (
            <div className="space-y-2 overflow-y-auto pr-1">
              {items.map((item) => (
                <div
                  key={item.value}
                  className="rounded border border-border bg-surface p-3 shadow-[0_1px_0_rgba(0,0,0,0.05)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-text-primary">{item.value}</p>
                    </div>
                    <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-text-muted">
                      {item.pageCount} page{item.pageCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {item.sourceUrls.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.sourceUrls.map((url) => (
                        <button
                          key={url}
                          onClick={() => openSource(url)}
                          className="group flex items-center gap-1 rounded-full bg-elevated px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-accent/10 hover:text-text-primary"
                        >
                          <Link2 size={12} strokeWidth={1.8} />
                          <span className="max-w-[220px] truncate text-left">{url}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Panel({
  title,
  loading,
  children
}: {
  title: string
  loading?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-col rounded border border-border bg-elevated p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-text-primary">{title}</span>
        {loading && <span className="text-xs text-text-muted">Loading...</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded border border-dashed border-border bg-surface text-sm text-text-muted">
      {message}
    </div>
  )
}
