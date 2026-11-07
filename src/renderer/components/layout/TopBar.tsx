import { useState } from 'react'
import {
  Sun,
  Moon,
  ChevronDown,
  ChevronsUpDown,
  ChevronRight,
  Settings,
  ArrowLeft
} from 'lucide-react'
import logoImg from '@renderer/assets/logo.png'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { useMatchRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { caseQueryOptions } from '@renderer/lib/queries'
import { accelerator } from '@renderer/lib/accelerator'
import { SearchBar } from '@renderer/components/search/SearchBar'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { CaptureSessionButton } from '@renderer/components/launchedBrowser/CaptureSessionButton'
import {
  CaptureSessionPanel,
  useCaptureSessionView
} from '@renderer/components/launchedBrowser/CaptureSessionPanel'
import {
  launchedBrowserName,
  launchedBrowserStatusQueryOptions
} from '@renderer/lib/api/launchedBrowser'
import { ConnectionStatus } from '@renderer/components/status/ConnectionStatus'
import { CaptureHealth } from '@renderer/components/status/CaptureHealth'
import { SharePill } from '@renderer/components/status/SharePill'
import { MemberCodeChip } from '@renderer/components/sharing/MemberCodeChip'
import { youAreLine } from '@renderer/components/sharing/memberModel'
import { membersQueryOptions } from '@renderer/lib/api/sharing'
import { ExportMenu } from '@renderer/components/export/ExportMenu'
import { EgressIndicator } from '@renderer/components/status/EgressIndicator'
import { useTheme } from '@renderer/hooks/useTheme'
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
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const { theme, toggleTheme } = useTheme()
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

        {/* A running session keeps its indicator and stop control here too. Settings has no
            rail, so the REC pill opens the Capture Session panel (`2d`); Open ‹Case› stays on the
            dashboard's. */}
        {sessionActive ? (
          <div className="flex items-center gap-2">
            <SessionControls />
            <RecIndicator popover={{ showOpenCase: false }} />
          </div>
        ) : (
          <CaptureSessionButton showOpenCase={false} />
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          title="Toggle theme"
          style={END_INSET}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </header>
    )
  }

  return (
    <header className={HEADER_CLASS}>
      {/* The side groups share what the search leaves equally, so the search sits at the
          window's centre until a side needs more than its half. The case name's track
          gives way first, down to about eight characters; then the search shrinks. */}
      <div
        className={cn(
          'grid flex-1 basis-0 items-center gap-3 max-[1000px]:grid-cols-[max-content_max-content_minmax(2rem,max-content)]',
          // Below 1,000 pixels the name hides and its track narrows (design review of 2026-11-04).
          self
            ? 'grid-cols-[max-content_max-content_minmax(7.5rem,max-content)]'
            : 'grid-cols-[max-content_max-content_minmax(6rem,max-content)]'
        )}
      >
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
                className="min-w-16 max-w-[220px] truncate font-display text-xs font-bold text-text-primary max-[1000px]:hidden"
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

      {/* Right controls */}
      <div
        data-testid="topbar-controls"
        className="flex flex-1 basis-0 items-center justify-end gap-2"
      >
        {/* The case's session switch lives in CaseActionBar, under this bar. Case screens
            carry the Capture Session rail; on the dashboard and the wizard, which have none, the
            REC pill opens the panel (`2c`). With no session running there is no pill, and a
            notice the panel still holds opens from the Capture Session button. */}
        {sessionActive && (
          <RecIndicator popover={activeCaseId ? undefined : { showOpenCase: isOnDashboard }} />
        )}
        {!activeCaseId && !sessionActive && <CaptureSessionButton showOpenCase={isOnDashboard} />}

        {/* The Case's one sharing control: "Share" until a peer joins, then the sync state. */}
        {activeCase && (
          <SharePill
            caseId={activeCase.id}
            onOpenMembers={() =>
              navigate({ to: '/cases/$caseId/settings', params: { caseId: activeCase.id } })
            }
          />
        )}
        <EgressIndicator />
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

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          title="Toggle theme"
          style={END_INSET}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </header>
  )
}

const REC_PILL_CLASS =
  'flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5'

// Names the launched browser while it is open (`2c`, `2d`). On screens with no rail it is also the
// trigger for the Capture Session panel, as a 300-pixel popover under it, while the panel has
// something to show; the outline takes the accent while the popover is open.
function RecIndicator({ popover }: { popover?: { showOpenCase: boolean } }) {
  const { data: launched } = useQuery(launchedBrowserStatusQueryOptions)
  const view = useCaptureSessionView()
  const [open, setOpen] = useState(false)
  const trigger = popover !== undefined && view.kind !== 'none'
  // A popover open as the panel emptied would open again with the next launch.
  const [wasTrigger, setWasTrigger] = useState(trigger)
  if (trigger !== wasTrigger) {
    setWasTrigger(trigger)
    if (!trigger) setOpen(false)
  }

  const content = (
    <>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      <span className="text-[10px] font-medium text-danger-fg">REC</span>
      {launched?.state === 'open' && (
        <span className="whitespace-nowrap text-[10px] text-text-secondary">
          · {launchedBrowserName(launched.browser.label)}
        </span>
      )}
    </>
  )
  if (!trigger) {
    return (
      <div data-testid="topbar-rec" className={REC_PILL_CLASS}>
        {content}
      </div>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="topbar-rec"
          className={cn(
            REC_PILL_CLASS,
            'transition-colors hover:bg-red-500/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            open && 'outline-2 outline-offset-1 outline-accent'
          )}
        >
          {content}
          <ChevronDown aria-hidden="true" className="h-3 w-3 text-text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} aria-label="Capture Session" className="w-[300px]">
        <CaptureSessionPanel
          form="popover"
          showOpenCase={popover.showOpenCase}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
