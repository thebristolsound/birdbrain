import { useEffect } from 'react'
import { useParams, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions } from '@renderer/lib/queries'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { useAppStore } from '@renderer/stores/appStore'
import { captureServerFetch } from '@renderer/lib/captureServerFetch'
import type { BirdbrainSettings } from '@shared/types'
import { CaseHeader } from '@renderer/components/layout/CaseHeader'

export function CaseWorkspace() {
  const { caseId } = useParams({ from: '/cases/$caseId' })
  const matchRoute = useMatchRoute()
  const { data: cases = [], isLoading } = useQuery(casesQueryOptions)

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
      window.birdbrain.settings.update({ lastActiveCaseId: caseId })
    }
  }, [caseId])

  const activeCase = cases.find((c) => c.id === caseId)

  const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
  const isSelectors = matchRoute({ to: '/cases/$caseId/selectors', fuzzy: true }) !== false
  const isNotes = matchRoute({ to: '/cases/$caseId/notes', fuzzy: true }) !== false
  const isTags = matchRoute({ to: '/cases/$caseId/tags', fuzzy: true }) !== false

  // Persist active section for session restore
  useEffect(() => {
    const section: BirdbrainSettings['lastActiveSection'] = isCaptures
      ? 'captures'
      : isSelectors
        ? 'selectors'
        : isNotes
          ? 'notes'
          : isTags
            ? 'tags'
            : 'captures'
    window.birdbrain.settings.update({ lastActiveSection: section })
  }, [isCaptures, isSelectors, isNotes, isTags])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">Loading case...</div>
    )
  }

  if (!activeCase) return null

  return (
    <div className="flex h-full flex-col">
      <CaseHeader />
      {isCaptures ? (
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
