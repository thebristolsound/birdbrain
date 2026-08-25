// The whole decision surface for <webview> guests, extracted from index.ts so it is
// unit-testable without an Electron window — the same reason resolveWindowSize and
// revealWhenReady were extracted.
//
// Two guests can be live at once on the Captures screen (#401): the MHTML evidence
// viewer and the Wayback replay pane in the side-by-side compare. They need opposite
// policies — one loads a local file with JavaScript off, the other loads remote
// archive.org content with JavaScript on — so every decision below is taken *per
// partition*. The partition is the discriminator, and a wrong one would silently
// loosen the evidence viewer, which is why this module refuses anything it does not
// recognise rather than falling through to a default.

// The partition names and the replay prefix live in @shared/constants so the
// renderer's <webview> attributes and this policy read the same strings. Replay
// pages redirect to the nearest snapshot and their own toolbar navigates, so
// subsequent navigation is permitted for Wayback — but only inside that prefix.
import { MHTML_PARTITION, WAYBACK_PARTITION, WAYBACK_REPLAY_PREFIX } from '@shared/constants'

export { MHTML_PARTITION, WAYBACK_PARTITION, WAYBACK_REPLAY_PREFIX }

export interface WebviewPartitionPolicy {
  partition: string
  /**
   * URL prefixes a guest on this partition may load or navigate to. A `file://`
   * entry names the *local* file scheme only: the remote-authority form is refused
   * by `matchesPrefix` before the list is consulted (#904).
   */
  allowedPrefixes: readonly string[]
  /**
   * Whether the guest may navigate after its first load. False keeps the evidence
   * viewer on exactly the file it was handed.
   */
  allowSubsequentNavigation: boolean
  /** Whether Chromium runs scripts in the guest. */
  javascript: boolean
  /**
   * Permissions this partition may be granted. Empty for both guests, and the
   * list exists so a future grant has to be written down here rather than
   * arrived at by a handler forgetting to deny.
   */
  allowedPermissions: readonly string[]
  /**
   * Hosts a guest on this partition may address, subresources included — an
   * `<img>`, a stylesheet, a font, a beacon, a `fetch` from script. Matched as an
   * exact hostname on an `https` URL: never a suffix, so `web.archive.org.evil.test`
   * is a different host, and never a licence for the scheme, so plaintext `http`
   * and WebSocket requests are outside it whatever the name. Empty means the guest
   * reaches no network at all.
   */
  allowedRequestHosts: readonly string[]
}

const MHTML_POLICY: WebviewPartitionPolicy = {
  partition: MHTML_PARTITION,
  allowedPrefixes: ['file://'],
  allowSubsequentNavigation: false,
  javascript: false,
  allowedPermissions: [],
  // Empty, and that is the whole point (#810): rendering stored evidence must not
  // reach the network. An MHTML carries its subresources inline, so a request that
  // leaves the machine is a resource the archive did not contain — and fetching it
  // would both show the reader something that is not in the artefact and tell its
  // origin that the operator is looking at this page, now.
  allowedRequestHosts: []
}

const WAYBACK_POLICY: WebviewPartitionPolicy = {
  partition: WAYBACK_PARTITION,
  // JavaScript is on (maintainer ruling R3 on #401): archive.org replays render
  // through their own scripts, and a JS-off pane would misrepresent the archived
  // page rather than reproduce it. Every other item on the hardening list is
  // mandatory precisely because this one is relaxed.
  allowedPrefixes: [WAYBACK_REPLAY_PREFIX],
  allowSubsequentNavigation: true,
  javascript: true,
  allowedPermissions: [],
  // One host, because one host is all this repository names: WAYBACK_REPLAY_PREFIX
  // and the CDX endpoint (waybackMachine.ts) both point at web.archive.org and
  // nothing in src/ addresses another. A replay rewrites the archived page's own
  // subresource URLs back through this host, so the archived content renders from
  // it; anything the page reaches for at runtime that was NOT rewritten is by
  // definition a live third party, which is exactly the request #886 exists to
  // stop. Bare archive.org and analytics.archive.org are deliberately absent: they
  // carry the replay's donation banner and its analytics beacon, neither of which
  // is the archived page, and both of which are a request the operator did not ask
  // to make. Widening this is a one-line edit with a known-answer test beside it,
  // not something to reach for the moment a replay looks less polished.
  allowedRequestHosts: ['web.archive.org']
}

// Schemes that resolve without leaving the machine, so they disclose nothing on
// any partition: `data:` and `blob:` are the guest's own bytes, `about:` is
// Chromium's own blank document. Blocking them would break a guest without
// closing anything.
const NON_NETWORK_SCHEMES: readonly string[] = ['data:', 'blob:', 'about:']

const POLICIES: Record<string, WebviewPartitionPolicy> = {
  [MHTML_PARTITION]: MHTML_POLICY,
  [WAYBACK_PARTITION]: WAYBACK_POLICY
}

/** Every partition a webview is allowed to run on, for session-level hardening. */
export const WEBVIEW_PARTITIONS: readonly string[] = [MHTML_PARTITION, WAYBACK_PARTITION]

/** The policy for a partition, or null when the partition is not one of ours. */
export function webviewPolicyFor(partition: string | null | undefined): WebviewPartitionPolicy | null {
  if (typeof partition !== 'string' || partition.length === 0) return null
  return POLICIES[partition] ?? null
}

/**
 * The partition a webview is attaching on. Electron sets it on both the attach
 * params and the webPreferences; the attribute is read first because that is what
 * the renderer actually asked for.
 */
export function resolveAttachPartition(
  params: Record<string, unknown> | null | undefined,
  webPreferences: Record<string, unknown> | null | undefined
): string | null {
  const fromParams = params?.partition
  if (typeof fromParams === 'string' && fromParams.length > 0) return fromParams
  const fromPrefs = webPreferences?.partition
  if (typeof fromPrefs === 'string' && fromPrefs.length > 0) return fromPrefs
  return null
}

export type WebviewAttachDecision =
  | { allowed: false; reason: 'unknown-partition' | 'src-not-allowed' }
  | { allowed: true; policy: WebviewPartitionPolicy }

/**
 * Whether a webview may attach at all, and under which policy. A guest whose
 * partition is unknown, or whose `src` is outside that partition's allow-list, is
 * refused before it exists.
 */
export function decideWebviewAttach(input: {
  partition: string | null | undefined
  src: string | null | undefined
}): WebviewAttachDecision {
  const policy = webviewPolicyFor(input.partition)
  if (!policy) return { allowed: false, reason: 'unknown-partition' }
  if (!matchesPrefix(policy, input.src)) return { allowed: false, reason: 'src-not-allowed' }
  return { allowed: true, policy }
}

/**
 * Preferences forced onto every guest, whatever the renderer asked for. `preload` is
 * deleted rather than blanked: an empty string is still a preload entry, and the
 * point is that no main-process code runs in a guest at all.
 *
 * Mutates in place because that is the only form Electron reads — the object handed
 * to `will-attach-webview` is the one used, and replacing the reference is ignored.
 */
export function sanitizeWebviewPreferences(
  webPreferences: Record<string, unknown>,
  policy: WebviewPartitionPolicy
): void {
  delete webPreferences.preload
  delete webPreferences.preloadURL
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInWorker = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
  webPreferences.experimentalFeatures = false
  webPreferences.enableBlinkFeatures = ''
  // No nested guests: a webview inside a webview would attach with its own
  // params and is not a shape any policy here describes.
  webPreferences.webviewTag = false
  webPreferences.javascript = policy.javascript
}

export type WebviewNavigationDecision = 'allow' | 'block'

/**
 * Whether a guest navigation proceeds. `initialLoadDone` is the host's own record of
 * whether this guest has navigated before, so a partition that allows exactly one
 * load can be enforced without asking Chromium what it is showing.
 */
export function decideWebviewNavigation(input: {
  partition: string | null | undefined
  url: string | null | undefined
  initialLoadDone: boolean
}): WebviewNavigationDecision {
  const policy = webviewPolicyFor(input.partition)
  if (!policy) return 'block'
  if (!matchesPrefix(policy, input.url)) return 'block'
  if (input.initialLoadDone && !policy.allowSubsequentNavigation) return 'block'
  return 'allow'
}

export type WebviewRequestDecision = 'allow' | 'block'

/**
 * Whether a request a guest issues is allowed to leave. This is the control the
 * navigation guard cannot be (#886, #810): a subresource — an `<img>`, a
 * stylesheet, a font, a beacon, a `fetch` or `XHR` from script — raises no
 * `will-navigate`, is not a permission request, and so went out unfiltered.
 *
 * Denies by default. A request passes only when it addresses a host the partition
 * allows, or sits inside the partition's own URL allow-list, which is what carries
 * the evidence viewer's local `file:///` artefact. `allowedPrefixes` is consulted rather
 * than duplicated so a partition's URL surface stays declared in one place; on the
 * Wayback side it is subsumed by the host match, since the replay prefix is on the
 * allowed host — but a replay also loads its own toolbar from paths outside that
 * prefix, which is why the host is the operative test and the prefix alone would
 * not do.
 */
export function decideWebviewRequest(input: {
  partition: string | null | undefined
  url: string | null | undefined
}): WebviewRequestDecision {
  const policy = webviewPolicyFor(input.partition)
  if (!policy) return 'block'
  const { url } = input
  if (typeof url !== 'string' || url.length === 0) return 'block'
  if (NON_NETWORK_SCHEMES.some((scheme) => url.startsWith(scheme))) return 'allow'
  if (matchesPrefix(policy, url)) return 'allow'
  const host = requestHost(url)
  if (host === null) return 'block'
  return policy.allowedRequestHosts.includes(host) ? 'allow' : 'block'
}

/**
 * Permission decision for a guest session. Denies everything, because neither
 * partition grants anything: nothing rendered in a webview — an evidence
 * artefact or a third party's archive — has any business reaching a camera, a
 * clipboard, a notification or a location. An unknown partition is denied twice
 * over, having no policy at all.
 */
export function allowWebviewPermission(
  partition: string | null | undefined,
  permission: string
): boolean {
  const policy = webviewPolicyFor(partition)
  return policy ? policy.allowedPermissions.includes(permission) : false
}

export type WebviewDownloadDecision = 'block'

/**
 * Downloads from a guest session. Always blocked: a file written by remote content
 * into the operator's machine is neither evidence nor corroboration, and it would
 * arrive with no manifest entry behind it.
 */
export function decideWebviewDownload(): WebviewDownloadDecision {
  return 'block'
}

/**
 * Whether a URL sits inside the partition's declared surface — the gate every
 * `allow` in this module passes through for anything that is not `https`.
 *
 * The remote-`file:` refusal lives here rather than at the three call sites (#904).
 * `matchesPrefix` is the only gate through which a `file:` URL can reach an `allow`
 * anywhere in this module: the other two allow paths in `decideWebviewRequest` are
 * locked to `data:`/`blob:`/`about:` and to `https:` respectively. So one refusal
 * covers attach, navigation and request at once, and a decision function added later
 * that consults the allow-list inherits it rather than having to remember it. It is
 * not a policy smuggled into a match, either: the `file://` entry on the evidence
 * viewer's list has always meant the local file scheme, and `startsWith` cannot say
 * so, because `file://` is a prefix of the remote form too.
 *
 * Reordering the host test in front of the prefix test in `decideWebviewRequest`
 * would not do instead: `requestHost` returns null for every non-`https` scheme, so
 * it would deny the legitimate `file:///` artefact along with the remote one.
 */
function matchesPrefix(policy: WebviewPartitionPolicy, url: string | null | undefined): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  if (isRemoteFileUrl(url)) return false
  return policy.allowedPrefixes.some((prefix) => url.startsWith(prefix))
}

/**
 * Whether a `file:` URL would fetch from somewhere other than this machine. Only the
 * empty-authority form `file:///path` is local; `file://host/share/x` is a remote
 * fetch wearing a local scheme. On Windows that is a UNC path, so Chromium opens an
 * SMB connection and the OS authenticates to it unasked, handing the operator's
 * account name and an offline-crackable NTLMv2 response to whoever chose the URL —
 * a credential disclosure rather than only a phone-home, and `package:win` ships.
 *
 * Three shapes carry the same authority and all three are refused:
 * - `file://evil.test/share/x.png` — the authority in its plain form.
 * - `file:////evil.test/share/x.png` — `URL` reads the host as empty and leaves
 *   `//evil.test/…` in the path, which Windows resolves as that same UNC target.
 * - `file://user:pw@evil.test/x` — `URL` refuses to parse a `file:` URL carrying
 *   credentials, and Chromium's parser is not `URL`. A `file:` string this module
 *   cannot resolve is one it cannot vouch for, so it is denied rather than waved
 *   through on a `startsWith` that does not care whether it parsed.
 *
 * `file://localhost/tmp/x` needs no exception: `URL` normalises that authority away
 * to the empty one, so it arrives here already in the local form.
 */
function isRemoteFileUrl(url: string): boolean {
  if (!/^file:/i.test(url)) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true
  }
  return parsed.hostname.length > 0 || parsed.pathname.startsWith('//')
}

/**
 * The hostname an `https` request addresses, or null for anything else. Parsing
 * rather than string-matching is the point: `URL` settles where the authority ends,
 * so a name embedded in a path, a userinfo segment or a query cannot pass itself off
 * as the host. Any other scheme yields null and is denied — a `file:` subresource has
 * already been settled above, either matched as the local form or refused as a remote
 * authority (#904; the prefix test alone could not tell those apart, which is the bug
 * this sentence used to describe as safe), and `http`/`ws`/`wss` to an allowed name is
 * still a request no partition here needs.
 */
function requestHost(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // `URL` lower-cases an ASCII hostname and resolves its punycode, so the exact
  // comparison at the call site is doing so against a normalised name.
  return parsed.protocol === 'https:' ? parsed.hostname : null
}
