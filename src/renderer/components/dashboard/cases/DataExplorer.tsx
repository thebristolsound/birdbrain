import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, ChevronRight, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import {
  extractedDataCategoriesQueryOptions,
  extractedDataSubcategoriesQueryOptions,
  extractedDataItemsQueryOptions,
  extractedDataCountQueryOptions,
  useExtractedDataMutations
} from '@renderer/lib/queries'

export function DataExplorer() {
  const { caseId } = useParams({ from: '/cases/$caseId/data' })
  const queryClient = useQueryClient()
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

  function handleCategoryClick(category: string) {
    if (selectedCategory === category) {
      setSelectedCategory(null)
      setSelectedSubcategory(null)
    } else {
      setSelectedCategory(category)
      setSelectedSubcategory(null)
    }
  }

  function handleSubcategoryClick(subcategory: string) {
    if (selectedSubcategory === subcategory) {
      setSelectedSubcategory(null)
    } else {
      setSelectedSubcategory(subcategory)
    }
  }

  async function handleReprocess() {
    setReprocessing(true)
    try {
      await reprocess.mutateAsync()
      // Invalidate all extracted data queries for this case to refresh counts/items
      queryClient.invalidateQueries({ queryKey: ['extractedData'] })
    } catch (err) {
      console.error('Reprocess failed:', err)
    } finally {
      setReprocessing(false)
    }
  }

  async function handleSourceUrlClick(url: string) {
    try {
      // Try to find the capture for this URL and navigate to it
      await window.birdbrain.captures.openExternal(url).catch(() => {
        // If openExternal fails (e.g. non-http URL), just ignore
      })
    } catch {
      // ignore
    }
  }

  if (loadingCategories) {
    return <div className="text-text-muted">Loading extracted data...</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between">
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
          title="Re-run extraction on all captured HTML files for this case"
        >
          <RefreshCw size={12} strokeWidth={1.8} className={reprocessing ? 'animate-spin' : ''} />
          {reprocessing ? 'Processing...' : 'Reprocess'}
        </Button>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <Database size={32} className="mx-auto mb-3 text-text-faint" />
          <p className="text-sm font-medium text-text-secondary">No data extracted yet</p>
          <p className="mt-1 text-xs text-text-muted">
            Extraction runs automatically on new captures. Click <strong>Reprocess</strong> to scan
            existing captures.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Categories */}
          <div className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Categories
              </span>
            </div>
            <div className="divide-y divide-border">
              {categories.map(({ category, count }) => (
                <button
                  key={category}
                  onClick={() => handleCategoryClick(category)}
                  className={[
                    'flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors',
                    selectedCategory === category
                      ? 'bg-accent-subtle text-accent'
                      : 'text-text-primary hover:bg-elevated'
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      size={14}
                      strokeWidth={2}
                      style={{
                        transform:
                          selectedCategory === category ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 150ms ease'
                      }}
                    />
                    <span className="text-sm font-medium">{category}</span>
                  </div>
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs font-mono text-text-muted">
                    {count.toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Subcategories */}
          {selectedCategory && (
            <div className="rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {selectedCategory}
                </span>
              </div>
              {loadingSubcategories ? (
                <div className="px-4 py-3 text-sm text-text-muted">Loading...</div>
              ) : (
                <div className="divide-y divide-border">
                  {subcategories.map(({ subcategory, count }) => (
                    <button
                      key={subcategory}
                      onClick={() => handleSubcategoryClick(subcategory)}
                      className={[
                        'flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors',
                        selectedSubcategory === subcategory
                          ? 'bg-accent-subtle text-accent'
                          : 'text-text-primary hover:bg-elevated'
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={14}
                          strokeWidth={2}
                          style={{
                            transform:
                              selectedSubcategory === subcategory
                                ? 'rotate(90deg)'
                                : 'rotate(0deg)',
                            transition: 'transform 150ms ease'
                          }}
                        />
                        <span className="text-sm">{subcategory}</span>
                      </div>
                      <span className="rounded-full bg-elevated px-2 py-0.5 text-xs font-mono text-text-muted">
                        {count.toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Items */}
          {selectedCategory && selectedSubcategory && (
            <div className="rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {selectedSubcategory}
                </span>
              </div>
              {loadingItems ? (
                <div className="px-4 py-3 text-sm text-text-muted">Loading...</div>
              ) : items.length === 0 ? (
                <div className="px-4 py-3 text-sm text-text-muted">No items found.</div>
              ) : (
                <div className="divide-y divide-border">
                  {items.map(({ value, pageCount, sourceUrls }) => (
                    <div key={value} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="break-all font-mono text-sm text-text-primary">
                          {value}
                        </span>
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
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
