import { useAppStore } from '@renderer/stores/appStore'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { CaseWorkspace } from '@renderer/components/cases/CaseWorkspace'
import { NewCaseWizard } from '@renderer/components/cases/NewCaseWizard'
import { SettingsView } from '@renderer/components/settings/SettingsView'

export function MainContent() {
  const appMode = useAppStore((s) => s.appMode)
  const settingsOpen = useAppStore((s) => s.settingsOpen)

  if (settingsOpen) {
    return (
      <main className="flex-1 overflow-auto bg-black">
        <div className="p-6">
          <SettingsView />
        </div>
      </main>
    )
  }

  if (appMode === 'new-case-wizard') {
    return (
      <main className="flex-1 overflow-auto bg-black">
        <NewCaseWizard />
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-auto bg-black">
      {appMode === 'dashboard' && <Dashboard />}
      {appMode === 'case-workspace' && <CaseWorkspace />}
    </main>
  )
}
