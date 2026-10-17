import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, createSign } from 'crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb } from '@main/services/db/core'
import { listCaseMembers } from '@main/services/db/caseMemberRepo'
import { createCase, getCase, listCases } from '@main/services/db/caseRepo'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import { readManifestSnapshot, readSharedCaseSnapshot } from '@main/services/manifest'
import { SharingError } from '@main/services/sharing/errors'
import { INVITE_LIFETIME_MS, type InviteFields } from '@main/services/sharing/invite'
import { InviteRegistry } from '@main/services/sharing/inviteRegistry'
import {
  JoinServer,
  adoptWelcome,
  joinDigest,
  requestJoin,
  type JoinIdentity,
  type WelcomeMessage
} from '@main/services/sharing/joinHandshake'
import { addMember, shareCase } from '@main/services/sharing/membership'
import {
  MAX_HANDSHAKE_FRAME_BYTES,
  MessageReader,
  expectMessage,
  writeMessage
} from '@main/services/sharing/messages'
import {
  memberTickets,
  rememberMemberTickets,
  resetSyncStateMemory
} from '@main/services/sharing/syncState'
import { MemoryHub, type ByteStream, type MemoryTransport } from '@main/services/sharing/transport'
import type { SharingJoinStep } from '@shared/types'
import {
  activate,
  caseDirOf,
  createPeer,
  mergeEntries,
  ownChainText,
  parsedChain,
  pull,
  recordSource,
  type Peer
} from '../../../helpers/syncPeers'

// The join handshake (#1810) between real replicas over one MemoryHub: the
// Owner's node listens through a JoinServer backed by the roster writers,
// and the joiner's network side runs with a signer built from the joiner's
// key while the Owner is the active installation. What the joiner writes
// runs after `activate(joiner)`.

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

async function refused(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (err) {
    if (err instanceof SharingError) return err.code
    throw err
  }
  throw new Error('expected a SharingError')
}

const identity = (peer: Peer): JoinIdentity => ({
  installationId: peer.installationId,
  publicKeyPem: peer.publicKeyPem,
  operatorName: peer.operatorName,
  sign: (hex) => createSign('sha256').update(hex).sign(peer.privateKeyPem, 'base64')
})

// Lets the hub's microtasks and the server's awaits run until `until` holds.
async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 2000 && !until(); i++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  expect(until()).toBe(true)
}

function walkValid(caseId: string): boolean {
  const caseDir = caseDirOf(caseId)
  const { verification } = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir))
  return verification?.valid === true && verification.outcome === 'pass'
}

// What a declined join must leave untouched on the Owner.
function ownerSnapshot(caseId: string): unknown {
  const dir = caseDirOf(caseId)
  const files: Array<[string, string]> = []
  const visit = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const abs = join(at, entry.name)
      if (entry.isDirectory()) visit(abs)
      else files.push([abs.slice(dir.length), sha(readFileSync(abs))])
    }
  }
  visit(dir)
  return {
    manifest: ownChainText(caseId),
    row: getDb().prepare('SELECT * FROM cases WHERE id = ?').get(caseId),
    members: listCaseMembers(caseId),
    files: files.sort()
  }
}

describe('join handshake (#1810)', () => {
  let root: string
  let A: Peer
  let B: Peer
  let C: Peer
  let caseId: string
  let hub: MemoryHub
  let ownerNode: MemoryTransport
  let registry: InviteRegistry
  let server: JoinServer
  let served: Promise<void>[]
  let changed: string[]

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-join-'))
    C = await createPeer(root, 'carol', 'Carol Member', 'CM')
    B = await createPeer(root, 'bob', 'Bob Member', 'BM')
    A = await createPeer(root, 'alice', 'Alice Owner', 'AO')
    caseId = createCase({ name: 'Shared' }).id
    hub = new MemoryHub({ chunkSize: 512 })
    ownerNode = hub.createTransport('alice-node')
    registry = new InviteRegistry()
    served = []
    changed = []
    server = new JoinServer({
      nodeId: ownerNode.nodeId,
      registry,
      roster: listCaseMembers,
      caseName: (id) => getCase(id)?.name,
      addMember,
      tickets: (id) => ({ ...memberTickets(id), [A.installationId]: ownerNode.ticket }),
      rememberTicket: (id, installationId, ticket) =>
        rememberMemberTickets(id, { [installationId]: ticket }),
      onChanged: (id) => changed.push(id)
    })
    await ownerNode.listen((stream, peerNodeId) => {
      served.push(server.serve(stream, peerNodeId))
    })
    await shareCase(caseId, { nodeId: ownerNode.nodeId })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await ownerNode.close()
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  function inviteFor(id = caseId): { inviteId: string; invite: InviteFields } {
    const { inviteId, secret, expiresAt } = registry.open(id)
    return {
      inviteId,
      invite: {
        ticket: ownerNode.ticket,
        caseId: id,
        operatorName: 'Alice Owner',
        secret,
        expiresAt
      }
    }
  }

  // One node per join; the first for a peer is `<name>-node`, the rest are
  // numbered, since a hub holds one node per name.
  const nodes = new Map<string, number>()
  function joinAs(peer: Peer, invite: InviteFields, onStep?: (step: SharingJoinStep) => void) {
    const n = (nodes.get(peer.name) ?? 0) + 1
    nodes.set(peer.name, n)
    const transport = hub.createTransport(n === 1 ? `${peer.name}-node` : `${peer.name}-node-${n}`)
    return {
      transport,
      outcome: requestJoin({ transport, invite, identity: identity(peer), onStep })
    }
  }

  it('approves a join: one member-add under the joiner node, the welcome, and both walks pass', async () => {
    const { invite } = inviteFor()
    const steps: SharingJoinStep[] = []
    const { outcome } = joinAs(B, invite, (step) => steps.push(step))
    await settle(() => server.pendingJoins(caseId).length === 1)
    const [pending] = server.pendingJoins(caseId)
    expect(pending).toMatchObject({
      caseId,
      installationId: B.installationId,
      operatorName: 'Bob Member',
      suggestedMemberCode: 'BM'
    })
    expect(pending.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(changed).toEqual([caseId])
    expect(steps).toEqual(['connecting', 'waiting'])

    const member = await server.approve(caseId, pending.requestId, 'BM')
    expect(member).toMatchObject({ installationId: B.installationId, nodeId: 'bob-node' })
    const { welcome } = await outcome
    await Promise.all(served)
    expect(server.pendingJoins(caseId)).toEqual([])
    const chain = parsedChain(ownChainText(caseId))
    expect(chain.map((e) => e.type)).toEqual(['member-add', 'member-add'])
    expect(chain[1]).toMatchObject({ memberInstallationId: B.installationId, nodeId: 'bob-node' })
    expect(memberTickets(caseId)).toEqual({ [B.installationId]: 'mem:bob-node' })
    expect(welcome).toMatchObject({ caseId, caseName: 'Shared', ownerPublicKeyPem: A.publicKeyPem })
    expect(welcome.roster.map((m) => [m.installationId, m.role])).toEqual([
      [A.installationId, 'owner'],
      [B.installationId, 'member']
    ])
    expect(welcome.tickets).toEqual({
      [A.installationId]: ownerNode.ticket,
      [B.installationId]: 'mem:bob-node'
    })
    // The Owner's walk passes straight after the approval.
    expect(walkValid(caseId)).toBe(true)
    const fromAlice = recordSource(caseId, A)

    await activate(B)
    expect(getCase(caseId)).toBeUndefined()
    expect(adoptWelcome(welcome, invite.ticket)).toEqual({ caseId, caseName: 'Shared' })
    expect(getCase(caseId)).toMatchObject({
      id: caseId,
      name: 'Shared',
      ownerInstallationId: A.installationId
    })
    expect(typeof getCase(caseId)?.sharedAt).toBe('string')
    expect(listCaseMembers(caseId).map((m) => [m.installationId, m.memberCode, m.role])).toEqual([
      [A.installationId, 'AO', 'owner'],
      [B.installationId, 'BM', 'member']
    ])
    expect(memberTickets(caseId)).toEqual({ [A.installationId]: ownerNode.ticket })
    expect(ownChainText(caseId)).toBe('')
    expect(readdirSync(caseDirOf(caseId)).sort()).toEqual([
      'manifest.jsonl',
      'members.json',
      'sync-state.json'
    ])
    // The first session: Bob holds Alice's chain and his own merge, and his
    // walk passes.
    const first = await pull(caseId, fromAlice)
    expect(first.errors).toEqual([])
    expect(mergeEntries(caseId)).toHaveLength(1)
    expect(walkValid(caseId)).toBe(true)
    const fromBob = recordSource(caseId, B)

    await activate(A)
    expect(walkValid(caseId)).toBe(true)
    const back = await pull(caseId, fromBob)
    expect(back.errors).toEqual([])
    expect(back.entriesReceived).toBe(1)
    expect(walkValid(caseId)).toBe(true)
  })

  it('leaves a join pending when the entered code is refused, until a good one', async () => {
    const { invite } = inviteFor()
    const { outcome } = joinAs(B, invite)
    await settle(() => server.pendingJoins(caseId).length === 1)
    const [{ requestId }] = server.pendingJoins(caseId)
    const bytes = ownChainText(caseId)
    expect(await refused(() => server.approve(caseId, requestId, 'AO'))).toBe(
      'member-code-rejected'
    )
    expect(await refused(() => server.approve(caseId, requestId, 'bob'))).toBe(
      'member-code-rejected'
    )
    expect(ownChainText(caseId)).toBe(bytes)
    expect(server.pendingJoins(caseId)).toHaveLength(1)
    expect(await refused(() => server.approve('other-case', requestId, 'BM'))).toBe(
      'join-request-unknown'
    )
    expect(await refused(() => server.approve(caseId, 'nope', 'BM'))).toBe('join-request-unknown')
    await server.approve(caseId, requestId, 'B2')
    expect((await outcome).welcome.roster.at(-1)?.memberCode).toBe('B2')
  })

  it('declines a join and changes nothing on either installation', async () => {
    const { invite } = inviteFor()
    const before = ownerSnapshot(caseId)
    await activate(B)
    const joinerBefore = { cases: listCases(), root: readdirSync(B.storageRoot).sort() }
    await activate(A)
    const { outcome } = joinAs(B, invite)
    await settle(() => server.pendingJoins(caseId).length === 1)
    const [{ requestId }] = server.pendingJoins(caseId)
    await server.decline(caseId, requestId)
    expect(await refused(() => outcome)).toBe('declined')
    await Promise.all(served)
    expect(server.pendingJoins(caseId)).toEqual([])
    expect(ownerSnapshot(caseId)).toEqual(before)
    expect(await refused(() => server.decline(caseId, requestId))).toBe('join-request-unknown')
    await activate(B)
    expect({ cases: listCases(), root: readdirSync(B.storageRoot).sort() }).toEqual(joinerBefore)
  })

  it('refuses a reused, an expired, a cancelled and an unknown invite with the named code', async () => {
    const used = inviteFor()
    const { outcome } = joinAs(B, used.invite)
    await settle(() => server.pendingJoins(caseId).length === 1)
    await server.decline(caseId, server.pendingJoins(caseId)[0].requestId)
    await outcome.catch(() => {})
    expect(await refused(() => joinAs(C, used.invite).outcome)).toBe('invite-reused')

    const cancelled = inviteFor()
    registry.cancel(caseId, cancelled.inviteId)
    expect(await refused(() => joinAs(C, cancelled.invite).outcome)).toBe('invite-cancelled')

    const unknown = { ...inviteFor().invite, secret: new Uint8Array(16).fill(1) }
    expect(await refused(() => joinAs(C, unknown).outcome)).toBe('invite-unknown')
    const otherCase = { ...inviteFor().invite, caseId: 'another-case' }
    expect(await refused(() => joinAs(C, otherCase).outcome)).toBe('invite-unknown')

    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()
    const expired = inviteFor()
    vi.setSystemTime(new Date(start + INVITE_LIFETIME_MS))
    // The joiner's clock refuses before any dial; the Owner's decides for a
    // join whose invite text claims a later expiry.
    const joinerNode = hub.createTransport('carol-expired')
    const dial = vi.spyOn(joinerNode, 'dial')
    expect(
      await refused(() =>
        requestJoin({ transport: joinerNode, invite: expired.invite, identity: identity(C) })
      )
    ).toBe('invite-expired')
    expect(dial).not.toHaveBeenCalled()
    const claimed = {
      ...expired.invite,
      expiresAt: new Date(start + 2 * INVITE_LIFETIME_MS).toISOString()
    }
    expect(
      await refused(() =>
        requestJoin({ transport: joinerNode, invite: claimed, identity: identity(C) })
      )
    ).toBe('invite-expired')
    expect(server.pendingJoins(caseId)).toEqual([])
    expect(parsedChain(ownChainText(caseId))).toHaveLength(1)
  })

  it('refuses a join signed over another node id, and leaves the invite open', async () => {
    const { invite } = inviteFor()
    const node = hub.createTransport('bob-raw')
    const connection = await node.dial(invite.ticket)
    const stream = await node.openStream(connection)
    const reader = new MessageReader(stream)
    await writeMessage(stream, {
      t: 'join',
      caseId,
      secret: invite.secret,
      installationId: B.installationId,
      publicKeyPem: B.publicKeyPem,
      operatorName: B.operatorName,
      ticket: node.ticket,
      signature: identity(B).sign(
        joinDigest(caseId, invite.secret, 'some-other-node', B.installationId)
      )
    })
    const answer = await expectMessage(reader, 'join-refused')
    expect(answer.reason).toBe('join-signature-invalid')
    expect(await reader.next()).toBeNull()
    stream.close()
    expect(server.pendingJoins(caseId)).toEqual([])
    expect(registry.openInvites(caseId)).toHaveLength(1)

    // A signature by another key over the right digest fails the same way.
    const forged = await node.openStream(await node.dial(invite.ticket))
    const forgedReader = new MessageReader(forged)
    await writeMessage(forged, {
      t: 'join',
      caseId,
      secret: invite.secret,
      installationId: B.installationId,
      publicKeyPem: B.publicKeyPem,
      operatorName: B.operatorName,
      ticket: node.ticket,
      signature: identity(C).sign(
        joinDigest(caseId, invite.secret, ownerNode.nodeId, B.installationId)
      )
    })
    expect((await expectMessage(forgedReader, 'join-refused')).reason).toBe(
      'join-signature-invalid'
    )
    forged.close()

    // The invite is still good for a correct join.
    const { outcome } = joinAs(C, invite)
    await settle(() => server.pendingJoins(caseId).length === 1)
    await server.approve(caseId, server.pendingJoins(caseId)[0].requestId, 'CM')
    expect((await outcome).welcome.roster).toHaveLength(2)
  })

  it('refuses a member joining again without using the invite up', async () => {
    const first = inviteFor()
    const { outcome } = joinAs(B, first.invite)
    await settle(() => server.pendingJoins(caseId).length === 1)
    await server.approve(caseId, server.pendingJoins(caseId)[0].requestId, 'BM')
    await outcome
    const again = inviteFor()
    expect(await refused(() => joinAs(B, again.invite).outcome)).toBe('already-member')
    expect(registry.openInvites(caseId).map((i) => i.inviteId)).toEqual([again.inviteId])
    const { outcome: carol } = joinAs(C, again.invite)
    await settle(() => server.pendingJoins(caseId).length === 1)
    await server.approve(caseId, server.pendingJoins(caseId)[0].requestId, 'CM')
    expect((await carol).welcome.roster.map((m) => m.memberCode)).toEqual(['AO', 'BM', 'CM'])
  })

  it('forgets a join whose joiner left, and approve then names no request', async () => {
    const { invite } = inviteFor()
    const { transport, outcome } = joinAs(B, invite)
    await settle(() => server.pendingJoins(caseId).length === 1)
    const [{ requestId }] = server.pendingJoins(caseId)
    await transport.close()
    await expect(outcome).rejects.toThrow()
    await settle(() => server.pendingJoins(caseId).length === 0)
    expect(await refused(() => server.approve(caseId, requestId, 'BM'))).toBe(
      'join-request-unknown'
    )
    expect(parsedChain(ownChainText(caseId))).toHaveLength(1)
  })

  it('closes a stream that opens with something other than a join', async () => {
    const node = hub.createTransport('bob-raw')
    const stream = await node.openStream(await node.dial(ownerNode.ticket))
    await writeMessage(stream, { t: 'heads', heads: [] })
    expect(await new MessageReader(stream).next()).toBeNull()
    await Promise.all(served)
    expect(server.pendingJoins(caseId)).toEqual([])
  })

  it('closes a stream whose header announces more than a handshake frame', async () => {
    const node = hub.createTransport('bob-raw')
    const stream = await node.openStream(await node.dial(ownerNode.ticket))
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, MAX_HANDSHAKE_FRAME_BYTES + 1)
    await stream.write(header)
    expect(await new MessageReader(stream).next()).toBeNull()
    await Promise.all(served)
    expect(server.pendingJoins(caseId)).toEqual([])
  })

  // A fixed answer: an Owner and a joiner on different builds must agree on
  // this digest byte for byte, or no join verifies.
  it('digests the canonical join body to a fixed answer', () => {
    const secret = Uint8Array.from({ length: 16 }, (_, i) => i)
    const text =
      '{"caseId":"case-1","ownerNodeId":"node-owner","purpose":"birdbrain-invite-join",' +
      '"secret":"000102030405060708090a0b0c0d0e0f","signer":"installation-joiner"}'
    const digest = joinDigest('case-1', secret, 'node-owner', 'installation-joiner')
    expect(digest).toBe(createHash('sha256').update(text).digest('hex'))
    expect(digest).toBe('7eb4f0643ede31fadb295b080105c54f0dff4e6eaf10d1a5f128498f34996126')
  })

  describe('a crafted welcome', () => {
    // A listener standing in for an Owner that answers every join with the
    // welcome the test hands it.
    async function fakeOwner(
      welcome: (joinerId: string) => WelcomeMessage
    ): Promise<MemoryTransport> {
      const node = hub.createTransport('fake-owner')
      await node.listen((stream: ByteStream) => {
        void (async () => {
          const reader = new MessageReader(stream)
          const join = await expectMessage(reader, 'join')
          await writeMessage(stream, { t: 'join-pending' })
          await writeMessage(stream, welcome(join.installationId))
          stream.close()
        })()
      })
      return node
    }

    const member = (
      peer: Peer,
      role: 'owner' | 'member',
      at: number,
      revokedAtIndex: number | null = null
    ) => ({
      installationId: peer.installationId,
      publicKeyPem: peer.publicKeyPem,
      memberCode: peer.memberCode,
      operatorName: peer.operatorName,
      nodeId: `node-${peer.name}`,
      role,
      addedAtIndex: at,
      revokedAtIndex
    })

    it('is refused for each of the four checks, and nothing is written', async () => {
      const good = (joinerId: string): WelcomeMessage => ({
        t: 'welcome',
        caseId,
        caseName: 'Shared',
        ownerPublicKeyPem: A.publicKeyPem,
        roster: [member(A, 'owner', 0), { ...member(B, 'member', 1), installationId: joinerId }],
        tickets: {}
      })
      const variants: Array<[string, (joinerId: string) => WelcomeMessage]> = [
        ['another Case', (id) => ({ ...good(id), caseId: 'another-case' })],
        [
          'two Owners',
          (id) => ({ ...good(id), roster: [...good(id).roster, member(C, 'owner', 2)] })
        ],
        ['no Owner', (id) => ({ ...good(id), roster: [good(id).roster[1]] })],
        ['an Owner key that differs', (id) => ({ ...good(id), ownerPublicKeyPem: C.publicKeyPem })],
        ['a roster without the joiner', (id) => ({ ...good(id), roster: [good(id).roster[0]] })],
        [
          'the joiner under another key',
          (id) => ({
            ...good(id),
            roster: [good(id).roster[0], { ...good(id).roster[1], publicKeyPem: C.publicKeyPem }]
          })
        ],
        [
          'the joiner revoked',
          (id) => ({
            ...good(id),
            roster: [good(id).roster[0], { ...good(id).roster[1], revokedAtIndex: 2 }]
          })
        ],
        [
          'a Member Code outside the pattern',
          (id) => ({
            ...good(id),
            roster: [good(id).roster[0], { ...good(id).roster[1], memberCode: 'bm' }]
          })
        ]
      ]
      await activate(B)
      const before = { cases: listCases(), root: readdirSync(B.storageRoot).sort() }
      for (const [name, welcome] of variants) {
        const owner = await fakeOwner(welcome)
        const invite: InviteFields = {
          ticket: owner.ticket,
          caseId,
          operatorName: 'Fake',
          secret: new Uint8Array(16),
          expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS).toISOString()
        }
        const node = hub.createTransport(`bob-${variants.findIndex((v) => v[0] === name)}`)
        expect([
          name,
          await refused(() => requestJoin({ transport: node, invite, identity: identity(B) }))
        ]).toEqual([name, 'welcome-invalid'])
        await owner.close()
      }
      expect({ cases: listCases(), root: readdirSync(B.storageRoot).sort() }).toEqual(before)
      // The good welcome itself is accepted, so the refusals above are each
      // the variant's doing.
      const owner = await fakeOwner(good)
      const node = hub.createTransport('bob-good')
      const invite: InviteFields = {
        ticket: owner.ticket,
        caseId,
        operatorName: 'Fake',
        secret: new Uint8Array(16),
        expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS).toISOString()
      }
      const { welcome } = await requestJoin({ transport: node, invite, identity: identity(B) })
      expect(welcome.roster).toHaveLength(2)
      await owner.close()
    })
  })

  it('refuses to adopt a welcome for a Case this installation already holds', async () => {
    const welcome: WelcomeMessage = {
      t: 'welcome',
      caseId,
      caseName: 'Shared',
      ownerPublicKeyPem: A.publicKeyPem,
      roster: [
        {
          installationId: A.installationId,
          publicKeyPem: A.publicKeyPem,
          memberCode: 'AO',
          operatorName: 'Alice Owner',
          nodeId: 'alice-node',
          role: 'owner',
          addedAtIndex: 0,
          revokedAtIndex: null
        }
      ],
      tickets: {}
    }
    // The Owner pasting its own invite: the Case exists here.
    expect(await refused(async () => adoptWelcome(welcome, ownerNode.ticket))).toBe('case-exists')
    expect(listCaseMembers(caseId)).toHaveLength(1)
  })

  it('refuses a join to an Owner that is not listening', async () => {
    const { invite } = inviteFor()
    await ownerNode.close()
    expect(await refused(() => joinAs(B, invite).outcome)).toBe('owner-unreachable')
    ownerNode = hub.createTransport('alice-node')
  })
})
