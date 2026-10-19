import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { randomUUID } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { closeDatabase } from '@main/services/db/core'
import { upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createCase } from '@main/services/db/caseRepo'
import { resetInstallationId } from '@main/services/installationId'
import { logger } from '@main/services/logger'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { resetSigningKey } from '@main/services/signingKey'
import { SharingError } from '@main/services/sharing/errors'
import { encodeInvite } from '@main/services/sharing/invite'
import { pullFromPeer, serveSyncSession, type SyncSource } from '@main/services/sharing/session'
import { SharingService, type SharingServiceDeps } from '@main/services/sharing/sharingService'
import {
  SYNC_INTERVAL_MS,
  createSyncService,
  sharingSwitchedOff,
  type SyncService,
  type SyncServiceDeps
} from '@main/services/sharing/syncService'
import {
  getSyncState,
  readSyncStateFile,
  rememberMemberTickets,
  resetSyncStateMemory
} from '@main/services/sharing/syncState'
import { MemoryHub, type MemoryTransport, type Transport } from '@main/services/sharing/transport'
import type { SharingSyncOutcome } from '@shared/types'
import {
  activate,
  addDocument,
  caseDirOf,
  createPeer,
  memberOf,
  mergeEntries,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../../helpers/syncPeers'

// The sync service (#1881): when sessions run. The service runs on Alice;
// Bob and Carol answer from sources recorded while each was active, on nodes
// whose names match their roster node ids, so `mem:node-<name>` is the ticket
// a welcome would have stored. Only setInterval is faked: the sessions and
// the helpers below wait on setImmediate and setTimeout, which stay real.

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

async function turns(n = 50): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => (release = resolve))
  return { promise, release }
}

function newSharing(deps: Partial<SharingServiceDeps> = {}): SharingService {
  const receivedCaptures = createCaptureLifecycle({
    selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
  })
  return new SharingService({ receivedCaptures, ...deps })
}

// A teammate's node: every hello it answers, in order, by Case.
interface Listener {
  node: MemoryTransport
  hellos: string[]
  streams: number
  // When set, the node holds each stream it is handed until this settles.
  gate: Promise<void> | null
}

// How many streams the service's own transport has open at once.
interface StreamCount {
  open: number
  max: number
}

function counted(inner: Transport, count: StreamCount): Transport {
  return {
    get nodeId() {
      return inner.nodeId
    },
    get ticket() {
      return inner.ticket
    },
    listen: (onStream) => inner.listen(onStream),
    dial: (ticket) => inner.dial(ticket),
    nodeIdOf: (ticket) => inner.nodeIdOf(ticket),
    openStream: async (connection) => {
      const stream = await inner.openStream(connection)
      count.open += 1
      count.max = Math.max(count.max, count.open)
      let closed = false
      return {
        write: (chunk) => stream.write(chunk),
        read: () => stream.read(),
        close: () => {
          if (!closed) count.open -= 1
          closed = true
          stream.close()
        }
      }
    },
    close: () => inner.close()
  }
}

// Leaves the first dial or stream open the service makes unsettled, as a
// peer that never accepts the connection or grants no stream would.
function hangingOnce(inner: Transport, call: 'dial' | 'openStream'): Transport {
  let hung = false
  const once = <T>(which: typeof call, real: () => Promise<T>): Promise<T> => {
    if (which !== call || hung) return real()
    hung = true
    return new Promise<T>(() => {})
  }
  return {
    get nodeId() {
      return inner.nodeId
    },
    get ticket() {
      return inner.ticket
    },
    listen: (onStream) => inner.listen(onStream),
    dial: (ticket) => once('dial', () => inner.dial(ticket)),
    nodeIdOf: (ticket) => inner.nodeIdOf(ticket),
    openStream: (connection) => once('openStream', () => inner.openStream(connection)),
    close: () => inner.close()
  }
}

const outcomeKinds = (outcomes: SharingSyncOutcome[]): string[][] =>
  outcomes.map((o) => [o.installationId, o.outcome])

describe('sync service (#1881)', () => {
  let root: string
  let A: Peer
  let B: Peer
  let C: Peer
  let hub: MemoryHub
  let c1: string
  let c2: string
  let fromBob: Map<string, SyncSource>
  let fromCarol: Map<string, SyncSource>
  let sharing: SharingService
  let factory: ReturnType<typeof vi.fn<() => Promise<Transport | null>>>
  let service: SyncService | null
  let streams: StreamCount

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    root = mkdtempSync(join(tmpdir(), 'bb-sync-service-'))
    C = await createPeer(root, 'carol', 'Carol Member', 'CM')
    B = await createPeer(root, 'bob', 'Bob Member', 'BM')
    A = await createPeer(root, 'alice', 'Alice Owner', 'AO')
    hub = new MemoryHub({ chunkSize: 4096 })
    c1 = randomUUID()
    c2 = randomUUID()
    service = null
    streams = { open: 0, max: 0 }
  })

  afterEach(async () => {
    await service?.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  // Alice owns c1 with Bob, Carol and Dave (revoked); Bob owns c2, which
  // Alice joined. Bob and Carol each hold a document Alice lacks. Leaves
  // Alice active.
  async function seedTeam({ tickets = true } = {}): Promise<void> {
    await activate(B)
    seedSharedCase(c1, A, [B, C])
    addDocument(c1, B, 1)
    seedSharedCase(c2, B, [A])
    addDocument(c2, B, 1)
    fromBob = new Map([
      [c1, recordSource(c1, B)],
      [c2, recordSource(c2, B)]
    ])
    await activate(C)
    seedSharedCase(c1, A, [B, C])
    addDocument(c1, C, 1)
    fromCarol = new Map([[c1, recordSource(c1, C)]])
    await activate(A)
    seedSharedCase(c1, A, [B, C])
    upsertCaseMember({
      ...memberOf(c1, C, 'member', 3),
      installationId: 'installation-dave',
      publicKeyPem: 'k',
      memberCode: 'DV',
      nodeId: 'node-dave',
      revokedAtIndex: 4
    })
    seedSharedCase(c2, B, [A])
    if (!tickets) return
    rememberMemberTickets(c1, {
      [B.installationId]: 'mem:node-bob',
      [C.installationId]: 'mem:node-carol'
    })
    rememberMemberTickets(c2, { [B.installationId]: 'mem:node-bob' })
  }

  async function listener(name: string, sources: Map<string, SyncSource>): Promise<Listener> {
    const node = hub.createTransport(`node-${name}`)
    const l: Listener = { node, hellos: [], streams: 0, gate: null }
    await node.listen((stream) => {
      l.streams += 1
      const gate = l.gate
      // A stream the service closed while it was held throws on the
      // listener's first write; that end of the session is not under test.
      void (async () => {
        if (gate) await gate
        await serveSyncSession(stream, (id) => {
          l.hellos.push(id)
          return sources.get(id) ?? null
        })
      })().catch(() => {})
    })
    return l
  }

  function build(
    deps: Partial<SharingServiceDeps> = {},
    syncDeps: Partial<SyncServiceDeps> = {}
  ): SyncService {
    sharing = newSharing(deps)
    factory = vi.fn(async () => counted(hub.createTransport('node-alice'), streams))
    service = createSyncService({ sharing, transportFactory: factory, ...syncDeps })
    return service
  }

  // What each syncNow call the spy saw resolved to, by Case.
  async function outcomesOf(
    spy: MockInstance<SharingService['syncNow']>
  ): Promise<Map<string, SharingSyncOutcome[]>> {
    const byCase = new Map<string, SharingSyncOutcome[]>()
    for (const [at, [caseId]] of spy.mock.calls.entries()) {
      byCase.set(caseId, await (spy.mock.results[at].value as Promise<SharingSyncOutcome[]>))
    }
    return byCase
  }

  it('start runs one session per member in good standing for an Owned and a joined Case, and returns first', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    const carol = await listener('carol', fromCarol)
    const svc = build()
    const syncNow = vi.spyOn(sharing, 'syncNow')
    svc.start()
    expect(bob.hellos).toEqual([])
    expect(carol.hellos).toEqual([])
    await svc.idle()
    expect([...bob.hellos].sort()).toEqual([c1, c2].sort())
    expect(carol.hellos).toEqual([c1])
    const outcomes = await outcomesOf(syncNow)
    expect(outcomeKinds(outcomes.get(c1) ?? [])).toEqual([
      [B.installationId, 'synced'],
      [C.installationId, 'synced']
    ])
    expect(outcomeKinds(outcomes.get(c2) ?? [])).toEqual([[B.installationId, 'synced']])
    expect(mergeEntries(c1)).toHaveLength(2)
    expect(mergeEntries(c2)).toHaveLength(1)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('runs a round every 60 s and none at 59 s', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    const carol = await listener('carol', fromCarol)
    const svc = build()
    svc.start()
    await svc.idle()
    expect(vi.getTimerCount()).toBe(1)
    expect(SYNC_INTERVAL_MS).toBe(60_000)
    vi.advanceTimersByTime(59_000)
    await svc.idle()
    await turns()
    expect(bob.hellos).toHaveLength(2)
    vi.advanceTimersByTime(1_000)
    await svc.idle()
    expect(bob.hellos).toHaveLength(4)
    expect(carol.hellos).toHaveLength(2)
  })

  it("a tick during a running round starts nothing, and one Case's members are pulled in turn", async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    const carol = await listener('carol', fromCarol)
    const held = deferred()
    bob.gate = held.promise
    const svc = build()
    const syncNow = vi.spyOn(sharing, 'syncNow')
    svc.start()
    await settle(() => bob.streams === 1)
    vi.advanceTimersByTime(60_000)
    vi.advanceTimersByTime(60_000)
    await turns()
    expect(syncNow).toHaveBeenCalledTimes(1)
    expect(bob.streams).toBe(1)
    expect(bob.hellos).toEqual([])
    expect(carol.streams).toBe(0)
    bob.gate = null
    held.release()
    await svc.idle()
    expect(carol.hellos).toEqual([c1])
    expect(streams.max).toBe(1)
  })

  it('a Sync now during a round shares the running session and starts no second one', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    await listener('carol', fromCarol)
    const held = deferred()
    bob.gate = held.promise
    const svc = build()
    const syncNow = vi.spyOn(sharing, 'syncNow')
    svc.start()
    await settle(() => bob.streams === 1)
    expect(syncNow.mock.calls[0][0]).toBe(c1)
    const inRound = syncNow.mock.results[0].value as Promise<SharingSyncOutcome[]>
    const pressed = sharing.syncNow(c1)
    expect(pressed).toBe(inRound)
    bob.gate = null
    held.release()
    await svc.idle()
    expect(await pressed).toEqual(await inRound)
    expect(bob.hellos.filter((id) => id === c1)).toHaveLength(1)
    await turns()
    expect(bob.hellos.filter((id) => id === c1)).toHaveLength(1)
  })

  it('does not dial a member revoked between ticks', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    const carol = await listener('carol', fromCarol)
    const svc = build()
    svc.start()
    await svc.idle()
    expect(carol.hellos).toEqual([c1])
    upsertCaseMember({ ...memberOf(c1, C, 'member', 2), revokedAtIndex: 5 })
    vi.advanceTimersByTime(60_000)
    await svc.idle()
    expect(carol.hellos).toEqual([c1])
    expect(carol.streams).toBe(1)
    expect(bob.hellos.filter((id) => id === c1)).toHaveLength(2)
  })

  it('does not dial a member revoked earlier in the same round', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    const carol = await listener('carol', fromCarol)
    const held = deferred()
    bob.gate = held.promise
    const svc = build()
    const syncNow = vi.spyOn(sharing, 'syncNow')
    svc.start()
    await settle(() => bob.streams === 1)
    upsertCaseMember({ ...memberOf(c1, C, 'member', 2), revokedAtIndex: 5 })
    bob.gate = null
    held.release()
    await svc.idle()
    expect(carol.streams).toBe(0)
    expect(outcomeKinds((await outcomesOf(syncNow)).get(c1) ?? [])).toEqual([
      [B.installationId, 'synced']
    ])
  })

  it('ends the round for a Case whose own row is revoked during it, and reaches nobody in it', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    const carol = await listener('carol', fromCarol)
    const held = deferred()
    bob.gate = held.promise
    const svc = build()
    svc.start()
    await settle(() => bob.streams === 1)
    upsertCaseMember({ ...memberOf(c1, A, 'owner', 0), revokedAtIndex: 5 })
    bob.gate = null
    held.release()
    await svc.idle()
    expect(bob.hellos).toContain(c1)
    expect(carol.streams).toBe(0)
    expect(getSyncState(c1).peersReachable).toBe(0)
  })

  it('forgets the members it reached once its own row is revoked between ticks', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    await listener('carol', fromCarol)
    const svc = build()
    svc.start()
    await svc.idle()
    expect(getSyncState(c2).peersReachable).toBe(1)
    upsertCaseMember({ ...memberOf(c2, A, 'member', 1), revokedAtIndex: 2 })
    vi.advanceTimersByTime(60_000)
    await svc.idle()
    expect(bob.hellos.filter((id) => id === c2)).toHaveLength(1)
    expect(getSyncState(c2).peersReachable).toBe(0)
  })

  it('runs no session for a Case whose own row is revoked', async () => {
    const c3 = randomUUID()
    seedSharedCase(c3, B, [A])
    upsertCaseMember({ ...memberOf(c3, A, 'member', 1), revokedAtIndex: 2 })
    rememberMemberTickets(c3, { [B.installationId]: 'mem:node-bob' })
    const bob = await listener('bob', new Map())
    const svc = build()
    svc.start()
    await svc.idle()
    expect(await sharing.syncNow(c3)).toEqual([])
    expect(factory).not.toHaveBeenCalled()
    expect(bob.streams).toBe(0)
    expect(getSyncState(c3).peersReachable).toBe(0)
  })

  it('peersReachable follows the latest round, and an unanswered dial records no error', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    await listener('carol', fromCarol)
    const svc = build()
    svc.start()
    await svc.idle()
    expect(getSyncState(c1).peersReachable).toBe(2)
    const before = readSyncStateFile(caseDirOf(c1)).peers[B.installationId]
    expect(before).toBeDefined()

    await bob.node.close()
    vi.advanceTimersByTime(60_000)
    await svc.idle()
    const state = getSyncState(c1)
    expect(state.peersReachable).toBe(1)
    expect(state.lastError).toBeNull()
    expect(state.phase).toBe('idle')
    expect(readSyncStateFile(caseDirOf(c1)).peers[B.installationId]).toEqual(before)

    const back = await listener('bob', fromBob)
    vi.advanceTimersByTime(60_000)
    await svc.idle()
    expect(back.hellos).toContain(c1)
    expect(getSyncState(c1).peersReachable).toBe(2)
  })

  it('a peer that answers and then goes silent records kind peer', async () => {
    await seedTeam()
    const silent = hub.createTransport('node-bob')
    await silent.listen((stream) => void stream.read())
    const carol = await listener('carol', fromCarol)
    const svc = build({ sessionIdleMs: 50 })
    const syncNow = vi.spyOn(sharing, 'syncNow')
    svc.start()
    await svc.idle()
    expect(getSyncState(c1).lastError?.kind).toBe('peer')
    expect(carol.hellos).toEqual([c1])
    const [fromSilent] = (await outcomesOf(syncNow)).get(c1) ?? []
    expect(fromSilent).toMatchObject({ installationId: B.installationId, errors: 1 })
    expect(getSyncState(c1).peersReachable).toBe(1)
  })

  it.each([
    ['a dial', 'dial', 'unreachable'],
    ['a stream open', 'openStream', 'failed']
  ] as const)(
    '%s that never settles ends that member at the idle bound, and later rounds run',
    async (_, call, outcome) => {
      await seedTeam()
      const bob = await listener('bob', fromBob)
      const carol = await listener('carol', fromCarol)
      const svc = build({ sessionIdleMs: 50 })
      factory.mockImplementation(async () => hangingOnce(hub.createTransport('node-alice'), call))
      const syncNow = vi.spyOn(sharing, 'syncNow')
      svc.start()
      await svc.idle()
      expect(outcomeKinds((await outcomesOf(syncNow)).get(c1) ?? [])).toEqual([
        [B.installationId, outcome],
        [C.installationId, 'synced']
      ])
      expect(carol.hellos).toEqual([c1])
      vi.advanceTimersByTime(60_000)
      await svc.idle()
      expect(bob.hellos.filter((id) => id === c1)).toHaveLength(1)
      expect(carol.hellos).toEqual([c1, c1])
    }
  )

  it('opens no transport without a Shared Case, and the first invite opens it once', async () => {
    const caseId = createCase({ name: 'Private' }).id
    const svc = build()
    svc.start()
    vi.advanceTimersByTime(180_000)
    await svc.idle()
    expect(factory).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    await sharing.createInvite(caseId)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    const syncNow = vi.spyOn(sharing, 'syncNow')
    vi.advanceTimersByTime(60_000)
    await svc.idle()
    expect(syncNow).toHaveBeenCalledWith(caseId)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('a join starts the transport once', async () => {
    const svc = build()
    svc.start()
    await svc.idle()
    const invite = encodeInvite({
      ticket: 'mem:node-nobody',
      caseId: '0196f7a2-aaaa-bbbb-cccc-0000000000ff',
      operatorName: 'Bob Member',
      secret: new Uint8Array(16),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    expect(await refused(() => sharing.joinCase(invite))).toBe('owner-unreachable')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('answers a roster member that dials it', async () => {
    await seedTeam({ tickets: false })
    const fromAlice = recordSource(c1, A)
    const svc = build({ sourceFor: (id) => (id === c1 ? fromAlice : null) })
    const syncNow = vi.spyOn(sharing, 'syncNow')
    svc.start()
    await svc.idle()
    expect(outcomeKinds((await outcomesOf(syncNow)).get(c1) ?? [])).toEqual([
      [B.installationId, 'no-address'],
      [C.installationId, 'no-address']
    ])
    expect(hub.listeningNode('mem:node-alice')).toBeDefined()

    await activate(B)
    const bobNode = hub.createTransport('node-bob')
    const result = await pullFromPeer(
      c1,
      await bobNode.openStream(await bobNode.dial('mem:node-alice')),
      {
        receivedCaptures: createCaptureLifecycle({
          selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
        })
      }
    )
    await activate(A)
    expect(result.peerInstallationId).toBe(A.installationId)
    expect(result.errors).toEqual([])
  })

  it('dials a member at its stored ticket, not one built from its node id', async () => {
    await seedTeam({ tickets: false })
    rememberMemberTickets(c1, { [B.installationId]: 'mem:node-bob' })
    await listener('bob', fromBob)
    const carol = await listener('carol', fromCarol)
    const svc = build()
    const syncNow = vi.spyOn(sharing, 'syncNow')
    svc.start()
    await svc.idle()
    expect(outcomeKinds((await outcomesOf(syncNow)).get(c1) ?? [])).toEqual([
      [B.installationId, 'synced'],
      [C.installationId, 'no-address']
    ])
    expect(carol.streams).toBe(0)
    expect(getSyncState(c1).peersReachable).toBe(1)

    rememberMemberTickets(c1, { [C.installationId]: 'mem:node-carol' })
    vi.advanceTimersByTime(60_000)
    await svc.idle()
    expect(carol.hellos).toEqual([c1])
    expect(getSyncState(c1).peersReachable).toBe(2)
  })

  it('stop clears the timer, closes the transport and starts nothing after', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    await listener('carol', fromCarol)
    const svc = build()
    svc.start()
    await svc.idle()
    expect(vi.getTimerCount()).toBe(1)
    await svc.stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(hub.listeningNode('mem:node-alice')).toBeUndefined()
    const seen = bob.hellos.length
    vi.advanceTimersByTime(180_000)
    svc.start()
    await svc.idle()
    await turns()
    expect(bob.hellos).toHaveLength(seen)
    expect(await refused(() => sharing.syncNow(c1))).toBe('sharing-unavailable')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('stop mid-round ends the round before its next member', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    const carol = await listener('carol', fromCarol)
    const held = deferred()
    bob.gate = held.promise
    const svc = build()
    svc.start()
    await settle(() => bob.streams === 1)
    const stopping = svc.stop()
    held.release()
    await stopping
    await svc.idle()
    await turns()
    expect(carol.streams).toBe(0)
    expect(hub.listeningNode('mem:node-alice')).toBeUndefined()
  })

  it.each([
    [
      'throws',
      async (): Promise<Transport | null> => {
        throw new SharingError('relay-unreachable')
      }
    ],
    ['returns null', async (): Promise<Transport | null> => null]
  ])('a factory that %s leaves the service off', async (_, start) => {
    await seedTeam()
    const info = vi.spyOn(logger, 'info')
    sharing = newSharing()
    factory = vi.fn(start)
    service = createSyncService({ sharing, transportFactory: factory })
    const svc = service
    expect(() => svc.start()).not.toThrow()
    await svc.idle()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith('sharing', 'sharing.sync_off', undefined, expect.any(Error))
    vi.advanceTimersByTime(180_000)
    await svc.idle()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a later command that starts the transport arms the timer', async () => {
    await seedTeam()
    const bob = await listener('bob', fromBob)
    await listener('carol', fromCarol)
    sharing = newSharing()
    factory = vi.fn<() => Promise<Transport | null>>()
    factory.mockResolvedValueOnce(null)
    factory.mockImplementation(async () => hub.createTransport('node-alice'))
    service = createSyncService({ sharing, transportFactory: factory })
    service.start()
    await service.idle()
    expect(vi.getTimerCount()).toBe(0)
    expect(bob.hellos).toEqual([])
    await sharing.syncNow(c1)
    expect(vi.getTimerCount()).toBe(1)
    expect(bob.hellos).toEqual([c1])
    vi.advanceTimersByTime(60_000)
    await service.idle()
    expect(bob.hellos.filter((id) => id === c1)).toHaveLength(2)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('the e2e switch keeps the factory uncalled', async () => {
    await seedTeam()
    const svc = build({}, { switchedOff: true })
    svc.start()
    vi.advanceTimersByTime(120_000)
    await svc.idle()
    expect(factory).not.toHaveBeenCalled()
    expect(await refused(() => sharing.syncNow(c1))).toBe('sharing-unavailable')
    expect(factory).not.toHaveBeenCalled()
  })

  it('sharingSwitchedOff reads the switch only when allowed', () => {
    expect(sharingSwitchedOff('1', true)).toBe(true)
    expect(sharingSwitchedOff('1', false)).toBe(false)
    expect(sharingSwitchedOff(undefined, true)).toBe(false)
    expect(sharingSwitchedOff('0', true)).toBe(false)
  })
})
