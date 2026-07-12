import { useState, useMemo } from 'react'
import { Search, ArrowUpDown } from 'lucide-react'
import type { Selector } from '@shared/types'
import { SelectorTableRow } from '@renderer/components/selectors/SelectorTableRow'
import { useSelectorsMutations } from '@renderer/lib/api/selectors'
import { Card, Button } from '@renderer/components/ui'

interface SelectorTableProps {
  selectors: Selector[]
  matchCounts: Record<string, number>
  onRefresh: () => void
  caseId: string
}

type SortField = 'pattern' | 'matches' | 'type' | 'label'
type SortDir = 'asc' | 'desc'

export function SelectorTable({ selectors, matchCounts, onRefresh, caseId }: SelectorTableProps) {
  const { update, remove } = useSelectorsMutations(caseId)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('matches')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const filtered = useMemo(() => {
    let result = selectors
    if (searchFilter) {
      const q = searchFilter.toLowerCase()
      result = result.filter(
        (s) => s.pattern.toLowerCase().includes(q) || (s.label && s.label.toLowerCase().includes(q))
      )
    }
    result = [...result].sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'matches':
          cmp = (matchCounts[a.id] || 0) - (matchCounts[b.id] || 0)
          break
        case 'pattern':
          cmp = a.pattern.localeCompare(b.pattern)
          break
        case 'type':
          cmp = Number(a.isRegex) - Number(b.isRegex)
          break
        case 'label':
          cmp = (a.label || '').localeCompare(b.label || '')
          break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return result
  }, [selectors, searchFilter, sortBy, sortDir, matchCounts])

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  async function handleToggleEnabled(sel: Selector) {
    await update.mutateAsync({ id: sel.id, enabled: !sel.enabled })
    onRefresh()
  }

  async function handleDelete(id: string) {
    await remove.mutateAsync(id)
    onRefresh()
  }

  return (
    <Card className="overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-sm font-semibold text-text-primary">Active Selectors</h3>
          <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-accent">
            {selectors.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter selectors..."
              className="rounded-lg border border-border bg-canvas py-1 pl-7 pr-3 text-xs text-text-secondary placeholder:text-text-faint focus:border-accent/40 focus:outline-none"
            />
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => handleSort(sortBy)}
            title="Toggle sort direction"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wider text-text-muted">
            <th className="w-16 px-4 py-2 font-medium">On</th>
            <th className="px-4 py-2 font-medium">Pattern</th>
            <th className="w-20 px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Label</th>
            <th
              className="w-24 cursor-pointer px-4 py-2 font-medium hover:text-text-secondary"
              onClick={() => handleSort('matches')}
            >
              Matches {sortBy === 'matches' && (sortDir === 'desc' ? '↓' : '↑')}
            </th>
            <th className="w-20 px-4 py-2 font-medium">Filter</th>
            <th className="w-24 px-4 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((sel) => (
            <SelectorTableRow
              key={sel.id}
              selector={sel}
              matchCount={matchCounts[sel.id] || 0}
              isExpanded={expandedRowId === sel.id}
              onToggleExpand={() => setExpandedRowId((prev) => (prev === sel.id ? null : sel.id))}
              onToggleEnabled={() => handleToggleEnabled(sel)}
              onDelete={() => handleDelete(sel.id)}
              caseId={caseId}
            />
          ))}
        </tbody>
      </table>
    </Card>
  )
}
