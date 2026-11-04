import { lookup as dnsLookup } from 'dns/promises'
import { createConnection, isIP } from 'net'
import { localAddressKind } from '@shared/localAddress'
import { parseProxyUrl } from '@shared/schemas'
import type { EgressSetting, KnownEgress } from '@shared/types'
import { knownEgress } from '@main/services/egress'
import type { CdpEventMap, NetworkResponse } from '@main/services/launchedBrowser/commands'
import type {
  BrowserExit,
  FirstTab,
  LaunchedBrowser,
  LaunchHooks
} from '@main/services/launchedBrowser/launcher'

// The launched browser's Egress checks (spec, "Egress"). Mandatory policy and extensions outrank
// a command-line switch, so while the Egress is not Direct the engine checks the effect: the
// proxy accepts a connection before launch, the first tab gathers no WebRTC candidate before any
// other tab runs, and every recorded response came through the proxy. Messages name no page URL
// and no remote address.

export const EGRESS_CHECK_TIMEOUTS = {
  proxyConnectMs: 10_000,
  // The stage-2 probe's page waited this long for candidate gathering to end (P6).
  iceGatherMs: 3_000
}

export type ProxyEgress = Exclude<KnownEgress, { kind: 'direct' }>
export type ConnectToProxy = (host: string, port: number, signal: AbortSignal) => Promise<void>
export type LookupProxy = (host: string) => Promise<string[]>

export interface EgressCheckDeps {
  connect?: ConnectToProxy
  lookup?: LookupProxy
  timeouts?: Partial<typeof EGRESS_CHECK_TIMEOUTS>
}

export interface ProxyEndpoint {
  url: string
  host: string
  port: number
  // Every address the proxy's host had at launch, as canonicalAddress writes it. Chromium
  // resolves the host itself, so a proxy whose addresses change mid-session reads as a bypass.
  addresses: ReadonlySet<string>
}

export interface EgressGuard {
  // The Egress the checks ran against, for the launch to use: it is fixed for the browser's life.
  egress: KnownEgress
  proxy: ProxyEndpoint | null
  hooks: Pick<LaunchHooks, 'checkFirstTab' | 'onRecordedSession' | 'onTargetUnwatched'>
  // After the launch: the first response from outside the proxy, including one that arrived
  // before this call, closes `browser` and then reports.
  enforce: (
    browser: Pick<LaunchedBrowser, 'stop'>,
    onBypass: (error: Error, closing: Promise<BrowserExit>) => void
  ) => void
}

const WORLD_NAME = 'birdbrain-egress-check'

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One written form per IP address, so the proxy's addresses and a response's endpoint compare
 * equal however each was written. IPv6 comes back in brackets, as `URL` writes it, without a
 * zone. Null for anything that is not an IP address.
 */
export function canonicalAddress(address: string): string | null {
  const bare = address.replace(/^\[(.*)\]$/, '$1').replace(/%.*$/, '')
  switch (isIP(bare)) {
    case 4:
      return new URL(`http://${bare}/`).hostname
    case 6:
      return new URL(`http://[${bare}]/`).hostname
    default:
      return null
  }
}

/**
 * Whether a response's remote endpoint shows a request that went around the proxy. A response
 * with no endpoint passes (a service worker's own, P9), and so does one from loopback or
 * link-local, which Chromium's implicit bypass keeps on this machine or its link. Anything else
 * passes only as the proxy's address and port.
 */
export function bypassedProxy(response: NetworkResponse, proxy: ProxyEndpoint): boolean {
  const { remoteIPAddress, remotePort } = response
  if (!remoteIPAddress) return false
  const address = canonicalAddress(remoteIPAddress)
  if (address === null) return true
  const kind = localAddressKind(`http://${address}/`)
  if (kind === 'loopback' || kind === 'link-local') return false
  return !(proxy.addresses.has(address) && remotePort === proxy.port)
}

export const connectToProxy: ConnectToProxy = (host, port, signal) =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, signal })
    socket.once('connect', () => {
      socket.destroy()
      resolve()
    })
    socket.once('error', reject)
  })

const lookupProxy: LookupProxy = async (host) =>
  (await dnsLookup(host, { all: true })).map(({ address }) => address)

/**
 * Opens a TCP connection to the proxy and closes it unused, so nothing reaches a site. Refuses,
 * naming the proxy, when its host does not resolve or nothing accepts within the timeout.
 */
export async function checkProxyAccepts(
  egress: ProxyEgress,
  deps: EgressCheckDeps = {}
): Promise<ProxyEndpoint> {
  const { connect = connectToProxy, lookup = lookupProxy } = deps
  const { proxyConnectMs } = { ...EGRESS_CHECK_TIMEOUTS, ...deps.timeouts }
  const parsed = parseProxyUrl(egress.proxyUrl)
  if (!parsed.ok) {
    throw codedError(
      `The Egress proxy address is not usable: ${parsed.reason}`,
      'EGRESS_PROXY_INVALID'
    )
  }
  const { url } = parsed
  const { hostname, port: portText } = new URL(url)
  const host = hostname.replace(/^\[(.*)\]$/, '$1')
  // `URL` drops http's default port, which parseProxyUrl writes out.
  const port = portText === '' ? 80 : Number(portText)
  const notFound = (reason: string): Error =>
    codedError(
      `Birdbrain could not find the address of the Egress proxy ${url} (${reason}), ` +
        'so the browser was not started.',
      'EGRESS_PROXY_UNREACHABLE'
    )

  let found: string[]
  if (isIP(host)) {
    found = [host]
  } else {
    try {
      found = await lookup(host)
    } catch (error) {
      throw notFound(messageOf(error))
    }
  }
  const addresses = new Set(found.map(canonicalAddress).filter((a): a is string => a !== null))
  if (addresses.size === 0) throw notFound('no address found')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), proxyConnectMs)
  try {
    await connect(host, port, controller.signal)
  } catch (error) {
    const reason = controller.signal.aborted
      ? `no answer within ${Math.round(proxyConnectMs / 1000)} seconds`
      : messageOf(error)
    throw codedError(
      `The Egress proxy ${url} did not accept a connection (${reason}), ` +
        'so the browser was not started.',
      'EGRESS_PROXY_UNREACHABLE'
    )
  } finally {
    clearTimeout(timer)
  }
  return { url, host, port, addresses }
}

/**
 * Gathers ICE candidates with no ICE servers, as the probe's page did (P6), and returns only
 * their count: a candidate names the machine's addresses.
 */
export function webRtcCheckScript(gatherMs: number): string {
  return `(async () => {
  const pc = new RTCPeerConnection({ iceServers: [] })
  let count = 0
  try {
    pc.createDataChannel('birdbrain')
    const gathered = new Promise((resolve) => {
      pc.onicecandidate = (event) => {
        if (!event.candidate) resolve()
        else if (event.candidate.candidate) count++
      }
      setTimeout(resolve, ${gatherMs})
    })
    await pc.setLocalDescription(await pc.createOffer())
    await gathered
  } finally {
    pc.close()
  }
  return count
})()`
}

/**
 * The WebRTC check on the first tab's `about:blank`, from an isolated world, before any site
 * loads. Any candidate means the WebRTC policy is not in force, and a check that cannot run
 * fails closed; either way the launch is refused.
 */
export async function checkWebRtc(
  { targetId, session }: FirstTab,
  label: string,
  gatherMs: number = EGRESS_CHECK_TIMEOUTS.iceGatherMs
): Promise<void> {
  const unchecked = (reason: string): Error =>
    codedError(
      `Birdbrain could not check WebRTC in ${label} (${reason}), so it closed the browser.`,
      'EGRESS_WEBRTC_UNCHECKED'
    )
  let count: unknown
  try {
    const { executionContextId } = await session.send('Page.createIsolatedWorld', {
      frameId: targetId,
      worldName: WORLD_NAME
    })
    const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
      expression: webRtcCheckScript(gatherMs),
      contextId: executionContextId,
      awaitPromise: true,
      returnByValue: true
    })
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    count = result?.value
  } catch (error) {
    throw unchecked(messageOf(error))
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw unchecked('the check returned no count')
  }
  if (count > 0) {
    const found = `${count} WebRTC ${count === 1 ? 'candidate' : 'candidates'}`
    throw codedError(
      `${label} is not keeping WebRTC on the Egress proxy: a check on its first tab found ` +
        `${found} outside the proxy. Birdbrain closed the browser.`,
      'EGRESS_WEBRTC_CANDIDATE'
    )
  }
}

/**
 * Runs the checks that come before a launch and returns the hooks for the rest. Refuses an
 * Egress that could not be read. Under Direct nothing is checked.
 */
export async function prepareEgressChecks(
  egress: EgressSetting,
  label: string,
  deps: EgressCheckDeps = {}
): Promise<EgressGuard> {
  const known = knownEgress(egress)
  if (known.kind === 'direct') {
    return { egress: known, proxy: null, hooks: {}, enforce: () => {} }
  }
  const { iceGatherMs } = { ...EGRESS_CHECK_TIMEOUTS, ...deps.timeouts }
  const proxy = await checkProxyAccepts(known, deps)

  let reportBypass: (error: Error) => void = () => {}
  const bypassed = new Promise<never>((_, reject) => {
    reportBypass = reject
  })
  bypassed.catch(() => {})
  const onResponse = ({ response }: CdpEventMap['Network.responseReceived']): void => {
    if (!bypassedProxy(response, proxy)) return
    reportBypass(
      codedError(
        `A response in ${label} did not come through the Egress proxy, ` +
          'so Birdbrain closed the browser.',
        'EGRESS_BYPASS'
      )
    )
  }

  return {
    egress: known,
    proxy,
    hooks: {
      // A tab the Operator navigates during the check is recorded, so its bypass ends it too.
      checkFirstTab: (tab) => Promise.race([checkWebRtc(tab, label, iceGatherMs), bypassed]),
      onRecordedSession: (session) => {
        session.on('Network.responseReceived', onResponse)
      },
      // A tab that stays open with no response events cannot be checked, so it fails closed.
      onTargetUnwatched: (_target, error) => {
        reportBypass(
          codedError(
            `Birdbrain could not watch the responses of a tab in ${label} ` +
              `(${messageOf(error)}), so it closed the browser.`,
            'EGRESS_UNWATCHED'
          )
        )
      }
    },
    enforce: (browser, onBypass) => {
      bypassed.catch((error: Error) => onBypass(error, browser.stop()))
    }
  }
}
