import { useAppStore } from '@renderer/stores/appStore'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
import { SettingsView } from '@renderer/components/settings/SettingsView'

export function MainContent() {
  const { activeView } = useAppStore()

  return (
    <main className="flex-1 overflow-auto bg-neutral-950 p-6">
      {activeView === 'dashboard' && <Dashboard />}
      {activeView === 'case-overview' && <CaseOverview />}
      {activeView === 'capture-viewer' && <CaptureViewer />}
      {activeView === 'settings' && <SettingsView />}
    </main>
  )
}
