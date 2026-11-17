import { ChevronRight, Settings, ArrowLeft } from 'lucide-react'
import logoImg from '@renderer/assets/logo.png'
import { Button } from '@renderer/components/ui'
import { useMatchRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { caseQueryOptions } from '@renderer/lib/queries'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { StatusGroup } from '@renderer/components/status/StatusGroup'
import { LaunchControl } from '@renderer/components/status/LaunchControl'
import { CaseMenu } from '@renderer/components/dashboard/CaseMenu'
import { useUpdateStatus } from '@renderer/hooks/useUpdateStatus'
import {
  WINDOW_CONTROLS_LEFT_PROPERTY,
  WINDOW_CONTROLS_RIGHT_PROPERTY
} from '@renderer/lib/windowControls'

// Margins that keep the bar's content clear of the native window controls: the OS title
// bar is hidden and this bar stands in for it. lib/windowControls.ts publishes the room
// each side needs. They go on the outermost item of each side rather than on the header,
// because the two side groups are `flex-1 basis-0` and padding on either would make them
// unequal, moving the search off the window's centre (e2e/topbar-layout.spec.ts). The
// -0.25rem is the logo's own `-ml-1`, which the inline margin replaces.
const START_INSET = {
  marginLeft: `calc(-0.25rem + var(${WINDOW_CONTROLS_LEFT_PROPERTY}, 0px))`
} as const
const END_INSET = { marginRight: `var(${WINDOW_CONTROLS_RIGHT_PROPERTY}, 0px)` } as const

const HEADER_CLASS =
  'app-drag flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4'

export function TopBar() {
  const navigate = useNavigate()
  const router = useRouter()
  const matchRoute = useMatchRoute()
  const { status: updateStatus } = useUpdateStatus()
  const updateAvailable =
    updateStatus?.state === 'available' || updateStatus?.state === 'downloaded'

  const isOnSettings = Boolean(matchRoute({ to: '/settings' }))
  // The rail shows on Case screens and the new-Case wizard (__root.tsx), and holds Settings at
  // its foot. Where there is no rail, Settings stays in this bar.
  const hasRail = Boolean(matchRoute({ to: '/cases/$caseId', fuzzy: true }))
  const isOnDashboard = Boolean(matchRoute({ to: '/' }))
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
      <header className={HEADER_CLASS}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-1 -ml-1" style={START_INSET}>
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

        {/* How the app is doing, the same control as on a Case (2026-11-08 top bar), then the
            capture control, which carries the recording mark and opens the panel, since Settings
            has no rail (`2d`). Open ‹Case› stays on the dashboard's. */}
        <StatusGroup />
        <div className="flex shrink-0 items-center gap-2" style={END_INSET}>
          <LaunchControl caseId={null} showOpenCase={false} />
        </div>
      </header>
    )
  }

  return (
    <header className={HEADER_CLASS}>
      {/* The side groups share what the search leaves equally, so the search sits at the
          window's centre until a side needs more than its half. The case name's track
          gives way first, down to 160 pixels; then the search shrinks. Below 1,000 pixels the
          name hides and its track narrows (design review of 2026-11-04). */}
      <div className="grid flex-1 basis-0 grid-cols-[max-content_max-content_minmax(10rem,max-content)] items-center gap-3 max-[1000px]:grid-cols-[max-content_max-content_minmax(2rem,max-content)]">
        {/* Logo — click to go home */}
        <button
          onClick={() => navigate({ to: '/' })}
          className="flex items-center gap-2 rounded-md px-1 -ml-1 hover:bg-elevated transition-colors"
          style={START_INSET}
          title="Home"
        >
          <img src={logoImg} alt="Birdbrain" className="h-6 w-6" />
          <span className="font-display text-xs font-extrabold tracking-tight text-text-primary">
            Birdbrain
          </span>
        </button>

        {/* The Case name opens the Case menu: Switch Case, sharing, the exports, Import and Case
            settings. A sync that is running or has stopped shows beside the name. */}
        {activeCaseId && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint" />
            <CaseMenu place="name" caseId={activeCaseId} caseData={activeCase ?? undefined} />
          </>
        )}
      </div>

      {/* The z-index lifts the results dropdown above sticky headers in the page below. */}
      {activeCaseId && (
        <div className="relative z-50 flex min-w-32 flex-[0_1_400px]">
          <SearchBar caseId={activeCaseId} />
        </div>
      )}

      {/* Right controls, on every screen: how the app is doing, then the capture control, the
          bar's one filled button at rest and the recording mark while a session records; then
          Settings, where no rail holds it. This bar is the only row of chrome above a Case
          screen. The group never narrows below its controls, so the search gives way instead
          of sitting over them. */}
      <div
        data-testid="topbar-controls"
        className="flex min-w-max flex-1 basis-0 items-center justify-end gap-2"
      >
        <StatusGroup />
        {hasRail ? (
          <div className="flex shrink-0 items-center gap-2" style={END_INSET}>
            <LaunchControl caseId={activeCase?.id ?? null} showOpenCase={false} />
          </div>
        ) : (
          <>
            <LaunchControl caseId={null} showOpenCase={isOnDashboard} />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate({ to: '/settings' })}
              title={updateAvailable ? 'Settings — update available' : 'Settings'}
              className="relative"
              style={END_INSET}
            >
              <Settings className="h-3.5 w-3.5" />
              {updateAvailable && (
                <span
                  data-testid="topbar-update-dot"
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent"
                />
              )}
            </Button>
          </>
        )}
      </div>
    </header>
  )
}
