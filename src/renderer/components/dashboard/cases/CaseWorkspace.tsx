import { useEffect } from 'react'
import { useParams, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import { useSessionMutations } from '@renderer/lib/api/session'
import { useSettingsMutations } from '@renderer/lib/api/settings'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { useTagFilters } from '@renderer/hooks/useTagFilters'
import { useAppStore } from '@renderer/stores/appStore'
import type { BirdbrainSettings } from '@shared/types'
import { Skeleton } from '@renderer/components/ui'

export function CaseWorkspace() {
  const { caseId } = useParams({ from: '/cases/$caseId' })
  const matchRoute = useMatchRoute()
  const { data: cases = [], isLoading } = useQuery(casesQueryOptions)
  const { activateCase } = useSessionMutations()
  const { update } = useSettingsMutations()

  useSelectorFilters(caseId)
  useTagFilters(caseId)

  // Clear per-case UI state when switching cases. Tag filters go with the rest
  // even though tags are app-global: carrying one across would narrow the new
  // case by a tag the operator picked while looking at another.
  useEffect(() => {
    const store = useAppStore.getState()
    store.setSelectedCaptureId(null)
    store.clearCaptureSelection()
    store.clearSelectorFilters()
    store.clearTagFilters()
  }, [caseId])

  // Activate case in the session service + persist session state
  useEffect(() => {
    if (caseId) {
      activateCase.mutate(caseId)
      // Persist last active case for session restore
      update.mutate({ lastActiveCaseId: caseId })
    }
  }, [caseId])

  const activeCase = cases.find((c) => c.id === caseId)

  const isOverview = matchRoute({ to: '/cases/$caseId/overview', fuzzy: true }) !== false
  const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
  const isNotes = matchRoute({ to: '/cases/$caseId/notes', fuzzy: true }) !== false
  const isSignals = matchRoute({ to: '/cases/$caseId/signals', fuzzy: true }) !== false
  const isData = matchRoute({ to: '/cases/$caseId/data', fuzzy: true }) !== false

  // Persist active section for session restore
  useEffect(() => {
    const section: BirdbrainSettings['lastActiveSection'] = isOverview
      ? 'overview'
      : isCaptures
        ? 'captures'
        : isNotes
          ? 'notes'
          : isSignals
            ? 'signals'
            : isData
              ? 'data'
              : 'overview'
    update.mutate({ lastActiveSection: section })
  }, [isOverview, isCaptures, isNotes, isSignals, isData])

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-[var(--d-gap)] p-[var(--d-pad)]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (!activeCase) return null

  return (
    <div className="flex h-full flex-col">
      {/* Split workspaces own their scroll regions and fill the available height. */}
      {isCaptures || isData || isSignals || isNotes ? (
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-[var(--d-pad)]">
          <Outlet />
        </div>
      )}
    </div>
  )
}
