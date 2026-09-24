import { Sun, Moon, ChevronsUpDown, ChevronRight, Settings, ArrowLeft } from 'lucide-react'
import logoImg from '@renderer/assets/logo.png'
import { Button } from '@renderer/components/ui'
import { useMatchRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { caseQueryOptions } from '@renderer/lib/queries'
import { accelerator } from '@renderer/lib/accelerator'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
import { ExportMenu } from '@renderer/components/export/ExportMenu'
import { useTheme } from '@renderer/hooks/useTheme'
import { useUpdateStatus } from '@renderer/hooks/useUpdateStatus'

export function TopBar() {
  const navigate = useNavigate()
  const router = useRouter()
  const matchRoute = useMatchRoute()
  const sessionActive = useAppStore((s) => s.sessionActive)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const { theme, toggleTheme } = useTheme()
  const { status: updateStatus } = useUpdateStatus()
  const updateAvailable =
    updateStatus?.state === 'available' || updateStatus?.state === 'downloaded'

  const isOnSettings = Boolean(matchRoute({ to: '/settings' }))
  // The pattern also matches the wizard's literal `new` segment, which is not a case.
  const isOnWizard = Boolean(matchRoute({ to: '/cases/new' }))
  const caseMatch = isOnWizard ? false : matchRoute({ to: '/cases/$caseId', fuzzy: true })
  const activeCaseId = caseMatch ? (caseMatch as { caseId: string }).caseId : null

  const { data: activeCase } = useQuery({
    ...caseQueryOptions(activeCaseId ?? ''),
    enabled: !!activeCaseId
  })

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

        {/* A running session keeps its indicator and stop control here too. */}
        {sessionActive && (
          <div className="flex items-center gap-2">
            <SessionControls />
            <RecIndicator />
          </div>
        )}

        <Button variant="ghost" size="icon-sm" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </header>
    )
  }

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
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

      {/* Breadcrumb case switcher — opens the command launcher */}
      {activeCaseId && (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <button
            data-testid="topbar-case-name"
            data-tour="caseswitcher"
            onClick={() => setCommandPaletteOpen(true)}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-elevated transition-colors"
            title={`Switch investigation (${accelerator('K')})`}
          >
            <span className="max-w-[220px] truncate font-display text-xs font-bold text-text-primary">
              {activeCase?.name ?? ''}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          </button>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Centered global search — absolutely positioned to viewport center. The
          transform makes this a stacking context, so it carries the z-index its
          results dropdown needs to clear sticky headers in the page below. */}
      {activeCaseId && (
        <div className="absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="pointer-events-auto">
            <SearchBar caseId={activeCaseId} />
          </div>
        </div>
      )}

      {/* Right controls */}
      <div className="flex items-center gap-2">
        {activeCaseId && <SessionControls />}

        {sessionActive && <RecIndicator />}

        <ConnectionStatus />
        <CaptureHealth />

        {activeCaseId && activeCase && (
          <ExportMenu caseId={activeCase.id} caseName={activeCase.name} />
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate({ to: '/settings' })}
          title={updateAvailable ? 'Settings — update available' : 'Settings'}
          className="relative"
        >
          <Settings className="h-3.5 w-3.5" />
          {updateAvailable && (
            <span
              data-testid="topbar-update-dot"
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent"
            />
          )}
        </Button>

        <Button variant="ghost" size="icon-sm" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </header>
  )
}

function RecIndicator() {
  return (
    <div
      data-testid="topbar-rec"
      className="flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      <span className="text-[10px] font-medium text-red-400">REC</span>
    </div>
  )
}
