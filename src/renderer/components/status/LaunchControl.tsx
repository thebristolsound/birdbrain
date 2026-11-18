import { useEffect, useId, useRef, useState, type ComponentProps } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import {
  AppWindow,
  ChevronDown,
  CircleAlert,
  CircleDot,
  CircleStop,
  ClipboardList,
  Puzzle,
  Shield
} from 'lucide-react'
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/stores/appStore'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import { useSessionMutations } from '@renderer/lib/api/session'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { vpnStatusQueryOptions } from '@renderer/lib/api/egress'
import { launchedBrowserStatusQueryOptions } from '@renderer/lib/api/launchedBrowser'
import { confirmContact } from '@renderer/lib/vpnWarning'
import { RecordingMark } from '@renderer/components/status/RecordingMark'
import { statusModel, type Signal } from '@renderer/components/status/statusGroupModel'
import {
  CaptureSessionPanel,
  useCaptureSessionView
} from '@renderer/components/launchedBrowser/CaptureSessionPanel'
import { noticeCard } from '@renderer/components/launchedBrowser/captureSessionPanelModel'
import { busyRefusal } from '@renderer/components/launchedBrowser/startDialogModel'
import { PasteUrlsDialog } from '@renderer/components/captures/PasteUrlsDialog'
import { createPortal } from 'react-dom'

interface LaunchControlProps {
  /** The Case on screen, or null where none is: the dashboard, Settings, the new-Case wizard. */
  caseId: string | null
  /** The dashboard's panel links to the browser's Case; Settings' does not. */
  showOpenCase: boolean
}

// The top bar's one capture control, on every screen. At rest it is the bar's one filled button,
// Launch browser, with a menu beside it for the other ways to capture and for the two facts that
// matter before a contact: the extension and the Egress. While a Capture Session records it is
// the recording mark. A launched browser's session has a panel: on a Case the mark shows or hides
// it, and where there is no panel on screen the mark opens it as a popover. The extension's
// session has none, so its mark opens the capture menu, which then holds Stop. A browser open
// with nothing recording yet shows an outline button naming the Capture Session.
export function LaunchControl({ caseId, showOpenCase }: LaunchControlProps) {
  const view = useCaptureSessionView()
  const sessionActive = useAppStore((s) => s.sessionActive)
  const sessionCaseId = useAppStore((s) => s.activeCaseId)
  const hidden = useAppStore((s) => s.captureSessionPanelHidden)
  const setHidden = useAppStore((s) => s.setCaptureSessionPanelHidden)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const browserSession = 'browser' in view
  // The breadcrumb names the Case on screen, and the Active Case, the one Captures go into, can
  // be another: a launched browser pins the Case it started in, and the extension can choose one
  // too. The mark says so on Case screens, where the two can be told apart.
  const into =
    sessionActive && caseId && sessionCaseId && sessionCaseId !== caseId
      ? cases.find((c) => c.id === sessionCaseId)?.name
      : undefined

  // A panel hidden for one launched browser shows again for the next.
  useEffect(() => {
    if (!browserSession) setHidden(false)
  }, [browserSession, setHidden])

  if (browserSession) {
    return caseId ? (
      <SessionTrigger
        recording={sessionActive}
        // The panel on a Case screen names an open browser, so the mark leaves the name out
        // while the panel shows. With the panel hidden, or once the browser closes and the
        // source is the extension, nothing else on the screen names the source.
        showSource={view.kind !== 'open' || hidden}
        into={into}
        selected={!hidden}
        aria-expanded={!hidden}
        title={hidden ? 'Show the Capture Session panel' : 'Hide the Capture Session panel'}
        onClick={() => setHidden(!hidden)}
      />
    ) : (
      <SessionPopover recording={sessionActive} showOpenCase={showOpenCase} />
    )
  }

  return <CaptureMenu caseId={caseId} recording={sessionActive} into={into} />
}

const MARK_BUTTON_CLASS =
  'shrink-0 rounded-md border border-border-strong px-1.5 transition-colors hover:bg-elevated aria-expanded:bg-elevated'

interface SessionTriggerProps extends ComponentProps<'button'> {
  recording: boolean
  showSource: boolean
  into?: string
  selected: boolean
}

// A launched browser's session in the bar. While it records it is the recording mark itself, so
// the bar carries one control for the session, not two
// (docs/design-handoff/2026-11-08-top-bar/). Otherwise it is an outline button whose border
// takes the accent while its panel shows (C1).
function SessionTrigger({ recording, showSource, into, selected, ...props }: SessionTriggerProps) {
  return recording ? (
    <button
      type="button"
      data-testid="topbar-capture-session"
      className={cn(MARK_BUTTON_CLASS, selected && 'bg-elevated')}
      {...props}
    >
      {/* The mark's elapsed time and source stay in the accessible name: hidden text names the
          control, not an aria-label. */}
      <span className="sr-only">Capture Session, </span>
      <RecordingMark showSource={showSource} into={into} trigger />
    </button>
  ) : (
    <Button
      variant="outline"
      data-testid="topbar-capture-session"
      className={cn(
        'shrink-0 gap-1 font-normal',
        selected && 'border-accent bg-accent-subtle text-accent hover:bg-accent-subtle'
      )}
      {...(props as ComponentProps<typeof Button>)}
    >
      Capture Session
      <ChevronDown aria-hidden="true" className="h-3 w-3" />
    </Button>
  )
}

// The dashboard, Settings and the new-Case wizard dock no Capture Session panel, so the control
// opens the panel as a 300-pixel popover under it (`2c`, `2d`).
function SessionPopover({
  recording,
  showOpenCase
}: {
  recording: boolean
  showOpenCase: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SessionTrigger recording={recording} showSource selected={open} />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} aria-label="Capture Session" className="w-[300px]">
        <CaptureSessionPanel
          form="popover"
          showOpenCase={showOpenCase}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

// What the menu says before a contact: whether the extension is connected, and the Egress with
// whether a VPN is seen. The same model the status control reads, so the two cannot disagree.
function useContactSignals(): { extension: Signal; egress: Signal } {
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const { data: settings, isError: settingsFailed } = useQuery(settingsQueryOptions)
  const egress = settings?.egress
  const direct = egress?.kind === 'direct'
  const { data: vpn, isError: vpnFailed } = useQuery({ ...vpnStatusQueryOptions, enabled: direct })
  const [extension, egressSignal] = statusModel({
    egress,
    egressReadFailed: settingsFailed && !egress,
    vpnSeen: direct && !vpnFailed ? vpn?.vpnSeen : undefined,
    vpnReadFailed: direct && vpnFailed,
    connectedToExtension,
    successCount: 0,
    failCount: 0,
    sessionActive: false
  }).signals
  return { extension, egress: egressSignal }
}

// The extension's Capture Session, which the row under the top bar used to start and stop. A
// start passes the VPN warning first, since a session's Captures contact sites (ADR-0032 VPN
// rule 3), and activates the Case before it starts: main refuses a start with no Active Case.
function useExtensionSession(caseId: string | null) {
  const setSessionActive = useAppStore((s) => s.setSessionActive)
  const { activateCase, start, stop } = useSessionMutations()
  const [working, setWorking] = useState(false)

  // Resolves to whether the session changed.
  async function run(action: () => Promise<boolean>): Promise<boolean> {
    if (working) return false
    setWorking(true)
    let changed = false
    try {
      changed = await action()
    } catch (error) {
      console.error('Failed to change the Capture Session:', error)
    }
    setWorking(false)
    return changed
  }

  return {
    working,
    start: () =>
      run(async () => {
        if (!caseId) return false
        if (!(await confirmContact({ caseId }, 'session'))) return false
        await activateCase.mutateAsync(caseId)
        await start.mutateAsync()
        setSessionActive(true)
        return true
      }),
    stop: () =>
      run(async () => {
        await stop.mutateAsync()
        setSessionActive(false)
        return true
      })
  }
}

interface CaptureMenuProps {
  caseId: string | null
  /** The extension's session records: the mark is the menu's trigger, and the menu holds Stop. */
  recording: boolean
  into?: string
}

function CaptureMenu({ caseId, recording, into }: CaptureMenuProps) {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const view = useCaptureSessionView()
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const openStartDialog = useAppStore((s) => s.openStartDialog)
  const openStartDialogPicker = useAppStore((s) => s.openStartDialogPicker)
  const dismissNotice = useAppStore((s) => s.dismissLaunchNotice)
  const { data: launched } = useQuery(launchedBrowserStatusQueryOptions)
  const { extension, egress } = useContactSignals()
  const session = useExtensionSession(caseId)
  // The paste dialog keeps the Case it was opened for. The palette can change the Case on screen
  // while the dialog is up, and the pasted addresses must not then go into the other Case. Each
  // opening has a number, so a queue that finishes after its dialog closed cannot close a later
  // opening or put its Case back.
  const [paste, setPaste] = useState<{ caseId: string; open: boolean; opening: number } | null>(
    null
  )
  const openings = useRef(0)
  const reasonId = useId()
  const control = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)

  // A start or a stop swaps the control's buttons, and the one that held focus goes with them.
  // Focus then lands on the button that took its place, not on the page.
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    if (document.activeElement === document.body) control.current?.querySelector('button')?.focus()
  }, [recording])

  function change(action: () => Promise<boolean>) {
    refocus.current = true
    void action().then((changed) => {
      if (!changed) refocus.current = false
    })
  }

  // One launched browser at a time: while one starts, a launch is held. An open or closing
  // browser never reaches here, since the control is then the session's.
  const busy = busyRefusal(launched)?.title
  const notice = view.kind === 'notice' ? view.notice : null
  const card = notice ? noticeCard(notice) : null
  const startHeld = !connectedToExtension
    ? 'The extension is not connected'
    : !caseId
      ? 'Open a Case first'
      : undefined

  function launch() {
    if (busy) return
    if (caseId) openStartDialog(caseId)
    else openStartDialogPicker()
  }

  return (
    <div ref={control} data-testid="launch-control" className="inline-flex shrink-0">
      {!recording && (
        <>
          <Button
            // aria-disabled rather than disabled, so the held button keeps focus and its reason
            // is reachable from the keyboard.
            aria-disabled={busy !== undefined}
            aria-describedby={busy ? reasonId : undefined}
            title={busy}
            onClick={launch}
            className="gap-1.5 whitespace-nowrap rounded-r-none aria-disabled:opacity-50"
          >
            {card && <CircleAlert aria-hidden="true" className="h-3 w-3" />}
            {caseId ? 'Launch browser' : 'Launch browser…'}
            {card && <span className="sr-only">. 1 notice: {card.title}</span>}
          </Button>
          {busy && (
            <span id={reasonId} className="sr-only">
              {busy}
            </span>
          )}
        </>
      )}
      <Menu>
        {recording ? (
          <MenuTrigger data-testid="topbar-capture-session" className={MARK_BUTTON_CLASS}>
            <span className="sr-only">Capture Session, </span>
            <RecordingMark into={into} trigger />
          </MenuTrigger>
        ) : (
          <MenuTrigger asChild>
            <Button
              // No tap gesture on a menu trigger: for Enter, Motion sends a pointerdown of its
              // own, which stops the menu opening on its first item.
              whileTap={undefined}
              aria-label="More ways to capture"
              title="More ways to capture"
              className="w-6 rounded-l-none border-l border-white/30 px-0"
            >
              <ChevronDown aria-hidden="true" className="h-3 w-3" />
            </Button>
          </MenuTrigger>
        )}
        <MenuContent
          aria-label={
            card
              ? `Capture. ${card.title}. ${card.detail}${card.tip ? ` ${card.tip}` : ''}`
              : 'Capture'
          }
          className="w-[300px]"
        >
          {notice && card && (
            <>
              <MenuLabel data-testid="launch-control-notice">
                <span className="block text-xs font-semibold text-text-primary">{card.title}</span>
                <span className="block text-[11px] text-text-muted">{card.detail}</span>
                {/* Main's own account of why the browser closed, which the panel shows in a tip. */}
                {card.tip && (
                  <span className="mt-1 block text-[11px] text-text-muted">{card.tip}</span>
                )}
              </MenuLabel>
              <MenuItem onSelect={() => dismissNotice(notice)}>Dismiss notice</MenuItem>
              <MenuSeparator />
            </>
          )}
          {recording && (
            <>
              <MenuItem
                data-testid="launch-control-stop"
                disabled={session.working}
                onSelect={() => change(session.stop)}
              >
                <CircleStop className={ITEM_ICON} strokeWidth={1.8} />
                Stop Capture Session
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem
            data-testid="launch-control-launch"
            disabled={busy !== undefined}
            onSelect={launch}
          >
            <AppWindow className={ITEM_ICON} strokeWidth={1.8} />
            Launch browser…
          </MenuItem>
          <MenuItem
            data-testid="launch-control-paste"
            disabled={!caseId}
            title={caseId ? undefined : 'Open a Case first'}
            onSelect={() => {
              if (!caseId) return
              openings.current += 1
              setPaste({ caseId, open: true, opening: openings.current })
            }}
          >
            <ClipboardList className={ITEM_ICON} strokeWidth={1.8} />
            Paste URLs to capture…
          </MenuItem>
          {!recording && (
            <MenuItem
              data-testid="launch-control-start-session"
              disabled={startHeld !== undefined || session.working}
              title={startHeld}
              className="items-start"
              onSelect={() => change(session.start)}
            >
              <CircleDot className={cn(ITEM_ICON, 'mt-0.5')} strokeWidth={1.8} />
              <span>
                Start Capture Session in Chrome
                <span className="block text-[10px] text-text-faint">Uses the extension.</span>
              </span>
            </MenuItem>
          )}
          <MenuSeparator />
          <SignalRow icon={Puzzle} signal={extension} />
          <SignalRow icon={Shield} signal={egress} />
          {egress.severity === 'warning' && (
            <MenuItem
              data-testid="launch-control-proxy"
              className="py-1.5 pl-8 text-[11px] text-accent"
              onSelect={() =>
                // From Settings this replaces the entry, so "Return to Birdbrain" still leaves.
                void navigate({
                  to: '/settings',
                  search: { section: 'egress' },
                  replace: Boolean(matchRoute({ to: '/settings' }))
                })
              }
            >
              Set up a proxy
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      {/* The dialog renders at the end of the document. Inside the bar its backdrop would lie in
          the window drag region, where a click starts a drag and does not close it. */}
      {paste &&
        createPortal(
          <PasteUrlsDialog
            key={paste.opening}
            caseId={paste.caseId}
            open={paste.open}
            onOpenChange={(open) =>
              setPaste((now) => (now?.opening === paste.opening ? { ...now, open } : now))
            }
          />,
          document.body
        )}
    </div>
  )
}

const ITEM_ICON = 'h-3.5 w-3.5 shrink-0 text-text-muted'

// A fact, not an action: it takes no focus and no click.
function SignalRow({ icon: Icon, signal }: { icon: typeof Puzzle; signal: Signal }) {
  return (
    <div
      role="none"
      data-testid={`launch-control-${signal.key}`}
      className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-secondary"
    >
      <Icon aria-hidden="true" className="h-3 w-3 shrink-0 text-text-muted" />
      <span className="text-text-primary">{signal.name}</span>
      <span
        className={cn(
          'ml-auto min-w-0 truncate',
          signal.severity === 'warning'
            ? 'text-warning-fg'
            : signal.severity === 'danger'
              ? 'text-danger-fg'
              : 'text-text-muted'
        )}
        title={signal.text}
      >
        {signal.text}
      </span>
    </div>
  )
}
