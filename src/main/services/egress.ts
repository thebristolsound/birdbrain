import { session as electronSession, type ProxyConfig, type Session } from 'electron'
import { getSettings } from '@main/services/settings'
import type { EgressKind, EgressSetting, KnownEgress } from '@shared/types'

// The Egress (ADR-0032). Background renders and the Wayback replay pane get the
// proxy on their own sessions, update checks get it on electron-updater's session,
// and the main-process requests (TSA, Wayback lookup, consent filter lists) go
// through `egressFetch`. Each fails closed: with the proxy down, or the setting
// unreadable, nothing goes out. Shared Case sync is the one exception (rule 1) and
// does not read it.

export function currentEgress(): EgressSetting {
  return getSettings().egress
}

/** Thrown when the saved Egress could not be read, so nothing may be sent. */
export class EgressUnavailableError extends Error {
  constructor() {
    super(
      'The Egress setting could not be read, so nothing is sent until one is chosen in Settings'
    )
    this.name = 'EgressUnavailableError'
  }
}

/** The Egress to route by, or EgressUnavailableError when it is not known. */
export function knownEgress(egress: EgressSetting = currentEgress()): KnownEgress {
  if (egress.kind === 'unavailable') throw new EgressUnavailableError()
  return egress
}

/**
 * What a signed capture entry records about the Egress a page was sent through:
 * the kind and the Operator's label (rule 5). Never the proxy's host or port,
 * which could expose the Operator's own infrastructure in an export. Undefined for
 * Direct, which records nothing.
 */
export interface CaptureEgress {
  kind: EgressKind
  label?: string
}

export function captureEgressOf(egress: KnownEgress): CaptureEgress | undefined {
  if (egress.kind === 'direct') return undefined
  return egress.label ? { kind: egress.kind, label: egress.label } : { kind: egress.kind }
}

/**
 * Chromium's proxy configuration for an Egress. The rules name the proxy alone,
 * with no `direct://` fallback, so an unreachable proxy fails the request instead
 * of exposing the Operator (rule 2). `<-loopback>` removes Chromium's implicit
 * bypass for localhost and loopback addresses, so those go through the proxy too.
 */
export function proxyConfigFor(egress: KnownEgress): ProxyConfig {
  if (egress.kind === 'direct') return { mode: 'direct' }
  return { mode: 'fixed_servers', proxyRules: egress.proxyUrl, proxyBypassRules: '<-loopback>' }
}

/**
 * The WebRTC policy for a page under an Egress (rule 2): UDP only through the
 * proxy unless the Egress is Direct.
 */
export function webRtcPolicyFor(egress: EgressSetting): 'default' | 'disable_non_proxied_udp' {
  return egress.kind === 'direct' ? 'default' : 'disable_non_proxied_udp'
}

export async function applyEgressToSession(ses: Session, egress: KnownEgress): Promise<void> {
  await ses.setProxy(proxyConfigFor(egress))
}

/**
 * A long-lived session that follows the Egress, such as the Wayback replay pane's.
 * Requests are refused while the session does not yet carry the current Egress: from
 * a change of setting until its proxy is applied, while the setting is unreadable,
 * and after the session refused a proxy. A refused request re-reads the setting, so
 * the session recovers once the file reads again; a proxy the session refused is not
 * retried until the setting names another. A session the Egress has been Direct on
 * since it was created is left as it was.
 */
export interface RoutedSession {
  sync: (egress?: EgressSetting) => void
  allowsRequests: () => boolean
}

export function createRoutedSession(
  ses: Session,
  onApplyFailed: (err: unknown) => void,
  readEgress: () => EgressSetting = currentEgress
): RoutedSession {
  let applied: string | null = null
  let applying: string | null = null
  let refused: string | null = null
  let touched = false

  const keyOf = (egress: EgressSetting): string =>
    egress.kind === 'direct' ? 'direct' : egress.kind === 'unavailable' ? '' : egress.proxyUrl

  function sync(egress: EgressSetting = readEgress()): void {
    if (egress.kind === 'unavailable') {
      applied = null
      return
    }
    if (egress.kind === 'direct' && !touched) {
      applied = 'direct'
      return
    }
    const key = keyOf(egress)
    if (applying === key) return
    touched = true
    applied = null
    applying = key
    applyEgressToSession(ses, egress).then(
      () => {
        if (applying === key) {
          applied = key
          applying = null
        }
      },
      (err: unknown) => {
        if (applying === key) applying = null
        refused = key
        onApplyFailed(err)
      }
    )
  }

  function allowsRequests(): boolean {
    if (applied !== null) return true
    if (applying === null) {
      const egress = readEgress()
      if (keyOf(egress) !== refused) sync(egress)
    }
    return applied !== null
  }

  sync()
  return { sync, allowsRequests }
}

// The session main-process requests use while the Egress is not Direct. In memory
// and uncached, like the render partitions. `routedProxy` is the proxy last applied
// to it, so a change of setting re-applies before the next request.
const ROUTED_PARTITION = 'egress-requests'
let routedProxy: string | null = null

/**
 * `fetch` for main-process requests. While the Egress is Direct it is the global
 * fetch, unchanged. Otherwise the request goes through Chromium's network stack on
 * a session carrying the proxy, so it fails when the proxy is unreachable; with the
 * setting unreadable it fails before anything is sent.
 */
export const egressFetch: typeof fetch = async (input, init) => {
  const egress = knownEgress()
  if (egress.kind === 'direct') return fetch(input, init)
  const routed = electronSession.fromPartition(ROUTED_PARTITION, { cache: false })
  if (routedProxy !== egress.proxyUrl) {
    await applyEgressToSession(routed, egress)
    routedProxy = egress.proxyUrl
  }
  return routed.fetch(input instanceof URL ? input.href : input, init)
}
