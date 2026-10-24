import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync
} from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { SYNC_ERROR_KINDS, type SyncState } from '@shared/types'
import { listCaseMembers } from '@main/services/db/caseMemberRepo'
import { listSharedCaseIds } from '@main/services/db/caseRepo'
import { getInstallationId } from '@main/services/installationId'
import { getSettings } from '@main/services/settings'
import { getStorageRoot } from '@main/services/storage'

// The two derived files a Shared Case directory carries beside the chains
// (docs/specs/2026-09-19-collaborative-cases-design.md, "Case directory"),
// and the payload `sharing:getSyncState` serves (item 21 of the members
// feasibility assessment, widened by `newer-version`). Neither file is
// evidence: `members.json` is a cache of the roster the Owner's chain states,
// rebuilt from `case_members`, and `sync-state.json` is what this replica
// remembers of its sessions.
//
// `sync-state.json` also holds the restore-safe high-water mark of the
// versions this installation gave its working-layer rows. A database restore
// (dbRestore.ts, dbSnapshots.ts) reverts the database and nothing else, so
// after one the rows' own maximum can sit below versions peers already hold;
// a write that reused one of those would be ignored by every peer as old.
// The mark lives outside the database, in every Shared Case's directory, and
// a new version is always above it (workingRows.ts, allocateLocalVersion).

export const SYNC_STATE_FILENAME = 'sync-state.json'
export const MEMBERS_FILENAME = 'members.json'

const ChainHeadRefSchema = z
  .object({ index: z.number().int().nonnegative(), entryHash: z.string() })
  .strict()

const PeerStateSchema = z
  .object({
    lastSessionAt: z.string(),
    // Whether that session completed without an error.
    ok: z.boolean(),
    // The heads this replica held after it, by chain.
    heads: z.record(z.string(), ChainHeadRefSchema)
  })
  .strict()

const SyncStateFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    localVersionHighWater: z.number().int().nonnegative(),
    lastSuccessAt: z.string().nullable(),
    transfer: z
      .object({
        entries: z.number().int().nonnegative(),
        blobs: z.number().int().nonnegative(),
        bytes: z.number().int().nonnegative()
      })
      .strict()
      .nullable(),
    lastError: z
      .object({ kind: z.enum(SYNC_ERROR_KINDS), at: z.string(), detail: z.string() })
      .strict()
      .nullable(),
    peers: z.record(z.string(), PeerStateSchema),
    // Each member's last-known transport ticket, by installation id (#1810):
    // learned from the member's `join` on the Owner, from `welcome` on a
    // joiner, and what Sync now dials. Defaulted so a file written before
    // the field existed still reads.
    tickets: z.record(z.string(), z.string()).default({})
  })
  .strict()

export type SyncStateFile = z.infer<typeof SyncStateFileSchema>

const EMPTY_STATE: SyncStateFile = {
  schemaVersion: 1,
  localVersionHighWater: 0,
  lastSuccessAt: null,
  transfer: null,
  lastError: null,
  peers: {},
  tickets: {}
}

// Reads a Case's sync state; the empty state when the file is absent. A file
// that is present but unreadable throws rather than reading as empty: the
// high-water mark it holds is what keeps a restored database from reusing a
// version, and losing it silently is the failure it exists to prevent.
export function readSyncStateFile(caseDir: string): SyncStateFile {
  const path = join(caseDir, SYNC_STATE_FILENAME)
  if (!existsSync(path)) return { ...EMPTY_STATE, peers: {}, tickets: {} }
  const parsed = SyncStateFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf-8')))
  if (!parsed.success) throw new Error(`${path} is not a sync state file this build reads`)
  return parsed.data
}

// Written whole to a temporary name, fsynced and renamed into place, so the
// file under the name is always a complete one: a reader never sees a
// partial file, and a crash after the rename cannot leave an empty one. A
// sync state file that does not parse throws from version allocation, which
// blocks every working-layer write in every Case until the file is repaired
// or removed, so the write is made durable before it takes the name.
function writeWhole(path: string, text: string): void {
  const partial = `${path}.partial`
  const fd = openSync(partial, 'w')
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(partial, path)
}

export function writeSyncStateFile(caseDir: string, state: SyncStateFile): void {
  mkdirSync(caseDir, { recursive: true })
  writeWhole(join(caseDir, SYNC_STATE_FILENAME), JSON.stringify(state, null, 2) + '\n')
}

function sharedCaseDirs(): string[] {
  const ids = listSharedCaseIds()
  if (ids.size === 0) return []
  const root = getStorageRoot()
  return [...ids].map((id) => join(root, id))
}

// The highest version this installation is known to have given a row, from
// every Shared Case's file. 0 when no Case is shared.
export function localVersionHighWater(): number {
  let mark = 0
  for (const caseDir of sharedCaseDirs()) {
    mark = Math.max(mark, readSyncStateFile(caseDir).localVersionHighWater)
  }
  return mark
}

// Records that `version` was given to a row, in every Shared Case's file: a
// row's Case is not always known at allocation (a tag has none), and a peer
// of any Shared Case may come to hold the version.
export function recordLocalVersion(version: number): void {
  for (const caseDir of sharedCaseDirs()) {
    const state = readSyncStateFile(caseDir)
    if (state.localVersionHighWater >= version) continue
    writeSyncStateFile(caseDir, { ...state, localVersionHighWater: version })
  }
}

// Sessions running in this process, by Case: what `phase` reads as syncing.
const running = new Map<string, number>()
// Peers whose latest session dialled from this process completed `hello`, by
// Case: what `peersReachable` counts. A session adds its peer here once the
// peer's proof verifies; the sharing service forgets one whose next attempt
// does not get that far (forgetReached).
const reached = new Map<string, Set<string>>()

export function beginSession(caseId: string): void {
  running.set(caseId, (running.get(caseId) ?? 0) + 1)
}

export interface SessionOutcome {
  peerInstallationId: string | null
  transfer: { entries: number; blobs: number; bytes: number }
  // The first error, when the session had one.
  error: {
    kind: SyncState['lastError'] extends infer E ? (E extends { kind: infer K } ? K : never) : never
    detail: string
  } | null
  heads: Record<string, { index: number; entryHash: string }>
}

// Records a finished session in the Case's file: the transfer, the error if
// any, and the peer's last session.
export function finishSession(caseId: string, outcome: SessionOutcome): void {
  const count = (running.get(caseId) ?? 1) - 1
  if (count > 0) running.set(caseId, count)
  else running.delete(caseId)
  const now = new Date().toISOString()
  const { peerInstallationId, transfer, error, heads } = outcome
  if (peerInstallationId !== null) {
    const peers = reached.get(caseId) ?? new Set<string>()
    peers.add(peerInstallationId)
    reached.set(caseId, peers)
  }
  const caseDir = join(getStorageRoot(), caseId)
  const state = readSyncStateFile(caseDir)
  const peers = { ...state.peers }
  if (peerInstallationId !== null) {
    peers[peerInstallationId] = { lastSessionAt: now, ok: error === null, heads }
  }
  writeSyncStateFile(caseDir, {
    ...state,
    lastSuccessAt: error === null ? now : state.lastSuccessAt,
    transfer,
    lastError:
      error === null ? state.lastError : { kind: error.kind, at: now, detail: error.detail },
    peers
  })
}

// Drops one peer from the Case's reached set: its latest dialled session did
// not complete `hello` (#1881).
export function forgetReached(caseId: string, installationId: string): void {
  reached.get(caseId)?.delete(installationId)
}

// Records members' tickets in the Case's file, replacing any held for the
// same installation. A member whose relay changes is dialed at its old ticket
// until something refreshes it here.
export function rememberMemberTickets(caseId: string, tickets: Record<string, string>): void {
  const caseDir = join(getStorageRoot(), caseId)
  const state = readSyncStateFile(caseDir)
  writeSyncStateFile(caseDir, { ...state, tickets: { ...state.tickets, ...tickets } })
}

export function memberTickets(caseId: string): Record<string, string> {
  return { ...readSyncStateFile(join(getStorageRoot(), caseId)).tickets }
}

// The payload the sync pill and the Members tab read. `peersTotal` is the
// roster less this installation and the revoked; `peersReachable` the peers
// whose latest session dialled from this process completed `hello`; `phase`
// is syncing while a session runs, error when the last session failed and
// none has succeeded since, idle otherwise; `egress` the Egress kind, which
// sync runs past (ADR-0032 rule 1). `peers` and `lastSuccessAt` are read off
// the file as written (#1514); nothing here is a new fact about a session.
export function getSyncState(caseId: string): SyncState {
  const self = getInstallationId()
  const members = listCaseMembers(caseId).filter(
    (m) => m.installationId !== self && m.revokedAtIndex === null
  )
  const state = readSyncStateFile(join(getStorageRoot(), caseId))
  const { lastError, lastSuccessAt, transfer } = state
  const failed = lastError !== null && (lastSuccessAt === null || lastError.at > lastSuccessAt)
  const reachedIds = reached.get(caseId) ?? new Set<string>()
  const peers = members.map(({ installationId }) => {
    const peer = state.peers[installationId]
    return {
      installationId,
      reachable: reachedIds.has(installationId),
      lastSessionAt: peer?.lastSessionAt ?? null,
      ok: peer?.ok ?? null,
      heldHead: peer?.heads[installationId]?.index ?? null
    }
  })
  return {
    phase: running.has(caseId) ? 'syncing' : failed ? 'error' : 'idle',
    peersReachable: [...reachedIds].filter((id) => members.some((m) => m.installationId === id))
      .length,
    peersTotal: members.length,
    peers,
    transfer,
    lastSuccessAt,
    lastError: lastError === null ? null : describeLastError(lastError, state.peers),
    egress: getSettings().egress.kind
  }
}

// The failed session's peer, when the file records one: finishSession writes
// the error's `at` and that peer's `lastSessionAt` from the same clock read,
// with `ok: false`, so the pair identifies the session. The index is the head
// of the peer's own chain this replica held after it, which for a
// `newer-version` pause is the last entry received.
function describeLastError(
  { kind, at }: NonNullable<SyncStateFile['lastError']>,
  peers: SyncStateFile['peers']
): NonNullable<SyncState['lastError']> {
  const match = Object.entries(peers).find(([, peer]) => peer.lastSessionAt === at && !peer.ok)
  if (!match) return { kind, at }
  const [installationId, peer] = match
  const index = peer.heads[installationId]?.index
  return index === undefined ? { kind, at, installationId } : { kind, at, installationId, index }
}

// `members.json`: the roster as `case_members` holds it, for a reader of the
// Case directory. The screens keep reading `case_members`.
export function writeMembersFile(caseId: string): void {
  const caseDir = join(getStorageRoot(), caseId)
  mkdirSync(caseDir, { recursive: true })
  const members = listCaseMembers(caseId).map(
    ({
      installationId,
      publicKeyPem,
      memberCode,
      operatorName,
      nodeId,
      role,
      addedAtIndex,
      revokedAtIndex
    }) => ({
      installationId,
      publicKeyPem,
      memberCode,
      operatorName,
      nodeId,
      role,
      addedAtIndex,
      revokedAtIndex
    })
  )
  writeWhole(
    join(caseDir, MEMBERS_FILENAME),
    JSON.stringify({ caseId, writtenAt: new Date().toISOString(), members }, null, 2) + '\n'
  )
}

// For tests: forgets the sessions and peers this process has seen.
export function resetSyncStateMemory(): void {
  running.clear()
  reached.clear()
}
