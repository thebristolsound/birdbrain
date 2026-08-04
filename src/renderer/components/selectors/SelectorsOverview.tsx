import { useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ListPlus } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { useAppStore } from '@renderer/stores/appStore'
import {
  selectorsQueryOptions,
  selectorMatchCountsQueryOptions,
  capturesQueryOptions,
  queryKeys,
  exportSelectorMatches
} from '@renderer/lib/queries'
import { CreateSelectorCard } from '@renderer/components/selectors/CreateSelectorCard'
import { SelectorTable } from '@renderer/components/selectors/SelectorTable'
import { SelectorFilterFooter } from '@renderer/components/selectors/SelectorFilterFooter'
import { BulkAddSelectorsModal } from '@renderer/components/selectors/BulkAddSelectorsModal'
import { AnimatePresence } from 'motion/react'

export function SelectorsOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/selectors' })
  const queryClient = useQueryClient()
  const filteredCaptureIds = useAppStore((s) => s.filteredCaptureIds)
  const {
    data: selectors = [],
    isLoading,
    isError,
    error,
    refetch
  } = useQuery(selectorsQueryOptions(caseId))
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
      await exportSelectorMatches(caseId)
    } catch (err) {
      console.error('Export matches failed:', err)
    } finally {
      setExporting(false)
    }
  }

  if (isLoading) {
    return <div className="text-text-muted">Loading selectors...</div>
  }

  if (isError) {
    return (
      <div className="space-y-2 px-8 py-6">
        <p className="text-sm text-red-400">
          Failed to load selectors: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6 pb-16">
      <div className="flex items-center justify-end gap-2">
        <Button
          data-testid="bulk-add-btn"
          variant="outline"
          size="sm"
          onClick={() => setShowBulkAddModal(true)}
          className="gap-1.5"
        >
          <ListPlus className="h-3.5 w-3.5" />
          Bulk Add
        </Button>
        <Button
          data-testid="export-matches-btn"
          variant="outline"
          size="sm"
          onClick={handleExportMatches}
          disabled={totalMatches === 0 || exporting}
          title={totalMatches === 0 ? 'No selector matches to export' : 'Export all matches to CSV'}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Exporting...' : 'Export Matches'}
        </Button>
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

      <AnimatePresence>
        {showBulkAddModal && (
          <BulkAddSelectorsModal
            caseId={caseId}
            existingSelectors={selectors}
            onClose={() => setShowBulkAddModal(false)}
            onCreated={() => handleRefresh()}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
