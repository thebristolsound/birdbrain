import { describe, it, expect } from 'vitest'
import type { CaseManifestSnapshot, ManifestSnapshotEntry } from '@shared/manifestSnapshot'
import type { ManifestEntry } from '@shared/schemas'
import type {
  SharingMember,
  SharingMembers,
  SharingPendingJoin,
  SyncErrorKind,
  SyncPeerState,
  SyncState
} from '@shared/types'
import { SYNC_ERROR_KINDS, SHARING_ERROR_CODES } from '@shared/types'
import {
  COPY,
  HUE_CLASSES,
  capturedBy,
  egressIsNotDirect,
  egressLabel,
  errorKindLabel,
  excludeBody,
  excludeTitle,
  exclusionBanner,
  exclusionsOf,
  expiresLine,
  expiryPhrase,
  fingerprintFull,
  fingerprintGroups,
  fingerprintPrefix,
  formatClock,
  hueFor,
  identityLine,
  inviteExpires,
  inviteTitle,
  joinFailure,
  joinRequestLead,
  joinRequestsToApprove,
  joinWaitingTitle,
  lastMergeOf,
  memberAddCaption,
  memberCodeAlternatives,
  memberCodeCheck,
  memberCodeHelper,
  memberCount,
  memberRows,
  mergeReceiving,
  networkNoticeBody,
  networkNoticeShort,
  nextFreeHue,
  notSharedBody,
  pausedStrip,
  relayUnreachableBody,
  relayUnreachableTitle,
  revokeBody,
  revokeTitle,
  roleLabel,
  shareActionLabel,
  sharePillModel,
  sharedByLine,
  syncPillModel,
  toApprove,
  trustNote,
  waitingBody,
  youAreLine,
  yourCodeWillBe,
  type SharePillInput
} from '@renderer/components/sharing/memberModel'

// The members screens as pure functions of the three payloads (#1514). The
// fixtures are the mock's cast: AR the Owner (self), NK, MB, SI members, JO a
// pending join and TV revoked.

const NOW = new Date('2026-09-19T14:05:00.000Z').getTime()
const FP = '9f3a1c7e44b208d1e6a05b937c2fd418' + 'ff'.repeat(16)

function member(
  installationId: string,
  memberCode: string,
  operatorName: string,
  addedAtIndex: number,
  extra: Partial<SharingMember> = {}
): SharingMember {
  return {
    caseId: 'case-1',
    installationId,
    publicKeyPem: 'pem',
    memberCode,
    operatorName,
    nodeId: `node-${installationId}`,
    role: 'member',
    addedAtIndex,
    revokedAtIndex: null,
    fingerprint: FP,
    ...extra
  }
}

const AR = member('inst-ar', 'AR', 'A. Renner', 24, { role: 'owner' })
const NK = member('inst-nk', 'NK', 'N. Kowalski', 25)
const MB = member('inst-mb', 'MB', 'M. Brandt', 26)
const SI = member('inst-si', 'SI', 'S. Idris', 28)
const TV = member('inst-tv', 'TV', 'T. Vance', 23, { revokedAtIndex: 30 })
const ROSTER = [AR, TV, NK, MB, SI]

const JO: SharingPendingJoin = {
  requestId: 'req-1',
  caseId: 'case-1',
  installationId: 'inst-jo',
  operatorName: 'J. Okafor',
  fingerprint: '7c2fd4189f3a1c7e44b208d1e6a05b93' + '00'.repeat(16),
  suggestedMemberCode: 'JO',
  receivedAt: '2026-09-19T14:07:00.000Z'
}

function members(overrides: Partial<SharingMembers> = {}): SharingMembers {
  return {
    caseId: 'case-1',
    installationId: 'inst-ar',
    isOwner: true,
    members: ROSTER,
    invites: [],
    pendingJoins: [],
    ...overrides
  }
}

function peer(installationId: string, extra: Partial<SyncPeerState> = {}): SyncPeerState {
  return {
    installationId,
    reachable: false,
    lastSessionAt: null,
    ok: null,
    heldHead: null,
    ...extra
  }
}

function sync(overrides: Partial<SyncState> = {}): SyncState {
  return {
    phase: 'idle',
    peersReachable: 3,
    peersTotal: 3,
    peers: [peer('inst-nk', { reachable: true }), peer('inst-mb'), peer('inst-si')],
    transfer: null,
    lastSuccessAt: null,
    lastError: null,
    egress: 'direct',
    ...overrides
  }
}

const stamp = {
  operatorId: 'inst-ar',
  operatorName: 'A. Renner',
  toolVersion: '1.0.1',
  prevHash: 'p',
  entryHash: 'e',
  schemaVersion: 4 as const,
  caseId: 'case-1'
}

function line(entry: ManifestEntry): ManifestSnapshotEntry {
  return { index: entry.index, parsed: true, entry }
}

const REVOKE: Extract<ManifestEntry, { type: 'member-revoke' }> = {
  ...stamp,
  type: 'member-revoke',
  memberInstallationId: 'inst-tv',
  timestamp: '2026-09-02T08:11:19.000Z',
  index: 30
}
const EXCLUDE: Extract<ManifestEntry, { type: 'exclude' }> = {
  ...stamp,
  type: 'exclude',
  exhibitId: 'ex-nk-12',
  authorInstallationId: 'inst-nk',
  reason: 'duplicate of NK-11',
  timestamp: '2026-08-02T11:20:40.000Z',
  index: 29
}
const MERGE_27: Extract<ManifestEntry, { type: 'merge' }> = {
  ...stamp,
  type: 'merge',
  heads: [{ installationId: 'inst-nk', index: 14, entryHash: 'h14', entriesReceived: 14 }],
  timestamp: '2026-08-05T16:45:01.000Z',
  index: 27
}
const MERGE_31: Extract<ManifestEntry, { type: 'merge' }> = {
  ...stamp,
  type: 'merge',
  heads: [{ installationId: 'inst-nk', index: 18, entryHash: 'h18', entriesReceived: 4 }],
  timestamp: '2026-09-19T14:02:11.000Z',
  index: 31
}

function snapshot(entries: ManifestEntry[]): CaseManifestSnapshot {
  return {
    caseId: 'case-1',
    entries: [...entries.map(line), { index: 99, parsed: false, reason: 'bad json' }],
    chain: { valid: true },
    signers: [],
    head: null,
    citationRule: { prefixed: true, localMemberCode: 'AR' }
  }
}

describe('hues', () => {
  it('ranks members by member-add order, keeps a revoked rank, and makes self the accent', () => {
    expect(hueFor(ROSTER, 'inst-ar', 'inst-ar')).toBe('accent')
    // TV was added first (index 23) and keeps rank 1 though revoked.
    expect(hueFor(ROSTER, 'inst-ar', 'inst-tv')).toBe(1)
    expect(hueFor(ROSTER, 'inst-ar', 'inst-nk')).toBe(2)
    expect(hueFor(ROSTER, 'inst-ar', 'inst-mb')).toBe(3)
    expect(hueFor(ROSTER, 'inst-ar', 'inst-si')).toBe(4)
    // A fifth member wraps onto the first hue.
    const fifth = member('inst-x', 'X', 'X', 40)
    expect(hueFor([...ROSTER, fifth], 'inst-ar', 'inst-x')).toBe(1)
    // The pending join takes the next free rank; without TV the ranks shift up.
    expect(nextFreeHue(ROSTER)).toBe(1)
    expect(nextFreeHue([AR, NK, MB])).toBe(3)
    expect(hueFor([AR, NK, MB], 'inst-ar', 'inst-mb')).toBe(2)
  })

  it('on a member’s replica, self is the accent and the Owner takes the slot after the members', () => {
    expect(hueFor(ROSTER, 'inst-nk', 'inst-nk')).toBe('accent')
    expect(hueFor(ROSTER, 'inst-nk', 'inst-si')).toBe(4)
    expect(hueFor(ROSTER, 'inst-nk', 'inst-ar')).toBe(1)
    expect(hueFor([AR, NK, MB], 'inst-nk', 'inst-ar')).toBe(3)
  })

  it('maps every hue to literal classes a token backs', () => {
    for (const n of [1, 2, 3, 4] as const) {
      expect(HUE_CLASSES[n]).toEqual({
        chip: `bg-member-${n}/15 border-member-${n}/30`,
        dot: `bg-member-${n}`,
        text: `text-member-${n}`
      })
    }
    expect(HUE_CLASSES.accent.dot).toBe('bg-accent')
    expect(HUE_CLASSES.faint.dot).toBe('bg-text-faint')
  })
})

describe('fingerprints, roles and labels', () => {
  it('groups the first 32 characters in fours and collapses to two groups', () => {
    expect(fingerprintGroups(FP)).toEqual([
      '9f3a',
      '1c7e',
      '44b2',
      '08d1',
      'e6a0',
      '5b93',
      '7c2f',
      'd418'
    ])
    expect(fingerprintFull(FP)).toBe('9f3a 1c7e 44b2 08d1 e6a0 5b93 7c2f d418')
    expect(fingerprintPrefix(FP)).toBe('9f3a 1c7e …')
    expect(fingerprintGroups('')).toEqual([])
  })

  it('labels roles, identity lines and Egress kinds as the mock does', () => {
    expect(roleLabel('owner', true)).toBe('Owner · you')
    expect(roleLabel('member', false)).toBe('Member')
    expect(roleLabel('member', true)).toBe('Member · you')
    expect(identityLine('owner', 'AR')).toBe('Owner · Member Code AR')
    expect(identityLine('member', 'NK')).toBe('Member · Member Code NK')
    expect(egressLabel('proxy')).toBe('Proxy')
    expect(egressLabel('tor')).toBe('Tor')
    expect(egressLabel('unavailable')).toBe('Unavailable')
    expect(egressIsNotDirect('direct')).toBe(false)
    expect(egressIsNotDirect(undefined)).toBe(false)
    for (const kind of ['proxy', 'tor', 'unavailable']) expect(egressIsNotDirect(kind)).toBe(true)
    expect(memberCount(ROSTER)).toBe(4)
  })

  it('prints clocks in UTC relative to today', () => {
    expect(formatClock('2026-09-19T14:02:11.000Z', NOW)).toBe('today 14:02')
    expect(formatClock('2026-09-18T13:52:00.000Z', NOW)).toBe('yesterday 13:52')
    expect(formatClock('2026-09-20T14:07:00.000Z', NOW)).toBe('tomorrow 14:07')
    expect(formatClock('2026-09-02T08:11:19.000Z', NOW)).toBe('2026-09-02 08:11')
    expect(formatClock('not a date', NOW)).toBe('not a date')
    expect(expiryPhrase('2026-09-20T14:07:00.000Z', NOW)).toBe('tomorrow 14:07')
    expect(expiresLine('2026-09-20T14:07:00.000Z', NOW)).toBe('Expires tomorrow 14:07')
    expect(relayUnreachableTitle('2026-09-19T13:48:00.000Z', NOW)).toBe(
      'Relay unreachable since 13:48'
    )
    expect(joinRequestLead(JO.receivedAt, NOW)).toBe('An installation used your invite from 14:07.')
  })
})

describe('memberRows', () => {
  it('shows revocation for this installation before its local connection state', () => {
    const rows = memberRows({
      members: members({ installationId: 'inst-tv', isOwner: false }),
      syncState: sync(),
      snapshot: undefined,
      nowMs: NOW
    })
    expect(rows.find((row) => row.installationId === 'inst-tv')).toMatchObject({
      dimmed: true,
      hue: 'faint',
      action: null,
      connection: { label: 'Revoked · keeps their copy', tone: 'faint', dot: 'transparent' }
    })
  })

  it('draws the Owner’s view: self, connected, syncing, offline, paused, pending and revoked', () => {
    const state = sync({
      phase: 'error',
      peersReachable: 2,
      peers: [
        peer('inst-nk', { reachable: true, lastSessionAt: '2026-09-19T14:03:00.000Z', ok: true }),
        peer('inst-mb', { reachable: false, lastSessionAt: '2026-09-19T13:41:00.000Z', ok: true }),
        peer('inst-si', {
          reachable: true,
          lastSessionAt: '2026-09-19T13:52:00.000Z',
          ok: false,
          heldHead: 3
        })
      ],
      lastError: {
        kind: 'newer-version',
        at: '2026-09-19T13:52:00.000Z',
        installationId: 'inst-si',
        index: 3
      }
    })
    const rows = memberRows({
      members: members({ pendingJoins: [JO] }),
      syncState: state,
      snapshot: snapshot([MERGE_27, EXCLUDE, REVOKE]),
      nowMs: NOW
    })
    expect(rows.map((r) => r.code)).toEqual(['TV', 'AR', 'NK', 'MB', 'SI', 'JO?'])

    const [tv, ar, nk, mb, si, jo] = rows
    expect(ar).toMatchObject({
      role: 'Owner · you',
      hue: 'accent',
      connection: { label: 'This machine', tone: 'muted', dot: 'accent', pulse: 'none' },
      lastSynced: '—',
      action: null,
      fingerprint: '9f3a 1c7e …'
    })
    expect(nk).toMatchObject({
      role: 'Member',
      hue: 2,
      connection: { label: 'Connected', tone: 'success', dot: 'success', pulse: 'none' },
      lastSynced: '2 minutes ago',
      action: 'revoke'
    })
    expect(mb).toMatchObject({
      connection: {
        label: 'Offline · last seen 24 minutes ago',
        tone: 'muted',
        dot: 'offline',
        pulse: 'none'
      },
      lastSynced: '24 minutes ago',
      action: 'revoke'
    })
    expect(si).toMatchObject({
      connection: { label: 'Paused · newer Birdbrain', tone: 'danger', dot: 'danger' },
      lastSynced: 'today 13:52 · up to SI·0003',
      action: 'revoke'
    })
    expect(si.paused).toEqual({
      lead: 'Sync with S. Idris is paused.',
      received: 'SI·0003',
      waiting: 'SI·0004',
      text:
        'Sync with S. Idris is paused. Their Birdbrain is newer than this one and wrote an entry ' +
        'this version cannot read. Received up to SI·0003; SI·0004 and later wait on their ' +
        'machine. Sync with them resumes after this computer updates. Other members are not ' +
        'affected.'
    })
    expect(jo).toMatchObject({
      kind: 'pending',
      requestId: 'req-1',
      code: 'JO?',
      name: 'J. Okafor',
      fingerprint: '7c2f d418 …',
      hue: 1,
      role: '—',
      connection: {
        label: 'Pending your approval',
        tone: 'warning',
        dot: 'warning',
        pulse: 'waiting'
      },
      lastSynced: '—',
      action: 'review'
    })
    expect(tv).toMatchObject({
      hue: 'faint',
      dimmed: true,
      connection: {
        label: 'Revoked 2026-09-02 · keeps their copy',
        tone: 'faint',
        dot: 'transparent'
      },
      lastSynced: '2026-09-02 08:11',
      action: null
    })
  })

  it('shows syncing peers while a session runs and offline with no last seen', () => {
    const rows = memberRows({
      members: members({ members: [AR, NK, MB] }),
      syncState: sync({
        phase: 'syncing',
        peersReachable: 1,
        peersTotal: 2,
        peers: [peer('inst-nk', { reachable: true }), peer('inst-mb')]
      }),
      snapshot: undefined,
      nowMs: NOW
    })
    expect(rows[1].connection).toEqual({
      label: 'Syncing',
      tone: 'secondary',
      dot: 'accent',
      pulse: 'syncing'
    })
    expect(rows[1].lastSynced).toBe('—')
    expect(rows[2].connection.label).toBe('Offline')
  })

  it('on a member’s replica hides Revoke, says Member · you, and dates no revocation', () => {
    const rows = memberRows({
      members: members({ installationId: 'inst-nk', isOwner: false }),
      syncState: undefined,
      snapshot: snapshot([]),
      nowMs: NOW
    })
    const nk = rows.find((r) => r.code === 'NK')
    const ar = rows.find((r) => r.code === 'AR')
    const tv = rows.find((r) => r.code === 'TV')
    expect(nk).toMatchObject({ role: 'Member · you', hue: 'accent', action: null })
    expect(nk?.connection.label).toBe('This machine')
    expect(ar).toMatchObject({ role: 'Owner', action: null })
    expect(ar?.connection.label).toBe('Offline')
    expect(tv?.connection.label).toBe('Revoked · keeps their copy')
    expect(tv?.lastSynced).toBe('—')
    expect(rows.every((r) => r.action !== 'revoke')).toBe(true)
  })

  it('keeps explicit chain pauses while other members sync, including a first-entry pause', () => {
    const state = sync({ phase: 'syncing', peers: [peer('inst-si', { pausedAtIndex: 0 })] })
    const rows = memberRows({
      members: members(),
      syncState: state,
      snapshot: undefined,
      nowMs: NOW
    })
    const si = rows.find((row) => row.code === 'SI')
    expect(si?.connection.label).toBe('Paused · newer Birdbrain')
    expect(si?.paused?.received).toBeNull()
    expect(si?.paused?.waiting).toBe('SI·0000')
    expect(si?.paused?.text).not.toContain('Received up to')
    expect(syncPillModel(state)).toMatchObject({
      a: 'Sync paused',
      b: 'newer version',
      chrome: 'error'
    })
  })

  it('ignores a stale case error once no explicit chain pause remains', () => {
    const rows = memberRows({
      members: members(),
      syncState: sync({
        phase: 'idle',
        lastError: { kind: 'newer-version', at: 'x', installationId: 'inst-si', index: 3 }
      }),
      snapshot: undefined,
      nowMs: NOW
    })
    expect(rows.find((r) => r.code === 'SI')?.paused).toBeNull()
    // A pause with no held head names no entries.
    expect(pausedStrip('S. Idris', 'SI', undefined)).toEqual({
      lead: 'Sync with S. Idris is paused.',
      received: null,
      waiting: null,
      text:
        'Sync with S. Idris is paused. Their Birdbrain is newer than this one and wrote an entry ' +
        'this version cannot read. Sync with them resumes after this computer updates. Other ' +
        'members are not affected.'
    })
  })
})

describe('syncPillModel', () => {
  it('is hidden with no state or no peers', () => {
    expect(syncPillModel(undefined)).toBeNull()
    expect(syncPillModel(sync({ peersTotal: 0, peersReachable: 0, peers: [] }))).toBeNull()
  })

  it('draws the mock’s idle and syncing states', () => {
    expect(syncPillModel(sync())).toEqual({
      a: 'Synced',
      b: '3 peers',
      chrome: 'idle',
      dot: 'success',
      spinner: false,
      glyph: false,
      title: 'Synced · 3 peers. Click to open Members.'
    })
    expect(syncPillModel(sync({ peersReachable: 2 }))).toMatchObject({
      a: 'Synced',
      b: '2 of 3 peers',
      chrome: 'idle',
      dot: 'warning'
    })
    expect(syncPillModel(sync({ peersReachable: 1, peersTotal: 1 }))).toMatchObject({
      b: '1 peer'
    })
    expect(
      syncPillModel(sync({ phase: 'syncing', transfer: { entries: 41, blobs: 2, bytes: 9 } }))
    ).toMatchObject({ a: 'Syncing', b: '41 entries', chrome: 'active', dot: null, spinner: true })
    expect(syncPillModel(sync({ phase: 'syncing' }))).toMatchObject({ b: '3 peers', spinner: true })
    expect(
      syncPillModel(sync({ phase: 'syncing', transfer: { entries: 1, blobs: 0, bytes: 0 } }))
    ).toMatchObject({ b: '1 entry' })
    // A peer dropped mid-sync: warning dot, no spinner (1e state table).
    expect(syncPillModel(sync({ phase: 'syncing', peersReachable: 2 }))).toMatchObject({
      a: 'Syncing',
      b: '2 of 3 peers',
      chrome: 'active',
      dot: 'warning',
      spinner: false
    })
  })

  it('tints every error kind, labels the newer version as paused, and keys on the phase', () => {
    for (const kind of SYNC_ERROR_KINDS) {
      const pill = syncPillModel(sync({ phase: 'error', lastError: { kind, at: 'x' } }))
      expect(pill).toMatchObject({ chrome: 'error', dot: 'danger', spinner: false })
      if (kind === 'newer-version') {
        expect(pill).toMatchObject({ a: 'Sync paused', b: 'newer version' })
      } else {
        expect(pill).toMatchObject({ a: 'Sync failed', b: errorKindLabel(kind) })
      }
    }
    expect(errorKindLabel('rejected-entry')).toBe('rejected entry')
    expect(errorKindLabel('hash-mismatch')).toBe('hash mismatch')
    // The error persists in the file after a later success; the phase decides.
    expect(
      syncPillModel(sync({ phase: 'idle', lastError: { kind: 'peer', at: 'x' } }))
    ).toMatchObject({ a: 'Synced', chrome: 'idle' })
    expect(syncPillModel(sync({ phase: 'error' }))).toMatchObject({
      a: 'Sync failed',
      b: 'local'
    })
  })

  it('leads with the glyph whenever the Egress is not Direct, unavailable included', () => {
    for (const egress of ['proxy', 'tor', 'unavailable'] as const) {
      expect(syncPillModel(sync({ egress }))?.glyph).toBe(true)
    }
    expect(syncPillModel(sync({ egress: 'direct' }))?.glyph).toBe(false)
  })
})

// The top bar's pill (2026-10-28 handoff, frame B) as a function of the
// platform check, the roster and the sync state.
describe('sharePillModel', () => {
  const local = members({ members: [], invites: [], pendingJoins: [] })
  const ownerOnly = members({ members: [AR] })
  const noPeers = sync({ peersTotal: 0, peersReachable: 0, peers: [] })
  const invite = (inviteId: string, expiresAt: string) => ({ inviteId, expiresAt })
  const read = (input: Partial<SharePillInput>) =>
    sharePillModel({ available: true, members: local, syncState: undefined, nowMs: NOW, ...input })

  it('is hidden until the platform check and the roster load, and while peers await a sync state', () => {
    expect(read({ available: undefined })).toBeNull()
    expect(read({ members: undefined })).toBeNull()
    expect(read({ members: members() })).toBeNull()
  })

  it('reads Share on a Case nobody has shared, and once the Owner is alone again', () => {
    expect(read({})).toEqual({
      state: 'share',
      a: 'Share',
      b: null,
      title: 'Share this Case with teammates. Opens Members.',
      dot: false,
      pulse: false,
      sync: null
    })
    expect(read({ members: ownerOnly, syncState: noPeers })?.state).toBe('share')
  })

  it('waits on the invite that expires last, and not on one already expired', () => {
    const invites = [
      invite('a', '2026-09-19T14:07:00.000Z'),
      invite('b', '2026-09-20T09:12:00.000Z')
    ]
    expect(read({ members: members({ members: [AR], invites }), syncState: noPeers })).toEqual({
      state: 'invite',
      a: 'Share',
      b: 'invite waiting',
      title: 'Invite expires tomorrow 09:12',
      dot: true,
      pulse: true,
      sync: null
    })
    const expired = [invite('a', '2026-09-19T14:04:00.000Z')]
    const pill = read({ members: members({ members: [AR], invites: expired }), syncState: noPeers })
    expect(pill?.state).toBe('share')
  })

  it('puts a join request ahead of an open invite, with a still dot', () => {
    const roster = members({
      members: [AR],
      invites: [invite('a', '2026-09-19T14:07:00.000Z')],
      pendingJoins: [JO]
    })
    expect(read({ members: roster, syncState: noPeers })).toEqual({
      state: 'approve',
      a: 'Share',
      b: '1 to approve',
      title: '1 join request to approve',
      dot: true,
      pulse: false,
      sync: null
    })
    expect(toApprove(2)).toBe('2 to approve')
    expect(joinRequestsToApprove(2)).toBe('2 join requests to approve')
  })

  it('is the sync pill once a peer is on the roster, whatever else is waiting', () => {
    const pill = read({ members: members({ pendingJoins: [JO] }), syncState: sync() })
    expect(pill?.state).toBe('synced')
    expect(pill?.sync).toEqual(syncPillModel(sync()))
    expect(pill).toMatchObject({
      a: 'Synced',
      b: '3 peers',
      title: 'Synced · 3 peers. Click to open Members.',
      dot: false,
      pulse: false
    })
  })

  it('draws the unavailable form before reading anything else', () => {
    expect(read({ available: false, members: undefined })).toEqual({
      state: 'unavailable',
      a: 'Share',
      b: null,
      title: 'Sharing is not available on this Mac.',
      dot: false,
      pulse: false,
      sync: null
    })
  })

  it('labels the palette row and the breadcrumb tooltip', () => {
    expect(shareActionLabel(false)).toBe('Share this Case…')
    expect(shareActionLabel(true)).toBe('Members…')
    expect(youAreLine('AR')).toBe('You are AR in this Case')
    expect(inviteExpires('2026-09-19T14:07:00.000Z', NOW)).toBe('Invite expires today 14:07')
  })
})

describe('memberCodeCheck', () => {
  it('upper-cases, refuses four characters and symbols, and accepts a free code', () => {
    expect(memberCodeCheck('jo', ROSTER, 'J. Okafor')).toEqual({ code: 'JO', ok: true })
    expect(memberCodeCheck('J9', ROSTER, 'J. Okafor')).toEqual({ code: 'J9', ok: true })
    expect(memberCodeCheck('mbr1', ROSTER, 'J. Okafor')).toMatchObject({
      code: 'MBR1',
      ok: false,
      reason: 'invalid',
      message: COPY.memberCodeRule
    })
    expect(memberCodeCheck('J-O', ROSTER, 'J. Okafor')).toMatchObject({ reason: 'invalid' })
    expect(memberCodeCheck('', ROSTER, 'J. Okafor')).toMatchObject({ reason: 'empty' })
  })

  it('treats a current or revoked code as taken and offers two unique alternatives', () => {
    expect(memberCodeCheck('mb', ROSTER, 'M. Brandt')).toEqual({
      code: 'MB',
      ok: false,
      reason: 'taken',
      message: 'MB is M. Brandt’s code. Try MBR or MB2.',
      takenBy: 'M. Brandt'
    })
    expect(memberCodeCheck('tv', ROSTER, 'J. Okafor')).toMatchObject({
      reason: 'taken',
      takenBy: 'T. Vance',
      message: 'TV is T. Vance’s code. Try TVJ or TV2.'
    })
    // Every alternative is itself a valid, unused code.
    for (const alt of memberCodeAlternatives('MB', ROSTER, 'M. Brandt')) {
      expect(memberCodeCheck(alt, ROSTER, 'M. Brandt')).toEqual({ code: alt, ok: true })
    }
    // A three-character code has no room for a suffix, so nothing fits and
    // the clause is dropped.
    const long = [...ROSTER, member('inst-abc', 'ABC', 'A. B. Cee', 50)]
    expect(memberCodeCheck('abc', long, 'A. B. Cee')).toMatchObject({
      message: 'ABC is A. B. Cee’s code.'
    })
    // One alternative left: the clause names it alone.
    const digits = ['NK2', 'NK3', 'NK4', 'NK5', 'NK6', 'NK7', 'NK8', 'NK9'].map((c, i) =>
      member(`inst-${c}`, c, c, 60 + i)
    )
    expect(memberCodeCheck('nk', [...ROSTER, ...digits], 'N. Kowalski')).toMatchObject({
      message: 'NK is N. Kowalski’s code. Try NKO.'
    })
    expect(
      memberCodeCheck(
        'nk',
        [...ROSTER, ...digits, member('inst-nko', 'NKO', 'N', 70)],
        'N. Kowalski'
      )
    ).toMatchObject({ message: 'NK is N. Kowalski’s code.' })
  })
})

describe('chain facts', () => {
  it('keys exclusions by Exhibit and prints the banner with or without a reason', () => {
    const facts = exclusionsOf(
      snapshot([EXCLUDE, { ...EXCLUDE, exhibitId: 'ex-2', reason: undefined, index: 33 }])
    )
    expect(facts.get('ex-nk-12')).toEqual({
      exhibitId: 'ex-nk-12',
      authorInstallationId: 'inst-nk',
      operatorName: 'A. Renner',
      timestamp: '2026-08-02T11:20:40.000Z',
      reason: 'duplicate of NK-11',
      index: 29
    })
    expect(exclusionBanner(facts.get('ex-nk-12')!)).toEqual({
      lead: 'Excluded from export',
      body:
        ' by A. Renner (Owner) on 2026-08-02 11:20 · “duplicate of NK-11”. The Exhibit stays in ' +
        'the Case and in every member’s copy; exports list it as excluded. At the last ' +
        'verification, the entry, bytes, and hash verified.',
      ref: 'exclude #0029'
    })
    expect(
      exclusionBanner(facts.get('ex-2')!).body.startsWith(
        ' by A. Renner (Owner) on 2026-08-02 11:20. '
      )
    ).toBe(true)
    expect(exclusionsOf(undefined).size).toBe(0)
  })

  it('finds the latest merge and the merge that received an entry', () => {
    const snap = snapshot([MERGE_27, MERGE_31, REVOKE])
    expect(lastMergeOf(snap, ROSTER)).toEqual({
      index: 31,
      timestamp: '2026-09-19T14:02:11.000Z',
      entriesReceived: 4,
      fromInstallationId: 'inst-nk',
      fromCode: 'NK'
    })
    expect(lastMergeOf(snapshot([REVOKE]), ROSTER)).toBeNull()
    expect(lastMergeOf(undefined, ROSTER)).toBeNull()
    expect(mergeReceiving(snap, 'inst-nk', 12)).toEqual({
      index: 27,
      timestamp: '2026-08-05T16:45:01.000Z'
    })
    expect(mergeReceiving(snap, 'inst-nk', 16)).toEqual({
      index: 31,
      timestamp: '2026-09-19T14:02:11.000Z'
    })
    expect(mergeReceiving(snap, 'inst-nk', 20)).toBeNull()
    expect(mergeReceiving(snap, 'inst-mb', 1)).toBeNull()
  })
})

describe('joinFailure', () => {
  const EXPIRES = '2026-09-20T14:07:00.000Z'

  it('draws the five rows of 1d and a fallback for any other rejection', () => {
    expect(joinFailure('invite-expired', 'A. Renner', EXPIRES, NOW, 'x')).toEqual({
      title: 'This invite has expired',
      body: 'Invites last 24 hours. Ask A. Renner for a new one.',
      action: 'paste-another',
      actionLabel: 'Paste another',
      icon: 'alert',
      tone: 'warning'
    })
    expect(joinFailure('invite-reused', 'A. Renner', EXPIRES, NOW, 'x')).toMatchObject({
      title: 'This invite was already used',
      body: 'Each invite works once. If that was not you, tell A. Renner before asking for another.',
      actionLabel: 'Paste another',
      tone: 'warning'
    })
    expect(joinFailure('owner-unreachable', 'A. Renner', EXPIRES, NOW, 'x')).toMatchObject({
      title: 'A. Renner is not online',
      body:
        'The Owner has to be running Birdbrain to approve you. The invite is still valid until ' +
        'tomorrow 14:07.',
      action: 'try-again',
      actionLabel: 'Try again',
      icon: 'wifi-off',
      tone: 'muted'
    })
    expect(joinFailure('owner-unreachable', 'A. Renner', null, NOW, 'x').body).toBe(
      'The Owner has to be running Birdbrain to approve you.'
    )
    for (const code of ['relay-unreachable', 'sharing-unavailable'] as const) {
      expect(joinFailure(code, 'A. Renner', EXPIRES, NOW, 'x')).toMatchObject({
        title: 'Cannot reach A. Renner or the relay',
        body:
          'No direct connection and the relay did not answer. Check your network; the relay URL ' +
          'is in Settings.',
        action: 'retry',
        actionLabel: 'Retry',
        icon: 'wifi-off',
        tone: 'danger'
      })
    }
    expect(joinFailure('declined', 'A. Renner', EXPIRES, NOW, 'x')).toMatchObject({
      title: 'A. Renner declined',
      body: 'Nothing was created on either machine. Contact them outside Birdbrain if this is unexpected.',
      action: 'close',
      actionLabel: 'Close',
      icon: 'x',
      tone: 'muted'
    })
    expect(
      joinFailure('case-exists', 'A. Renner', EXPIRES, NOW, 'Case already here')
    ).toMatchObject({
      title: 'Case already here',
      body: '',
      action: 'close'
    })
    expect(joinFailure(null, 'A. Renner', EXPIRES, NOW, 'disk full')).toMatchObject({
      title: 'disk full',
      action: 'close'
    })
  })
})

describe('copy', () => {
  it('interpolates the mock’s strings', () => {
    expect(networkNoticeBody('Proxy')).toBe(
      'Egress is set to Proxy. That covers captures, not sync: connections to members leave this ' +
        'computer directly. While a connection is set up, a member’s installation receives every ' +
        'network address this computer has, on every interface. A system VPN does not hide them; ' +
        'its own addresses are on that list. The relay sees the address this computer reaches it ' +
        'from. No setting changes this. If these addresses must stay private, do not share this ' +
        'Case from this computer.'
    )
    expect(networkNoticeShort('Tor')).toBe(
      'Egress is set to Tor; sync does not use it. During connection setup a member’s ' +
        'installation receives every address on this computer, including a system VPN’s own. The ' +
        'relay sees the address this computer reaches it from.'
    )
    expect(notSharedBody('AR')).toContain('Exhibit Numbers gain your Member Code (AR-7)')
    expect(yourCodeWillBe('AR')).toBe('Your Member Code will be AR')
    expect(relayUnreachableBody(['NK'], ['MB', 'SI'])).toBe(
      'Last reached: NK. Not reached: MB and SI. Try syncing again after the relay answers.'
    )
    expect(relayUnreachableBody([], ['MB'])).toBe(
      'Not reached: MB. Try syncing again after the relay answers.'
    )
    expect(relayUnreachableBody(['NK', 'MB'], ['SI', 'TV', 'JO'])).toBe(
      'Last reached: NK and MB. Not reached: SI, TV and JO. Try syncing again after the relay answers.'
    )
    expect(inviteTitle('Operation Nightjar')).toBe('Invite to Operation Nightjar')
    expect(waitingBody('2026-09-20T14:07:00.000Z', NOW)).toBe(
      'You can close this. The invite stays valid until tomorrow 14:07 or until it is used. A ' +
        'join request will appear in Members.'
    )
    expect(memberCodeHelper('JO')).toBe(
      'Their Exhibits will read JO-1, JO-2… Up to three characters, A–Z and 0–9. Cannot be ' +
        'changed after approval.'
    )
    expect(trustNote('J. Okafor')).toBe(
      'The name is what they typed into their own settings. The fingerprint identifies their ' +
        'installation. If you want to be sure this is J. Okafor, ask them to read the fingerprint ' +
        'back over a channel you already trust.'
    )
    expect(memberAddCaption(32)).toBe('Manifest entry member-add #0032 written to your chain.')
    expect(joinWaitingTitle('A. Renner')).toBe('Waiting for A. Renner to approve')
    expect(sharedByLine('A. Renner', 5)).toBe('Shared by A. Renner · 5 members')
    expect(sharedByLine('A. Renner', 1)).toBe('Shared by A. Renner · 1 member')
    expect(capturedBy(null, 'AR')).toBe('Captured by you (AR)')
    expect(capturedBy('N. Kowalski', 'NK')).toBe('Captured by N. Kowalski (NK)')
    expect(revokeTitle('S. Idris')).toBe('Revoke S. Idris?')
    expect(revokeBody('S. Idris', 'SI', [1, 2, 3])).toBe(
      'S. Idris will stop receiving updates. They keep the copy of this Case they already have. ' +
        'Their 3 Exhibits (SI-1–SI-3), notes, and tags stay in the Case, attributed to them.'
    )
    expect(revokeBody('S. Idris', 'SI', [1])).toContain('Their 1 Exhibit (SI-1), notes, and tags')
    expect(revokeBody('S. Idris', 'SI', [])).toContain(
      'already have. Their notes, and tags stay in the Case'
    )
    expect(excludeTitle('NK-12')).toBe('Exclude NK-12 from export?')
    expect(excludeBody('N. Kowalski')).toBe(
      'The Exhibit stays in the Case and in every member’s copy. Exports will list it as excluded, ' +
        'with your name and the time, rather than leave it out silently. Only N. Kowalski can ' +
        'delete it.'
    )
    expect(COPY.revokeNote).toBe(
      'Recorded in your Manifest as member-revoke. Cannot be undone; they would need a new invite.'
    )
    expect(COPY.chainNoteVerified).toBe('Verified chain · Seq is the entry index')
    expect(COPY.chainNoteTimeline).toBe('Cross-chain order is by asserted time, not verified')
  })

  // The brief's copy constraint: no unqualified assurance word on any of
  // these surfaces, and the integrity label is never 'Chain verified'. The
  // mock's one qualified use of 'private' is allowed by sentence.
  it('emits no unqualified assurance word and never says "Chain verified"', () => {
    const emitted: string[] = [
      ...Object.values(COPY).flatMap((v) => (typeof v === 'string' ? [v] : [...v])),
      networkNoticeBody('Proxy'),
      networkNoticeShort('Proxy'),
      notSharedBody('AR'),
      relayUnreachableBody(['NK'], ['MB']),
      trustNote('J. Okafor'),
      excludeBody('N. Kowalski'),
      revokeBody('S. Idris', 'SI', [1, 2, 3]),
      waitingBody('2026-09-20T14:07:00.000Z', NOW),
      inviteExpires('2026-09-20T14:07:00.000Z', NOW),
      joinRequestsToApprove(2),
      youAreLine('AR'),
      pausedStrip('S. Idris', 'SI', 3).text,
      exclusionBanner({
        exhibitId: 'x',
        authorInstallationId: 'y',
        operatorName: 'A. Renner',
        timestamp: '2026-08-02T11:20:40.000Z',
        reason: 'duplicate',
        index: 29
      }).body,
      ...SYNC_ERROR_KINDS.flatMap((kind: SyncErrorKind) => {
        const pill = syncPillModel(sync({ phase: 'error', lastError: { kind, at: 'x' } }))
        return pill ? [pill.a, pill.b, pill.title] : []
      }),
      ...SHARING_ERROR_CODES.flatMap((code) => {
        const row = joinFailure(code, 'A. Renner', '2026-09-20T14:07:00.000Z', NOW, 'x')
        return [row.title, row.body]
      })
    ]
    const allowed = new Set([
      'If these addresses must stay private, do not share this Case from this computer.'
    ])
    const forbidden = [
      /chain verified/i,
      /\bsecure\b/i,
      /end-to-end/i,
      /tamper[- ]proof/i,
      /\bguarantees?\b/i,
      /\bprivate\b/i,
      /court[- ]admissible/i
    ]
    for (const text of emitted) {
      const sentences = text.split(/(?<=\.)\s+/).filter((s) => !allowed.has(s))
      for (const sentence of sentences) {
        for (const rule of forbidden) expect(sentence).not.toMatch(rule)
      }
    }
  })
})
