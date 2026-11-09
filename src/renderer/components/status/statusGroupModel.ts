import type { EgressSetting } from '@shared/types'
import { egressIndicatorText } from '@renderer/components/status/egressText'

// The top bar's one status control (docs/design-handoff/2026-11-08-top-bar/, Option B): three
// app-wide signals, read together. Nominal is neutral. Off nominal, the worst signal gives the
// control its colour, its icon and one short word; the others stay as faint dots. Ranking, from
// worst: an Egress that could not be read (nothing is sent, #1695); capture failures; a Direct
// Egress with no VPN seen, which ADR-0032 keeps advisory. A disconnected extension is never a
// signal: it is the normal state for anyone using Launch browser, which needs none.

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
  egress: EgressSetting | undefined
  vpnSeen: boolean | undefined
  connectedToExtension: boolean
  tabCount?: number
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
  /** The stored count, shown while a session runs so the Operator sees evidence landing. */
  count: number | null
  /** The background-capture line, or null while the queue is empty. */
  queued: string | null
  /** The whole state in one sentence, for the button's accessible name. */
  summary: string
}

const RANK: Record<Severity, number> = { nominal: 0, warning: 1, danger: 2 }

export function statusModel(input: StatusInput): StatusModel {
  const { egress, vpnSeen, connectedToExtension, tabCount, successCount, failCount } = input

  const extension: Signal = {
    key: 'extension',
    name: 'Extension',
    text: connectedToExtension
      ? tabCount !== undefined
        ? `Connected · ${tabCount} ${tabCount === 1 ? 'tab' : 'tabs'}`
        : 'Connected'
      : 'Not connected',
    severity: 'nominal'
  }

  const egressText = egress ? egressIndicatorText(egress, vpnSeen) : 'Reading…'
  const egressSignal: Signal = {
    key: 'egress',
    name: 'Egress',
    text: egressText,
    severity: egress?.kind === 'unavailable' ? 'danger' : vpnSeen === false ? 'warning' : 'nominal'
  }

  const health: Signal = {
    key: 'health',
    name: 'Capture Health',
    text:
      failCount > 0
        ? `${successCount} captured · ${failCount} failed`
        : successCount > 0
          ? `${successCount} captured`
          : 'Nothing captured yet',
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
      ? egress?.kind === 'unavailable'
        ? 'Egress unknown'
        : 'VPN not seen'
      : worst?.key === 'health'
        ? `${failCount} failed`
        : null

  const count = input.sessionActive && successCount > 0 ? successCount : null

  const issues = ranked.filter((s) => s.severity !== 'nominal')
  const lead =
    issues.length === 0
      ? 'all nominal'
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
