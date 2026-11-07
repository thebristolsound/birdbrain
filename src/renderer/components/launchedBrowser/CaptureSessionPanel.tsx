import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type {
  LaunchedBrowserNotice,
  LaunchedBrowserSummary,
  LaunchedBrowserTab
} from '@shared/types'
import { Button } from '@renderer/components/ui'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import {
  endLaunchedBrowserSession,
  launchedBrowserName,
  launchedBrowserPopOutQueryOptions,
  launchedBrowserStatusQueryOptions,
  popOutPanel
} from '@renderer/lib/api/launchedBrowser'
import { useAppStore } from '@renderer/stores/appStore'
import { cn } from '@renderer/lib/utils'
import { CaptureControl } from '@renderer/components/launchedBrowser/CaptureControl'
import { InfoTip } from '@renderer/components/launchedBrowser/InfoTip'
import { PopOutStub } from '@renderer/components/launchedBrowser/PopOutStub'
import { egressName } from '@renderer/components/launchedBrowser/startDialogModel'
import {
  captureTarget,
  extensionWarningTitle,
  formatElapsed,
  noticeCard,
  panelView,
  tabCount,
  tabStatus,
  tabTitle,
  type PanelView
} from '@renderer/components/launchedBrowser/captureSessionPanelModel'

// The rail and its overlay list the tabs; the top bar's popover and the pop-out's window count
// them (`2d`, `1g`).
export type PanelForm = 'rail' | 'overlay' | 'popover' | 'window'

interface PanelProps {
  form: PanelForm
  // Called before a control hands over to another surface, so an overlay or popover can close.
  onDone?: () => void
  // "Open ‹Case›", which the dashboard's popover offers.
  showOpenCase?: boolean
}

export function useCaptureSessionView(): PanelView {
  const { data: status } = useQuery(launchedBrowserStatusQueryOptions)
  const dismissed = useAppStore((s) => s.dismissedLaunchNotice)
  return panelView(status, dismissed)
}

const EYEBROW = 'font-display text-[10px] font-semibold uppercase tracking-[.06em] text-text-faint'

// The Capture Session panel (S3), in the forms this step builds: the rail on Case screens, the
// overlay its strip opens, the top bar's popover on the dashboard and in Settings, and the
// pop-out's window, whose title bar names the Case.
export function CaptureSessionPanel({ form, onDone, showOpenCase = false }: PanelProps) {
  const view = useCaptureSessionView()
  const { data: poppedOut = false } = useQuery(launchedBrowserPopOutQueryOptions)
  if (view.kind === 'none') return null
  if (view.kind === 'notice') return <NoticeBody notice={view.notice} />
  // Main docks the panel once the browser has closed; until that event lands, state 10 shows here.
  if (poppedOut && form !== 'window' && view.kind !== 'closed') {
    return <PopOutStub onDone={onDone} />
  }
  return <BrowserBody view={view} form={form} onDone={onDone} showOpenCase={showOpenCase} />
}

function BrowserBody({
  view: { kind, browser },
  form,
  onDone,
  showOpenCase
}: {
  view: Extract<PanelView, { browser: LaunchedBrowserSummary }>
  form: PanelForm
  onDone?: () => void
  showOpenCase: boolean
}) {
  const openStartDialog = useAppStore((s) => s.openStartDialog)
  const setStopConfirmOpen = useAppStore((s) => s.setStopConfirmOpen)
  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: settings } = useQuery(settingsQueryOptions)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')

  const { label, caseId, sessionStartedAt, tabs, extensionWarnings } = browser
  const name = launchedBrowserName(label)
  const caseName = cases.find(({ id }) => id === caseId)?.name ?? ''
  const egress = settings?.egress
  // The Egress is fixed for the browser's life: a change ends its Capture Session first.
  const egressText = egress && egress.kind !== 'unavailable' ? egressName(egress) : null
  // The pop-out's title bar names the Case.
  const inPopOut = form === 'window'
  const listsTabs = form === 'rail' || form === 'overlay'
  // The popover only counts tabs; every other form holds the Capture control (#1832).
  const capturesHere = form !== 'popover'
  const pad = listsTabs ? 'px-3 py-2.5' : 'px-2.5 py-2'
  const openCaseLink = showOpenCase && (
    <OpenCaseLink caseId={caseId} caseName={caseName} onDone={onDone} />
  )

  if (kind === 'closed') {
    async function stopSession() {
      setStopping(true)
      setStopError('')
      try {
        await endLaunchedBrowserSession()
      } catch {
        setStopError('The Capture Session could not be stopped.')
      } finally {
        setStopping(false)
      }
    }
    return (
      <div className={cn('flex flex-col gap-1.5 text-[11px] leading-[1.45]', pad)}>
        <div className="flex items-center gap-1.5">
          <PanelTitle />
          {sessionStartedAt !== null && <Elapsed since={sessionStartedAt} />}
        </div>
        <div className="flex items-center gap-1.5">
          <span>
            <span className="font-semibold text-text-primary">{name} closed.</span>{' '}
            <span className="text-text-muted">
              The Capture Session keeps running until you stop it.
            </span>
          </span>
          <InfoTip text="Launching again joins this Capture Session." />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {/* The start dialog is the main window's. */}
          {!inPopOut && (
            <Button
              variant="outline"
              onClick={() => {
                onDone?.()
                openStartDialog(caseId)
              }}
            >
              Launch again…
            </Button>
          )}
          <Button variant="outline" disabled={stopping} onClick={() => void stopSession()}>
            Stop Capture Session
          </Button>
        </div>
        {stopError && (
          <p role="alert" className="text-danger-fg">
            {stopError}
          </p>
        )}
        {openCaseLink}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[11px] leading-[1.45]">
      <div className={cn('flex flex-col gap-[3px] border-b border-border', pad)}>
        <div className="flex items-center gap-1.5">
          <PanelTitle />
          {sessionStartedAt !== null && <Elapsed since={sessionStartedAt} />}
          <span className="flex-1" />
          {!inPopOut && (
            <Button
              variant="link"
              disabled={kind === 'closing'}
              className="px-0 text-[11px] text-text-muted underline"
              onClick={() => {
                onDone?.()
                void popOutPanel()
              }}
            >
              Pop out
            </Button>
          )}
          <Button
            variant="outline"
            disabled={kind === 'closing'}
            onClick={() => {
              onDone?.()
              setStopConfirmOpen(true)
            }}
          >
            Stop…
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-text-primary">{name}</span>
          {egressText && (
            <>
              <span aria-hidden="true" className="text-text-faint">
                ·
              </span>
              <span className="text-text-muted">{egressText}</span>
            </>
          )}
        </div>
        {!inPopOut && <div className="text-text-muted">Into {caseName}</div>}
        {kind === 'closing' && <div className="text-text-muted">Closing {name}…</div>}
      </div>
      {extensionWarnings.length > 0 && (
        <div className={pad}>
          <ExtensionWarning count={extensionWarnings.length} egress={egressText} />
        </div>
      )}
      {capturesHere && kind === 'open' && <CaptureControl browser={browser} pad={pad} />}
      {listsTabs ? (
        <TabList tabs={tabs} selectable={!browser.captureUnavailable} />
      ) : (
        <div className={cn('flex flex-col gap-1.5', pad)}>
          <span className="text-text-muted">{tabCount(tabs.length)}</span>
          {openCaseLink}
        </div>
      )}
    </div>
  )
}

// "Open ‹Case›", which only the dashboard's popover offers.
function OpenCaseLink({
  caseId,
  caseName,
  onDone
}: {
  caseId: string
  caseName: string
  onDone?: () => void
}) {
  const navigate = useNavigate()
  return (
    <Button
      variant="link"
      className="h-auto self-start px-0 text-[11px] text-text-muted underline"
      onClick={() => {
        onDone?.()
        void navigate({ to: '/cases/$caseId', params: { caseId } })
      }}
    >
      Open {caseName}
    </Button>
  )
}

function PanelTitle() {
  return (
    <span className="font-display text-xs font-semibold text-text-primary">Capture Session</span>
  )
}

// Both clocks are this machine's, so main's start time and the renderer's now compare.
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <span role="timer" className="font-mono text-[10px] text-text-muted">
      {formatElapsed(now - since)}
    </span>
  )
}

// State 9 (`1m`). The launcher warns only while the Egress is not Direct.
function ExtensionWarning({ count, egress }: { count: number; egress: string | null }) {
  const tip =
    'Shown only while the Egress is not Direct. ' +
    `With the Egress on ${egress ?? 'a proxy'}, an extension can replace the proxy setting, and ` +
    'Birdbrain cannot check what it does. The Capture Session continues; the warning refuses ' +
    'nothing. Remove it in the browser if you did not add it.'
  return (
    <div
      role="status"
      className="rounded border border-l-[3px] border-border border-l-warning-fg bg-card px-2.5 py-[7px]"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-text-primary">{extensionWarningTitle(count)}</span>
        <InfoTip text={tip} />
      </div>
      <div className="text-text-muted">It could change how traffic leaves this browser.</div>
    </div>
  )
}

// Each row names its tab, and once the engine records it, whether its page was recorded from
// its first request or why it cannot be captured (`1k`). A row the Capture control can take
// is a button that makes it the capture target.
function TabList({ tabs, selectable }: { tabs: LaunchedBrowserTab[]; selectable: boolean }) {
  const pickedId = useAppStore((s) => s.captureTargetId)
  const setTarget = useAppStore((s) => s.setCaptureTargetId)
  const target = captureTarget(tabs, pickedId)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-3 py-2">
      {tabs.length === 0 ? (
        <p className="text-text-muted">{tabCount(0)}</p>
      ) : (
        <>
          <div className={EYEBROW}>{tabCount(tabs.length)}</div>
          <ul aria-label="Tabs" className="flex flex-col gap-1.5">
            {tabs.map((tab) => {
              const status = tabStatus(tab)
              const takes =
                selectable && tab.refusal === undefined && tab.firstRequest !== undefined
              const chosen = target?.targetId === tab.targetId
              const body = (
                <>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold text-text-primary">
                      {tabTitle(tab)}
                    </span>
                    {status && <TabStatusLabel status={status} />}
                  </div>
                  <div className="truncate font-mono text-[10px] text-text-muted">{tab.url}</div>
                  {tab.refusal === 'crashed' && (
                    <div className="text-danger-fg">Reload it in the browser, then capture.</div>
                  )}
                </>
              )
              return (
                <li
                  key={tab.targetId}
                  title={tab.url}
                  className={cn(
                    'min-w-0 rounded border bg-card',
                    tab.refusal === 'private' || tab.refusal === 'not-http'
                      ? 'border-dotted border-border text-text-muted'
                      : tab.refusal === 'crashed'
                        ? 'border-danger-line bg-danger-surface'
                        : chosen
                          ? 'border-accent'
                          : 'border-border'
                  )}
                >
                  {takes ? (
                    <button
                      type="button"
                      aria-pressed={chosen}
                      className="w-full min-w-0 px-[7px] py-[5px] text-left"
                      onClick={() => setTarget(tab.targetId)}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="px-[7px] py-[5px]">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

function TabStatusLabel({ status }: { status: NonNullable<ReturnType<typeof tabStatus>> }) {
  const { label, tip, tone } = status
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        className={cn(
          'whitespace-nowrap text-[10px]',
          tone === 'chip' && 'rounded border border-border-strong px-1 font-mono text-text-muted',
          tone === 'muted' && 'text-text-muted',
          tone === 'danger' && 'font-semibold text-danger-fg'
        )}
      >
        {label}
      </span>
      {tip && <InfoTip text={tip} />}
    </span>
  )
}

// State 11 and its kin: how the last launched browser closed, until the Operator dismisses it.
function NoticeBody({ notice }: { notice: LaunchedBrowserNotice }) {
  const dismiss = useAppStore((s) => s.dismissLaunchNotice)
  const { title, detail, tip } = noticeCard(notice)
  return (
    <div className="px-3 py-2.5 text-[11px] leading-[1.45]">
      <div
        role="status"
        className="rounded border border-l-[3px] border-border border-l-danger-fg bg-card px-2.5 py-[7px]"
      >
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-text-primary">{title}</span>
          {tip && <InfoTip text={tip} />}
        </div>
        <div className="text-text-muted">{detail}</div>
        <div className="mt-1.5">
          <Button variant="ghost" onClick={() => dismiss(notice)}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  )
}
