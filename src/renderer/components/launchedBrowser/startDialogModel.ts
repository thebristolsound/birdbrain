import type { KnownEgress, LaunchedBrowserStatus, LaunchedBrowserStep } from '@shared/types'

// What the start dialog (S2) says about a launch: the refusals drawn as states 1 to 4 (`1j`),
// and the checklist while the browser starts (`1e`). Where main's message names what a browser
// reported or which proxy failed, the card keeps it.

export interface LaunchRefusal {
  // The canvas's state number, for the four refusals it draws.
  state?: 1 | 2 | 3 | 4
  title: string
  detail: string
}

const EGRESS_KINDS: Readonly<Record<KnownEgress['kind'], string>> = {
  direct: 'Direct',
  proxy: 'Proxy',
  tor: 'Tor'
}

export function egressKindName({ kind }: KnownEgress): string {
  return EGRESS_KINDS[kind]
}

// "Proxy · Harbor relay", or "Direct".
export function egressName(egress: KnownEgress): string {
  const kind = egressKindName(egress)
  return egress.kind === 'direct' ? kind : `${kind} · ${egress.label}`
}

export const NO_BROWSER_REFUSAL: LaunchRefusal = {
  state: 1,
  title: 'No supported browser found',
  detail: 'Choose one in Settings → Capture.'
}

const ONE_AT_A_TIME = 'Only one can be open at a time.'

const BUSY_TITLES: Readonly<Record<'starting' | 'open' | 'closing', string>> = {
  starting: 'A launched browser is starting',
  open: 'A launched browser is already open',
  closing: 'A launched browser is closing'
}

// State 4 before a launch. A browser that has closed leaves its Capture Session running, and a
// launch joins it.
export function busyRefusal(status: LaunchedBrowserStatus | undefined): LaunchRefusal | null {
  if (!status || status.state === 'none' || status.state === 'closed') return null
  return { state: 4, title: BUSY_TITLES[status.state], detail: ONE_AT_A_TIME }
}

// Before a launch, on a platform where main offers none. Main's message says why.
export function unavailableRefusal(
  status: LaunchedBrowserStatus | undefined
): LaunchRefusal | null {
  if (status?.state !== 'none' || !status.launchUnavailable) return null
  return { title: 'Launch not available', detail: status.launchUnavailable }
}

export const UNREADABLE_EGRESS_REFUSAL: LaunchRefusal = {
  title: 'Birdbrain could not read the Egress setting',
  detail: 'The browser was not started. Choose an Egress in Settings → Network.'
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

function messageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(error)
}

// A launch that main refused or that failed, as a card.
export function refusalFor(error: unknown, label: string, egress: KnownEgress): LaunchRefusal {
  const message = messageOf(error)
  switch (codeOf(error)) {
    case 'BROWSER_NOT_FOUND':
      return { ...NO_BROWSER_REFUSAL, detail: message }
    case 'BROWSER_UNRECOGNIZED':
    case 'BROWSER_BELOW_FLOOR':
      return { state: 1, title: `Birdbrain closed ${label}`, detail: message }
    case 'BROWSER_NO_CONNECTION':
      return {
        state: 2,
        title: `${label} didn't respond`,
        detail: `${message} A setting on this computer may be blocking it.`
      }
    case 'EGRESS_PROXY_UNREACHABLE':
    case 'EGRESS_PROXY_INVALID':
      return {
        state: 3,
        title: `Can't reach ${egressName(egress)}`,
        detail: `${message} Check the proxy in Settings → Network.`
      }
    case 'BROWSER_ALREADY_RUNNING':
      return { state: 4, title: BUSY_TITLES.open, detail: ONE_AT_A_TIME }
    case 'EGRESS_WEBRTC_CANDIDATE':
    case 'EGRESS_WEBRTC_UNCHECKED':
    case 'EGRESS_BYPASS':
    case 'EGRESS_UNWATCHED':
      return { title: 'Browser closed by a connection check', detail: message }
    case 'EGRESS_UNAVAILABLE':
      return UNREADABLE_EGRESS_REFUSAL
    default:
      return { title: 'The launch failed', detail: message }
  }
}

export type StepProgress = 'done' | 'current' | 'pending'

export interface LaunchStepLine {
  step: LaunchedBrowserStep
  progress: StepProgress
  text: string
}

const ROUTED_STEPS: readonly LaunchedBrowserStep[] = ['proxy', 'browser', 'first-tab']
const DIRECT_STEPS: readonly LaunchedBrowserStep[] = ['browser']

function stepText(step: LaunchedBrowserStep, progress: StepProgress, egress: string): string {
  const texts: Record<LaunchedBrowserStep, Record<StepProgress, string>> = {
    proxy: {
      pending: `Reach ${egress}`,
      current: `Reaching ${egress}`,
      done: `${egress} is reachable`
    },
    browser: {
      pending: 'Start the browser',
      current: 'Starting the browser',
      done: 'Browser started'
    },
    'first-tab': {
      pending: 'Check the connection on the first tab',
      current: 'Checking the connection on the first tab',
      done: 'First tab checked'
    }
  }
  return texts[step][progress]
}

// The checklist: the proxy and the first tab are checked only while the Egress is not Direct.
export function launchSteps(
  egress: KnownEgress,
  at: LaunchedBrowserStep | 'open'
): LaunchStepLine[] {
  const steps = egress.kind === 'direct' ? DIRECT_STEPS : ROUTED_STEPS
  const reached = at === 'open' ? steps.length : Math.max(steps.indexOf(at), 0)
  return steps.map((step, index) => {
    const progress: StepProgress =
      index < reached ? 'done' : index === reached ? 'current' : 'pending'
    return { step, progress, text: stepText(step, progress, egressName(egress)) }
  })
}
