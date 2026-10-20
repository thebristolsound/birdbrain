import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase } from '@main/services/db/core'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import {
  IrohTransport,
  irohBinding,
  startIrohTransport
} from '@main/services/sharing/irohTransport'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import {
  activate,
  addDocument,
  appendOwnChainLine,
  createPeer,
  memberAddBody,
  memberChainText,
  ownChainText,
  pull,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../../helpers/syncPeers'

// The Iroh transport over the real binding (#1809). Opt in with
// BIRDBRAIN_IROH_SMOKE=1. It needs internet access: both endpoints reach n0's
// public relays, and the tickets name the relay only, so the first connection
// starts there (it may then move to a direct path between the two). Skipped,
// not failed, when the flag is unset or the binding does not load.

const binding = irohBinding()
const enabled = process.env.BIRDBRAIN_IROH_SMOKE === '1' && binding !== null

describe.skipIf(!enabled)('Iroh transport smoke test (#1809)', () => {
  const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-0000000a1809'
  let root: string
  let A: Peer
  let B: Peer
  const open: IrohTransport[] = []

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-iroh-smoke-'))
    A = await createPeer(root, 'alice', 'Alice Owner', 'AL')
    B = await createPeer(root, 'bob', 'Bob Member', 'BO')
    for (const peer of [A, B]) {
      await activate(peer)
      seedSharedCase(CASE_ID, A, [B])
    }
    await activate(A)
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, A, 'owner', A))
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, B, 'member', A))
  })

  afterEach(async () => {
    for (const transport of open.splice(0)) await transport.close()
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  const started = async (dir: string): Promise<IrohTransport> => {
    const transport = await startIrohTransport({ userDataDir: dir, cipher: null, relayUrl: '' })
    if (transport === null) throw new Error('binding did not load')
    open.push(transport)
    return transport
  }

  it(
    'runs one sync session between two endpoints through the relay',
    { timeout: 120_000 },
    async () => {
      addDocument(CASE_ID, A, 1)
      const ownerChain = ownChainText(CASE_ID)
      const source = recordSource(CASE_ID, A)
      const listener = await started(A.dir)
      const dialer = await started(B.dir)

      // The ticket names the node id and the relay, and no direct address.
      const addr = binding!.EndpointTicket.fromString(listener.ticket).endpointAddr()
      expect(addr.id().toString()).toBe(listener.nodeId)
      expect(addr.relayUrl()).toMatch(/^https:\/\//)
      expect(addr.directAddresses()).toEqual([])

      await activate(B)
      const began = performance.now()
      const result = await pull(CASE_ID, source, {}, {}, { dialer, listener })
      const sessionMs = Math.round(performance.now() - began)
      console.log(`[iroh smoke] one sync session took ${sessionMs} ms`)
      expect(result.errors).toEqual([])
      expect(result.entriesReceived).toBe(3)
      expect(memberChainText(CASE_ID, A)).toBe(ownerChain)
    }
  )

  it(
    'keeps the node id across restarts, and a fresh directory gets another',
    { timeout: 120_000 },
    async () => {
      const first = await started(A.dir)
      const nodeId = first.nodeId
      await first.close()
      open.splice(open.indexOf(first), 1)
      expect((await started(A.dir)).nodeId).toBe(nodeId)
      expect((await started(mkdtempSync(join(root, 'fresh-')))).nodeId).not.toBe(nodeId)
    }
  )
})
