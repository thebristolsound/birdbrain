import type { WaybackLinkBatchResult } from '@shared/ipc'
import type { EgressSetting, KnownEgress } from '@shared/types'

// The wording of a Wayback batch over the Links tab (#1738, plan S3 and S4).

function addresses(n: number): string {
  return n === 1 ? '1 address' : `${n} addresses`
}

function rows(n: number): string {
  return n === 1 ? '1 row' : `${n} rows`
}

/**
 * Where the requests leave from, for an Egress the batch can use, else null: an
 * unreadable setting sends nothing (ADR-0032). A proxy is named by its kind and the
 * Operator's label, never its address.
 */
export function egressRouteSentence(egress: EgressSetting | undefined): string | null {
  if (!egress || egress.kind === 'unavailable') return null
  if (egress.kind === 'direct') {
    return "The requests leave over this computer's own connection, because the Egress is set to Direct."
  }
  const name = egress.kind === 'tor' ? 'Tor' : 'the proxy'
  const label = egress.label ? ` ("${egress.label}")` : ''
  return `The requests leave through ${name} set as the Egress${label}.`
}

export function isKnownEgress(egress: EgressSetting | undefined): egress is KnownEgress {
  return egress !== undefined && egress.kind !== 'unavailable'
}

export function refusedRowsSentence(refusedRows: number): string {
  return `${rows(refusedRows)} not sent. The address rule refuses these addresses:`
}

export function overCapSentence(cap: number, overCap: number): string {
  const rest = overCap === 1 ? '1 more address is' : `${overCap} more addresses are`
  return `Only the first ${addresses(cap)} are checked. ${rest} not checked.`
}

/** What a finished batch reports, or a running one's progress. */
export function batchStatusSentence(
  { running, done, total }: { running: boolean; done: number; total: number },
  outcome: WaybackLinkBatchResult | null
): string | null {
  if (running) return `Checking in Wayback: ${done} of ${total} done.`
  if (!outcome) return null
  const { answered, failed, notChecked, stopped, status } = outcome
  const checked = `${addresses(answered)} answered${failed ? `, ${failed} failed` : ''}`
  const rest = notChecked ? ` ${addresses(notChecked)} not checked.` : ''
  if (stopped === 'rate-limited') {
    return `archive.org answered HTTP ${status ?? '429 or 503'}, so the batch stopped. ${checked}.${rest}`
  }
  if (stopped === 'cancelled') return `Batch cancelled. ${checked}.${rest}`
  if (stopped === 'route-changed') {
    return `The Egress setting changed, so the batch stopped. ${checked}.${rest}`
  }
  return `Batch finished. ${checked}.`
}
