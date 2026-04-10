import { Radar, Sun, Moon, ChevronsUpDown, Settings, ArrowLeft } from 'lucide-react'
import { useMatchRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useAppStore } from '@renderer/stores/appStore'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
import { useTheme } from '@renderer/hooks/useTheme'

export function TopBar() {
  const navigate = useNavigate()
  const router = useRouter()
  const matchRoute = useMatchRoute()
  const sessionActive = useAppStore((s) => s.sessionActive)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const { theme, toggleTheme } = useTheme()

  const isOnSettings = Boolean(matchRoute({ to: '/settings' }))
  const caseMatch = matchRoute({ to: '/cases/$caseId', fuzzy: true })
  const activeCaseId = caseMatch ? (caseMatch as { caseId: string }).caseId : null

  // Simplified settings header
  if (isOnSettings) {
    return (
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        {/* Logo */}
        <div className="flex items-center gap-2 px-1 -ml-1">
          <div className="glow-indigo flex h-6 w-6 items-center justify-center rounded-md bg-accent">
            <Radar className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="font-display text-xs font-extrabold tracking-tight text-text-primary">
            Birdbrain
          </span>
        </div>

        {/* Return button */}
        <button
          onClick={() => router.history.back()}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-muted hover:bg-elevated hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Return to Birdbrain</span>
        </button>

        <div className="flex-1" />

        {/* Theme toggle only */}
        <button
          onClick={toggleTheme}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-accent transition-all duration-300"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </header>
    )
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      {/* Logo — click to go home */}
      <button
        onClick={() => navigate({ to: '/' })}
        className="flex items-center gap-2 rounded-md px-1 -ml-1 hover:bg-elevated transition-colors"
        title="Home"
      >
        <div className="glow-indigo flex h-6 w-6 items-center justify-center rounded-md bg-accent">
          <Radar className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="font-display text-xs font-extrabold tracking-tight text-text-primary">
          Birdbrain
        </span>
      </button>

      {/* Compact case switcher */}
      {activeCaseId && (
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary transition-colors"
          title="Switch investigation (Ctrl+K)"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
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
          onClick={() => navigate({ to: '/settings' })}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-accent transition-all duration-300"
          title="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>

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
