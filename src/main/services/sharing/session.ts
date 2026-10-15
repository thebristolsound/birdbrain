import { createHash, randomBytes } from 'crypto'
import { join } from 'path'
import type { CaseMember, SyncErrorKind } from '@shared/types'
import { canonicalStringify, verifyEntrySignature } from '@shared/verify'
import { listCaseMembers } from '@main/services/db/caseMemberRepo'
import { getInstallationId } from '@main/services/installationId'
import { signEntryHash } from '@main/services/signingKey'
import {
  head,
  readChainFileSnapshots,
  readEntries,
  readManifestSnapshot
} from '@main/services/manifest'
import { getStorageRoot } from '@main/services/storage'
import {
  CHALLENGE_BYTES,
  MessageReader,
  PeerByeError,
  ProtocolError,
  expectMessage,
  writeMessage,
  type ChainHead
} from '@main/services/sharing/messages'
import type { ByteStream } from '@main/services/sharing/transport'

// The sync session (docs/specs/2026-09-19-collaborative-cases-design.md,
// "Sync session"): pull-only, over one bidirectional stream. The dialer runs
// `pullFromPeer` and is the only side that writes anything to its replica; the
// listener runs `serveSyncSession` and answers requests from a `SyncSource`.
// Both sides prove who they are in `hello`: each signs the other's challenge
// with its installation key, and each checks the signature against the key
// the roster holds for that installation. A peer the roster does not name, or
// names as revoked, gets `bye` and nothing else; the listener re-reads its
// roster before every request, so a revocation mid-session ends the session
// at the next request.
//
// Because nothing is pushed, a peer can only offer entries, files and rows:
// what the dialer stores is decided by entryAcceptance, blobAcceptance and
// workingRows, never by anything the peer says.

// What a listening peer serves, read live at request time.
export interface SyncSource {
  installationId: string
  caseId: string
  roster(): CaseMember[]
  heads(): ChainHead[]
  sign(hex: string): string
}

export type SyncPhase = 'hello' | 'heads' | 'entries' | 'blobs' | 'rows' | 'merge'

export interface SyncError {
  kind: SyncErrorKind
  detail: string
  installationId?: string
  index?: number
}

export interface SyncSessionResult {
  // Set once the peer proved it is the roster member it claims to be.
  peerInstallationId: string | null
  entriesReceived: number
  blobsReceived: number
  bytesReceived: number
  rowsApplied: number
  // Index of the `merge` entry this session wrote, or null on a session that
  // brought no new entry.
  mergeIndex: number | null
  errors: SyncError[]
}

export interface SyncSessionOptions {
  onPhase?: (phase: SyncPhase) => void
}

// Why a listener ends a session before serving it; sent in `bye`.
export const BYE_REASONS = {
  notMember: 'not-a-member',
  revoked: 'revoked',
  unknownCase: 'unknown-case',
  ownInstallation: 'own-installation',
  badProof: 'bad-proof',
  protocol: 'protocol-error',
  done: 'done'
} as const

// The string a side signs to prove it holds the key the roster names: bound
// to the Case and to the signer, so a proof cannot be replayed into another
// Case or claimed by another member.
export function helloDigest(caseId: string, challenge: Uint8Array, signer: string): string {
  const body = {
    purpose: 'birdbrain-sync-hello',
    caseId,
    challenge: Buffer.from(challenge).toString('hex'),
    signer
  }
  return createHash('sha256').update(canonicalStringify(body)).digest('hex')
}

// The roster's reason to refuse an installation, or null when it is a member
// in good standing.
export function membershipRefusal(
  roster: CaseMember[],
  installationId: string
): typeof BYE_REASONS.notMember | typeof BYE_REASONS.revoked | null {
  const member = roster.find((m) => m.installationId === installationId)
  if (!member) return BYE_REASONS.notMember
  if (member.revokedAtIndex !== null) return BYE_REASONS.revoked
  return null
}

// Every chain head a Case directory holds: the local chain under this
// installation's id, and each other member's chain file. A lineage chain is
// a forked Case's history and is not synced.
export function caseChainHeads(caseDir: string, localInstallationId: string): ChainHead[] {
  const heads: ChainHead[] = []
  const own = readManifestSnapshot(caseDir).head
  if (own) heads.push({ installationId: localInstallationId, ...own })
  for (const chain of readChainFileSnapshots(caseDir)) {
    if (chain.sourceCaseId !== undefined) continue
    const ref = head(readEntries(chain.jsonl.toString('utf-8')))
    if (ref) heads.push({ installationId: chain.installationId, ...ref })
  }
  return heads
}

// The source a listening installation serves a Case from. Null for a Case
// nobody shared: it has no roster, so no peer could prove membership.
export function liveSyncSource(caseId: string): SyncSource | null {
  if (listCaseMembers(caseId).length === 0) return null
  const installationId = getInstallationId()
  const caseDir = join(getStorageRoot(), caseId)
  return {
    installationId,
    caseId,
    roster: () => listCaseMembers(caseId),
    heads: () => caseChainHeads(caseDir, installationId),
    sign: signEntryHash
  }
}

async function sayBye(stream: ByteStream, reason: string): Promise<void> {
  try {
    await writeMessage(stream, { t: 'bye', reason })
  } catch {
    // The peer may already be gone; the session is over either way.
  }
}

// The listening side. `sourceFor` resolves the Case the dialer names, or null
// when this installation does not share it.
export async function serveSyncSession(
  stream: ByteStream,
  sourceFor: (caseId: string) => SyncSource | null
): Promise<void> {
  const reader = new MessageReader(stream)
  try {
    const hello = await expectMessage(reader, 'hello')
    const source = sourceFor(hello.caseId)
    if (!source) return await sayBye(stream, BYE_REASONS.unknownCase)
    const peerId = hello.installationId
    if (peerId === source.installationId) return await sayBye(stream, BYE_REASONS.ownInstallation)
    const refusal = membershipRefusal(source.roster(), peerId)
    if (refusal) return await sayBye(stream, refusal)

    const challenge = randomBytes(CHALLENGE_BYTES)
    await writeMessage(stream, {
      t: 'hello',
      caseId: source.caseId,
      installationId: source.installationId,
      challenge,
      proof: source.sign(helloDigest(source.caseId, hello.challenge, source.installationId))
    })
    const { signature } = await expectMessage(reader, 'proof')
    const member = source.roster().find((m) => m.installationId === peerId)
    const expected = helloDigest(source.caseId, challenge, peerId)
    if (!member || !verifyEntrySignature(expected, signature, member.publicKeyPem)) {
      return await sayBye(stream, BYE_REASONS.badProof)
    }

    for (let message = await reader.next(); message !== null; message = await reader.next()) {
      if (message.t === 'bye') return
      // Re-read before every request: a `member-revoke` written during the
      // session ends it here, before another entry, file or row goes out.
      const refusedNow = membershipRefusal(source.roster(), peerId)
      if (refusedNow) return await sayBye(stream, refusedNow)
      switch (message.t) {
        case 'heads':
          await writeMessage(stream, { t: 'heads', heads: source.heads() })
          break
        default:
          return await sayBye(stream, BYE_REASONS.protocol)
      }
    }
  } catch (err) {
    if (err instanceof PeerByeError) return
    if (err instanceof ProtocolError) return await sayBye(stream, BYE_REASONS.protocol)
    throw err
  } finally {
    stream.close()
  }
}

// The dialing side: pulls everything the peer holds that this replica lacks.
export async function pullFromPeer(
  caseId: string,
  stream: ByteStream,
  options: SyncSessionOptions = {}
): Promise<SyncSessionResult> {
  const roster = listCaseMembers(caseId)
  if (roster.length === 0) throw new Error(`Case ${caseId} is not a Shared Case`)
  const self = getInstallationId()
  const caseDir = join(getStorageRoot(), caseId)
  const reader = new MessageReader(stream)
  const result: SyncSessionResult = {
    peerInstallationId: null,
    entriesReceived: 0,
    blobsReceived: 0,
    bytesReceived: 0,
    rowsApplied: 0,
    mergeIndex: null,
    errors: []
  }
  const fail = (kind: SyncErrorKind, detail: string): void => {
    result.errors.push({ kind, detail })
  }
  try {
    options.onPhase?.('hello')
    const challenge = randomBytes(CHALLENGE_BYTES)
    await writeMessage(stream, {
      t: 'hello',
      caseId,
      installationId: self,
      challenge,
      proof: null
    })
    const hello = await expectMessage(reader, 'hello')
    const peer = roster.find((m) => m.installationId === hello.installationId)
    const refusal = hello.caseId === caseId ? membershipRefusal(roster, hello.installationId) : null
    if (hello.caseId !== caseId) {
      fail('peer', `peer answered for Case ${hello.caseId}`)
      await sayBye(stream, BYE_REASONS.unknownCase)
      return result
    }
    if (!peer || refusal) {
      fail('peer', `peer ${hello.installationId} is ${refusal}`)
      await sayBye(stream, refusal ?? BYE_REASONS.notMember)
      return result
    }
    const expected = helloDigest(caseId, challenge, peer.installationId)
    if (hello.proof === null || !verifyEntrySignature(expected, hello.proof, peer.publicKeyPem)) {
      fail('peer', `peer ${peer.installationId} failed to prove its key`)
      await sayBye(stream, BYE_REASONS.badProof)
      return result
    }
    result.peerInstallationId = peer.installationId
    await writeMessage(stream, {
      t: 'proof',
      signature: signEntryHash(helloDigest(caseId, hello.challenge, self))
    })

    options.onPhase?.('heads')
    await writeMessage(stream, { t: 'heads', heads: caseChainHeads(caseDir, self) })
    await expectMessage(reader, 'heads')

    await sayBye(stream, BYE_REASONS.done)
  } catch (err) {
    if (err instanceof PeerByeError) {
      fail('peer', `peer ended the session: ${err.reason}`)
    } else if (err instanceof ProtocolError) {
      fail('peer', err.message)
      await sayBye(stream, BYE_REASONS.protocol)
    } else {
      throw err
    }
  } finally {
    stream.close()
  }
  return result
}
