import { ChevronsUpDown, ChevronRight, Settings, ArrowLeft } from 'lucide-react'
import logoImg from '@renderer/assets/logo.png'
import { Button } from '@renderer/components/ui'
import { useMatchRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { caseQueryOptions } from '@renderer/lib/queries'
import { accelerator } from '@renderer/lib/accelerator'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { CaptureSessionButton } from '@renderer/components/launchedBrowser/CaptureSessionButton'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { StatusGroup } from '@renderer/components/status/StatusGroup'
import { RecordingMark } from '@renderer/components/status/RecordingMark'
import { useCaptureSessionView } from '@renderer/components/launchedBrowser/CaptureSessionPanel'
import { MemberCodeChip } from '@renderer/components/sharing/MemberCodeChip'
import { youAreLine } from '@renderer/components/sharing/memberModel'
import { membersQueryOptions } from '@renderer/lib/api/sharing'
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
  const sessionActive = useAppStore((s) => s.sessionActive)
  // With no launched browser the Capture Session control is absent, so an extension-only
  // session carries its own recording mark on the screens that have no action bar.
  const launchedView = useCaptureSessionView()
  const extensionOnlyRecording = sessionActive && launchedView.kind === 'none'
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const { status: updateStatus } = useUpdateStatus()
  const updateAvailable =
    updateStatus?.state === 'available' || updateStatus?.state === 'downloaded'

  const isOnSettings = Boolean(matchRoute({ to: '/settings' }))
  const isOnDashboard = Boolean(matchRoute({ to: '/' }))
  // The pattern also matches the wizard's literal `new` segment, which is not a case.
  const isOnWizard = Boolean(matchRoute({ to: '/cases/new' }))
  const caseMatch = isOnWizard ? false : matchRoute({ to: '/cases/$caseId', fuzzy: true })
  const activeCaseId = caseMatch ? (caseMatch as { caseId: string }).caseId : null

  const { data: activeCase } = useQuery({
    ...caseQueryOptions(activeCaseId ?? ''),
    enabled: !!activeCaseId
  })
  // This installation's Member Code leads the breadcrumb on a shared Case
  // (docs/design-handoff/2026-10-28-share-a-case/, frame C); a Case nobody
  // shared has an empty roster and no chip.
  const { data: roster } = useQuery({
    ...membersQueryOptions(activeCaseId ?? ''),
    enabled: !!activeCaseId
  })
  const self = roster?.members.find((m) => m.installationId === roster.installationId) ?? null
  const switchTitle = `Switch case (${accelerator('K')})`
  // The name can hide on a narrow window, so the tooltip carries it in full.
  const crumbTitle = [activeCase?.name, switchTitle, self && youAreLine(self.memberCode)]
    .filter(Boolean)
    .join(' · ')

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

        {/* A running session keeps its stop control here too; the Capture Session control
            carries the recording mark and opens the panel, since Settings has no rail (`2d`).
            Open ‹Case› stays on the dashboard's. */}
        {sessionActive && <SessionControls />}
        {extensionOnlyRecording && <RecordingMark />}
        <CaptureSessionButton showOpenCase={false} />
        {/* How the app is doing, the same control as on a Case (2026-11-08 top bar). */}
        <div style={END_INSET}>
          <StatusGroup />
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

        {/* Breadcrumb case switcher — opens the command launcher */}
        {activeCaseId && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint" />
            <button
              data-testid="topbar-case-name"
              data-tour="caseswitcher"
              onClick={() => setCommandPaletteOpen(true)}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-elevated transition-colors"
              title={crumbTitle}
            >
              {self && (
                <MemberCodeChip
                  code={self.memberCode}
                  hue="accent"
                  size={18}
                  data-testid="topbar-member-code"
                />
              )}
              <span
                data-testid="topbar-case-name-text"
                className="max-w-[220px] truncate font-display text-xs font-semibold text-text-primary max-[1000px]:hidden"
              >
                {activeCase?.name ?? ''}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            </button>
          </>
        )}
      </div>

      {/* The z-index lifts the results dropdown above sticky headers in the page below. */}
      {activeCaseId && (
        <div className="relative z-50 flex min-w-32 flex-[0_1_400px]">
          <SearchBar caseId={activeCaseId} />
        </div>
      )}

      {/* Right controls: how the app is doing, then Settings. What acts on the Case (Share,
          Export, Launch browser, the session switch and the recording mark) lives in
          CaseActionBar, under this bar (docs/design-handoff/2026-11-08-top-bar/, Option B). */}
      <div
        data-testid="topbar-controls"
        className="flex flex-1 basis-0 items-center justify-end gap-2"
      >
        {/* The dashboard and the wizard have no rail and no action bar (`2c`), so the session's
            control, and the recording mark while it records, stay up here. */}
        {!activeCaseId && extensionOnlyRecording && <RecordingMark />}
        {!activeCaseId && <CaptureSessionButton showOpenCase={isOnDashboard} />}

        <StatusGroup />

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
      </div>
    </header>
  )
}
