import { createHash, createSign } from 'crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { MANIFEST_FILENAME } from '@shared/constants'
import { ManifestEntrySchema, type ManifestEntry } from '@shared/schemas'
import { canonicalStringify } from '@shared/verify'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { getStorageRoot, initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import {
  getPublicKeyPem,
  initSigningKey,
  resetSigningKey,
  signEntryHash
} from '@main/services/signingKey'
import {
  appendManifestEntry,
  getManifestHead,
  initManifest,
  readMemberChainText
} from '@main/services/manifest'
import { MemoryHub } from '@main/services/sharing/transport'
import {
  liveSyncSource,
  pullFromPeer,
  serveSyncSession,
  type SyncSessionOptions,
  type SyncSessionResult,
  type SyncSource
} from '@main/services/sharing/session'
import type { ChainHead } from '@main/services/sharing/messages'
import type { CaseMember } from '@shared/types'

// n installations in one process (#1512). The main-process services are
// module singletons (database, storage root, installation id, signing key,
// settings), so one peer is active at a time: `activate` switches every
// singleton to that peer's files. A session's dialing side runs on the active
// peer, against real files and a real database; its listening side answers
// from a `SyncSource` recorded off another peer while that peer was active,
// through the same live source the app serves from.

export interface Peer {
  name: string
  operatorName: string
  memberCode: string
  // The user-data directory: installation id, signing keys, settings.
  dir: string
  storageRoot: string
  dbPath: string
  installationId: string
  publicKeyPem: string
  privateKeyPem: string
}

export async function activate(peer: Peer): Promise<void> {
  closeDatabase()
  await initDatabase(peer.dbPath)
  initStorage(peer.storageRoot)
  resetInstallationId()
  initInstallationId(peer.dir)
  resetSigningKey()
  initSigningKey(peer.dir, { confirmUnprotectedKey: () => true })
  initSettings(peer.dir)
  updateSettings({ operatorName: peer.operatorName })
}

// Creates a peer under `root` and leaves it active.
export async function createPeer(
  root: string,
  name: string,
  operatorName: string,
  memberCode: string
): Promise<Peer> {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const peer: Peer = {
    name,
    operatorName,
    memberCode,
    dir,
    storageRoot: join(dir, 'captures'),
    dbPath: join(dir, 'birdbrain.db'),
    installationId: '',
    publicKeyPem: '',
    privateKeyPem: ''
  }
  await activate(peer)
  peer.installationId = getInstallationId()
  peer.publicKeyPem = getPublicKeyPem()
  // Plaintext under the test runner: there is no OS credential store to wrap it.
  peer.privateKeyPem = readFileSync(join(dir, 'signing-key.pem'), 'utf-8')
  return peer
}

export function memberOf(
  caseId: string,
  peer: Peer,
  role: 'owner' | 'member',
  addedAtIndex: number
): CaseMember {
  return {
    caseId,
    installationId: peer.installationId,
    publicKeyPem: peer.publicKeyPem,
    memberCode: peer.memberCode,
    operatorName: peer.operatorName,
    nodeId: `node-${peer.name}`,
    role,
    addedAtIndex,
    revokedAtIndex: null
  }
}

// On the active peer: the Case row, its directory, and the roster cache.
export function seedSharedCase(caseId: string, owner: Peer, members: Peer[]): void {
  const now = '2026-10-01T00:00:00.000Z'
  getDb()
    .prepare(
      `INSERT INTO cases (id, name, description, type, created_at, updated_at, shared_at, owner_installation_id)
       VALUES (?, 'Shared', NULL, 'custom', ?, ?, ?, ?)`
    )
    .run(caseId, now, now, now, owner.installationId)
  mkdirSync(join(getStorageRoot(), caseId), { recursive: true })
  upsertCaseMember(memberOf(caseId, owner, 'owner', 0))
  members.forEach((peer, at) => upsertCaseMember(memberOf(caseId, peer, 'member', at + 1)))
}

export const TIME = '2026-10-02T09:00:00.000Z'

export const caseDirOf = (caseId: string): string => join(getStorageRoot(), caseId)

// Appends one entry to the active peer's own chain, filling index, prevHash,
// hash and signature the way appendManifestEntry does: for the schema-4
// membership entries, which the app has no writer for until the invite flow
// lands (#1810).
export function appendOwnChainLine(
  caseId: string,
  body: Record<string, unknown>
): { index: number; entryHash: string } {
  const caseDir = caseDirOf(caseId)
  initManifest(caseDir)
  const { prevHash, nextIndex } = getManifestHead(caseDir)
  const full = { ...body, index: nextIndex, prevHash }
  const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
  const line = JSON.stringify({ ...full, entryHash, signature: signEntryHash(entryHash) })
  appendFileSync(join(caseDir, MANIFEST_FILENAME), line + '\n')
  return { index: nextIndex, entryHash }
}

const by = (peer: Peer) => ({
  operatorId: peer.installationId,
  operatorName: peer.operatorName,
  toolVersion: '0.0.0'
})

export function memberAddBody(
  caseId: string,
  member: Peer,
  role: 'owner' | 'member',
  owner: Peer
): Record<string, unknown> {
  return {
    type: 'member-add',
    caseId,
    memberInstallationId: member.installationId,
    memberPublicKeyPem: member.publicKeyPem,
    memberCode: member.memberCode,
    memberOperatorName: member.operatorName,
    nodeId: `node-${member.name}`,
    role,
    timestamp: TIME,
    ...by(owner),
    schemaVersion: 4
  }
}

export function memberRevokeBody(
  caseId: string,
  member: Peer,
  owner: Peer
): Record<string, unknown> {
  return {
    type: 'member-revoke',
    caseId,
    memberInstallationId: member.installationId,
    timestamp: TIME,
    ...by(owner),
    schemaVersion: 4
  }
}

export interface Document {
  exhibitId: string
  path: string
  contentHash: string
  index: number
}

// One document Exhibit committed by the active peer: its bytes on disk under
// the Case directory and the signed `exhibit` entry on its chain.
export function addDocument(caseId: string, peer: Peer, n: number, content?: string): Document {
  const exhibitId = `${peer.name}-doc-${n}`
  const path = `${caseId}/documents/${exhibitId}.pdf`
  const bytes = Buffer.from(content ?? `%PDF statement ${n} by ${peer.name}`)
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const abs = join(getStorageRoot(), path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  const caseDir = caseDirOf(caseId)
  initManifest(caseDir)
  const { index } = appendManifestEntry(caseDir, {
    type: 'exhibit',
    exhibitId,
    caseId,
    kind: 'document',
    origin: 'manual-upload',
    name: `${exhibitId}.pdf`,
    exhibitNumber: n,
    path,
    contentHash,
    sizeBytes: bytes.length,
    timestamp: TIME,
    ...by(peer)
  })
  return { exhibitId, path, contentHash, index }
}

// '' before the peer wrote its first entry.
export const ownChainText = (caseId: string): string => {
  const path = join(caseDirOf(caseId), MANIFEST_FILENAME)
  return existsSync(path) ? readFileSync(path, 'utf-8') : ''
}

export const memberChainText = (caseId: string, peer: Peer): string =>
  readMemberChainText(caseDirOf(caseId), peer.installationId)

export function parsedChain(text: string): ManifestEntry[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => ManifestEntrySchema.parse(JSON.parse(line)))
}

export const mergeEntries = (caseId: string): Array<Extract<ManifestEntry, { type: 'merge' }>> =>
  parsedChain(ownChainText(caseId)).filter((e) => e.type === 'merge')

// What a peer serves, captured while that peer is active so another peer can
// dial it afterwards. Every read goes through the live source the app serves
// from; the capture is of its answers. `members` is the roster the listener
// re-reads before every request, and `chains` the lines it serves, so a test
// can change either between sessions or mid-session.
export interface RecordedSource extends SyncSource {
  members: CaseMember[]
  chains: Map<string, string[]>
}

export function recordSource(caseId: string, peer: Peer): RecordedSource {
  const live = liveSyncSource(caseId)
  if (!live) throw new Error(`Case ${caseId} is not shared on ${peer.name}`)
  const chains = new Map<string, string[]>()
  for (const { installationId } of live.heads()) {
    chains.set(installationId, live.chainLines(installationId, 0))
  }
  const source: RecordedSource = {
    installationId: live.installationId,
    caseId,
    members: live.roster(),
    chains,
    roster: () => source.members,
    heads: (): ChainHead[] =>
      [...source.chains].flatMap(([installationId, lines]) => {
        const last = lines.at(-1)
        if (last === undefined) return []
        const { index, entryHash } = JSON.parse(last) as { index: number; entryHash: string }
        return [{ installationId, index, entryHash }]
      }),
    chainLines: (installationId, fromIndex) =>
      (source.chains.get(installationId) ?? []).slice(fromIndex),
    sign: (hex) => createSign('sha256').update(hex).sign(peer.privateKeyPem, 'base64')
  }
  return source
}

// One session: the active peer dials a listener answering from `source`.
export async function pull(
  caseId: string,
  source: SyncSource,
  options: SyncSessionOptions = {}
): Promise<SyncSessionResult> {
  const hub = new MemoryHub({ chunkSize: 4096 })
  const dialer = hub.createTransport('dialer')
  const listener = hub.createTransport('listener')
  const served = new Promise<void>((resolve, reject) => {
    void listener.listen((stream) => {
      serveSyncSession(stream, (id) => (id === source.caseId ? source : null)).then(resolve, reject)
    })
  })
  const stream = await dialer.openStream(await dialer.dial(listener.ticket))
  const result = await pullFromPeer(caseId, stream, options)
  await served
  return result
}
