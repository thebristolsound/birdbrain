import type { EgressSetting } from '@shared/types'
import { egressIndicatorText } from '@renderer/components/status/egressText'

// The top bar's one status control (docs/design-handoff/2026-11-08-top-bar/, Option B): three
// app-wide signals, read together. Nominal is neutral. Off nominal, the worst signal gives the
// control its colour, its icon and one short word; the others stay as faint dots. Ranking, from
// worst: an Egress that could not be read (nothing is sent, #1695), or whose settings read
// failed; capture failures; a Direct Egress with no VPN seen, or whose VPN check failed, which
// ADR-0032 keeps advisory. A disconnected extension is never a signal: it is the normal state
// for anyone using Launch browser, which needs none.

export type Severity = 'nominal' | 'warning' | 'danger'
export type SignalKey = 'extension' | 'egress' | 'health'

export interface Signal {
  key: SignalKey
  name: string
  /** The row's text in the popover and in the accessible summary. */
  text: string
  severity: Severity
}

export interface StatusInput {
  /** Undefined until the settings read returns one. */
  egress: EgressSetting | undefined
  /** The settings read failed: the Egress is unknown, which is not the same as still loading. */
  egressReadFailed: boolean
  /** Undefined while the Egress is not Direct, and until the VPN check answers. */
  vpnSeen: boolean | undefined
  /** The latest VPN check failed: whether a VPN is on the route is unknown, not still loading. */
  vpnReadFailed: boolean
  connectedToExtension: boolean
  successCount: number
  failCount: number
  sessionActive: boolean
  /** Background captures queued or running (recapture queue). */
  pending?: number
}

export interface StatusModel {
  signals: Signal[]
  /** The worst signal, or null while all is nominal. */
  worst: Signal | null
  severity: Severity
  /** The short word beside the dots, or null. */
  word: string | null
  /**
   * Captures stored since launch or since the capture log was cleared, not the Case's total.
   * Shown while a session runs so the Operator sees evidence landing.
   */
  count: number | null
  /** The background-capture line, or null while the queue is empty. */
  queued: string | null
  /** The whole state in one sentence, for the button's accessible name. */
  summary: string
}

const RANK: Record<Severity, number> = { nominal: 0, warning: 1, danger: 2 }

export function statusModel(input: StatusInput): StatusModel {
  const { egress, egressReadFailed, vpnSeen, connectedToExtension, successCount, failCount } = input

  const extension: Signal = {
    key: 'extension',
    name: 'Extension',
    text: connectedToExtension ? 'Connected' : 'Not connected',
    severity: 'nominal'
  }

  const egressUnknown = egress ? egress.kind === 'unavailable' : egressReadFailed
  // Only a Direct Egress asks whether a VPN is on the route. A failed check outranks whatever
  // was read before it, and a check still in flight is neither a warning nor a pass.
  const direct = egress?.kind === 'direct'
  const vpnUnknown = direct && input.vpnReadFailed
  const vpnPending = direct && !vpnUnknown && vpnSeen === undefined
  const egressSignal: Signal = {
    key: 'egress',
    name: 'Egress',
    text: egress
      ? vpnUnknown
        ? 'Direct · VPN check failed'
        : egressIndicatorText(egress, vpnSeen)
      : egressReadFailed
        ? 'Egress unknown'
        : 'Reading…',
    severity: egressUnknown
      ? 'danger'
      : vpnUnknown || (direct && vpnSeen === false)
        ? 'warning'
        : 'nominal'
  }

  const health: Signal = {
    key: 'health',
    name: 'Capture Health',
    text:
      failCount > 0
        ? `${successCount} captured · ${failCount} failed`
        : successCount > 0
          ? `${successCount} captured`
          : // The counters restart with the app and with Clear, so this is not "none yet".
            'No captures logged',
    severity: failCount > 0 ? 'danger' : 'nominal'
  }

  // Ranked worst first; ties keep the order Egress, health, extension.
  const ranked = [egressSignal, health, extension]
  const worst = ranked.reduce<Signal | null>(
    (acc, s) =>
      s.severity !== 'nominal' && (!acc || RANK[s.severity] > RANK[acc.severity]) ? s : acc,
    null
  )

  const word =
    worst?.key === 'egress'
      ? egressUnknown
        ? 'Egress unknown'
        : vpnUnknown
          ? 'VPN check failed'
          : 'VPN not seen'
      : worst?.key === 'health'
        ? `${failCount} failed`
        : null

  const count = input.sessionActive && successCount > 0 ? successCount : null

  const issues = ranked.filter((s) => s.severity !== 'nominal')
  // An Egress or a VPN check still being read is no issue yet, and no pass either.
  const lead =
    issues.length === 0
      ? !egress
        ? 'reading the Egress'
        : vpnPending
          ? 'checking for a VPN'
          : 'all nominal'
      : issues
          .map((s) => (s.severity === 'danger' ? 'a problem' : 'a warning'))
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(' and ')
  const pending = input.pending ?? 0
  const queued =
    pending > 0
      ? `${pending} background capture${pending === 1 ? '' : 's'} queued or running`
      : null
  const summary =
    `Status: ${lead}. Egress: ${egressSignal.text}. Extension: ${extension.text}. ${health.text}.` +
    (queued ? ` ${queued}.` : '')

  return {
    signals: [extension, egressSignal, health],
    worst,
    severity: worst?.severity ?? 'nominal',
    word,
    count,
    queued,
    summary
  }
}
