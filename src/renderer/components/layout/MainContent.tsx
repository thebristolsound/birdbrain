import { useAppStore } from '@renderer/stores/appStore'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { CaseWorkspace } from '@renderer/components/cases/CaseWorkspace'
import { SettingsView } from '@renderer/components/settings/SettingsView'

export function MainContent() {
  const appMode = useAppStore((s) => s.appMode)
  const settingsOpen = useAppStore((s) => s.settingsOpen)

  if (settingsOpen) {
    return (
      <main className="flex-1 overflow-auto bg-neutral-950">
        <div className="p-6">
          <SettingsView />
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-auto bg-neutral-950">
      {appMode === 'dashboard' && (
        <div className="p-6">
          <Dashboard />
        </div>
      )}
      {appMode === 'case-workspace' && <CaseWorkspace />}
    </main>
  )
}
