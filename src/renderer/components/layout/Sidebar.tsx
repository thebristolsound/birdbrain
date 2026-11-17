import type { ReactNode } from 'react'
import { useNavigate, useMatchRoute, useParams } from '@tanstack/react-router'
import {
  Home,
  LayoutDashboard,
  Layers,
  Crosshair,
  StickyNote,
  Database,
  Settings
} from 'lucide-react'
import { useUpdateStatus } from '@renderer/hooks/useUpdateStatus'

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

// The rail on Case screens: each section under its own label, so the rail names where the
// Operator is, and Settings at the foot. Its width is SIDE_RAIL_PX in captureColumns.ts, which
// the Captures screen and the Capture Session dock measure against.
export function Sidebar() {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const { status: updateStatus } = useUpdateStatus()
  const updateAvailable =
    updateStatus?.state === 'available' || updateStatus?.state === 'downloaded'

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
    <nav
      aria-label="Sections"
      className="flex w-[72px] shrink-0 flex-col items-center gap-0.5 border-r border-border bg-surface py-2"
    >
      <RailButton
        icon={Home}
        label="Home"
        active={isOnHome}
        tour="nav-dashboard"
        onClick={() => navigate({ to: '/' })}
      />
      {NAV_ITEMS.map(({ id, icon, label }) => (
        <RailButton
          key={id}
          icon={icon}
          label={label}
          active={isActive(id)}
          disabled={!caseId}
          tour={`nav-${id}`}
          onClick={() => handleNavClick(id)}
        />
      ))}
      <div className="flex-1" />
      <RailButton
        icon={Settings}
        label="Settings"
        active={false}
        title={updateAvailable ? 'Settings — update available' : undefined}
        onClick={() => navigate({ to: '/settings' })}
      >
        {updateAvailable && (
          <span
            data-testid="rail-update-dot"
            className="absolute right-4 top-2 h-1.5 w-1.5 rounded-full bg-accent"
          />
        )}
      </RailButton>
    </nav>
  )
}

interface RailButtonProps {
  icon: typeof Layers
  label: string
  active: boolean
  disabled?: boolean
  tour?: string
  title?: string
  onClick: () => void
  children?: ReactNode
}

function RailButton({
  icon: Icon,
  label,
  active,
  disabled = false,
  tour,
  title,
  onClick,
  children
}: RailButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // The same words as the visible label: end-to-end specs find the items by this attribute.
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={title}
      data-tour={tour}
      className={[
        'rail-button relative flex h-12 w-[60px] flex-col items-center justify-center gap-1 rounded text-[10px] font-medium leading-none transition-colors',
        active
          ? 'bg-accent-subtle text-accent'
          : disabled
            ? 'cursor-not-allowed text-text-faint'
            : 'text-text-muted hover:bg-elevated hover:text-text-secondary'
      ].join(' ')}
    >
      {active && (
        <span className="absolute -left-1.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
      )}
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      {label}
      {children}
    </button>
  )
}
