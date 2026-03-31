import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import {
  selectorsQueryOptions,
  selectorMatchCountsQueryOptions,
  capturesQueryOptions
} from '@renderer/lib/queries'
import { CreateSelectorCard } from './CreateSelectorCard'
import { SelectorTable } from './SelectorTable'
import { SelectorFilterFooter } from './SelectorFilterFooter'

export function SelectorsOverview() {
  const { caseId } = useParams({ strict: false })
  const filteredCaptureIds = useAppStore((s) => s.filteredCaptureIds)
  const { data: selectors = [], isLoading } = useQuery(selectorsQueryOptions(caseId!))
  const { data: matchCounts = {} } = useQuery(selectorMatchCountsQueryOptions(caseId!))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId!))
  const [showCreateForm, setShowCreateForm] = useState(false)

  if (isLoading) {
    return <div className="text-slate-500">Loading selectors...</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6 pb-16">
      <CreateSelectorCard
        isOpen={showCreateForm}
        onToggle={() => setShowCreateForm((v) => !v)}
        onCreated={() => {
          setShowCreateForm(false)
        }}
        caseId={caseId!}
      />

      {selectors.length === 0 ? (
        <p className="text-sm text-slate-500">
          No selectors found. Create one to start matching captures.
        </p>
      ) : (
        <SelectorTable
          selectors={selectors}
          matchCounts={matchCounts}
          onRefresh={() => {}}
          caseId={caseId!}
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
