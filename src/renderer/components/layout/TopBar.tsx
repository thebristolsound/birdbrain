import { Sun, Moon, ChevronsUpDown, Settings, ArrowLeft } from 'lucide-react'
import logoImg from '@renderer/assets/logo.png'
import { Button } from '@renderer/components/ui'
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
          <img src={logoImg} alt="Birdbrain" className="h-6 w-6" />
          <span className="font-display text-xs font-extrabold tracking-tight text-text-primary">
            Birdbrain
          </span>
        </div>

        {/* Return button */}
        <Button variant="ghost" size="sm" onClick={() => router.history.back()} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Return to Birdbrain</span>
        </Button>

        <div className="flex-1" />

        {/* Theme toggle only */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
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
        <img src={logoImg} alt="Birdbrain" className="h-6 w-6" />
        <span className="font-display text-xs font-extrabold tracking-tight text-text-primary">
          Birdbrain
        </span>
      </button>

      {/* Compact case switcher */}
      {activeCaseId && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCommandPaletteOpen(true)}
          title="Switch investigation (Ctrl+K)"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </Button>
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

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate({ to: '/settings' })}
          title="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </header>
  )
}
