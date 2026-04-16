import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  extractedDataCategoriesQueryOptions,
  extractedDataSubcategoriesQueryOptions,
  extractedDataItemsQueryOptions,
  extractedDataCountQueryOptions,
  useExtractedDataMutations
} from '@renderer/lib/queries'
import { ChevronRight, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@renderer/components/ui'

export function DataExplorer() {
  const { caseId } = useParams({ from: '/cases/$caseId/data' })
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null)

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

  function handleReprocess() {
    if (confirm('Re-extract data from all captures in this case? This may take a few moments.')) {
      reprocess.mutate()
    }
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
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Extracted Data</h2>
          <p className="text-sm text-text-muted">
            {totalCount} {totalCount === 1 ? 'item' : 'items'} extracted from captures
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReprocess}
          disabled={reprocess.isPending}
          className="gap-1.5"
        >
          <RefreshCw size={14} className={reprocess.isPending ? 'animate-spin' : ''} />
          Re-extract All
        </Button>
      </div>

      {categories.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-text-muted">
          <div className="text-center">
            <p>No data extracted yet.</p>
            <p className="mt-1 text-sm">Data will be extracted automatically from new captures.</p>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-3 gap-4 overflow-hidden">
          {/* Categories Panel */}
          <div className="overflow-y-auto rounded border border-border bg-surface">
            <div className="sticky top-0 border-b border-border bg-elevated px-3 py-2">
              <h3 className="text-sm font-medium text-text-primary">Categories</h3>
            </div>
            <div className="divide-y divide-border">
              {categories.map((cat) => (
                <button
                  key={cat.category}
                  onClick={() => handleCategoryClick(cat.category)}
                  className={[
                    'flex w-full items-center justify-between px-3 py-2 text-left transition-colors',
                    selectedCategory === cat.category
                      ? 'bg-accent-subtle text-accent'
                      : 'hover:bg-elevated text-text-secondary'
                  ].join(' ')}
                >
                  <span className="truncate text-sm">{cat.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">{cat.count}</span>
                    <ChevronRight
                      size={14}
                      className={selectedCategory === cat.category ? 'rotate-90' : ''}
                      style={{ transition: 'transform 150ms ease' }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Subcategories Panel */}
          <div className="overflow-y-auto rounded border border-border bg-surface">
            <div className="sticky top-0 border-b border-border bg-elevated px-3 py-2">
              <h3 className="text-sm font-medium text-text-primary">
                {selectedCategory || 'Subcategories'}
              </h3>
            </div>
            {!selectedCategory ? (
              <div className="flex h-32 items-center justify-center text-sm text-text-muted">
                Select a category
              </div>
            ) : loadingSubcategories ? (
              <div className="flex h-32 items-center justify-center text-sm text-text-muted">
                Loading...
              </div>
            ) : subcategories.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-text-muted">
                No subcategories
              </div>
            ) : (
              <div className="divide-y divide-border">
                {subcategories.map((sub) => (
                  <button
                    key={sub.subcategory}
                    onClick={() => handleSubcategoryClick(sub.subcategory)}
                    className={[
                      'flex w-full items-center justify-between px-3 py-2 text-left transition-colors',
                      selectedSubcategory === sub.subcategory
                        ? 'bg-accent-subtle text-accent'
                        : 'hover:bg-elevated text-text-secondary'
                    ].join(' ')}
                  >
                    <span className="truncate text-sm">{sub.subcategory}</span>
                    <span className="text-xs text-text-muted">{sub.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items Panel */}
          <div className="overflow-y-auto rounded border border-border bg-surface">
            <div className="sticky top-0 border-b border-border bg-elevated px-3 py-2">
              <h3 className="text-sm font-medium text-text-primary">
                {selectedSubcategory || 'Items'}
              </h3>
            </div>
            {!selectedSubcategory ? (
              <div className="flex h-32 items-center justify-center text-sm text-text-muted">
                Select a subcategory
              </div>
            ) : loadingItems ? (
              <div className="flex h-32 items-center justify-center text-sm text-text-muted">
                Loading...
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-text-muted">
                No items
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((item, idx) => (
                  <div key={idx} className="px-3 py-2">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="break-all font-mono text-sm text-text-primary">
                        {item.value}
                      </span>
                      <span className="shrink-0 text-xs text-text-muted">
                        {item.pageCount} {item.pageCount === 1 ? 'page' : 'pages'}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {item.sourceUrls.map((url, urlIdx) => (
                        <button
                          key={urlIdx}
                          onClick={() => window.birdbrain.captures.openExternal(url)}
                          className="group flex items-center gap-1 text-xs text-text-muted hover:text-accent"
                          title={url}
                        >
                          <ExternalLink size={10} className="shrink-0" />
                          <span className="truncate">{url}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
