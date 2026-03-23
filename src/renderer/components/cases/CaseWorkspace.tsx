import { useAppStore } from '@renderer/stores/appStore'
import type { CaseTab } from '@renderer/stores/appStore'
import { useCases } from '@renderer/hooks/useCases'
import { useCaptures } from '@renderer/hooks/useCaptures'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CaseAnalysis } from '@renderer/components/analysis/CaseAnalysis'
import { SelectorsOverview } from '@renderer/components/selectors/SelectorsOverview'
import { CaseEntities } from '@renderer/components/cases/CaseEntities'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { LayoutDashboard, Layers, Fingerprint, Brain, Crosshair } from 'lucide-react'

const tabs: { id: CaseTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'captures', label: 'Captures', icon: Layers },
  { id: 'entities', label: 'Entities', icon: Fingerprint },
  { id: 'analysis', label: 'Analysis', icon: Brain },
  { id: 'selectors', label: 'Selectors', icon: Crosshair }
]

export function CaseWorkspace() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const activeCaseTab = useAppStore((s) => s.activeCaseTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const { cases, loading } = useCases()
  const { captures } = useCaptures(activeCaseId)

  useSelectorFilters(activeCaseId)

  const activeCase = cases.find((c) => c.id === activeCaseId)

  if (!activeCaseId) return null

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">Loading case…</div>
    )
  }

  if (!activeCase) return null

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="h-11 shrink-0 flex items-end gap-0.5 border-b px-5 bg-slate-900 border-white/[0.06]">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeCaseTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeCaseTab === 'captures' ? (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-[30%] overflow-y-auto">
            <CaptureList caseId={activeCaseId} />
          </div>
          <div className="flex-1 overflow-y-auto">
            <CaptureViewer />
          </div>
        </div>
      ) : activeCaseTab === 'analysis' ? (
        <div className="flex flex-1 overflow-hidden">
          <CaseAnalysis />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          {activeCaseTab === 'overview' && <CaseOverview />}
          {activeCaseTab === 'entities' && <CaseEntities />}
          {activeCaseTab === 'selectors' && <SelectorsOverview />}
        </div>
      )}
    </div>
  )
}
