import type { CaseManifestSnapshot, ManifestSnapshotEntry } from '@shared/manifestSnapshot'
import type { ManifestEntry } from '@shared/schemas'
import type {
  BirdbrainSettings,
  InventoryExhibitRow,
  SharingMember,
  SharingMembers,
  SharingPendingJoin,
  SyncPeerState,
  SyncState
} from '@shared/types'

// The mock's cast for the members screens' component tests (#1514): AR the
// Owner (self), NK, MB, SI members, TV revoked, JO a pending join. The same
// shapes tests/renderer/components/memberModel.test.ts uses.

export const CASE_ID = 'case-1'
export const FP = '9f3a1c7e44b208d1e6a05b937c2fd418' + 'ff'.repeat(16)

export function member(
  installationId: string,
  memberCode: string,
  operatorName: string,
  addedAtIndex: number,
  extra: Partial<SharingMember> = {}
): SharingMember {
  return {
    caseId: CASE_ID,
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

export const AR = member('inst-ar', 'AR', 'A. Renner', 24, { role: 'owner' })
export const NK = member('inst-nk', 'NK', 'N. Kowalski', 25)
export const MB = member('inst-mb', 'MB', 'M. Brandt', 26)
export const SI = member('inst-si', 'SI', 'S. Idris', 28)
export const TV = member('inst-tv', 'TV', 'T. Vance', 23, { revokedAtIndex: 30 })
export const ROSTER = [AR, TV, NK, MB, SI]

export const JO: SharingPendingJoin = {
  requestId: 'req-1',
  caseId: CASE_ID,
  installationId: 'inst-jo',
  operatorName: 'J. Okafor',
  fingerprint: '7c2fd4189f3a1c7e44b208d1e6a05b93' + '00'.repeat(16),
  suggestedMemberCode: 'JO',
  receivedAt: '2026-09-19T14:07:00.000Z'
}

export function members(overrides: Partial<SharingMembers> = {}): SharingMembers {
  return {
    caseId: CASE_ID,
    installationId: 'inst-ar',
    isOwner: true,
    members: ROSTER,
    invites: [],
    pendingJoins: [],
    ...overrides
  }
}

export function peer(installationId: string, extra: Partial<SyncPeerState> = {}): SyncPeerState {
  return {
    installationId,
    reachable: false,
    lastSessionAt: null,
    ok: null,
    heldHead: null,
    ...extra
  }
}

export function sync(overrides: Partial<SyncState> = {}): SyncState {
  return {
    phase: 'idle',
    peersReachable: 1,
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
  caseId: CASE_ID
}

export const REVOKE: Extract<ManifestEntry, { type: 'member-revoke' }> = {
  ...stamp,
  type: 'member-revoke',
  memberInstallationId: 'inst-tv',
  timestamp: '2026-09-02T08:11:19.000Z',
  index: 30
}

export const MERGE_31: Extract<ManifestEntry, { type: 'merge' }> = {
  ...stamp,
  type: 'merge',
  heads: [{ installationId: 'inst-nk', index: 18, entryHash: 'h18', entriesReceived: 4 }],
  timestamp: '2026-09-19T14:02:11.000Z',
  index: 31
}

function line(entry: ManifestEntry): ManifestSnapshotEntry {
  return { index: entry.index, parsed: true, entry }
}

export function snapshot(entries: ManifestEntry[] = [REVOKE, MERGE_31]): CaseManifestSnapshot {
  return {
    caseId: CASE_ID,
    entries: entries.map(line),
    chain: { valid: true },
    signers: [],
    head: null,
    citationRule: { prefixed: true, localMemberCode: 'AR' }
  }
}

export function settings(overrides: Partial<BirdbrainSettings> = {}): BirdbrainSettings {
  return {
    operatorName: 'A. Renner',
    egress: { kind: 'direct' },
    sharingRelayUrl: '',
    ...overrides
  } as BirdbrainSettings
}

export function exhibitRow(citation: string, n: number): InventoryExhibitRow {
  return {
    rowType: 'anchored',
    entity: 'exhibit',
    id: `ex-${citation}`,
    caseId: CASE_ID,
    name: `${citation}.html`,
    contentHash: 'h',
    path: null,
    sizeBytes: null,
    exists: true,
    kind: 'capture',
    origin: 'web',
    exhibitNumber: n,
    citation,
    committedAt: '2026-08-01T00:00:00.000Z',
    manifestSeq: n,
    anchored: true
  }
}

// A sharing refusal as the preload hands it over: a plain Error carrying the
// code.
export function refusal(code: string, message = `refused: ${code}`): Error {
  return Object.assign(new Error(message), { code })
}
