import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { KnownEgress, LaunchedBrowserOption } from '@shared/types'
import { refusalCode, type VpnWarningCheck } from '@shared/ipc'
import { Button, Dialog, DialogContent, DialogTitle, Input } from '@renderer/components/ui'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import { useSessionMutations } from '@renderer/lib/api/session'
import { settingsQueryOptions, useSettingsMutations } from '@renderer/lib/api/settings'
import { vpnStatusQueryOptions } from '@renderer/lib/api/egress'
import { birdbrain } from '@renderer/lib/birdbrain'
import { VPN_SESSION_CAVEAT } from '@renderer/components/status/VpnWarningDialog'
import {
  cancelBrowserLaunch,
  launchBrowser,
  launchedBrowserStatusQueryOptions,
  launchedBrowsersQueryOptions
} from '@renderer/lib/api/launchedBrowser'
import { useAppStore } from '@renderer/stores/appStore'
import { cn } from '@renderer/lib/utils'
import { InfoTip } from '@renderer/components/launchedBrowser/InfoTip'
import {
  NO_BROWSER_REFUSAL,
  CASES_UNREAD_REFUSAL,
  NO_CASE_REFUSAL,
  UNREADABLE_EGRESS_REFUSAL,
  busyRefusal,
  egressKindName,
  launchSteps,
  refusalFor,
  unavailableRefusal,
  type LaunchRefusal,
  type StepProgress
} from '@renderer/components/launchedBrowser/startDialogModel'

const TITLE_TIP =
  'The browser runs on a browser profile of its own. Pages in this browser can tell that ' +
  'software drives it.'

// A session warning main says is due for a Case (ADR-0032 VPN rule 3), with the Operator's
// choice to stop warning on this network. A new answer from main starts with the choice unmade.
interface SessionWarning {
  caseId: string
  canMute: boolean
  mute: boolean
}

function sessionWarning(caseId: string, { warn, canMute }: VpnWarningCheck): SessionWarning | null {
  return warn ? { caseId, canMute, mute: false } : null
}

const STEP_MARKS: Readonly<Record<StepProgress, { mark: string; className: string }>> = {
  done: { mark: '✓', className: 'text-success-fg' },
  current: { mark: '◌', className: 'text-accent' },
  pending: { mark: '·', className: 'text-text-faint' }
}

// The start dialog (S2: `1b` to `1e`), mounted once at the root and opened for a Case from the
// top bar or the command palette. It launches into the Case it was opened for, which it
// activates first, as the capture menu's session start does. Opened where no Case is on screen,
// it asks which Case, preset to the last one opened. The Persona picker is the Persona step's
// (#1833).
export function StartDialog() {
  const namedCaseId = useAppStore((s) => s.startDialogCaseId)
  const picking = useAppStore((s) => s.startDialogPicking)
  const close = useAppStore((s) => s.closeStartDialog)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const setPanelHidden = useAppStore((s) => s.setCaptureSessionPanelHidden)
  const navigate = useNavigate()
  const open = namedCaseId !== null || picking

  const {
    data: readCases,
    isError: casesFailed,
    refetch: readCasesAgain
  } = useQuery(casesQueryOptions)
  const cases = readCases ?? []
  // The dialog stays mounted while closed, so a failed read of the Cases would stand for good.
  // Opening on the picker reads them again, which is what its refusal tells the Operator to do.
  // Once per opening: a read that fails again passes through loading and back to failed, and
  // reading again each time it fails would never stop.
  const readAgainThisOpening = useRef(false)
  useEffect(() => {
    if (!open || !picking) {
      readAgainThisOpening.current = false
      return
    }
    if (!casesFailed || readAgainThisOpening.current) return
    readAgainThisOpening.current = true
    void readCasesAgain()
  }, [open, picking, casesFailed, readCasesAgain])
  const { data: settings } = useQuery(settingsQueryOptions)
  const [pickedCaseId, setPickedCaseId] = useState('')
  // The Case to launch into: the one the dialog was opened for, else the Operator's pick, else
  // the last Case opened, else the first Case there is.
  const pickable = cases.filter((c) => !c.archived)
  const pickedCase =
    pickable.find(({ id }) => id === pickedCaseId) ??
    pickable.find(({ id }) => id === settings?.lastActiveCaseId) ??
    pickable[0]
  const caseId = namedCaseId ?? (picking ? (pickedCase?.id ?? null) : null)
  const { data: status } = useQuery(launchedBrowserStatusQueryOptions)
  const { data: browsers } = useQuery({ ...launchedBrowsersQueryOptions, enabled: open })
  const { activateCase } = useSessionMutations()
  const { update } = useSettingsMutations()

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
  const [typedName, setTypedName] = useState('')
  const [nameError, setNameError] = useState('')
  const [warning, setWarning] = useState<SessionWarning | null>(null)
  // Counts the questions put to main, so an answer that arrives after a later question is dropped.
  const lastAsk = useRef(0)

  // Every way out of the dialog comes here, so the next opening starts clean.
  function dismiss() {
    setLaunching(null)
    setRefusal(null)
    setCancelling(false)
    setCancelError('')
    setPickedCaseId('')
    setTypedName('')
    setNameError('')
    setWarning(null)
    lastAsk.current += 1
    cancelled.current = false
    close()
  }

  const caseName = cases.find(({ id }) => id === caseId)?.name ?? ''
  const browser =
    browsers?.find(({ executablePath }) => executablePath === selectedPath) ?? browsers?.[0]
  const egress = settings?.egress
  const knownEgress: KnownEgress | null = egress && egress.kind !== 'unavailable' ? egress : null
  const operatorName = settings?.operatorName?.trim() ?? ''
  // No operator name is saved, so the dialog asks for one and saves it on Launch.
  const askName = settings !== undefined && operatorName === ''
  // The no-VPN line (`1b`), under a Direct Egress only: the indicator's words with the session
  // warning's caveat, since Birdbrain sees this computer's route and not the browser's.
  const direct = knownEgress?.kind === 'direct'
  const { data: vpn } = useQuery({ ...vpnStatusQueryOptions, enabled: open && direct })
  const noVpnSeen = direct && vpn?.vpnSeen === false

  // Main is asked when the dialog opens for a Case, so the form says a warning is due before
  // Launch is pressed. A check that fails here shows no warning; Launch asks again.
  useEffect(() => {
    if (!open || caseId === null) return
    lastAsk.current += 1
    const ask = lastAsk.current
    birdbrain.egress.checkVpnWarning({ caseId }, 'session').then(
      (check) => {
        if (ask === lastAsk.current) setWarning(sessionWarning(caseId, check))
      },
      () => undefined
    )
  }, [open, caseId])
  const dueWarning = warning?.caseId === caseId ? warning : null

  // A refusal known before the launch starts. A missing operator name is asked for in its row.
  const blocked =
    unavailableRefusal(status) ??
    busyRefusal(status) ??
    // No Case to pick is said only of a list that was read: a failed read has its own words,
    // and one still in flight holds Launch without a reason, since `caseId` is null.
    (picking && casesFailed && !readCases ? CASES_UNREAD_REFUSAL : null) ??
    (picking && readCases && pickable.length === 0 ? NO_CASE_REFUSAL : null) ??
    (browsers?.length === 0 ? NO_BROWSER_REFUSAL : null) ??
    (egress?.kind === 'unavailable' ? UNREADABLE_EGRESS_REFUSAL : null)
  const shownRefusal = launching ? null : (blocked ?? refusal)
  const canLaunch =
    !launching &&
    !blocked &&
    caseId !== null &&
    browser !== undefined &&
    knownEgress !== null &&
    (askName ? typedName.trim() !== '' : operatorName !== '')

  // One browser found has no select to take the focus. The name field takes it while the
  // dialog asks for a name, and otherwise Launch does once it can be pressed.
  const loneBrowser = browsers?.length === 1
  const nameField = useRef<HTMLInputElement>(null)
  const launchButton = useRef<HTMLButtonElement>(null)
  const unclaimedFocus = open && !picking && !launching && loneBrowser
  const focusName = unclaimedFocus && askName
  const focusLaunch = unclaimedFocus && !askName && canLaunch
  useEffect(() => {
    if (focusName) nameField.current?.focus()
  }, [focusName])
  useEffect(() => {
    if (focusLaunch) launchButton.current?.focus()
  }, [focusLaunch])

  // Saved as typed, as the Operator tab saves it: the name is trimmed only to test for a blank.
  async function nameSaved(): Promise<boolean> {
    if (!askName) return true
    try {
      await update.mutateAsync({ operatorName: typedName })
      return true
    } catch {
      setNameError('The name could not be saved.')
      return false
    }
  }

  // Asked again on the press: the network can change while the dialog is open.
  async function askVpnWarningAgain(forCase: string): Promise<VpnWarningCheck> {
    lastAsk.current += 1
    const check = await birdbrain.egress.checkVpnWarning({ caseId: forCase }, 'session')
    setWarning(sessionWarning(forCase, check))
    return check
  }

  const cameDue = ({ warn }: VpnWarningCheck) => warn && dueWarning === null

  // Tells main the Operator went ahead, which is what marks the Case warned and mutes a network.
  async function answerVpnWarning(forCase: string, canMute: boolean): Promise<void> {
    const choice = dueWarning?.mute && canMute ? 'mute-network' : 'continue'
    await birdbrain.egress.answerVpnWarning({ caseId: forCase, occasion: 'session', choice })
    setWarning(null)
  }

  // Back to the form with nothing launched. A cancel pressed meanwhile still closes the dialog.
  function holdLaunch() {
    if (cancelled.current) dismiss()
    else setLaunching(null)
  }

  async function launch() {
    if (!caseId || !browser || !knownEgress) return
    cancelled.current = false
    setRefusal(null)
    setLaunching({ browser, egress: knownEgress })
    try {
      // A launch starts or joins a Capture Session, so it passes the VPN warning first
      // (ADR-0032 VPN rule 3). A warning the pressed form did not show holds the launch: the
      // form shows it now, and the Operator presses the button that names it.
      const check = await askVpnWarningAgain(caseId)
      if (cameDue(check)) {
        holdLaunch()
        return
      }
      if (!(await nameSaved())) {
        holdLaunch()
        return
      }
      if (check.warn) await answerVpnWarning(caseId, check.canMute)
      await activateCase.mutateAsync(caseId)
      // A cancel while the Case was activating reached main before any launch it could stop.
      if (cancelled.current) {
        dismiss()
        return
      }
      await launchBrowser(browser.executablePath)
      dismiss()
    } catch (error) {
      if (
        cancelled.current &&
        refusalCode(error, 'launchedBrowser:launch') === 'BROWSER_LAUNCH_CANCELLED'
      ) {
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

  // Opens the Egress setting, as the VPN warning's own "Set up a proxy" does. Nothing is launched
  // and main is told nothing, so the warning is still due.
  function setUpProxy() {
    dismiss()
    void navigate({ to: '/settings', search: { section: 'egress' } })
  }

  // State 4's Show panel: the panel sits on the Case screens of the browser's Case.
  const browserCaseId = status && status.state !== 'none' ? status.browser.caseId : null
  function showPanel() {
    if (!browserCaseId) return
    dismiss()
    // The top bar's mark can have hidden the panel, and this button says it shows it.
    setPanelHidden(false)
    void navigate({ to: '/cases/$caseId/captures', params: { caseId: browserCaseId } })
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
            <DialogTitle>
              {picking ? 'Launch a browser' : `Launch a browser for ${caseName}`}
            </DialogTitle>
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
                {picking && (
                  <>
                    <dt className="pt-1.5 text-text-muted">
                      <label htmlFor="launch-case-select">Case</label>
                    </dt>
                    <dd>
                      {pickedCase ? (
                        <select
                          id="launch-case-select"
                          autoFocus
                          value={pickedCase.id}
                          onChange={(e) => setPickedCaseId(e.target.value)}
                          className="h-7 w-full rounded border border-border-strong bg-surface px-2 text-xs text-text-primary"
                        >
                          {pickable.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        // "None yet" is said only of a list that was read and holds no Case.
                        <span className="block pt-1.5 text-text-faint">
                          {readCases ? 'None yet' : casesFailed ? 'Not read' : 'Reading…'}
                        </span>
                      )}
                    </dd>
                  </>
                )}
                <dt className={cn('text-text-muted', !loneBrowser && 'pt-1.5')}>
                  {loneBrowser ? 'Browser' : <label htmlFor="launch-browser-select">Browser</label>}
                </dt>
                <dd>
                  {browsers && browser ? (
                    <>
                      {loneBrowser ? (
                        <span data-testid="launch-browser-only" className="text-text-primary">
                          {optionText(browser)}
                        </span>
                      ) : (
                        <select
                          id="launch-browser-select"
                          autoFocus={!picking}
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
                      )}
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
                  {(noVpnSeen || dueWarning) && (
                    <p className="mt-0.5 text-[11px]">
                      <span data-testid="launch-no-vpn" className="text-warning-fg">
                        VPN not seen. {VPN_SESSION_CAVEAT}
                      </span>
                      {dueWarning && (
                        <>
                          {' '}
                          <Button
                            variant="link"
                            className="h-auto px-0 text-[11px] underline"
                            onClick={setUpProxy}
                          >
                            Set up a proxy
                          </Button>
                        </>
                      )}
                    </p>
                  )}
                  {dueWarning?.canMute && (
                    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={dueWarning.mute}
                        onChange={(e) => setWarning({ ...dueWarning, mute: e.target.checked })}
                      />
                      Do not warn on this network
                    </label>
                  )}
                </dd>
                <dt className={cn('text-text-muted', askName && 'pt-1.5')}>
                  {askName ? (
                    <label htmlFor="launch-operator-name">Operator Name</label>
                  ) : (
                    'Operator'
                  )}
                </dt>
                <dd>
                  {askName ? (
                    <>
                      <Input
                        ref={nameField}
                        id="launch-operator-name"
                        type="text"
                        value={typedName}
                        onChange={(e) => {
                          setTypedName(e.target.value)
                          setNameError('')
                        }}
                        placeholder="e.g. Alex Smith"
                        aria-invalid={nameError ? true : undefined}
                        aria-describedby="launch-operator-name-note"
                        className="h-7 bg-surface"
                      />
                      {nameError ? (
                        <p
                          id="launch-operator-name-note"
                          role="alert"
                          className="mt-0.5 text-[11px] text-danger-fg"
                        >
                          {nameError}
                        </p>
                      ) : (
                        <p
                          id="launch-operator-name-note"
                          className="mt-0.5 text-[11px] text-text-muted"
                        >
                          Every Capture carries an operator name.
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="text-text-primary">{operatorName}</span>
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
                <span className="min-w-0 flex-1 text-[11px] text-text-muted">
                  {caseId !== null &&
                    (sessionActive
                      ? `Joins the running Capture Session in ${caseName}.`
                      : `Starts a Capture Session in ${caseName}.`)}
                </span>
                <Button variant="outline" className="shrink-0 whitespace-nowrap" onClick={dismiss}>
                  Cancel
                </Button>
                <Button
                  ref={launchButton}
                  className="shrink-0 whitespace-nowrap font-semibold text-accent-foreground"
                  disabled={!canLaunch}
                  onClick={() => void launch()}
                >
                  {dueWarning ? 'Launch without VPN' : sessionActive ? 'Launch and join' : 'Launch'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}

// The version shows under the choice, with what it is from. A chosen executable names its path,
// which tells it from a found browser of the same product.
function optionText({ label, chosen, executablePath }: LaunchedBrowserOption): string {
  return chosen ? `${label} · ${executablePath}` : label
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

// A refusal in the danger triple's left rule, as `1j` draws states 1 to 3. State 4 refuses
// nothing that went wrong, so it is drawn without the rule. The canvas's state numbers label its
// catalogue and are not shown.
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
      className={cn(
        'mt-3 flex items-center gap-2 rounded border border-border bg-card px-2.5 py-[7px]',
        state !== 4 && 'border-l-[3px] border-l-danger-fg'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-text-primary">{title}</div>
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
  at: Parameters<typeof launchSteps>[1] | undefined
  cancelling: boolean
  cancelError: string
  onCancel: () => void
}) {
  const lines = launchSteps(egress, at ?? 'proxy')
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="font-semibold text-text-primary">Launching {browser.label}…</div>
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
