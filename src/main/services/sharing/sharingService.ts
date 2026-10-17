import type {
  CaseMember,
  SharingChangedEvent,
  SharingInvite,
  SharingInvitePreview,
  SharingJoinProgressEvent,
  SharingJoinResult,
  SharingMembers,
  SharingSyncOutcome
} from '@shared/types'
import type { SharedCaseExclusion } from '@shared/verify'
import { listCaseMembers } from '@main/services/db/caseMemberRepo'
import { getCase } from '@main/services/db/caseRepo'
import { getInstallationId } from '@main/services/installationId'
import { logger } from '@main/services/logger'
import { getSettings } from '@main/services/settings'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import { SharingError } from '@main/services/sharing/errors'
import { decodeInvite, encodeInvite } from '@main/services/sharing/invite'
import { InviteRegistry } from '@main/services/sharing/inviteRegistry'
import {
  JoinServer,
  adoptWelcome,
  fingerprintPem,
  requestJoin,
  type JoinIdentity
} from '@main/services/sharing/joinHandshake'
import {
  addMember,
  excludeExhibit,
  revokeMember,
  shareCase
} from '@main/services/sharing/membership'
import { MessageReader } from '@main/services/sharing/messages'
import {
  liveSyncSource,
  pullFromPeer,
  serveSyncSession,
  type SyncSource
} from '@main/services/sharing/session'
import { memberTickets, rememberMemberTickets } from '@main/services/sharing/syncState'
import {
  PeerUnreachableError,
  type ByteStream,
  type Transport
} from '@main/services/sharing/transport'

// The sharing service (#1810): one per process, behind the `sharing:*`
// channels. It holds the transport, the open invites and the pending joins,
// composes the invite string, the roster writers and the join handshake into
// the commands the members screens call, runs Sync now, and answers the
// member list. Nothing here decides what a session stores: the session and
// its acceptance modules do, and the roster writers decide who is a member.
//
// The transport starts on the first call that needs the network, not at
// launch, through `setTransportProvider`. The default provider returns null,
// so every such call refuses `sharing-unavailable` until `IrohTransport` is
// wired in (#1809). SC-9 moves the start to launch and owns the timer.

export type TransportProvider = () => Promise<Transport | null>

export interface SharingServiceDeps {
  emitChanged?: (payload: SharingChangedEvent) => void
  emitJoinProgress?: (payload: SharingJoinProgressEvent) => void
  // What a listening node serves a Case from; the live source by default.
  sourceFor?: (caseId: string) => SyncSource | null
}

export interface StreamHandlers {
  join: (stream: ByteStream, peerNodeId: string) => Promise<void>
  hello: (stream: ByteStream) => Promise<void>
}

// A stream that replays the chunks the router read, then reads on: the
// handler's own reader re-parses from the first byte, so `serveSyncSession`
// and `JoinServer.serve` both still read their first message themselves.
function replayed(stream: ByteStream, chunks: Uint8Array[]): ByteStream {
  const queue = [...chunks]
  return {
    write: (chunk) => stream.write(chunk),
    read: async () => queue.shift() ?? stream.read(),
    close: () => stream.close()
  }
}

// Hands an incoming stream to the handler its first message names: `join`
// to the join server, `hello` to the sync session. Anything else, a stream
// that ends before its first frame, and a first frame that is not a message
// close the stream and reach no handler.
export async function routeIncomingStream(
  stream: ByteStream,
  peerNodeId: string,
  handlers: StreamHandlers
): Promise<void> {
  const recorded: Uint8Array[] = []
  const recording: ByteStream = {
    write: (chunk) => stream.write(chunk),
    read: async () => {
      const chunk = await stream.read()
      if (chunk !== null) recorded.push(chunk)
      return chunk
    },
    close: () => stream.close()
  }
  let first
  try {
    first = await new MessageReader(recording).next()
  } catch {
    stream.close()
    return
  }
  if (first?.t === 'join') return handlers.join(replayed(stream, recorded), peerNodeId)
  if (first?.t === 'hello') return handlers.hello(replayed(stream, recorded))
  stream.close()
}

interface Started {
  transport: Transport
  joins: JoinServer
}

function caseOrThrow(caseId: string): NonNullable<ReturnType<typeof getCase>> {
  const row = getCase(caseId)
  if (!row) throw new Error(`Case not found: ${caseId}`)
  return row
}

function trimmedOperatorName(): string {
  const name = getSettings().operatorName?.trim() ?? ''
  if (name.length === 0) throw new SharingError('operator-name-required')
  return name
}

export class SharingService {
  private readonly registry = new InviteRegistry()
  private provider: TransportProvider = async () => null
  private started: Promise<Started | null> | null = null
  private readonly syncing = new Map<string, Promise<SharingSyncOutcome[]>>()
  private readonly sourceFor: (caseId: string) => SyncSource | null

  constructor(private readonly deps: SharingServiceDeps = {}) {
    this.sourceFor = deps.sourceFor ?? liveSyncSource
  }

  setTransportProvider(provider: TransportProvider): void {
    this.provider = provider
    this.started = null
  }

  // The transport, started on the first call and listened on once. A
  // provider that returns null is asked again next time.
  private async transportOrThrow(): Promise<Started> {
    this.started ??= this.start()
    const started = await this.started
    if (started === null) {
      this.started = null
      throw new SharingError('sharing-unavailable')
    }
    return started
  }

  private async start(): Promise<Started | null> {
    const transport = await this.provider()
    if (transport === null) return null
    const joins = new JoinServer({
      nodeId: transport.nodeId,
      registry: this.registry,
      roster: listCaseMembers,
      caseName: (caseId) => getCase(caseId)?.name,
      addMember,
      tickets: (caseId) => ({ ...memberTickets(caseId), [getInstallationId()]: transport.ticket }),
      rememberTicket: (caseId, installationId, ticket) =>
        rememberMemberTickets(caseId, { [installationId]: ticket }),
      onChanged: (caseId) => this.changed(caseId)
    })
    await transport.listen((stream, peerNodeId) => {
      routeIncomingStream(stream, peerNodeId, {
        join: (s, peer) => joins.serve(s, peer),
        hello: (s) => serveSyncSession(s, this.sourceFor)
      }).catch((err: unknown) => {
        logger.warn('sharing', 'sharing.stream_failed', undefined, err)
      })
    })
    return { transport, joins }
  }

  private changed(caseId: string): void {
    this.deps.emitChanged?.({ caseId })
  }

  // The first invite for a Case shares it: the Owner's own `member-add` and
  // the row columns, then one open invite.
  async createInvite(caseId: string, ownerMemberCode?: string): Promise<SharingInvite> {
    caseOrThrow(caseId)
    const operatorName = trimmedOperatorName()
    const { transport } = await this.transportOrThrow()
    await shareCase(caseId, { ownerMemberCode, nodeId: transport.nodeId })
    const { inviteId, secret, expiresAt } = this.registry.open(caseId)
    const invite = encodeInvite({
      ticket: transport.ticket,
      caseId,
      operatorName,
      secret,
      expiresAt
    })
    this.changed(caseId)
    return { inviteId, invite, expiresAt }
  }

  cancelInvite(caseId: string, inviteId: string): void {
    this.registry.cancel(caseId, inviteId)
    this.changed(caseId)
  }

  // What the join wizard shows before the joiner commits: never the secret.
  readInvite(text: string): SharingInvitePreview {
    const { caseId, operatorName, expiresAt } = decodeInvite(text)
    return { caseId, ownerName: operatorName, expiresAt }
  }

  private identity(): JoinIdentity {
    return {
      installationId: getInstallationId(),
      publicKeyPem: getPublicKeyPem(),
      operatorName: trimmedOperatorName(),
      sign: signEntryHash
    }
  }

  // Joins the Case an invite names, adopts the welcome, and runs the first
  // session on a new stream of the join connection (the design's step 4).
  // The join is complete once the Case is adopted; a first session that
  // fails is logged and left to Sync now.
  async joinCase(text: string): Promise<SharingJoinResult> {
    const invite = decodeInvite(text)
    if (getCase(invite.caseId) !== undefined) throw new SharingError('case-exists')
    const identity = this.identity()
    const { transport } = await this.transportOrThrow()
    const { caseId, operatorName: ownerName } = invite
    const step = (s: SharingJoinProgressEvent['step']): void =>
      this.deps.emitJoinProgress?.({ caseId, ownerName, step: s })
    const { welcome, connection } = await requestJoin({ transport, invite, identity, onStep: step })
    try {
      step('adopting')
      const result = adoptWelcome(welcome, invite.ticket)
      this.changed(caseId)
      step('syncing')
      try {
        await pullFromPeer(caseId, await transport.openStream(connection))
      } catch (err) {
        logger.warn('sharing', 'sharing.first_session_failed', undefined, err)
      }
      return result
    } finally {
      connection.close()
      this.changed(caseId)
    }
  }

  async approveJoin(caseId: string, requestId: string, memberCode: string): Promise<CaseMember> {
    const { joins } = await this.transportOrThrow()
    const member = await joins.approve(caseId, requestId, memberCode)
    this.changed(caseId)
    return member
  }

  async declineJoin(caseId: string, requestId: string): Promise<void> {
    const { joins } = await this.transportOrThrow()
    await joins.decline(caseId, requestId)
    this.changed(caseId)
  }

  async revoke(caseId: string, installationId: string): Promise<CaseMember> {
    const member = await revokeMember(caseId, installationId)
    this.changed(caseId)
    return member
  }

  async excludeExhibit(
    caseId: string,
    exhibitId: string,
    reason?: string
  ): Promise<SharedCaseExclusion> {
    const exclusion = await excludeExhibit(caseId, exhibitId, reason)
    this.changed(caseId)
    return exclusion
  }

  // One pull from each member in good standing whose ticket is known, one
  // after another. A second call while one runs shares its result.
  syncNow(caseId: string): Promise<SharingSyncOutcome[]> {
    const running = this.syncing.get(caseId)
    if (running) return running
    const run = this.runSync(caseId).finally(() => this.syncing.delete(caseId))
    this.syncing.set(caseId, run)
    return run
  }

  private async runSync(caseId: string): Promise<SharingSyncOutcome[]> {
    const row = caseOrThrow(caseId)
    if (row.sharedAt === undefined) throw new SharingError('not-shared')
    const { transport } = await this.transportOrThrow()
    const self = getInstallationId()
    const tickets = memberTickets(caseId)
    const outcomes: SharingSyncOutcome[] = []
    for (const member of listCaseMembers(caseId)) {
      const { installationId } = member
      if (installationId === self || member.revokedAtIndex !== null) continue
      const ticket = tickets[installationId]
      if (ticket === undefined) {
        outcomes.push({ installationId, outcome: 'no-address' })
        continue
      }
      let connection
      try {
        connection = await transport.dial(ticket)
      } catch (err) {
        if (err instanceof PeerUnreachableError) {
          outcomes.push({ installationId, outcome: 'unreachable' })
          continue
        }
        throw err
      }
      try {
        const result = await pullFromPeer(caseId, await transport.openStream(connection))
        outcomes.push({
          installationId,
          outcome: 'synced',
          entries: result.entriesReceived,
          blobs: result.blobsReceived,
          rowsApplied: result.rowsApplied,
          errors: result.errors.length
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        outcomes.push({ installationId, outcome: 'failed', detail })
      } finally {
        connection.close()
      }
    }
    this.changed(caseId)
    return outcomes
  }

  // The roster with each member's fingerprint, the open invites (never the
  // secret), and the joins waiting for approval.
  async getMembers(caseId: string): Promise<SharingMembers> {
    const row = caseOrThrow(caseId)
    const installationId = getInstallationId()
    const started = this.started === null ? null : await this.started
    return {
      caseId,
      installationId,
      isOwner: row.ownerInstallationId === installationId,
      members: listCaseMembers(caseId).map((m) => ({
        ...m,
        fingerprint: fingerprintPem(m.publicKeyPem)
      })),
      invites: this.registry.openInvites(caseId),
      pendingJoins: started?.joins.pendingJoins(caseId) ?? []
    }
  }

  // Closes the transport, if one started. For quit.
  async close(): Promise<void> {
    const started = this.started === null ? null : await this.started
    this.started = null
    await started?.transport.close()
  }
}
