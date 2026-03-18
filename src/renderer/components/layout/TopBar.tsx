import { useAppStore } from '@renderer/stores/appStore'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { CaseSwitcher } from '@renderer/components/cases/CaseSwitcher'

export function TopBar() {
  const appMode = useAppStore((s) => s.appMode)
  const goToDashboard = useAppStore((s) => s.goToDashboard)
  const toggleSettings = useAppStore((s) => s.toggleSettings)

  return (
    <header className="flex h-12 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4">
      {appMode === 'case-workspace' ? (
        <div className="flex items-center gap-2">
          <button
            onClick={goToDashboard}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            title="Back to dashboard"
          >
            ←
          </button>
          <CaseSwitcher />
        </div>
      ) : (
        <button
          onClick={goToDashboard}
          className="text-sm font-bold tracking-wide text-neutral-100 hover:text-white"
        >
          Birdbrain
        </button>
      )}

      <SearchBar />

      <div className="flex items-center gap-2">
        <SessionControls />
        <ConnectionStatus />
        <button
          onClick={toggleSettings}
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          title="Settings"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
