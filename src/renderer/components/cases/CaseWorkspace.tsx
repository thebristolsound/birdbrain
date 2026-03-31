import { useEffect } from 'react'
import { useParams, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions, capturesQueryOptions } from '@renderer/lib/queries'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { LayoutDashboard, Layers, Crosshair } from 'lucide-react'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

type CaseTab = 'overview' | 'captures' | 'selectors'

const tabs: { id: CaseTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'captures', label: 'Captures', icon: Layers },
  { id: 'selectors', label: 'Selectors', icon: Crosshair }
]

export function CaseWorkspace() {
  const { caseId } = useParams({ strict: false })
  const matchRoute = useMatchRoute()
  const { data: cases = [], isLoading } = useQuery(casesQueryOptions)
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId!))

  useSelectorFilters(caseId!)

  // Activate case on the capture server when entering workspace
  useEffect(() => {
    if (caseId) {
      fetch(`${CAPTURE_SERVER_BASE_URL}/api/cases/${caseId}/activate`, { method: 'POST' }).catch(
        (err) => console.error('Failed to activate case on server:', err)
      )
    }
  }, [caseId])

  const activeCase = cases.find((c) => c.id === caseId)

  if (!caseId) return null

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">Loading case...</div>
    )
  }

  if (!activeCase) return null

  const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
  const isSelectors = matchRoute({ to: '/cases/$caseId/selectors', fuzzy: true }) !== false

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="h-11 shrink-0 flex items-end gap-0.5 border-b px-5 bg-slate-900 border-white/[0.06]">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive =
            (tab.id === 'overview' && !isCaptures && !isSelectors) ||
            (tab.id === 'captures' && isCaptures) ||
            (tab.id === 'selectors' && isSelectors)
          return (
            <Link
              key={tab.id}
              to={
                tab.id === 'overview'
                  ? '/cases/$caseId'
                  : tab.id === 'captures'
                    ? '/cases/$caseId/captures'
                    : '/cases/$caseId/selectors'
              }
              params={{ caseId: caseId! }}
              className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-500/15 font-semibold text-indigo-400'
                  : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.id === 'captures' && (
                <span
                  className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    isActive ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {captures.length}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Tab content */}
      {isCaptures ? (
        <Outlet />
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      )}
    </div>
  )
}
