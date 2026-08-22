import { useNavigate, useMatchRoute, useParams } from '@tanstack/react-router'
import { Home, LayoutDashboard, Layers, Crosshair, StickyNote, Database } from 'lucide-react'

type SidebarSection = 'overview' | 'captures' | 'notes' | 'signals' | 'data'

const NAV_ITEMS: { id: SidebarSection; icon: typeof Layers; label: string }[] = [
  { id: 'overview', icon: LayoutDashboard, label: 'Overview' },
  { id: 'captures', icon: Layers, label: 'Captures' },
  { id: 'notes', icon: StickyNote, label: 'Notes' },
  { id: 'signals', icon: Crosshair, label: 'Signals' },
  { id: 'data', icon: Database, label: 'Data' }
]

const SECTION_PATHS = {
  overview: '/cases/$caseId/overview',
  captures: '/cases/$caseId/captures',
  notes: '/cases/$caseId/notes',
  signals: '/cases/$caseId/signals',
  data: '/cases/$caseId/data'
} as const satisfies Record<SidebarSection, string>

export function Sidebar() {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()

  // useParams with strict: false returns partial params — caseId may be undefined outside case routes
  const params = useParams({ strict: false }) as Record<string, string | undefined>
  const caseId = params.caseId

  const isOnHome = Boolean(matchRoute({ to: '/' }))

  function isActive(section: SidebarSection): boolean {
    if (!caseId) return false
    return Boolean(matchRoute({ to: SECTION_PATHS[section], params: { caseId } }))
  }

  function handleNavClick(section: SidebarSection) {
    if (!caseId) return
    navigate({ to: SECTION_PATHS[section], params: { caseId } })
  }

  return (
    <aside className="flex w-12 flex-col border-r border-border bg-surface">
      {/* Main nav icons */}
      <div className="flex flex-1 flex-col items-center gap-1 py-2">
        {/* Home */}
        <div className="group relative">
          <button
            onClick={() => navigate({ to: '/' })}
            className={[
              'relative flex h-10 w-10 items-center justify-center rounded transition-colors',
              isOnHome
                ? 'bg-accent-subtle text-accent'
                : 'text-text-muted hover:bg-elevated hover:text-text-secondary'
            ].join(' ')}
            aria-label="Home"
          >
            {isOnHome && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
            )}
            <Home size={18} strokeWidth={1.8} />
          </button>

          {/* Tooltip */}
          <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="whitespace-nowrap rounded bg-surface px-2 py-1 text-xs text-text-primary shadow-md ring-1 ring-border">
              Home
            </div>
          </div>
        </div>

        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const active = isActive(id)
          const disabled = !caseId

          return (
            <div key={id} className="group relative">
              <button
                onClick={() => handleNavClick(id)}
                disabled={disabled}
                className={[
                  'relative flex h-10 w-10 items-center justify-center rounded transition-colors',
                  active
                    ? 'bg-accent-subtle text-accent'
                    : disabled
                      ? 'cursor-not-allowed text-text-faint'
                      : 'text-text-muted hover:bg-elevated hover:text-text-secondary'
                ].join(' ')}
                aria-label={label}
              >
                {/* Active left-edge bar */}
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
                )}
                <Icon size={18} strokeWidth={1.8} />
              </button>

              {/* Tooltip */}
              <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="whitespace-nowrap rounded bg-surface px-2 py-1 text-xs text-text-primary shadow-md ring-1 ring-border">
                  {label}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
