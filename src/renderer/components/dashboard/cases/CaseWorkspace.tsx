import { useEffect } from 'react'
import { useParams, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import { useSettingsMutations } from '@renderer/lib/api/settings'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { useAppStore } from '@renderer/stores/appStore'
import { captureServerFetch } from '@renderer/lib/captureServerFetch'
import type { BirdbrainSettings } from '@shared/types'
import { Skeleton } from '@renderer/components/ui'

export function CaseWorkspace() {
  const { caseId } = useParams({ from: '/cases/$caseId' })
  const matchRoute = useMatchRoute()
  const { data: cases = [], isLoading } = useQuery(casesQueryOptions)
  const { update: updateSettings } = useSettingsMutations()

  useSelectorFilters(caseId)

  // Clear per-case UI state when switching cases
  useEffect(() => {
    const store = useAppStore.getState()
    store.setSelectedCaptureId(null)
    store.clearCaptureSelection()
    store.clearSelectorFilters()
  }, [caseId])

  // Activate case on the capture server + persist session state
  useEffect(() => {
    if (caseId) {
      captureServerFetch(`/api/cases/${caseId}/activate`, { method: 'POST' }).catch((err) =>
        console.error('Failed to activate case on server:', err)
      )
      // Persist last active case for session restore
      updateSettings.mutate({ lastActiveCaseId: caseId })
    }
  }, [caseId])

  const activeCase = cases.find((c) => c.id === caseId)

  const isOverview = matchRoute({ to: '/cases/$caseId/overview', fuzzy: true }) !== false
  const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
  const isSelectors = matchRoute({ to: '/cases/$caseId/selectors', fuzzy: true }) !== false
  const isNotes = matchRoute({ to: '/cases/$caseId/notes', fuzzy: true }) !== false
  const isTags = matchRoute({ to: '/cases/$caseId/tags', fuzzy: true }) !== false
  const isData = matchRoute({ to: '/cases/$caseId/data', fuzzy: true }) !== false

  // Persist active section for session restore
  useEffect(() => {
    const section: BirdbrainSettings['lastActiveSection'] = isOverview
      ? 'overview'
      : isCaptures
        ? 'captures'
        : isSelectors
          ? 'selectors'
          : isNotes
            ? 'notes'
            : isTags
              ? 'tags'
              : isData
                ? 'data'
                : 'overview'
    updateSettings.mutate({ lastActiveSection: section })
  }, [isOverview, isCaptures, isSelectors, isNotes, isTags, isData])

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (!activeCase) return null

  return (
    <div className="flex h-full flex-col">
      {isCaptures || isData ? (
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      )}
    </div>
  )
}
