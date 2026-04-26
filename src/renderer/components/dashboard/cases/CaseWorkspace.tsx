import { useEffect } from 'react'
import { useParams, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions } from '@renderer/lib/queries'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { useAppStore } from '@renderer/stores/appStore'
import { captureServerFetch } from '@renderer/lib/captureServerFetch'
import { CaseHeader } from '@renderer/components/layout/CaseHeader'
import { LoadingState } from '@renderer/components/ui/loading-state'

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

  // Activate case on the capture server
  useEffect(() => {
    if (caseId) {
      captureServerFetch(`/api/cases/${caseId}/activate`, { method: 'POST' }).catch((err) =>
        console.error('Failed to activate case on server:', err)
      )
    }
  }, [caseId])

  const activeCase = cases.find((c) => c.id === caseId)

  const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
  const isData = matchRoute({ to: '/cases/$caseId/data', fuzzy: true }) !== false

  if (isLoading) {
    return <LoadingState label="Loading case..." className="h-full" />
  }

  if (!activeCase) return null

  return (
    <div className="flex h-full flex-col">
      <CaseHeader />
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
