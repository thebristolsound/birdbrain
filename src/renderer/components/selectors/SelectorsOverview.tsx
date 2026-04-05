import { useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ListPlus } from 'lucide-react'
import { useAppStore } from '@renderer/stores/appStore'
import {
  selectorsQueryOptions,
  selectorMatchCountsQueryOptions,
  capturesQueryOptions,
  queryKeys
} from '@renderer/lib/queries'
import { CreateSelectorCard } from './CreateSelectorCard'
import { SelectorTable } from './SelectorTable'
import { SelectorFilterFooter } from './SelectorFilterFooter'
import { BulkAddSelectorsModal } from './BulkAddSelectorsModal'

export function SelectorsOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/selectors' })
  const queryClient = useQueryClient()
  const filteredCaptureIds = useAppStore((s) => s.filteredCaptureIds)
  const { data: selectors = [], isLoading } = useQuery(selectorsQueryOptions(caseId))
  const { data: matchCounts = {} } = useQuery(selectorMatchCountsQueryOptions(caseId))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showBulkAddModal, setShowBulkAddModal] = useState(false)
  const [exporting, setExporting] = useState(false)

  const totalMatches = useMemo(
    () => Object.values(matchCounts).reduce((a, b) => a + b, 0),
    [matchCounts]
  )

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
  }

  async function handleExportMatches() {
    setExporting(true)
    try {
      await window.birdbrain.selectors.exportMatches(caseId)
    } catch (err) {
      console.error('Export matches failed:', err)
    } finally {
      setExporting(false)
    }
  }

  if (isLoading) {
    return <div className="text-text-muted">Loading selectors...</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6 pb-16">
      <div className="flex items-center justify-end gap-2">
        <button
          data-testid="bulk-add-btn"
          onClick={() => setShowBulkAddModal(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-elevated"
        >
          <ListPlus className="h-3.5 w-3.5" />
          Bulk Add
        </button>
        <button
          data-testid="export-matches-btn"
          onClick={handleExportMatches}
          disabled={totalMatches === 0 || exporting}
          className="flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-elevated disabled:opacity-40"
          title={totalMatches === 0 ? 'No selector matches to export' : 'Export all matches to CSV'}
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Exporting...' : 'Export Matches'}
        </button>
      </div>

      <CreateSelectorCard
        isOpen={showCreateForm}
        onToggle={() => setShowCreateForm((v) => !v)}
        onCreated={() => {
          setShowCreateForm(false)
          handleRefresh()
        }}
        caseId={caseId}
      />

      {selectors.length === 0 ? (
        <p className="text-sm text-text-muted">
          No selectors found. Create one to start matching captures.
        </p>
      ) : (
        <SelectorTable
          selectors={selectors}
          matchCounts={matchCounts}
          onRefresh={handleRefresh}
          caseId={caseId}
        />
      )}

      <SelectorFilterFooter
        selectors={selectors}
        totalCaptures={captures.length}
        filteredCount={filteredCaptureIds?.length ?? captures.length}
      />

      {showBulkAddModal && (
        <BulkAddSelectorsModal
          caseId={caseId}
          existingSelectors={selectors}
          onClose={() => setShowBulkAddModal(false)}
          onCreated={() => handleRefresh()}
        />
      )}
    </div>
  )
}
