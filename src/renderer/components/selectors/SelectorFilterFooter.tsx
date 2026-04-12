import { Filter, X, XCircle } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { Selector } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { Button } from '@renderer/components/ui'

interface SelectorFilterFooterProps {
  selectors: Selector[]
  totalCaptures: number
  filteredCount: number
}

export function SelectorFilterFooter({
  selectors,
  totalCaptures,
  filteredCount
}: SelectorFilterFooterProps) {
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)
  const removeSelectorFilter = useAppStore((s) => s.removeSelectorFilter)
  const clearSelectorFilters = useAppStore((s) => s.clearSelectorFilters)
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const caseId = (params as { caseId?: string }).caseId

  if (activeSelectorFilters.length === 0) return null

  const activeSelectors = selectors.filter((s) => activeSelectorFilters.includes(s.id))

  return (
    <div className="sticky bottom-0 flex items-center gap-4 border-t border-border bg-surface px-5 py-3">
      <div className="flex items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-medium text-text-muted">Active cross-filters:</span>
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {activeSelectors.map((sel) => (
          <span
            key={sel.id}
            className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2.5 py-0.5 text-xs text-accent"
          >
            {sel.label || sel.pattern}
            <button
              onClick={() => removeSelectorFilter(sel.id)}
              className="text-indigo-500 hover:text-indigo-300"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      <span className="text-xs text-text-muted">
        Showing {filteredCount} of {totalCaptures} captures
      </span>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            if (caseId) {
              navigate({ to: '/cases/$caseId/captures', params: { caseId } })
            }
          }}
        >
          View in Captures
        </Button>
        <Button variant="outline" size="sm" onClick={clearSelectorFilters} className="gap-1">
          <XCircle className="h-3 w-3" />
          Clear All
        </Button>
      </div>
    </div>
  )
}
