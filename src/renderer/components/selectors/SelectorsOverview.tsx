import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

export function SelectorsOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/selectors' })
  const queryClient = useQueryClient()
  const filteredCaptureIds = useAppStore((s) => s.filteredCaptureIds)
  const { data: selectors = [], isLoading } = useQuery(selectorsQueryOptions(caseId))
  const { data: matchCounts = {} } = useQuery(selectorMatchCountsQueryOptions(caseId))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const [showCreateForm, setShowCreateForm] = useState(false)

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
  }

  if (isLoading) {
    return <div className="text-text-muted">Loading selectors...</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6 pb-16">
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
    </div>
  )
}
