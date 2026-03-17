import { useAppStore } from '@renderer/stores/appStore'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CaseAnalysis } from '@renderer/components/analysis/CaseAnalysis'
import { SettingsView } from '@renderer/components/settings/SettingsView'

export function MainContent() {
  const appMode = useAppStore((s) => s.appMode)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const activeCaseTab = useAppStore((s) => s.activeCaseTab)

  if (settingsOpen) {
    return (
      <main className="flex-1 overflow-auto bg-neutral-950 p-6">
        <SettingsView />
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-auto bg-neutral-950 p-6">
      {appMode === 'dashboard' && <Dashboard />}
      {appMode === 'case-workspace' && activeCaseTab === 'overview' && <CaseOverview />}
      {appMode === 'case-workspace' && activeCaseTab === 'analysis' && <CaseAnalysis />}
    </main>
  )
}
