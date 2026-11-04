import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { KnownEgress, LaunchedBrowserOption } from '@shared/types'
import { Button, Dialog, DialogContent, DialogTitle } from '@renderer/components/ui'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import { useSessionMutations } from '@renderer/lib/api/session'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import {
  cancelBrowserLaunch,
  launchBrowser,
  launchedBrowserStatusQueryOptions,
  launchedBrowsersQueryOptions
} from '@renderer/lib/api/launchedBrowser'
import { useAppStore } from '@renderer/stores/appStore'
import { InfoTip } from '@renderer/components/launchedBrowser/InfoTip'
import {
  NO_BROWSER_REFUSAL,
  UNREADABLE_EGRESS_REFUSAL,
  busyRefusal,
  egressKindName,
  launchSteps,
  refusalFor,
  type LaunchRefusal,
  type StepProgress
} from '@renderer/components/launchedBrowser/startDialogModel'

const TITLE_TIP =
  'The browser runs on a browser profile of its own. Pages in this browser can tell that ' +
  'software drives it.'

const OPERATOR_TIP = 'Every Capture carries an operator name, so Birdbrain asks for it first.'

const STEP_MARKS: Readonly<Record<StepProgress, { mark: string; className: string }>> = {
  done: { mark: '✓', className: 'text-success-fg' },
  current: { mark: '◌', className: 'text-accent' },
  pending: { mark: '·', className: 'text-text-faint' }
}

// The start dialog (S2: `1b` to `1e`), mounted once at the root and opened for a Case from the
// Case action bar or the command palette. It launches into the Case it was opened for, which it
// activates first, as the Capture Session switch does before a start. The Persona picker is the
// Persona step's (#1833).
export function StartDialog() {
  const caseId = useAppStore((s) => s.startDialogCaseId)
  const close = useAppStore((s) => s.closeStartDialog)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const navigate = useNavigate()
  const open = caseId !== null

  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: settings } = useQuery(settingsQueryOptions)
  const { data: status } = useQuery(launchedBrowserStatusQueryOptions)
  const { data: browsers } = useQuery({ ...launchedBrowsersQueryOptions, enabled: open })
  const { activateCase } = useSessionMutations()

  const [selectedPath, setSelectedPath] = useState('')
  // The browser being launched and the Egress it was launched with.
  const [launching, setLaunching] = useState<{
    browser: LaunchedBrowserOption
    egress: KnownEgress
  } | null>(null)
  const [refusal, setRefusal] = useState<LaunchRefusal | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const cancelled = useRef(false)

  // Every way out of the dialog comes here, so the next opening starts clean.
  function dismiss() {
    setLaunching(null)
    setRefusal(null)
    setCancelling(false)
    setCancelError('')
    cancelled.current = false
    close()
  }

  const caseName = cases.find(({ id }) => id === caseId)?.name ?? ''
  const browser =
    browsers?.find(({ executablePath }) => executablePath === selectedPath) ?? browsers?.[0]
  const egress = settings?.egress
  const knownEgress: KnownEgress | null = egress && egress.kind !== 'unavailable' ? egress : null
  const operatorName = settings?.operatorName?.trim() ?? ''

  // What refuses a launch before it starts, in the order the launch itself checks.
  const blocked =
    busyRefusal(status) ??
    (browsers?.length === 0 ? NO_BROWSER_REFUSAL : null) ??
    (egress?.kind === 'unavailable' ? UNREADABLE_EGRESS_REFUSAL : null)
  const shownRefusal = launching ? null : (blocked ?? refusal)
  const canLaunch =
    !launching && !blocked && browser !== undefined && knownEgress !== null && operatorName !== ''

  async function launch() {
    if (!caseId || !browser || !knownEgress) return
    cancelled.current = false
    setRefusal(null)
    setLaunching({ browser, egress: knownEgress })
    try {
      await activateCase.mutateAsync(caseId)
      await launchBrowser(browser.executablePath)
      dismiss()
    } catch (error) {
      if (cancelled.current && (error as { code?: unknown }).code === 'BROWSER_LAUNCH_CANCELLED') {
        dismiss()
        return
      }
      setRefusal(refusalFor(error, browser.label, knownEgress))
      setLaunching(null)
    }
  }

  async function cancel() {
    cancelled.current = true
    setCancelling(true)
    setCancelError('')
    try {
      await cancelBrowserLaunch()
    } catch (error) {
      cancelled.current = false
      setCancelling(false)
      setCancelError((error as Error).message)
    }
  }

  // State 4's Show panel: the panel sits on the Case screens of the browser's Case.
  const browserCaseId = status && status.state !== 'none' ? status.browser.caseId : null
  function showPanel() {
    if (!browserCaseId) return
    dismiss()
    void navigate({ to: '/cases/$caseId/captures', params: { caseId: browserCaseId } })
  }

  function setOperatorName() {
    dismiss()
    void navigate({ to: '/settings' })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !launching && dismiss()}>
      {open && (
        <DialogContent
          onClose={() => !launching && dismiss()}
          className="max-w-[440px] rounded-md p-4 text-xs"
          data-testid="launch-start-dialog"
        >
          <div className="flex items-center gap-1.5">
            <DialogTitle>Launch a browser for {caseName}</DialogTitle>
            <InfoTip text={TITLE_TIP} />
          </div>
          {launching ? (
            <LaunchChecklist
              browser={launching.browser}
              egress={launching.egress}
              at={
                status?.state === 'starting'
                  ? status.step
                  : status?.state === 'open'
                    ? 'open'
                    : undefined
              }
              cancelling={cancelling}
              cancelError={cancelError}
              onCancel={() => void cancel()}
            />
          ) : (
            <>
              <p className="mt-1 text-text-muted">
                Birdbrain opens the browser for a Capture Session and closes it when the Capture
                Session ends.
              </p>
              <dl className="mt-3 grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
                <dt className="pt-1.5 text-text-muted">
                  <label htmlFor="launch-browser-select">Browser</label>
                </dt>
                <dd>
                  {browsers && browser ? (
                    <>
                      <select
                        id="launch-browser-select"
                        autoFocus
                        value={browser.executablePath}
                        onChange={(e) => setSelectedPath(e.target.value)}
                        className="h-7 w-full rounded border border-border-strong bg-surface px-2 text-xs text-text-primary"
                      >
                        {browsers.map((option) => (
                          <option key={option.executablePath} value={option.executablePath}>
                            {optionText(option)}
                          </option>
                        ))}
                      </select>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                        {browser.lastVersion && (
                          <span className="font-mono">{browser.lastVersion}</span>
                        )}
                        <span>
                          {browser.lastVersion ? 'from its last launch' : 'not launched yet'}
                        </span>
                      </div>
                    </>
                  ) : (
                    browsers && <span className="block pt-1.5 text-text-faint">None found</span>
                  )}
                </dd>
                <dt className="text-text-muted">Profile</dt>
                <dd className="text-text-secondary">
                  A new browser profile, which Birdbrain deletes when the browser closes.
                </dd>
                <dt className="text-text-muted">Egress</dt>
                <dd>
                  {knownEgress ? (
                    <EgressValue egress={knownEgress} />
                  ) : (
                    <span className="text-danger-fg">Not readable</span>
                  )}
                  {/* #1696's no-VPN line goes here, under a Direct Egress, once #2037 merges. */}
                </dd>
                <dt className="text-text-muted">Operator</dt>
                <dd>
                  {operatorName ? (
                    <span className="text-text-primary">{operatorName}</span>
                  ) : (
                    <>
                      <span className="font-semibold text-danger-fg">Not set</span>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                        <span>Set your name before launching.</span>
                        <InfoTip text={OPERATOR_TIP} />
                      </div>
                    </>
                  )}
                </dd>
              </dl>
              {shownRefusal && (
                <RefusalCard
                  refusal={shownRefusal}
                  onShowPanel={shownRefusal.state === 4 && browserCaseId ? showPanel : undefined}
                />
              )}
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
                <span className="text-[11px] text-text-muted">
                  {sessionActive
                    ? `Joins the running Capture Session in ${caseName}.`
                    : `Starts a Capture Session in ${caseName}.`}
                </span>
                <span className="flex-1" />
                <Button variant="outline" onClick={dismiss}>
                  Cancel
                </Button>
                {settings && !operatorName && (
                  <Button variant="outline" onClick={setOperatorName}>
                    Set operator name
                  </Button>
                )}
                <Button
                  className="font-semibold text-accent-foreground"
                  disabled={!canLaunch}
                  onClick={() => void launch()}
                >
                  {sessionActive ? 'Launch and join' : 'Launch'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}

function optionText({ label, lastVersion, chosen, executablePath }: LaunchedBrowserOption): string {
  const name = chosen ? `${label} · ${executablePath}` : label
  return lastVersion ? `${name} ${lastVersion}` : name
}

function EgressValue({ egress }: { egress: KnownEgress }) {
  const routed = egress.kind !== 'direct'
  const tip =
    'Change it in Settings → Operator before launching.' +
    (routed ? ' The Egress hides where you are, not which browser is looking.' : '')
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span>
          <span className="font-semibold">{egressKindName(egress)}</span>
          {routed && ` · ${egress.label}`}
        </span>
        <InfoTip text={tip} />
      </div>
      <p className="text-[11px] text-text-muted">
        Fixed while the browser is open. Changing it ends the Capture Session.
      </p>
    </>
  )
}

function RefusalCard({
  refusal: { state, title, detail },
  onShowPanel
}: {
  refusal: LaunchRefusal
  onShowPanel?: () => void
}) {
  return (
    <div
      role="status"
      className="mt-3 flex items-center gap-2 rounded border border-l-[3px] border-border border-l-danger-fg bg-card px-2.5 py-[7px]"
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-text-primary">
          {state && (
            <span className="font-mono text-[10px] font-normal text-text-faint">{state} · </span>
          )}
          {title}
        </div>
        <div className="text-text-muted">{detail}</div>
      </div>
      {onShowPanel && (
        <Button variant="outline" onClick={onShowPanel}>
          Show panel
        </Button>
      )}
    </div>
  )
}

function LaunchChecklist({
  browser,
  egress,
  at,
  cancelling,
  cancelError,
  onCancel
}: {
  browser: LaunchedBrowserOption
  egress: KnownEgress
  at: Parameters<typeof launchSteps>[2] | undefined
  cancelling: boolean
  cancelError: string
  onCancel: () => void
}) {
  const lines = launchSteps(egress, browser.label, at ?? 'proxy')
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="font-semibold text-text-primary">Starting {browser.label}…</div>
      <ul aria-label="Launch checks" className="flex flex-col gap-1.5">
        {lines.map(({ step, progress, text }) => {
          const { mark, className } = STEP_MARKS[progress]
          return (
            <li
              key={step}
              className={`flex gap-2 ${progress === 'pending' ? 'text-text-faint' : 'text-text-primary'}`}
            >
              <span aria-hidden="true" className={`w-3 ${className}`}>
                {mark}
              </span>
              <span>{text}</span>
            </li>
          )
        })}
      </ul>
      {cancelError && (
        <p role="alert" className="text-[11px] text-danger-fg">
          {cancelError}
        </p>
      )}
      <div>
        <Button
          variant="link"
          // The form this replaced held focus, so focus would otherwise fall out of the dialog.
          autoFocus
          className="px-0 text-text-muted underline"
          disabled={cancelling}
          onClick={onCancel}
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </Button>
      </div>
    </div>
  )
}
