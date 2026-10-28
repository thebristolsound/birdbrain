import type { CaseManifestSnapshot } from '@shared/manifestSnapshot'
import { MEMBER_CODE_PATTERN, type ManifestEntry } from '@shared/schemas'
import type {
  CaseMember,
  SharingErrorCode,
  SharingMembers,
  SharingOpenInvite,
  SharingPendingJoin,
  SharingSyncOutcome,
  SyncErrorKind,
  SyncState
} from '@shared/types'
import { formatSeq } from '@renderer/components/data/ledgerModel'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'

// The Shared Case members screens as pure functions of the IPC payloads
// (#1514): the roster (`sharing:getMembers`), the sync state
// (`sharing:getSyncState`) and the local chain (`manifest:snapshot`). Every
// string the screens show is here or derived here, verbatim from
// docs/design-handoff/2026-09-19-shared-case-members/ and the entry points
// of docs/design-handoff/2026-10-28-share-a-case/, so one test can read
// them all against the brief's copy constraints. Nothing here computes an
// integrity claim: the verdict stays in the snapshot.

// --- Hues -------------------------------------------------------------------

// This installation is always the accent; every other member takes the hue
// of its rank in the Owner's `member-add` order, revoked members included so
// nobody's hue moves when one is revoked (assessment item 20). `faint` is the
// chip of a revoked row and of the ledger's Timeline toggle.
export type MemberHue = 'accent' | 'faint' | 1 | 2 | 3 | 4

// Literal class strings so Tailwind sees every utility; a template would
// emit classes the build never generated.
export const HUE_CLASSES: Record<MemberHue, { chip: string; dot: string; text: string }> = {
  accent: { chip: 'bg-accent/15 border-accent/30', dot: 'bg-accent', text: 'text-accent' },
  faint: {
    chip: 'bg-text-faint/15 border-text-faint/30',
    dot: 'bg-text-faint',
    text: 'text-text-faint'
  },
  1: { chip: 'bg-member-1/15 border-member-1/30', dot: 'bg-member-1', text: 'text-member-1' },
  2: { chip: 'bg-member-2/15 border-member-2/30', dot: 'bg-member-2', text: 'text-member-2' },
  3: { chip: 'bg-member-3/15 border-member-3/30', dot: 'bg-member-3', text: 'text-member-3' },
  4: { chip: 'bg-member-4/15 border-member-4/30', dot: 'bg-member-4', text: 'text-member-4' }
}

const HUE_COUNT = 4

function rankHue(rank: number): MemberHue {
  return (((rank - 1) % HUE_COUNT) + 1) as 1 | 2 | 3 | 4
}

function nonOwnersByAddition(members: readonly CaseMember[]): CaseMember[] {
  return members.filter((m) => m.role !== 'owner').sort((a, b) => a.addedAtIndex - b.addedAtIndex)
}

export function hueFor(
  members: readonly CaseMember[],
  selfInstallationId: string,
  installationId: string
): MemberHue {
  if (installationId === selfInstallationId) return 'accent'
  const ranked = nonOwnersByAddition(members)
  const rank = ranked.findIndex((m) => m.installationId === installationId)
  if (rank >= 0) return rankHue(rank + 1)
  // The Owner seen from a member's replica has no rank of its own (the mock
  // draws the Owner's view only): it takes the slot after the last member.
  // An installation off the roster takes the same slot, as a pending join
  // does.
  return rankHue(ranked.length + 1)
}

// The hue the next approved member takes: what a pending join's `JO?` chip
// shows.
export function nextFreeHue(members: readonly CaseMember[]): MemberHue {
  return rankHue(nonOwnersByAddition(members).length + 1)
}

// The Connection cell's text, dot and pulse as literal classes, for the same
// reason HUE_CLASSES is literal. `animate-pulse` stands in for the mock's
// 1.4 s and 2 s pulses.
export const CONNECTION_TONE_CLASSES: Record<ConnectionTone, string> = {
  muted: 'text-text-muted',
  secondary: 'text-text-secondary',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  faint: 'text-text-faint'
}

export const DOT_TONE_CLASSES: Record<DotTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success-fg',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-fg',
  offline: 'bg-border-strong',
  transparent: 'bg-transparent'
}

export const PULSE_CLASSES: Record<Pulse, string> = {
  none: '',
  syncing: 'animate-pulse',
  waiting: 'animate-pulse'
}

// --- Fingerprints and labels ------------------------------------------------

// The first 32 hex characters of a key fingerprint in groups of four, as the
// mock prints every fingerprint (eight groups).
export function fingerprintGroups(fingerprint: string): string[] {
  return fingerprint.slice(0, 32).match(/.{1,4}/g) ?? []
}

export function fingerprintFull(fingerprint: string): string {
  return fingerprintGroups(fingerprint).join(' ')
}

// The collapsed form: two groups and an ellipsis.
export function fingerprintPrefix(fingerprint: string): string {
  return `${fingerprintGroups(fingerprint).slice(0, 2).join(' ')} …`
}

export function roleLabel(role: CaseMember['role'], isSelf: boolean): string {
  const base = role === 'owner' ? 'Owner' : 'Member'
  return isSelf ? `${base} · you` : base
}

// The Egress kind as the notice names it: the kind with its first letter
// upper-cased, as the mock computes it. 'unavailable' reads as not Direct
// (fails closed) and prints as 'Unavailable'.
export function egressLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

export function egressIsNotDirect(kind: string | undefined): boolean {
  return kind !== undefined && kind !== 'direct'
}

// Non-revoked roster members: the "Members · N" header.
export function memberCount(members: readonly CaseMember[]): number {
  return members.filter((m) => m.revokedAtIndex === null).length
}

// --- Clock words -------------------------------------------------------------

// Dates print in UTC, as every other timestamp in the renderer does, so a
// test and a screenshot read the same whatever the machine's zone.
const DAY_MS = 86_400_000

function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS)
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

export function formatDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

// 'today 14:02', 'yesterday 13:52', 'tomorrow 14:07' or the date and time.
export function formatClock(iso: string, nowMs: number): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const days = utcDay(ts) - utcDay(nowMs)
  const clock = new Date(ts).toISOString().slice(11, 16)
  if (days === 0) return `today ${clock}`
  if (days === -1) return `yesterday ${clock}`
  if (days === 1) return `tomorrow ${clock}`
  return formatDateTime(new Date(ts).toISOString())
}

// The invite's expiry as the dialog and the join flow print it.
export function expiryPhrase(expiresAt: string, nowMs: number): string {
  return formatClock(expiresAt, nowMs)
}

// --- Copy -------------------------------------------------------------------

// Verbatim from the mock. A string with a value in it is a function; the
// rest are constants.
export const COPY = {
  navLabel: 'Case settings',
  navFootnote:
    'First slice ships Members only. General and Export keep their current homes; the tabs are ' +
    'here so the screen reads as settings.',
  networkNoticeTitle: 'Teammates and the relay can see this computer’s network addresses',
  fingerprintLabel: 'Key fingerprint',
  fingerprintToggleTitle: 'Show full fingerprint',
  fingerprintExplainer:
    'A fingerprint identifies this installation’s signing key, not a person. Read it aloud to a ' +
    'peer over a channel you already trust if you want them to confirm it is you.',
  syncNow: 'Sync now',
  invite: 'Invite',
  revoke: 'Revoke',
  review: 'Review',
  checkForUpdates: 'Check for updates',
  membersFootnote:
    'A member is an installation. One person on two machines appears twice, with two Member ' +
    'Codes. Staging Pool, Selectors, to-do items, and timestamp settings stay on each machine ' +
    'and are not synced.',
  relayUrlLabel: 'Relay URL',
  relayExplainer:
    'Peers connect to each other directly. When a direct connection fails, this relay carries ' +
    'the connection instead. The relay can see which installations connected, when, and how ' +
    'much data passed. It cannot read Case content: the connection is encrypted between the ' +
    'two peers. Case files on this disk are not encrypted by Birdbrain.',
  recoveryHeading: 'Recovery',
  recoveryTitle: 'Create a new Case from my copy',
  recoveryBody:
    'For when the Owner’s machine is lost. Makes a separate Case from the copy on this machine, ' +
    'with you as Owner and a lineage entry pointing back here. This Case is left as it is.',
  recoveryAction: 'Create new Case…',
  notSharedTitle: 'This Case is on this machine only',
  notSharedPoints: [
    'Peers connect to each other; no server holds the Case.',
    'You approve every join and can stop syncing with a member later.',
    'Members who leave keep the copy they already hold.'
  ],
  relayUnreachableTail: 'Try syncing again after the relay answers.',
  retry: 'Retry',
  changeRelay: 'Change relay',
  unavailableTitle: 'Sharing is not available on this Mac',
  unavailableBody:
    'The peer-to-peer library Birdbrain uses has no build for Intel Macs yet. Everything else ' +
    'in this Case works as before. On an Apple silicon Mac, Windows, or Linux this Case can be ' +
    'shared or joined.',
  unavailableNote:
    'To work with a peer today, export a Case Archive and import it on their machine. That is ' +
    'a one-time copy, not a sync.',
  exportArchive: 'Export Case Archive…',
  inviteExplainer:
    'Send this to one person over a channel you already use, such as Signal or email. It works ' +
    'once and expires in 24 hours. You need to be online when they use it.',
  copyInvite: 'Copy invite',
  showQr: 'Show QR',
  hideQr: 'Hide QR',
  qrLabel: 'QR code for the same invite',
  qrExplainer:
    'Same invite as the text. Useful when the peer is in the room: they scan it from the Join ' +
    'screen. The code is the invite itself, so treat the screen like the string.',
  waitingTitle: 'Waiting for someone to use this invite',
  copyAgain: 'Copy again',
  cancelInvite: 'Cancel invite',
  done: 'Done',
  joinRequestTitle: 'Join request',
  operatorNameLabel: 'Operator name',
  memberCodeLabel: 'Member Code',
  memberCodeOk: 'Unique in this Case',
  memberCodeRule: 'Up to three characters, A–Z and 0–9. Cannot be changed after approval.',
  decline: 'Decline',
  approve: 'Approve',
  joinTitle: 'Join a shared Case',
  joinSubtitle: 'Paste the invite the Owner sent you.',
  joinFrom: 'From',
  joinValidUntil: 'Valid until',
  joinCaution:
    'The name comes from the invite, so it is what the sender typed. If it is not who you ' +
    'expected, stop here.',
  back: 'Back',
  join: 'Join',
  joinWaitingBody:
    'Connected to their installation. They see your name and fingerprint and pick your Member ' +
    'Code.',
  joinFingerprintLead: 'Your fingerprint, if they ask:',
  excludedPill: 'Excluded from export',
  excludedIntegrity: 'At the last verification, the entry, bytes, and hash verified.',
  excludedStays:
    'The Exhibit stays in the Case and in every member’s copy; exports list it as excluded.',
  revokeNote:
    'Recorded in your Manifest as member-revoke. Cannot be undone; they would need a new invite.',
  cancel: 'Cancel',
  excludeBody:
    'The Exhibit stays in the Case and in every member’s copy. Exports will list it as excluded, ' +
    'with your name and the time, rather than leave it out silently.',
  reasonLabel: 'Reason',
  reasonOptional: '(optional, recorded)',
  excludeAction: 'Exclude from export',
  chainLabel: 'Chain',
  timeline: 'Timeline',
  chainNoteVerified: 'Verified chain · Seq is the entry index',
  chainNoteIndex: 'Seq is the entry index',
  chainNoteTimeline: 'Cross-chain order is by asserted time, not verified',
  ledgerFooter:
    'Each member’s chain is its own sequence and is verified on its own; Seq is the index in ' +
    'that chain. The Timeline view interleaves chains by the time each writer asserted, which ' +
    'verification does not check. A merge entry says which members’ chains advanced and by how ' +
    'many entries. The verdict above checks this installation’s chain only. It does not check ' +
    'the other members’ chain files or the states named by merge entries, and it does not show ' +
    'who sat at a member’s machine.',
  glyphLabel: 'Network addresses visible to teammates and the relay',
  detailsInMembers: 'Details in Members',
  clickToOpen: 'Click to open Members.',
  share: 'Share',
  shareTitle: 'Share this Case with teammates. Opens Members.',
  inviteWaiting: 'invite waiting',
  shareThisCase: 'Share this Case…',
  membersAction: 'Members…'
} as const

// Refusals the Members tab shows inline, by the code main returns. The mock
// draws none of these, so each is one plain sentence; any other code or a
// code-less rejection shows main's own message.
export function refusalMessage(code: SharingErrorCode | null, fallback: string): string {
  switch (code) {
    case 'operator-name-required':
      return 'Set an Operator name in Settings first; invites carry it.'
    case 'relay-url-invalid':
      return 'That is not a URL this build can use as a relay.'
    case 'owner-not-revocable':
      return 'The Owner cannot be revoked.'
    case 'already-revoked':
      return 'This member is already revoked.'
    case 'not-owner':
      return 'Only the Owner of this Case can do that.'
    case 'not-a-member':
      return 'This installation is not a member of this Case.'
    case 'not-shared':
      return 'This Case is not shared.'
    case 'sharing-unavailable':
      return 'Sharing is not available on this computer.'
    default:
      return fallback
  }
}

// The long notice on the Members tab. `egress` is the label from egressLabel.
export function networkNoticeBody(egress: string): string {
  return (
    `Egress is set to ${egress}. That covers captures, not sync: connections to members leave ` +
    'this computer directly. While a connection is set up, a member’s installation receives ' +
    'every network address this computer has, on every interface. A system VPN does not hide ' +
    'them; its own addresses are on that list. The relay sees the address this computer ' +
    'reaches it from. No setting changes this. If these addresses must stay private, do not ' +
    'share this Case from this computer.'
  )
}

// The short notice in the sync pill's popover.
export function networkNoticeShort(egress: string): string {
  return (
    `Egress is set to ${egress}; sync does not use it. During connection setup a member’s ` +
    'installation receives every address on this computer, including a system VPN’s own. The ' +
    'relay sees the address this computer reaches it from.'
  )
}

export function identityLine(role: CaseMember['role'], code: string): string {
  return `${role === 'owner' ? 'Owner' : 'Member'} · Member Code ${code}`
}

export function notSharedBody(code: string): string {
  return (
    'Share it with up to four peers who run Birdbrain. Each keeps a full copy. Every Capture, ' +
    'note, and tag stays signed by the installation that made it, and Exhibit Numbers gain ' +
    `your Member Code (${code}-7) so citations stay unique.`
  )
}

export function yourCodeWillBe(code: string): string {
  return `Your Member Code will be ${code}`
}

export function relayUnreachableTitle(sinceIso: string, nowMs: number): string {
  return `Relay unreachable since ${formatClock(sinceIso, nowMs).replace(/^today /, '')}`
}

// Reachability records a handshake, not whether it used a relay or a direct connection.
export function relayUnreachableBody(connected: string[], unreachable: string[]): string {
  const parts: string[] = []
  if (connected.length > 0) parts.push(`Last reached: ${listWords(connected)}.`)
  if (unreachable.length > 0) {
    parts.push(`Not reached: ${listWords(unreachable)}.`)
  }
  parts.push(COPY.relayUnreachableTail)
  return parts.join(' ')
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export function inviteTitle(caseName: string): string {
  return `Invite to ${caseName}`
}

export function expiresLine(expiresAt: string, nowMs: number): string {
  return `Expires ${expiryPhrase(expiresAt, nowMs)}`
}

export function waitingBody(expiresAt: string, nowMs: number): string {
  return (
    `You can close this. The invite stays valid until ${expiryPhrase(expiresAt, nowMs)} or ` +
    'until it is used. A join request will appear in Members.'
  )
}

export function joinRequestLead(receivedAt: string, nowMs: number): string {
  return `An installation used your invite from ${formatClock(receivedAt, nowMs).replace(/^today /, '')}.`
}

export function memberCodeHelper(code: string): string {
  return `Their Exhibits will read ${code}-1, ${code}-2… ${COPY.memberCodeRule}`
}

export function trustNote(name: string): string {
  return (
    'The name is what they typed into their own settings. The fingerprint identifies their ' +
    `installation. If you want to be sure this is ${name}, ask them to read the fingerprint ` +
    'back over a channel you already trust.'
  )
}

export function memberAddCaption(index: number): string {
  return `Manifest entry member-add #${formatSeq(index)} written to your chain.`
}

export function joinWaitingTitle(ownerName: string): string {
  return `Waiting for ${ownerName} to approve`
}

export function sharedByLine(ownerName: string, count: number): string {
  return `Shared by ${ownerName} · ${count} ${count === 1 ? 'member' : 'members'}`
}

export function capturedBy(name: string | null, code: string): string {
  return name === null ? `Captured by you (${code})` : `Captured by ${name} (${code})`
}

export function syncAttemptMessage(outcomes: SharingSyncOutcome[]): string | null {
  if (outcomes.length === 0) return 'No peers were available for this sync attempt.'
  const completed = outcomes.filter(
    (result) => result.outcome === 'synced' && result.errors === 0
  ).length
  return completed === outcomes.length
    ? null
    : `Sync incomplete · ${completed} of ${outcomes.length} peers completed without errors`
}

export function revokeTitle(name: string): string {
  return `Revoke ${name}?`
}

export function revokeBody(name: string, code: string, exhibitNumbers: number[]): string {
  const numbers = [...new Set(exhibitNumbers)].sort((a, b) => a - b)
  const count = numbers.length
  const contiguous = numbers.every((number, index) => number === numbers[0] + index)
  const range =
    count === 0 || !contiguous
      ? ''
      : count === 1
        ? ` (${code}-${numbers[0]})`
        : ` (${code}-${numbers[0]}–${code}-${numbers[count - 1]})`
  const theirs =
    count > 0
      ? `Their ${count} ${count === 1 ? 'Exhibit' : 'Exhibits'}${range}, notes, and tags`
      : 'Their notes, and tags'
  return (
    `${name} will stop receiving updates. They keep the copy of this Case they already have. ` +
    `${theirs} stay in the Case, attributed to them.`
  )
}

export function excludeTitle(citation: string): string {
  return `Exclude ${citation} from export?`
}

export function excludeBody(authorName: string): string {
  return `${COPY.excludeBody} Only ${authorName} can delete it.`
}

// --- Member rows ---------------------------------------------------------------

export type ConnectionTone = 'muted' | 'secondary' | 'success' | 'warning' | 'danger' | 'faint'
export type DotTone = 'accent' | 'success' | 'warning' | 'danger' | 'offline' | 'transparent'
export type Pulse = 'none' | 'syncing' | 'waiting'

export interface MemberConnection {
  label: string
  tone: ConnectionTone
  dot: DotTone
  pulse: Pulse
}

// The strip under a row paused on a newer version (ruling 2 of 2026-10-10).
// `received` and `waiting` are chain indices (`SI·0003`), not Exhibit
// Numbers: the error carries the index this replica holds, not a citation.
export interface PausedStrip {
  lead: string
  received: string | null
  waiting: string | null
  text: string
}

export function pausedStrip(
  name: string,
  code: string,
  index: number | undefined,
  waitingIndex?: number
): PausedStrip {
  const lead = `Sync with ${name} is paused.`
  const received = index === undefined ? null : `${code}·${formatSeq(index)}`
  const firstWaiting = waitingIndex ?? (index === undefined ? undefined : index + 1)
  const waiting = firstWaiting === undefined ? null : `${code}·${formatSeq(firstWaiting)}`
  const middle =
    ' Their Birdbrain is newer than this one and wrote an entry this version cannot read.'
  const entries =
    received === null
      ? waiting === null
        ? ''
        : ` ${waiting} and later wait on their machine.`
      : ` Received up to ${received}; ${waiting} and later wait on their machine.`
  const tail =
    ' Sync with them resumes after this computer updates. Other members are not affected.'
  return { lead, received, waiting, text: `${lead}${middle}${entries}${tail}` }
}

export interface MemberRow {
  key: string
  kind: 'member' | 'pending'
  installationId: string | null
  requestId: string | null
  code: string
  name: string
  fingerprint: string | null
  hue: MemberHue
  role: string
  connection: MemberConnection
  lastSynced: string
  dimmed: boolean
  action: 'revoke' | 'review' | null
  paused: PausedStrip | null
}

export interface MemberRowsInput {
  members: SharingMembers
  syncState: SyncState | undefined
  snapshot: CaseManifestSnapshot | undefined
  nowMs: number
}

function parsedEntries(snapshot: CaseManifestSnapshot | undefined): ManifestEntry[] {
  if (!snapshot) return []
  return snapshot.entries.flatMap((line) => (line.parsed ? [line.entry] : []))
}

// The `member-revoke` entry at the roster's `revokedAtIndex`, when this
// replica's chain holds it (the Owner's does; a member's never).
function revokeEntryOf(
  snapshot: CaseManifestSnapshot | undefined,
  member: CaseMember
): Extract<ManifestEntry, { type: 'member-revoke' }> | null {
  if (member.revokedAtIndex === null) return null
  for (const entry of parsedEntries(snapshot)) {
    if (
      entry.type === 'member-revoke' &&
      entry.index === member.revokedAtIndex &&
      entry.memberInstallationId === member.installationId
    ) {
      return entry
    }
  }
  return null
}

function pausedWith(syncState: SyncState | undefined, installationId: string): boolean {
  return (
    syncState?.peers.some(
      (peer) => peer.installationId === installationId && peer.pausedAtIndex !== undefined
    ) ||
    (syncState?.phase === 'error' &&
      syncState.lastError?.kind === 'newer-version' &&
      syncState.lastError.installationId === installationId)
  )
}

export function memberRows({ members, syncState, snapshot, nowMs }: MemberRowsInput): MemberRow[] {
  const self = members.installationId
  const roster = [...members.members].sort((a, b) => a.addedAtIndex - b.addedAtIndex)
  const rows: MemberRow[] = roster.map((member) => {
    const isSelf = member.installationId === self
    const peer = syncState?.peers.find((p) => p.installationId === member.installationId)
    const hue = hueFor(members.members, self, member.installationId)
    const base = {
      key: member.installationId,
      kind: 'member' as const,
      installationId: member.installationId,
      requestId: null,
      code: member.memberCode,
      name: member.operatorName,
      fingerprint: member.fingerprint === null ? null : fingerprintPrefix(member.fingerprint),
      hue,
      role: roleLabel(member.role, isSelf),
      dimmed: false,
      action: null as MemberRow['action'],
      paused: null as PausedStrip | null
    }
    if (member.revokedAtIndex !== null) {
      const entry = revokeEntryOf(snapshot, member)
      const when = entry === null ? '' : ` ${formatDate(entry.timestamp)}`
      return {
        ...base,
        hue: 'faint',
        connection: {
          label: `Revoked${when} · keeps their copy`,
          tone: 'faint',
          dot: 'transparent',
          pulse: 'none'
        },
        lastSynced: entry === null ? '—' : formatDateTime(entry.timestamp),
        dimmed: true
      }
    }
    if (isSelf) {
      return {
        ...base,
        connection: { label: 'This machine', tone: 'muted', dot: 'accent', pulse: 'none' },
        lastSynced: '—'
      }
    }
    const action: MemberRow['action'] = members.isOwner ? 'revoke' : null
    if (pausedWith(syncState, member.installationId)) {
      const waiting = peer?.pausedAtIndex ?? syncState?.lastError?.waitingIndex
      const index =
        peer?.pausedAtIndex === undefined
          ? syncState?.lastError?.index
          : peer.pausedAtIndex > 0
            ? peer.pausedAtIndex - 1
            : undefined
      const at = peer?.lastSessionAt
      const upTo = index === undefined ? '' : ` · up to ${member.memberCode}·${formatSeq(index)}`
      return {
        ...base,
        connection: {
          label: 'Paused · newer Birdbrain',
          tone: 'danger',
          dot: 'danger',
          pulse: 'none'
        },
        lastSynced: at ? `${formatClock(at, nowMs)}${upTo}` : '—',
        action,
        paused: pausedStrip(member.operatorName, member.memberCode, index, waiting)
      }
    }
    const lastSynced = peer?.lastSessionAt ? formatRelativeTime(peer.lastSessionAt, nowMs) : '—'
    if (peer?.reachable && syncState?.phase === 'syncing') {
      return {
        ...base,
        connection: { label: 'Syncing', tone: 'secondary', dot: 'accent', pulse: 'syncing' },
        lastSynced,
        action
      }
    }
    if (peer?.reachable) {
      return {
        ...base,
        connection: { label: 'Connected', tone: 'success', dot: 'success', pulse: 'none' },
        lastSynced,
        action
      }
    }
    const seen = peer?.lastSessionAt
      ? `Offline · last seen ${formatRelativeTime(peer.lastSessionAt, nowMs)}`
      : 'Offline'
    return {
      ...base,
      connection: { label: seen, tone: 'muted', dot: 'offline', pulse: 'none' },
      lastSynced,
      action
    }
  })
  const pendingHue = nextFreeHue(members.members)
  for (const join of members.pendingJoins) rows.push(pendingRow(join, pendingHue))
  return rows
}

function pendingRow(join: SharingPendingJoin, hue: MemberHue): MemberRow {
  return {
    key: `pending:${join.requestId}`,
    kind: 'pending',
    installationId: join.installationId,
    requestId: join.requestId,
    code: `${join.suggestedMemberCode}?`,
    name: join.operatorName,
    fingerprint: fingerprintPrefix(join.fingerprint),
    hue,
    role: '—',
    connection: {
      label: 'Pending your approval',
      tone: 'warning',
      dot: 'warning',
      pulse: 'waiting'
    },
    lastSynced: '—',
    dimmed: false,
    action: 'review',
    paused: null
  }
}

// --- Sync pill ------------------------------------------------------------------

export type PillChrome = 'idle' | 'active' | 'error'

export interface SyncPill {
  a: string
  b: string
  chrome: PillChrome
  dot: 'success' | 'warning' | 'danger' | null
  spinner: boolean
  glyph: boolean
  title: string
}

function peersWord(n: number): string {
  return `${n} ${n === 1 ? 'peer' : 'peers'}`
}

// The second cell of a failed pill: the kind with its hyphens as spaces, the
// mock's "relay, peer, rejected entry, hash mismatch". 'local' has no label in
// the mock and takes the same rule.
export function errorKindLabel(kind: SyncErrorKind): string {
  return kind.replace(/-/g, ' ')
}

// Null when the pill is hidden: no state yet, or a Case with no peers.
// Error chrome keys on `phase`, not on `lastError`, which main keeps after a
// later success.
export function syncPillModel(state: SyncState | undefined): SyncPill | null {
  if (!state || state.peersTotal === 0) return null
  const { phase, peersReachable, peersTotal, transfer, lastError } = state
  const glyph = egressIsNotDirect(state.egress)
  const allReachable = peersReachable === peersTotal
  const some = `${peersReachable} of ${peersWord(peersTotal)}`
  let pill: Omit<SyncPill, 'glyph' | 'title'>
  if (phase === 'error' || state.peers.some((peer) => peer.pausedAtIndex !== undefined)) {
    const kind = state.peers.some((peer) => peer.pausedAtIndex !== undefined)
      ? 'newer-version'
      : (lastError?.kind ?? 'local')
    pill =
      kind === 'newer-version'
        ? { a: 'Sync paused', b: 'newer version', chrome: 'error', dot: 'danger', spinner: false }
        : {
            a: 'Sync failed',
            b: errorKindLabel(kind),
            chrome: 'error',
            dot: 'danger',
            spinner: false
          }
  } else if (phase === 'syncing') {
    pill = allReachable
      ? {
          a: 'Syncing',
          // The last session's count: this build reports no total and no
          // running count, so the pill never claims "41 of 63".
          b: transfer
            ? `${transfer.entries} ${transfer.entries === 1 ? 'entry' : 'entries'}`
            : peersWord(peersTotal),
          chrome: 'active',
          dot: null,
          spinner: true
        }
      : { a: 'Syncing', b: some, chrome: 'active', dot: 'warning', spinner: false }
  } else {
    pill = allReachable
      ? { a: 'Synced', b: peersWord(peersTotal), chrome: 'idle', dot: 'success', spinner: false }
      : { a: 'Synced', b: some, chrome: 'idle', dot: 'warning', spinner: false }
  }
  return { ...pill, glyph, title: `${pill.a} · ${pill.b}. ${COPY.clickToOpen}` }
}

// --- Share pill ------------------------------------------------------------------

// The top bar's one sharing control (docs/design-handoff/2026-10-28-share-a-case/,
// frame B): "Share" on a Case nobody has shared, what it waits on once an
// invite is out, the shipped sync pill from the first approved join, and a
// dashed form where sharing is unavailable. Every state opens Members.
export type SharePillState = 'share' | 'invite' | 'approve' | 'synced' | 'unavailable'

export interface SharePill {
  state: SharePillState
  // The label's two cells, joined by the sync pill's "·": "Share" and, while
  // the pill waits on something, what it waits on. The synced state carries
  // the sync pill's own cells.
  a: string
  b: string | null
  title: string
  // The warning dot that stands in for the users icon while the pill waits:
  // pulsing for an invite, still for a join request.
  dot: boolean
  pulse: boolean
  sync: SyncPill | null
}

export interface SharePillInput {
  available: boolean | undefined
  members: SharingMembers | undefined
  syncState: SyncState | undefined
  nowMs: number
}

export function toApprove(n: number): string {
  return `${n} to approve`
}

export function joinRequestsToApprove(n: number): string {
  return `${n} join ${n === 1 ? 'request' : 'requests'} to approve`
}

export function inviteExpires(expiresAt: string, nowMs: number): string {
  return `Invite expires ${expiryPhrase(expiresAt, nowMs)}`
}

// The breadcrumb's tooltip tail: "You are AR in this Case".
export function youAreLine(code: string): string {
  return `You are ${code} in this Case`
}

// The command palette's row for the open Case (frame D): the Owner of a local
// Case is offered sharing; a shared Case, joined or owned, opens Members.
export function shareActionLabel(shared: boolean): string {
  return shared ? COPY.membersAction : COPY.shareThisCase
}

// The invite the pill waits on: the one that expires last. An invite past its
// expiry is not waiting, whether or not the registry has dropped it yet.
function latestOpenInvite(invites: readonly SharingOpenInvite[], nowMs: number): string | null {
  let latest: string | null = null
  for (const { expiresAt } of invites) {
    const ts = new Date(expiresAt).getTime()
    if (Number.isNaN(ts) || ts <= nowMs) continue
    if (latest === null || ts > new Date(latest).getTime()) latest = expiresAt
  }
  return latest
}

// First match wins: unavailable, synced, a join to approve, an invite
// waiting, then "Share". Null until the platform check and the roster have
// loaded, and while a Case with peers waits for its first sync state, so the
// pill never reads "Share" on its way to "Synced".
export function sharePillModel({
  available,
  members,
  syncState,
  nowMs
}: SharePillInput): SharePill | null {
  const still = { dot: false, pulse: false, sync: null }
  if (available === false) {
    return {
      state: 'unavailable',
      a: COPY.share,
      b: null,
      title: `${COPY.unavailableTitle}.`,
      ...still
    }
  }
  if (available === undefined || members === undefined) return null
  const sync = syncPillModel(syncState)
  if (sync) return { state: 'synced', a: sync.a, b: sync.b, title: sync.title, ...still, sync }
  if (syncState === undefined && memberCount(members.members) > 1) return null
  const joins = members.pendingJoins.length
  if (joins > 0) {
    return {
      state: 'approve',
      a: COPY.share,
      b: toApprove(joins),
      title: joinRequestsToApprove(joins),
      dot: true,
      pulse: false,
      sync: null
    }
  }
  const expiresAt = latestOpenInvite(members.invites, nowMs)
  if (expiresAt !== null) {
    return {
      state: 'invite',
      a: COPY.share,
      b: COPY.inviteWaiting,
      title: inviteExpires(expiresAt, nowMs),
      dot: true,
      pulse: true,
      sync: null
    }
  }
  return { state: 'share', a: COPY.share, b: null, title: COPY.shareTitle, ...still }
}

// --- Member Code validation ------------------------------------------------------

export type MemberCodeCheck =
  | { code: string; ok: true }
  | { code: string; ok: false; reason: 'empty' | 'invalid'; message: string }
  | { code: string; ok: false; reason: 'taken'; message: string; takenBy: string }

function codeLetters(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .split('')
}

// Two codes the Owner could use instead of a taken one: the code plus the
// next letter of the joiner's name not already in it, and the code plus the
// lowest free digit from 2, each cut to three characters and dropped when it
// is not itself a valid, unused code.
export function memberCodeAlternatives(
  code: string,
  members: readonly CaseMember[],
  joinerName: string
): string[] {
  const used = new Set(members.map((m) => m.memberCode.toUpperCase()))
  used.add(code)
  const fits = (candidate: string): boolean =>
    MEMBER_CODE_PATTERN.test(candidate) && !used.has(candidate)
  const out: string[] = []
  const letter = codeLetters(joinerName).find((ch) => !code.includes(ch))
  if (letter !== undefined) {
    const withLetter = `${code}${letter}`.slice(0, 3)
    if (fits(withLetter)) out.push(withLetter)
  }
  for (let digit = 2; digit <= 9; digit++) {
    const withDigit = `${code}${digit}`.slice(0, 3)
    if (fits(withDigit) && !out.includes(withDigit)) {
      out.push(withDigit)
      break
    }
  }
  return out
}

// Validates a Member Code as the join request dialog types it (README
// "Interactions"): upper-cased, `[A-Z0-9]{1,3}`, unique among current and
// revoked members.
export function memberCodeCheck(
  input: string,
  members: readonly CaseMember[],
  joinerName: string
): MemberCodeCheck {
  const code = input.toUpperCase()
  if (code.length === 0) return { code, ok: false, reason: 'empty', message: COPY.memberCodeRule }
  if (!MEMBER_CODE_PATTERN.test(code)) {
    return { code, ok: false, reason: 'invalid', message: COPY.memberCodeRule }
  }
  const holder = members.find((m) => m.memberCode.toUpperCase() === code)
  if (holder) {
    const alternatives = memberCodeAlternatives(code, members, joinerName)
    const tryThese =
      alternatives.length === 2
        ? ` Try ${alternatives[0]} or ${alternatives[1]}.`
        : alternatives.length === 1
          ? ` Try ${alternatives[0]}.`
          : ''
    return {
      code,
      ok: false,
      reason: 'taken',
      message: `${code} is ${holder.operatorName}’s code.${tryThese}`,
      takenBy: holder.operatorName
    }
  }
  return { code, ok: true }
}

// --- Chain facts the screens read ---------------------------------------------

// An `exclude` entry in this replica's chain, keyed by the Exhibit it names.
export interface ExclusionFact {
  exhibitId: string
  authorInstallationId: string
  operatorName: string
  timestamp: string
  reason: string | null
  index: number
}

export function exclusionsOf(
  snapshot: CaseManifestSnapshot | undefined
): Map<string, ExclusionFact> {
  const out = new Map<string, ExclusionFact>()
  if (!snapshot?.chain.valid) return out
  for (const entry of parsedEntries(snapshot)) {
    if (entry.type !== 'exclude' || out.has(entry.exhibitId)) continue
    out.set(entry.exhibitId, {
      exhibitId: entry.exhibitId,
      authorInstallationId: entry.authorInstallationId,
      operatorName: entry.operatorName,
      timestamp: entry.timestamp,
      reason: entry.reason ?? null,
      index: entry.index
    })
  }
  return out
}

// The exclusion banner: "Excluded from export by A. Renner (Owner) on
// 2026-08-02 11:20 · “duplicate of NK-11”. … exclude #0029". The reason
// clause is dropped when none was recorded.
export function exclusionBanner(fact: ExclusionFact): { lead: string; body: string; ref: string } {
  const reason = fact.reason === null ? '' : ` · “${fact.reason}”`
  return {
    lead: COPY.excludedPill,
    body: ` by ${fact.operatorName} (Owner) on ${formatDateTime(fact.timestamp)}${reason}. ${COPY.excludedStays} ${COPY.excludedIntegrity}`,
    ref: `exclude #${formatSeq(fact.index)}`
  }
}

// The latest `merge` in this replica's chain, for the Sync card's footer:
// "received 4 entries from NK · Manifest entry merge #0031".
export interface LastMerge {
  index: number
  timestamp: string
  entriesReceived: number
  fromInstallationId: string
  fromCode: string | null
}

export function lastMergeOf(
  snapshot: CaseManifestSnapshot | undefined,
  members: readonly CaseMember[]
): LastMerge | null {
  let latest: Extract<ManifestEntry, { type: 'merge' }> | null = null
  for (const entry of parsedEntries(snapshot)) {
    if (entry.type === 'merge' && (latest === null || entry.index > latest.index)) latest = entry
  }
  if (latest === null) return null
  const [head] = latest.heads
  return {
    index: latest.index,
    timestamp: latest.timestamp,
    entriesReceived: head.entriesReceived,
    fromInstallationId: head.installationId,
    fromCode: members.find((m) => m.installationId === head.installationId)?.memberCode ?? null
  }
}

// The merge that first named a member's chain at or past an entry's index:
// the "received by you <ts> in merge #NNNN" clause of a detail byline.
export function mergeReceiving(
  snapshot: CaseManifestSnapshot | undefined,
  installationId: string,
  index: number
): { index: number; timestamp: string } | null {
  for (const entry of parsedEntries(snapshot)) {
    if (entry.type !== 'merge') continue
    if (entry.heads.some((h) => h.installationId === installationId && h.index >= index)) {
      return { index: entry.index, timestamp: entry.timestamp }
    }
  }
  return null
}

// --- Join failures ---------------------------------------------------------------

export type JoinFailureAction = 'paste-another' | 'try-again' | 'retry' | 'close'

export interface JoinFailure {
  title: string
  body: string
  action: JoinFailureAction
  actionLabel: string
  icon: 'alert' | 'wifi-off' | 'x'
  tone: 'warning' | 'muted' | 'danger'
}

const ACTION_LABELS: Record<JoinFailureAction, string> = {
  'paste-another': 'Paste another',
  'try-again': 'Try again',
  retry: 'Retry',
  close: 'Close'
}

// The five rows of 1d, by the refusal code main returns; any other code or a
// code-less rejection takes the same row shape with main's message as the
// title.
export function joinFailure(
  code: SharingErrorCode | null,
  ownerName: string,
  expiresAt: string | null,
  nowMs: number,
  fallbackMessage: string
): JoinFailure {
  const row = (
    title: string,
    body: string,
    action: JoinFailureAction,
    icon: JoinFailure['icon'],
    tone: JoinFailure['tone']
  ): JoinFailure => ({ title, body, action, actionLabel: ACTION_LABELS[action], icon, tone })
  switch (code) {
    case 'invite-expired':
      return row(
        'This invite has expired',
        `Invites last 24 hours. Ask ${ownerName} for a new one.`,
        'paste-another',
        'alert',
        'warning'
      )
    case 'invite-reused':
      return row(
        'This invite was already used',
        `Each invite works once. If that was not you, tell ${ownerName} before asking for another.`,
        'paste-another',
        'alert',
        'warning'
      )
    case 'owner-unreachable':
      return row(
        `${ownerName} is not online`,
        'The Owner has to be running Birdbrain to approve you.' +
          (expiresAt === null
            ? ''
            : ` The invite is still valid until ${expiryPhrase(expiresAt, nowMs)}.`),
        'try-again',
        'wifi-off',
        'muted'
      )
    case 'relay-unreachable':
    case 'sharing-unavailable':
      return row(
        `Cannot reach ${ownerName} or the relay`,
        'No direct connection and the relay did not answer. Check your network; the relay URL ' +
          'is in Settings.',
        'retry',
        'wifi-off',
        'danger'
      )
    case 'declined':
      return row(
        `${ownerName} declined`,
        'Nothing was created on either machine. Contact them outside Birdbrain if this is ' +
          'unexpected.',
        'close',
        'x',
        'muted'
      )
    default:
      return row(fallbackMessage, '', 'close', 'x', 'muted')
  }
}
