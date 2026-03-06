import { useAppStore } from '@renderer/stores/appStore'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { SessionControls } from '@renderer/components/status/SessionControls'

export function TopBar() {
  const { goToDashboard, setActiveView, toggleSidebar, sidebarCollapsed } = useAppStore()

  return (
    <header className="flex h-12 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4">
      <button
        onClick={toggleSidebar}
        className="text-neutral-400 hover:text-neutral-200"
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <button
        onClick={goToDashboard}
        className="flex items-center gap-2 text-amber-500 hover:text-amber-400"
      >
        <span className="text-lg font-bold">Birdbrain</span>
      </button>

      <div className="flex-1">
        <SearchBar />
      </div>

      <SessionControls />
      <ConnectionStatus />

      <button
        onClick={() => setActiveView('settings')}
        className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        title="Settings"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </header>
  )
}
