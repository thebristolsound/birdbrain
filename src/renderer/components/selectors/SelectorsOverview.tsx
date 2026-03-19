import { useState, useEffect } from 'react'
import type { Selector } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { useCaptures } from '@renderer/hooks/useCaptures'
import { CreateSelectorCard } from './CreateSelectorCard'
import { SelectorTable } from './SelectorTable'
import { SelectorFilterFooter } from './SelectorFilterFooter'

export function SelectorsOverview() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const filteredCaptureIds = useAppStore((s) => s.filteredCaptureIds)
  const [selectors, setSelectors] = useState<Selector[]>([])
  const [matchCounts, setMatchCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const { captures } = useCaptures(activeCaseId)

  useEffect(() => {
    if (activeCaseId) loadSelectors(activeCaseId)
  }, [activeCaseId])

  async function loadSelectors(caseId: string) {
    setLoading(true)
    try {
      const [result, counts] = await Promise.all([
        window.birdbrain.selectors.list(caseId),
        window.birdbrain.selectors.matchCounts(caseId)
      ])
      setSelectors(result)
      setMatchCounts(counts)
    } catch (err) {
      console.error('Failed to load selectors:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-slate-500">Loading selectors...</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6 pb-16">
      <CreateSelectorCard
        isOpen={showCreateForm}
        onToggle={() => setShowCreateForm((v) => !v)}
        onCreated={() => {
          setShowCreateForm(false)
          if (activeCaseId) loadSelectors(activeCaseId)
        }}
        caseId={activeCaseId!}
      />

      {selectors.length === 0 ? (
        <p className="text-sm text-slate-500">
          No selectors found. Create one to start matching captures.
        </p>
      ) : (
        <SelectorTable
          selectors={selectors}
          matchCounts={matchCounts}
          onRefresh={() => activeCaseId && loadSelectors(activeCaseId)}
          caseId={activeCaseId!}
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
