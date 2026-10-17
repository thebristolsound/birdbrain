import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSign, generateKeyPairSync } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase } from '@main/services/db/core'
import { listCaseMembers, upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createCase, getCase } from '@main/services/db/caseRepo'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import { updateSettings } from '@main/services/settings'
import { SharingError } from '@main/services/sharing/errors'
import { decodeInvite, encodeInvite } from '@main/services/sharing/invite'
import { InviteRegistry } from '@main/services/sharing/inviteRegistry'
import { JoinServer, requestJoin } from '@main/services/sharing/joinHandshake'
import { addMember, shareCase } from '@main/services/sharing/membership'
import { MessageReader, writeMessage } from '@main/services/sharing/messages'
import { serveSyncSession } from '@main/services/sharing/session'
import { SharingService, routeIncomingStream } from '@main/services/sharing/sharingService'
import {
  memberTickets,
  rememberMemberTickets,
  resetSyncStateMemory
} from '@main/services/sharing/syncState'
import { MemoryHub, type ByteStream, type MemoryTransport } from '@main/services/sharing/transport'
import type { SharingJoinProgressEvent, SharingSyncOutcome } from '@shared/types'
import {
  activate,
  addDocument,
  caseDirOf,
  createPeer,
  memberOf,
  mergeEntries,
  ownChainText,
  parsedChain,
  recordSource,
  seedSharedCase,
  type Peer,
  type RecordedSource
} from '../../../helpers/syncPeers'

// The sharing service (#1810): the router in front of a listening node, the
// transport seam, the commands the members screens call, and Sync now. One
// installation is active at a time, so a listener standing for the other
// peer answers from a source recorded while that peer was active.

async function refused(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (err) {
    if (err instanceof SharingError) return err.code
    throw err
  }
  throw new Error('expected a SharingError')
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 2000 && !until(); i++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  expect(until()).toBe(true)
}

async function settleAsync(until: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (await until()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('condition never held')
}

const signer = (peer: Peer) => (hex: string) =>
  createSign('sha256').update(hex).sign(peer.privateKeyPem, 'base64')

// A key no peer holds, for a roster member who never dials in.
const ERIN_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
}).publicKey

describe('sharing service (#1810)', () => {
  let root: string
  let A: Peer
  let B: Peer
  let C: Peer
  let caseId: string
  let hub: MemoryHub

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-sharing-service-'))
    C = await createPeer(root, 'carol', 'Carol Member', 'CM')
    B = await createPeer(root, 'bob', 'Bob Member', 'BM')
    A = await createPeer(root, 'alice', 'Alice Owner', 'AO')
    caseId = createCase({ name: 'Shared' }).id
    hub = new MemoryHub({ chunkSize: 256 })
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  // A node on the hub that routes every stream to the handlers given.
  async function listening(
    name: string,
    handlers: Parameters<typeof routeIncomingStream>[2]
  ): Promise<{ node: MemoryTransport; routed: Promise<void>[] }> {
    const node = hub.createTransport(name)
    const routed: Promise<void>[] = []
    await node.listen((stream, peer) => {
      routed.push(routeIncomingStream(stream, peer, handlers))
    })
    return { node, routed }
  }

  describe('the router', () => {
    it('completes a session for a hello stream, reaches the join handler for a join, and closes the rest', async () => {
      await shareCase(caseId, { nodeId: 'alice-node' })
      await addMember(caseId, {
        installationId: B.installationId,
        publicKeyPem: B.publicKeyPem,
        operatorName: B.operatorName,
        nodeId: 'bob-node',
        memberCode: 'BM'
      })
      addDocument(caseId, A, 1)
      const fromAlice = recordSource(caseId, A)
      const joinHandler = vi.fn(async (stream: ByteStream) => {
        // The handler reads the join itself from the replayed stream.
        const first = await new MessageReader(stream).next()
        expect(first?.t).toBe('join')
        stream.close()
      })
      const { node, routed } = await listening('alice-node', {
        join: joinHandler,
        hello: (stream) => serveSyncSession(stream, (id) => (id === caseId ? fromAlice : null))
      })

      // A session through the router lands Alice's chain on Bob.
      await activate(B)
      seedSharedCase(caseId, A, [B])
      const service = new SharingService()
      service.setTransportProvider(async () => hub.createTransport('bob-node'))
      rememberMemberTickets(caseId, { [A.installationId]: node.ticket })
      const [outcome] = await service.syncNow(caseId)
      expect(outcome).toMatchObject({ installationId: A.installationId, outcome: 'synced' })
      expect((outcome as Extract<SharingSyncOutcome, { outcome: 'synced' }>).entries).toBe(3)
      expect(mergeEntries(caseId)).toHaveLength(1)

      // A join stream reaches the join handler with its first frame intact.
      const dialer = hub.createTransport('dialer')
      const joinStream = await dialer.openStream(await dialer.dial(node.ticket))
      await writeMessage(joinStream, {
        t: 'join',
        caseId,
        secret: new Uint8Array(16),
        installationId: C.installationId,
        publicKeyPem: C.publicKeyPem,
        operatorName: C.operatorName,
        ticket: dialer.ticket,
        signature: 'sig'
      })
      await settle(() => joinHandler.mock.calls.length === 1)
      expect(await new MessageReader(joinStream).next()).toBeNull()

      // Another first message, and a stream that closes before its first
      // frame, are closed and reach nothing.
      const other = await dialer.openStream(await dialer.dial(node.ticket))
      await writeMessage(other, { t: 'heads', heads: [] })
      expect(await new MessageReader(other).next()).toBeNull()
      const silent = await dialer.openStream(await dialer.dial(node.ticket))
      silent.close()
      const garbage = await dialer.openStream(await dialer.dial(node.ticket))
      await garbage.write(new Uint8Array([0, 0, 0, 2, 0xff, 0xff]))
      expect(await new MessageReader(garbage).next()).toBeNull()
      await Promise.all(routed)
      expect(joinHandler).toHaveBeenCalledTimes(1)
      await service.close()
    })
  })

  describe('with the default provider', () => {
    it('refuses createInvite, joinCase and syncNow with sharing-unavailable and writes nothing', async () => {
      const service = new SharingService()
      expect(await refused(() => service.createInvite(caseId))).toBe('sharing-unavailable')
      expect(getCase(caseId)?.sharedAt).toBeUndefined()
      expect(ownChainText(caseId)).toBe('')
      const invite = encodeInvite({
        ticket: 'mem:nowhere',
        caseId: 'another-case',
        operatorName: 'Alice Owner',
        secret: new Uint8Array(16),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      })
      expect(await refused(() => service.joinCase(invite))).toBe('sharing-unavailable')
      expect(getCase('another-case')).toBeUndefined()
      await shareCase(caseId, { nodeId: 'alice-node' })
      expect(await refused(() => service.syncNow(caseId))).toBe('sharing-unavailable')
      expect(await refused(() => service.approveJoin(caseId, 'r', 'X'))).toBe('sharing-unavailable')
      const members = await service.getMembers(caseId)
      expect(members).toMatchObject({ isOwner: true, invites: [], pendingJoins: [] })
      expect(members.members[0].fingerprint).toMatch(/^[0-9a-f]{64}$/)
      // A provider set later is asked on the next call.
      service.setTransportProvider(async () => hub.createTransport('alice-node'))
      const created = await service.createInvite(caseId)
      expect(decodeInvite(created.invite).caseId).toBe(caseId)
      await service.close()
    })

    it('refuses a join to a Case this installation holds before dialing, and a read of a bad invite', async () => {
      const service = new SharingService()
      const invite = encodeInvite({
        ticket: 'mem:nowhere',
        caseId,
        operatorName: 'Alice Owner',
        secret: new Uint8Array(16),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      })
      expect(await refused(() => service.joinCase(invite))).toBe('case-exists')
      expect(await refused(async () => service.readInvite('bbinvite1!!'))).toBe('invite-malformed')
      expect(service.readInvite(invite)).toEqual({
        caseId,
        ownerName: 'Alice Owner',
        expiresAt: decodeInvite(invite).expiresAt
      })
      updateSettings({ operatorName: '' })
      expect(await refused(() => service.createInvite(caseId))).toBe('operator-name-required')
    })
  })

  describe('on the Owner', () => {
    let service: SharingService
    let changed: string[]
    let ownerNode: MemoryTransport

    beforeEach(() => {
      changed = []
      service = new SharingService({ emitChanged: ({ caseId: id }) => changed.push(id) })
      service.setTransportProvider(async () => {
        ownerNode = hub.createTransport('alice-node')
        return ownerNode
      })
    })

    afterEach(async () => {
      await service.close()
    })

    it('shares the Case on the first invite, lists and cancels invites, and refuses a member', async () => {
      const first = await service.createInvite(caseId, 'AL')
      expect(getCase(caseId)).toMatchObject({ ownerInstallationId: A.installationId })
      expect(parsedChain(ownChainText(caseId))).toHaveLength(1)
      expect(listCaseMembers(caseId)[0].memberCode).toBe('AL')
      expect(ownerNode.isListening).toBe(true)
      const fields = decodeInvite(first.invite)
      expect(fields).toMatchObject({
        ticket: ownerNode.ticket,
        caseId,
        operatorName: 'Alice Owner'
      })
      expect(fields.expiresAt).toBe(first.expiresAt)
      const second = await service.createInvite(caseId)
      expect(parsedChain(ownChainText(caseId))).toHaveLength(1)
      let members = await service.getMembers(caseId)
      expect(members.invites.map((i) => i.inviteId).sort()).toEqual(
        [first.inviteId, second.inviteId].sort()
      )
      service.cancelInvite(caseId, first.inviteId)
      members = await service.getMembers(caseId)
      expect(members.invites.map((i) => i.inviteId)).toEqual([second.inviteId])
      expect(await refused(async () => service.cancelInvite(caseId, 'nope'))).toBe(
        'invite-not-found'
      )
      expect(changed).toEqual([caseId, caseId, caseId])

      // On Bob's installation the same call is refused: he is not the Owner.
      const fromAlice = recordSource(caseId, A)
      void fromAlice
      await activate(B)
      seedSharedCase(caseId, A, [B])
      const bobService = new SharingService()
      bobService.setTransportProvider(async () => hub.createTransport('bob-node'))
      expect(await refused(() => bobService.createInvite(caseId))).toBe('not-owner')
      expect(ownChainText(caseId)).toBe('')
      await bobService.close()
    })

    it('approves, declines, revokes and excludes through the join server and the writers', async () => {
      const { invite } = await service.createInvite(caseId)
      const fields = decodeInvite(invite)
      const bobNode = hub.createTransport('bob-node')
      const joining = requestJoin({
        transport: bobNode,
        invite: fields,
        identity: {
          installationId: B.installationId,
          publicKeyPem: B.publicKeyPem,
          operatorName: B.operatorName,
          sign: signer(B)
        }
      })
      let members = await service.getMembers(caseId)
      await settleAsync(async () => {
        members = await service.getMembers(caseId)
        return members.pendingJoins.length === 1
      })
      const [pending] = members.pendingJoins
      expect(pending).toMatchObject({ installationId: B.installationId, suggestedMemberCode: 'BM' })
      expect(await refused(() => service.approveJoin(caseId, pending.requestId, 'AO'))).toBe(
        'member-code-rejected'
      )
      const member = await service.approveJoin(caseId, pending.requestId, 'BM')
      expect(member).toMatchObject({ installationId: B.installationId, nodeId: 'bob-node' })
      const { welcome, connection } = await joining
      connection.close()
      expect(welcome.roster).toHaveLength(2)
      expect(memberTickets(caseId)).toEqual({ [B.installationId]: bobNode.ticket })

      // Carol's join is declined.
      const { invite: again } = await service.createInvite(caseId)
      const carolNode = hub.createTransport('carol-node')
      const carol = requestJoin({
        transport: carolNode,
        invite: decodeInvite(again),
        identity: {
          installationId: C.installationId,
          publicKeyPem: C.publicKeyPem,
          operatorName: C.operatorName,
          sign: signer(C)
        }
      })
      await settleAsync(async () => {
        members = await service.getMembers(caseId)
        return members.pendingJoins.length === 1
      })
      expect(members.pendingJoins.map((p) => p.installationId)).toEqual([C.installationId])
      expect(changed.length).toBeGreaterThanOrEqual(4)
      await service.declineJoin(caseId, members.pendingJoins[0].requestId)
      expect(await refused(() => carol)).toBe('declined')
      expect(await refused(() => service.declineJoin(caseId, 'gone'))).toBe('join-request-unknown')

      // Revoke Bob, exclude his document after a session, and read the list.
      const doc = addDocument(caseId, A, 1)
      const exclusion = await service.excludeExhibit(caseId, doc.exhibitId, 'withdrawn')
      expect(exclusion).toMatchObject({ exhibitId: doc.exhibitId, reason: 'withdrawn' })
      const revoked = await service.revoke(caseId, B.installationId)
      expect(revoked.revokedAtIndex).toBe(4)
      expect(await refused(() => service.revoke(caseId, B.installationId))).toBe('already-revoked')
      members = await service.getMembers(caseId)
      expect(members.members.map((m) => [m.installationId, m.revokedAtIndex])).toEqual([
        [A.installationId, null],
        [B.installationId, 4]
      ])
      expect(members.isOwner).toBe(true)
      expect(members.installationId).toBe(A.installationId)
    })

    it('syncs now from each member in good standing and reports the rest', async () => {
      await service.createInvite(caseId)
      for (const peer of [B, C]) {
        await addMember(caseId, {
          installationId: peer.installationId,
          publicKeyPem: peer.publicKeyPem,
          operatorName: peer.operatorName,
          nodeId: `node-${peer.name}`,
          memberCode: peer.memberCode
        })
      }
      const fromAlice = recordSource(caseId, A)

      // Bob holds the Case and a document; his node answers from a recording.
      await activate(B)
      seedSharedCase(caseId, A, [B, C])
      addDocument(caseId, B, 1)
      const fromBob = recordSource(caseId, B)
      await activate(A)
      const { node: bobNode } = await listening('bob-node', {
        join: async (stream) => stream.close(),
        hello: (stream) => serveSyncSession(stream, (id) => (id === caseId ? fromBob : null))
      })
      rememberMemberTickets(caseId, { [B.installationId]: bobNode.ticket })

      // Carol has no ticket; Dave is revoked; Bob syncs.
      await service.revoke(caseId, C.installationId)
      const dave = memberOf(caseId, C, 'member', 9)
      upsertCaseMember({
        ...dave,
        installationId: 'installation-dave',
        publicKeyPem: 'k',
        memberCode: 'DV'
      })
      await service.revoke(caseId, 'installation-dave')
      const outcomes = await service.syncNow(caseId)
      expect(outcomes).toEqual([
        {
          installationId: B.installationId,
          outcome: 'synced',
          entries: 1,
          blobs: 1,
          rowsApplied: 0,
          errors: 0
        }
      ])
      expect(mergeEntries(caseId)).toHaveLength(1)

      // A second call while one runs shares its result.
      const [x, y] = await Promise.all([service.syncNow(caseId), service.syncNow(caseId)])
      expect(x).toBe(y)
      expect(x[0]).toMatchObject({ outcome: 'synced', entries: 0 })

      // A member whose ticket is unknown, and one whose node is gone.
      await addMember(caseId, {
        installationId: 'installation-erin',
        publicKeyPem: ERIN_KEY,
        operatorName: 'Erin',
        nodeId: 'erin-node',
        memberCode: 'ER'
      })
      await bobNode.close()
      const after = await service.syncNow(caseId)
      expect(after.map((o) => [o.installationId, o.outcome])).toEqual([
        [B.installationId, 'unreachable'],
        ['installation-erin', 'no-address']
      ])
      void fromAlice
      // A Case nobody shared refuses.
      const other = createCase({ name: 'Private' }).id
      expect(await refused(() => service.syncNow(other))).toBe('not-shared')
    })
  })

  describe('joinCase on the joiner', () => {
    it('joins, adopts the welcome, runs the first session and reports each step', async () => {
      // Alice's side, built while she is active: the Case shared with Bob
      // already approved, so the stub Owner node can answer the join and the
      // first session from her recorded replica while Bob is active.
      await shareCase(caseId, { nodeId: 'alice-node' })
      const bobMember = await addMember(caseId, {
        installationId: B.installationId,
        publicKeyPem: B.publicKeyPem,
        operatorName: B.operatorName,
        nodeId: 'bob-node',
        memberCode: 'BM'
      })
      addDocument(caseId, A, 1)
      const fromAlice: RecordedSource = recordSource(caseId, A)
      // The stub's roster is Alice's before the approval and gains Bob on
      // it, as the real writer's would.
      const roster = listCaseMembers(caseId).filter((m) => m.installationId !== B.installationId)
      const registry = new InviteRegistry()
      const { secret, expiresAt } = registry.open(caseId)
      const ownerNode = hub.createTransport('alice-node')
      const joins = new JoinServer({
        nodeId: ownerNode.nodeId,
        registry,
        roster: () => roster,
        caseName: () => 'Shared',
        addMember: async () => {
          roster.push(bobMember)
          return bobMember
        },
        tickets: () => ({ [A.installationId]: ownerNode.ticket }),
        rememberTicket: () => {},
        onChanged: () => {}
      })
      const routed: Promise<void>[] = []
      await ownerNode.listen((stream, peer) => {
        routed.push(
          routeIncomingStream(stream, peer, {
            join: (s, p) => joins.serve(s, p),
            hello: (s) => serveSyncSession(s, (id) => (id === caseId ? fromAlice : null))
          })
        )
      })
      const invite = encodeInvite({
        ticket: ownerNode.ticket,
        caseId,
        operatorName: 'Alice Owner',
        secret,
        expiresAt
      })

      await activate(B)
      const steps: SharingJoinProgressEvent[] = []
      const changed: string[] = []
      const service = new SharingService({
        emitJoinProgress: (event) => steps.push(event),
        emitChanged: ({ caseId: id }) => changed.push(id)
      })
      service.setTransportProvider(async () => hub.createTransport('bob-node'))
      expect(await refused(() => service.joinCase('bbinvite1zzz'))).toBe('invite-malformed')
      const joining = service.joinCase(invite)
      await settle(() => joins.pendingJoins(caseId).length === 1)
      await joins.approve(caseId, joins.pendingJoins(caseId)[0].requestId, 'BM')
      expect(await joining).toEqual({ caseId, caseName: 'Shared' })
      expect(getCase(caseId)).toMatchObject({
        name: 'Shared',
        ownerInstallationId: A.installationId
      })
      expect(listCaseMembers(caseId).map((m) => m.installationId)).toEqual([
        A.installationId,
        B.installationId
      ])
      expect(steps.map((s) => s.step)).toEqual(['connecting', 'waiting', 'adopting', 'syncing'])
      expect(steps[0]).toMatchObject({ caseId, ownerName: 'Alice Owner' })
      expect(changed).toEqual([caseId, caseId])
      // The first session brought Alice's chain and wrote the merge.
      expect(mergeEntries(caseId)).toHaveLength(1)
      expect(memberTickets(caseId)).toEqual({ [A.installationId]: ownerNode.ticket })
      expect((await service.getMembers(caseId)).isOwner).toBe(false)
      // The same invite again: the Case exists here now.
      expect(await refused(() => service.joinCase(invite))).toBe('case-exists')
      await service.close()
      await Promise.all(routed)
      expect(parsedChain(ownChainText(caseId)).map((e) => e.type)).toEqual(['merge'])
      void caseDirOf
    })
  })
})
