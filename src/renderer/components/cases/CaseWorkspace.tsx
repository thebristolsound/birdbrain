import { useAppStore } from '@renderer/stores/appStore'
import type { CaseTab } from '@renderer/stores/appStore'
import { useCases } from '@renderer/hooks/useCases'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
import { CaptureList } from '@renderer/components/captures/CaptureList'
import { CaseAnalysis } from '@renderer/components/analysis/CaseAnalysis'
import { SelectorsOverview } from '@renderer/components/selectors/SelectorsOverview'

const tabs: { id: CaseTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'captures', label: 'Captures' },
  { id: 'entities', label: 'Entities' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'selectors', label: 'Selectors' }
]

export function CaseWorkspace() {
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const activeCaseTab = useAppStore((s) => s.activeCaseTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const { cases } = useCases()

  const activeCase = cases.find((c) => c.id === activeCaseId)

  if (!activeCaseId || !activeCase) return null

  return (
    <div className="flex h-full flex-col">
      {/* Case header */}
      <div className="border-b border-neutral-800 px-6 pb-2 pt-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-neutral-100">
            {activeCase.name}
          </h1>
          {sessionActive && (
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" title="Recording" />
          )}
        </div>
        {activeCase.description && (
          <p className="mt-1 text-sm text-neutral-400">{activeCase.description}</p>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-neutral-800 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeCaseTab === tab.id
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        {activeCaseTab === 'overview' && <CaseOverview />}
        {activeCaseTab === 'captures' && (
          <div className="flex h-full gap-4">
            <div className="w-[30%] overflow-y-auto">
              <CaptureList caseId={activeCaseId} />
            </div>
            <div className="flex-1 overflow-y-auto">
              <CaptureViewer />
            </div>
          </div>
        )}
        {activeCaseTab === 'entities' && (
          <div className="text-neutral-500">Entities view — coming in Task 7</div>
        )}
        {activeCaseTab === 'analysis' && <CaseAnalysis />}
        {activeCaseTab === 'selectors' && <SelectorsOverview />}
      </div>
    </div>
  )
}
