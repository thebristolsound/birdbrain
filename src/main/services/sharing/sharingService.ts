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
import {
  MAX_HANDSHAKE_FRAME_BYTES,
  MessageReader,
  ProtocolError
} from '@main/services/sharing/messages'
import {
  liveSyncSource,
  pullFromPeer,
  rememberPeerTicket,
  serveSyncSession,
  type SyncSessionResult,
  type SyncSource
} from '@main/services/sharing/session'
import type { ReceivedCaptures } from '@main/services/sharing/receivedEvidence'
import {
  forgetReached,
  memberTickets,
  rememberMemberTickets
} from '@main/services/sharing/syncState'
import {
  PeerUnreachableError,
  TransportError,
  type ByteStream,
  type Connection,
  type Transport,
  type TransportFailure
} from '@main/services/sharing/transport'

// The sharing service (#1810): one per process, behind the `sharing:*`
// channels. It holds the transport, the open invites and the pending joins,
// composes the invite string, the roster writers and the join handshake into
// the commands the members screens call, runs Sync now, and answers the
// member list. Nothing here decides what a session stores: the session and
// its acceptance modules do, and the roster writers decide who is a member.
//
// The transport starts on the first call that needs the network, through
// `setTransportProvider`. The default provider returns null, so every such
// call refuses `sharing-unavailable`. The app's provider is the sync service's
// (syncService.ts, #1881), which owns the transport's lifetime: it runs the
// round that starts the transport at launch when a Shared Case exists, arms
// the 60-second timer, and closes the transport on quit.

export type TransportProvider = () => Promise<Transport | null>

export interface SharingServiceDeps {
  emitChanged?: (payload: SharingChangedEvent) => void
  emitJoinProgress?: (payload: SharingJoinProgressEvent) => void
  // What a listening node serves a Case from; the live source by default.
  sourceFor?: (caseId: string) => SyncSource | null
  // What every pull hands the apply step (receivedEvidence.ts). Required, as on
  // the session, so no session this service runs skips an author's deletion.
  receivedCaptures: ReceivedCaptures
  // How long a dialled session waits for the peer to send or take a byte
  // before it ends the session (#1881); 30 s by default.
  sessionIdleMs?: number
}

export const SESSION_IDLE_MS = 30_000

// A stream whose read or write gives up once the peer has been idle for `ms`:
// it closes the stream and refuses with a ProtocolError, which the session
// records as the peer's failure. The deadline restarts on every chunk, so a
// transfer that keeps moving is never cut. Without it a peer that took the
// stream and never answered would hold the session, and every later round of
// its Case, until the app quit.
function closeWhenIdle(stream: ByteStream, ms: number): ByteStream {
  const bounded = <T>(op: Promise<T>, what: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        stream.close()
        reject(new ProtocolError(`The peer ${what} nothing for ${ms} ms`))
      }, ms)
      op.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (err: unknown) => {
          clearTimeout(timer)
          reject(err)
        }
      )
    })
  return {
    write: (chunk) => bounded(stream.write(chunk), 'took'),
    read: () => bounded(stream.read(), 'sent'),
    close: () => stream.close()
  }
}

// A dial or stream open that has not settled within `ms` refuses with what
// `late` builds, and closes what it settles to afterwards. closeWhenIdle
// bounds only an open stream, and a peer that grants no stream would
// otherwise hold the Case's session, and every later round, until quit.
function settleWithin<T>(
  op: Promise<T>,
  ms: number,
  late: () => Error,
  discard: (value: T) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      reject(late())
    }, ms)
    op.then(
      (value) => {
        if (expired) {
          discard(value)
          return
        }
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        if (expired) return
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function syncedOutcome(installationId: string, result: SyncSessionResult): SharingSyncOutcome {
  return {
    installationId,
    outcome: 'synced',
    entries: result.entriesReceived,
    blobs: result.blobsReceived,
    rowsApplied: result.rowsApplied,
    errors: result.errors.length
  }
}

const errorDetail = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface StreamHandlers {
  join: (stream: ByteStream, peerNodeId: string) => Promise<void>
  hello: (stream: ByteStream, peerNodeId: string) => Promise<void>
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

// How the network ends a teammate's stream in ordinary use. These log at
// info with no toast, since the teammate's side reports the sync session it
// was running and the next round retries. Everything else warns: a peer that
// closes with a nonzero code (this app always closes with 0), a peer's QUIC
// stack aborting the connection, a connection lost any other way, an error the
// transport cannot name, and a failure in this app's own code.
const ORDINARY_DISCONNECTS: ReadonlySet<TransportFailure> = new Set<TransportFailure>([
  'PEER_CLOSED',
  'TIMED_OUT',
  'LOCALLY_CLOSED',
  'CONNECTION_RESET',
  'STREAM_STOPPED',
  'STREAM_RESET',
  'STREAM_CLOSED'
])

export function logStreamFailure(err: unknown): void {
  if (err instanceof TransportError && ORDINARY_DISCONNECTS.has(err.code)) {
    logger.info('sharing', 'sharing.stream_failed', undefined, err)
  } else {
    logger.warn('sharing', 'sharing.stream_failed', undefined, err)
  }
}

// Hands an incoming stream to the handler its first message names: `join`
// to the join server, `hello` to the sync session. Anything else, a stream
// that ends before its first frame, a first frame that is not a message, and
// one whose header announces more than a handshake frame close the stream
// and reach no handler; the sender is unknown here, so no larger body is read.
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
    first = await new MessageReader(recording, MAX_HANDSHAKE_FRAME_BYTES).next()
  } catch {
    stream.close()
    return
  }
  if (first?.t === 'join') return handlers.join(replayed(stream, recorded), peerNodeId)
  if (first?.t === 'hello') return handlers.hello(replayed(stream, recorded), peerNodeId)
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
  private readonly sessionIdleMs: number

  constructor(private readonly deps: SharingServiceDeps) {
    this.sourceFor = deps.sourceFor ?? liveSyncSource
    this.sessionIdleMs = deps.sessionIdleMs ?? SESSION_IDLE_MS
  }

  setTransportProvider(provider: TransportProvider): void {
    this.provider = provider
    this.started = null
  }

  // The transport, started on the first call and listened on once. A
  // provider that returns null, or a start that throws, is asked again next
  // time rather than kept.
  private async transportOrThrow(): Promise<Started> {
    const pending = (this.started ??= this.start())
    let started: Started | null
    try {
      started = await pending
    } catch (err) {
      if (this.started === pending) this.started = null
      throw err
    }
    if (started === null) {
      if (this.started === pending) this.started = null
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
        hello: (s, peer) =>
          serveSyncSession(s, this.sourceFor, {
            ticket: transport.ticket,
            peerNodeId: peer,
            ticketNodeId: (ticket) => transport.nodeIdOf(ticket),
            rememberTicket: rememberPeerTicket
          })
      }).catch(logStreamFailure)
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
  // fails is logged and left to Sync now. The first session is the Case's
  // running one from the moment the Case exists, with no await between, so a
  // Sync now or a timer round on the new Case shares it rather than starting a
  // second.
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
      await this.single(caseId, () => this.firstSession(caseId, transport, connection))
      return result
    } finally {
      connection.close()
      this.changed(caseId)
    }
  }

  private async firstSession(
    caseId: string,
    transport: Transport,
    connection: Connection
  ): Promise<SharingSyncOutcome[]> {
    const installationId = getCase(caseId)?.ownerInstallationId ?? ''
    try {
      const result = await pullFromPeer(caseId, await this.openBounded(transport, connection), {
        receivedCaptures: this.deps.receivedCaptures,
        ticket: transport.ticket,
        peerNodeId: connection.peerNodeId,
        ticketNodeId: (ticket) => transport.nodeIdOf(ticket)
      })
      return [syncedOutcome(installationId, result)]
    } catch (err) {
      logger.warn('sharing', 'sharing.first_session_failed', undefined, err)
      return [{ installationId, outcome: 'failed', detail: errorDetail(err) }]
    }
  }

  private async openBounded(transport: Transport, connection: Connection): Promise<ByteStream> {
    const ms = this.sessionIdleMs
    const stream = await settleWithin(
      transport.openStream(connection),
      ms,
      () => new ProtocolError(`The peer opened no stream for ${ms} ms`),
      (late) => late.close()
    )
    return closeWhenIdle(stream, ms)
  }

  // A dial the peer leaves unanswered counts as unreachable.
  private dialBounded(transport: Transport, ticket: string): Promise<Connection> {
    return settleWithin(
      transport.dial(ticket),
      this.sessionIdleMs,
      () => new PeerUnreachableError(ticket),
      (late) => late.close()
    )
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
  // after another. A second call while one runs shares its result, and so
  // does a timer round or a join's first session on the same Case: one Case
  // never has two sessions at once (#1881).
  syncNow(caseId: string): Promise<SharingSyncOutcome[]> {
    return this.single(caseId, () => this.runSync(caseId))
  }

  private single(
    caseId: string,
    run: () => Promise<SharingSyncOutcome[]>
  ): Promise<SharingSyncOutcome[]> {
    const running = this.syncing.get(caseId)
    if (running) return running
    const started = run().finally(() => this.syncing.delete(caseId))
    this.syncing.set(caseId, started)
    return started
  }

  // The roster as it stands, or null when this installation's own row is
  // revoked: such an installation runs no session for the Case and reaches
  // nobody in it.
  private rosterInStanding(caseId: string, self: string): CaseMember[] | null {
    const roster = listCaseMembers(caseId)
    if (!roster.some((m) => m.installationId === self && m.revokedAtIndex !== null)) return roster
    for (const { installationId } of roster) forgetReached(caseId, installationId)
    return null
  }

  // `peersReachable` counts the members whose latest dialled session got past
  // `hello` (syncState.ts), so a member attempt that stops short of the
  // `heads` phase forgets that member. The roster is read again before each
  // member, since a session earlier in the round may have stored a revocation.
  private async runSync(caseId: string): Promise<SharingSyncOutcome[]> {
    const row = caseOrThrow(caseId)
    if (row.sharedAt === undefined) throw new SharingError('not-shared')
    const self = getInstallationId()
    const order = this.rosterInStanding(caseId, self)
    if (order === null) {
      this.changed(caseId)
      return []
    }
    const { transport } = await this.transportOrThrow()
    const tickets = memberTickets(caseId)
    const outcomes: SharingSyncOutcome[] = []
    for (const { installationId } of order) {
      if (installationId === self) continue
      const roster = this.rosterInStanding(caseId, self)
      if (roster === null) break
      const member = roster.find((m) => m.installationId === installationId)
      if (member === undefined || member.revokedAtIndex !== null) continue
      let greeted = false
      try {
        const ticket = tickets[installationId]
        if (ticket === undefined) {
          outcomes.push({ installationId, outcome: 'no-address' })
          continue
        }
        let connection
        try {
          connection = await this.dialBounded(transport, ticket)
        } catch (err) {
          if (err instanceof PeerUnreachableError) {
            outcomes.push({ installationId, outcome: 'unreachable' })
            continue
          }
          throw err
        }
        try {
          const result = await pullFromPeer(caseId, await this.openBounded(transport, connection), {
            receivedCaptures: this.deps.receivedCaptures,
            ticket: transport.ticket,
            peerNodeId: connection.peerNodeId,
            ticketNodeId: (ticket) => transport.nodeIdOf(ticket),
            onPhase: (phase) => {
              if (phase === 'heads') greeted = true
            }
          })
          outcomes.push(syncedOutcome(installationId, result))
        } catch (err) {
          outcomes.push({ installationId, outcome: 'failed', detail: errorDetail(err) })
        } finally {
          connection.close()
        }
      } finally {
        if (!greeted) forgetReached(caseId, installationId)
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

  // Closes the transport, if one started. For quit. A start that failed has
  // already refused the command that asked for it, so here it leaves nothing
  // to close.
  async close(): Promise<void> {
    const pending = this.started
    this.started = null
    const started = pending === null ? null : await pending.catch(() => null)
    await started?.transport.close()
  }
}
