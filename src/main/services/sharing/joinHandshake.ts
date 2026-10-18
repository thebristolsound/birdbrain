import { createHash, createPublicKey, randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { MEMBER_CODE_PATTERN } from '@shared/schemas'
import type { CaseMember, SharingJoinStep, SharingPendingJoin } from '@shared/types'
import { canonicalStringify, verifyEntrySignature } from '@shared/verify'
import { suggestMemberCode } from '@shared/memberCode'
import { withTransaction } from '@main/services/db/core'
import { upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createJoinedCase, getCase } from '@main/services/db/caseRepo'
import { getInstallationId } from '@main/services/installationId'
import { initManifest } from '@main/services/manifest'
import { getStorageRoot } from '@main/services/storage'
import { SharingError } from '@main/services/sharing/errors'
import type { InviteFields } from '@main/services/sharing/invite'
import type { InviteRegistry } from '@main/services/sharing/inviteRegistry'
import type { JoiningMember } from '@main/services/sharing/membership'
import {
  MAX_HANDSHAKE_FRAME_BYTES,
  MessageReader,
  PeerByeError,
  ProtocolError,
  expectMessage,
  writeMessage,
  type SyncMessage,
  type SyncMessageOf,
  type WelcomeMember
} from '@main/services/sharing/messages'
import { rememberMemberTickets, writeMembersFile } from '@main/services/sharing/syncState'
import {
  PeerUnreachableError,
  type ByteStream,
  type Connection,
  type Transport
} from '@main/services/sharing/transport'

// The join handshake (#1810, docs/specs/2026-09-19-collaborative-cases-design.md
// "Invite and join"), on a stream of its own. The Owner's side (`JoinServer`)
// reads `join`, verifies the signature over the invite's secret bound to THIS
// node, claims the invite, and holds the join until the Owner approves or
// declines it from the members screen; approval writes `member-add` through
// the roster writer and answers `welcome`. The joiner's side (`requestJoin`)
// writes nothing: it dials the invite's ticket, signs over the node id the
// transport reached, and checks the `welcome` before `adoptWelcome` creates
// the Case under the Owner's id.
//
// What the signature proves: the joiner held the key it offered and addressed
// this Owner's node, so a join relayed through another node fails here and
// leaves the invite open. What it does not prove: who sat at the joiner's
// machine. Over MemoryTransport nothing authenticates the node id itself;
// Iroh does.

export type WelcomeMessage = SyncMessageOf<'welcome'>

// The string a joiner signs: the design's `secret || ownerNodeId`, bound the
// way `helloDigest` binds a hello proof, to a purpose, the Case and the
// signer, so a join signature never passes as a hello proof or an entry
// signature, and never for another Case or another joiner.
export function joinDigest(
  caseId: string,
  secret: Uint8Array,
  ownerNodeId: string,
  signer: string
): string {
  const body = {
    purpose: 'birdbrain-invite-join',
    caseId,
    secret: Buffer.from(secret).toString('hex'),
    ownerNodeId,
    signer
  }
  return createHash('sha256').update(canonicalStringify(body)).digest('hex')
}

// SHA-256 of a PEM public key's DER form, so the same key fingerprints the
// same through two encodings (exhibits.ts); null when the key does not parse.
export function fingerprintPem(pem: string): string | null {
  try {
    const der = createPublicKey(pem).export({ type: 'spki', format: 'der' })
    return createHash('sha256').update(der).digest('hex')
  } catch {
    return null
  }
}

function samePem(a: string, b: string): boolean {
  const normalize = (pem: string): string => pem.replace(/\r\n/g, '\n').trim()
  return normalize(a) === normalize(b)
}

export interface JoinServerDeps {
  // This transport's node id: what a join signature must be bound to.
  nodeId: string
  registry: InviteRegistry
  roster: (caseId: string) => CaseMember[]
  caseName: (caseId: string) => string | undefined
  addMember: (caseId: string, joiner: JoiningMember) => Promise<CaseMember>
  // Every member's ticket this installation knows, its own included.
  tickets: (caseId: string) => Record<string, string>
  rememberTicket: (caseId: string, installationId: string, ticket: string) => void
  // Fired when an invite, pending join or roster changes.
  onChanged: (caseId: string) => void
}

type Decision = 'approved' | 'declined' | 'left'

interface PendingJoin extends SharingPendingJoin {
  publicKeyPem: string
  nodeId: string
  ticket: string
  stream: ByteStream
  open: boolean
  settle: (decision: Decision) => void
}

export class JoinServer {
  private readonly pending = new Map<string, PendingJoin>()

  constructor(private readonly deps: JoinServerDeps) {}

  // The Owner's side of one join stream. Nothing a joiner sends is larger
  // than a `join`, so every frame stays under the handshake cap.
  async serve(stream: ByteStream, peerNodeId: string): Promise<void> {
    const { deps } = this
    const reader = new MessageReader(stream, MAX_HANDSHAKE_FRAME_BYTES)
    let caseId: string | undefined
    let requestId: string | undefined
    const refuse = async (reason: SyncMessageOf<'join-refused'>['reason']): Promise<void> => {
      await writeMessage(stream, { t: 'join-refused', reason })
    }
    try {
      const join = await expectMessage(reader, 'join')
      caseId = join.caseId
      const expected = joinDigest(join.caseId, join.secret, deps.nodeId, join.installationId)
      if (!verifyEntrySignature(expected, join.signature, join.publicKeyPem)) {
        return await refuse('join-signature-invalid')
      }
      // Before the claim, so an existing member's mistaken join does not use
      // the invite up.
      const roster = deps.roster(join.caseId)
      const held = roster.some(
        (m) =>
          m.installationId === join.installationId || samePem(m.publicKeyPem, join.publicKeyPem)
      )
      if (held) return await refuse('already-member')
      try {
        deps.registry.claim(join.caseId, join.secret)
      } catch (err) {
        if (err instanceof SharingError) return await refuse(err.code)
        throw err
      }
      requestId = randomUUID()
      const decided = new Promise<Decision>((resolve) => {
        const pending: PendingJoin = {
          requestId: requestId!,
          caseId: join.caseId,
          installationId: join.installationId,
          operatorName: join.operatorName,
          fingerprint: fingerprintPem(join.publicKeyPem) ?? '',
          suggestedMemberCode: suggestMemberCode(
            join.operatorName,
            roster.map((m) => m.memberCode)
          ),
          receivedAt: new Date().toISOString(),
          publicKeyPem: join.publicKeyPem,
          nodeId: peerNodeId,
          ticket: join.ticket,
          stream,
          open: true,
          settle: resolve
        }
        this.pending.set(requestId!, pending)
      })
      await writeMessage(stream, { t: 'join-pending' })
      deps.onChanged(join.caseId)
      // The joiner sends nothing more until it is answered: the next read
      // resolves only when it closed the stream or broke the protocol, and
      // either ends the join.
      const left = reader.next().then(
        () => 'left' as const,
        () => 'left' as const
      )
      const decision = await Promise.race([decided, left])
      const pending = this.pending.get(requestId)
      if (pending) pending.open = false
      if (decision === 'declined') await refuse('declined')
    } catch (err) {
      if (err instanceof PeerByeError) return
      if (err instanceof ProtocolError) return
      throw err
    } finally {
      if (requestId !== undefined) this.pending.delete(requestId)
      stream.close()
      if (caseId !== undefined) deps.onChanged(caseId)
    }
  }

  pendingJoins(caseId: string): SharingPendingJoin[] {
    return [...this.pending.values()]
      .filter((p) => p.caseId === caseId && p.open)
      .map(
        ({
          requestId,
          installationId,
          operatorName,
          fingerprint,
          suggestedMemberCode,
          receivedAt
        }) => ({
          requestId,
          caseId,
          installationId,
          operatorName,
          fingerprint,
          suggestedMemberCode,
          receivedAt
        })
      )
  }

  private pendingOrThrow(caseId: string, requestId: string): PendingJoin {
    const pending = this.pending.get(requestId)
    if (pending === undefined || pending.caseId !== caseId || !pending.open) {
      throw new SharingError('join-request-unknown')
    }
    return pending
  }

  // Writes the `member-add` with the code the Owner entered and answers
  // `welcome`. A refused code leaves the join pending. The `member-add`
  // stands once written: if the joiner left between the check and the
  // `welcome`, the Owner revokes it from the members screen.
  async approve(caseId: string, requestId: string, memberCode: string): Promise<CaseMember> {
    const { deps } = this
    const pending = this.pendingOrThrow(caseId, requestId)
    const member = await deps.addMember(caseId, {
      installationId: pending.installationId,
      publicKeyPem: pending.publicKeyPem,
      operatorName: pending.operatorName,
      nodeId: pending.nodeId,
      memberCode
    })
    deps.rememberTicket(caseId, pending.installationId, pending.ticket)
    const roster = deps.roster(caseId)
    const owner = roster.find((m) => m.role === 'owner')
    await writeMessage(pending.stream, {
      t: 'welcome',
      caseId,
      caseName: deps.caseName(caseId) ?? 'Shared Case',
      ownerPublicKeyPem: owner?.publicKeyPem ?? '',
      roster: roster.map(
        ({
          installationId,
          publicKeyPem,
          memberCode: code,
          operatorName,
          nodeId,
          role,
          addedAtIndex,
          revokedAtIndex
        }) => ({
          installationId,
          publicKeyPem,
          memberCode: code,
          operatorName,
          nodeId,
          role,
          addedAtIndex,
          revokedAtIndex
        })
      ),
      tickets: deps.tickets(caseId)
    })
    pending.settle('approved')
    return member
  }

  async decline(caseId: string, requestId: string): Promise<void> {
    this.pendingOrThrow(caseId, requestId).settle('declined')
  }
}

export interface JoinIdentity {
  installationId: string
  publicKeyPem: string
  operatorName: string
  sign: (hex: string) => string
}

export interface JoinRequest {
  transport: Transport
  invite: InviteFields
  identity: JoinIdentity
  onStep?: (step: SharingJoinStep) => void
}

export interface JoinOutcome {
  welcome: WelcomeMessage
  // The connection the join came over, for the first sync session.
  connection: Connection
}

// Why a `welcome` is refused, or null when it names this joiner on a roster
// with one Owner holding the key offered.
export function welcomeProblem(
  welcome: WelcomeMessage,
  invite: InviteFields,
  identity: Pick<JoinIdentity, 'installationId' | 'publicKeyPem'>
): string | null {
  if (welcome.caseId !== invite.caseId) return 'welcome names another Case'
  const owners = welcome.roster.filter((m) => m.role === 'owner')
  if (owners.length !== 1) return `welcome names ${owners.length} Owners`
  if (!samePem(owners[0].publicKeyPem, welcome.ownerPublicKeyPem)) {
    return "the Owner's roster key is not the key the welcome offers"
  }
  const self = welcome.roster.find((m) => m.installationId === identity.installationId)
  if (self === undefined || !samePem(self.publicKeyPem, identity.publicKeyPem)) {
    return 'the roster does not name this installation under its key'
  }
  if (self.role !== 'member' || self.revokedAtIndex !== null) {
    return 'the roster does not name this installation as a member'
  }
  if (welcome.roster.some((m) => !MEMBER_CODE_PATTERN.test(m.memberCode))) {
    return 'a Member Code is not one to three characters from A-Z and 0-9'
  }
  return null
}

async function nextAnswer(reader: MessageReader): Promise<SyncMessage> {
  const message = await reader.next()
  if (message === null) throw new ProtocolError('Stream ended during the join')
  if (message.t === 'bye') throw new PeerByeError(message.reason)
  return message
}

// The joiner's side. Writes nothing; the caller adopts the `welcome`.
export async function requestJoin(request: JoinRequest): Promise<JoinOutcome> {
  const { transport, invite, identity, onStep } = request
  // The Owner's clock still decides for any join that reaches it.
  if (Date.now() >= Date.parse(invite.expiresAt)) throw new SharingError('invite-expired')
  onStep?.('connecting')
  let connection: Connection
  try {
    connection = await transport.dial(invite.ticket)
  } catch (err) {
    if (err instanceof PeerUnreachableError) throw new SharingError('owner-unreachable')
    throw err
  }
  const stream = await transport.openStream(connection)
  try {
    const reader = new MessageReader(stream)
    // Signed over the node the transport reached, not a node id read out of
    // the ticket: the signature then binds the join to the node answering.
    const { peerNodeId } = connection
    const digest = joinDigest(invite.caseId, invite.secret, peerNodeId, identity.installationId)
    await writeMessage(stream, {
      t: 'join',
      caseId: invite.caseId,
      secret: invite.secret,
      installationId: identity.installationId,
      publicKeyPem: identity.publicKeyPem,
      operatorName: identity.operatorName,
      ticket: transport.ticket,
      signature: identity.sign(digest)
    })
    // A refusal can come first (the invite or the signature) or instead of
    // the welcome (a decline), so each answer is read by type.
    const first = await nextAnswer(reader)
    if (first.t === 'join-refused') throw new SharingError(first.reason)
    if (first.t !== 'join-pending') {
      throw new ProtocolError(`Expected join-pending, received ${first.t}`)
    }
    onStep?.('waiting')
    const second = await nextAnswer(reader)
    if (second.t === 'join-refused') throw new SharingError(second.reason)
    if (second.t !== 'welcome') throw new ProtocolError(`Expected welcome, received ${second.t}`)
    const problem = welcomeProblem(second, invite, identity)
    if (problem !== null) throw new SharingError('welcome-invalid', problem)
    return { welcome: second, connection }
  } catch (err) {
    connection.close()
    throw err
  } finally {
    stream.close()
  }
}

// On the joiner, with the `welcome` checked: the Case row under the Owner's
// id, the roster rows, the Case directory with an empty manifest, and the
// tickets. No member chain file is made: until the first session stores the
// Owner's chain, an empty one would read as a chain of nobody.
export function adoptWelcome(
  welcome: WelcomeMessage,
  ownerTicket: string
): { caseId: string; caseName: string } {
  const { caseId, caseName, roster, tickets } = welcome
  if (getCase(caseId) !== undefined) throw new SharingError('case-exists')
  const self = getInstallationId()
  const owner = roster.find((m) => m.role === 'owner')!
  withTransaction(() => {
    createJoinedCase({ id: caseId, name: caseName, ownerInstallationId: owner.installationId })
    for (const member of roster) upsertCaseMember(toCaseMember(caseId, member))
  })
  const caseDir = join(getStorageRoot(), caseId)
  mkdirSync(caseDir, { recursive: true })
  initManifest(caseDir)
  writeMembersFile(caseId)
  const known: Record<string, string> = { ...tickets, [owner.installationId]: ownerTicket }
  delete known[self]
  rememberMemberTickets(caseId, known)
  return { caseId, caseName }
}

function toCaseMember(caseId: string, member: WelcomeMember): CaseMember {
  return { caseId, ...member }
}
