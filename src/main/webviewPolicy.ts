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
  /** URL prefixes a guest on this partition may load or navigate to. */
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
}

const MHTML_POLICY: WebviewPartitionPolicy = {
  partition: MHTML_PARTITION,
  allowedPrefixes: ['file://'],
  allowSubsequentNavigation: false,
  javascript: false,
  allowedPermissions: []
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
  allowedPermissions: []
}

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

function matchesPrefix(policy: WebviewPartitionPolicy, url: string | null | undefined): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  return policy.allowedPrefixes.some((prefix) => url.startsWith(prefix))
}
