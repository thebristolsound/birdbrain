import { Radar, Sun, Moon } from 'lucide-react'
import { useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
import { casesQueryOptions } from '@renderer/lib/queries'
import { useTheme } from '@renderer/hooks/useTheme'

export function TopBar() {
  const matchRoute = useMatchRoute()
  const sessionActive = useAppStore((s) => s.sessionActive)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { theme, toggleTheme } = useTheme()

  const caseMatch = matchRoute({ to: '/cases/$caseId', fuzzy: true })
  const activeCaseId = caseMatch ? (caseMatch as { caseId: string }).caseId : null
  const activeCase = activeCaseId ? cases.find((c) => c.id === activeCaseId) : null

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="glow-indigo flex h-6 w-6 items-center justify-center rounded-md bg-accent">
          <Radar className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="font-display text-xs font-extrabold tracking-tight text-text-primary">
          Birdbrain
        </span>
      </div>

      {/* Case name (clickable to open command palette) */}
      {activeCase && (
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-semibold text-text-secondary hover:bg-elevated hover:text-text-primary transition-colors"
          title="Switch investigation (Ctrl+K)"
        >
          {activeCase.name}
          <span className="text-[10px] text-text-faint">▾</span>
        </button>
      )}

      <div className="flex-1" />

      {/* Right controls */}
      <div className="flex items-center gap-2">
        {activeCaseId && <SearchBar />}

        {activeCaseId && <SessionControls />}

        {sessionActive && (
          <div className="flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-[10px] font-medium text-red-400">REC</span>
          </div>
        )}

        <ConnectionStatus />
        <CaptureHealth />

        <button
          onClick={toggleTheme}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-accent transition-all duration-300"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </header>
  )
}
