import { Radar, ChevronRight, Settings, Bell } from 'lucide-react'
import { useAppStore } from '@renderer/stores/appStore'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
import { useCases } from '@renderer/hooks/useCases'

export function TopBar() {
  const appMode = useAppStore((s) => s.appMode)
  const activeCaseId = useAppStore((s) => s.activeCaseId)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const goToDashboard = useAppStore((s) => s.goToDashboard)
  const toggleSettings = useAppStore((s) => s.toggleSettings)
  const { cases } = useCases()

  const activeCase = cases.find((c) => c.id === activeCaseId)

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-slate-900 px-4">
      {/* Logo + Breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="glow-indigo flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
            <Radar className="h-4 w-4 text-white" />
          </div>
          <span className="font-display text-sm font-extrabold tracking-tight text-white">
            Birdbrain
          </span>
          <span className="ml-1 rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500">v2.0</span>
        </div>

        {appMode === 'case-workspace' && (
          <div className="flex items-center gap-1.5 text-sm">
            <button
              onClick={goToDashboard}
              className="text-slate-500 hover:text-slate-300"
            >
              Investigations
            </button>
            <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
            <span className="text-slate-300">
              {activeCase?.name ?? 'Untitled'}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1" />

      {appMode === 'dashboard' ? (
        <div className="flex items-center gap-3">
          <CaptureHealth />
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-900 hover:text-slate-300 transition-colors">
            <Bell className="h-4 w-4" />
          </button>
          <button
            onClick={toggleSettings}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-900 hover:text-slate-300 transition-colors"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <SearchBar />

          <div className="flex items-center gap-2">
            <SessionControls />

            {sessionActive && (
              <div className="flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                <span className="text-[11px] font-medium text-red-400">Recording</span>
              </div>
            )}

            <ConnectionStatus />
            <CaptureHealth />

            <button
              onClick={toggleSettings}
              className="rounded p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </header>
  )
}
