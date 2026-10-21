import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createServer, type AddressInfo } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase } from '@main/services/db/core'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import {
  E2E_SHARING_BRIDGE_SWITCH,
  LOOPBACK_HOST,
  LoopbackTransport,
  sharingBridgeDirectory,
  startLoopbackTransport
} from '@main/services/sharing/loopbackTransport'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import { PeerUnreachableError, type ByteStream } from '@main/services/sharing/transport'
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

// The test-only bridge between two Birdbrain processes on one machine
// (#1882). Two transports in one process stand in for the two launches: each
// records its port in the shared directory and dials the other by node id.

async function readBytes(stream: ByteStream, length: number): Promise<string> {
  const pieces: Uint8Array[] = []
  let got = 0
  while (got < length) {
    const piece = await stream.read()
    if (piece === null) break
    pieces.push(piece)
    got += piece.length
  }
  return Buffer.concat(pieces).toString()
}

// A stream the listener accepted, with the node id its header line named.
function accepted(transport: LoopbackTransport): Promise<{ stream: ByteStream; peer: string }> {
  return new Promise((resolve) => {
    void transport.listen((stream, peer) => resolve({ stream, peer }))
  })
}

async function unreachable(run: () => Promise<unknown>): Promise<void> {
  await expect(run()).rejects.toBeInstanceOf(PeerUnreachableError)
}

describe('sharingBridgeDirectory', () => {
  it('names the switch the e2e spec sets', () => {
    expect(E2E_SHARING_BRIDGE_SWITCH).toBe('BIRDBRAIN_E2E_SHARING_BRIDGE')
  })

  it('selects the bridge only in a run from source with a directory set', () => {
    expect(sharingBridgeDirectory('/tmp/bridge', true)).toBe('/tmp/bridge')
    expect(sharingBridgeDirectory(' /tmp/bridge ', true)).toBe('/tmp/bridge')
    expect(sharingBridgeDirectory(undefined, true)).toBeNull()
    expect(sharingBridgeDirectory('', true)).toBeNull()
    expect(sharingBridgeDirectory('   ', true)).toBeNull()
  })

  it('never selects the bridge in a packaged run, switch or no switch', () => {
    expect(sharingBridgeDirectory('/tmp/bridge', false)).toBeNull()
    expect(sharingBridgeDirectory(undefined, false)).toBeNull()
  })
})

describe('LoopbackTransport', () => {
  let directory: string
  const open: LoopbackTransport[] = []

  async function start(nodeId: string): Promise<LoopbackTransport> {
    const transport = await startLoopbackTransport({ directory, nodeId })
    open.push(transport)
    return transport
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bb-loopback-'))
  })

  afterEach(async () => {
    for (const transport of open.splice(0)) await transport.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('listens on 127.0.0.1 only and records its port under its node id', async () => {
    const transport = await start('owner')
    expect(transport.address.address).toBe(LOOPBACK_HOST)
    expect(transport.address.port).toBeGreaterThan(0)
    expect(readdirSync(directory)).toEqual(['owner.json'])
    expect(JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf-8'))).toEqual({
      host: LOOPBACK_HOST,
      port: transport.address.port
    })
  })

  it('creates the directory when it does not exist yet', async () => {
    directory = join(directory, 'nested', 'bridge')
    const transport = await start('owner')
    expect(readdirSync(directory)).toEqual(['owner.json'])
    await transport.close()
    open.length = 0
  })

  it('reads the node a ticket names', async () => {
    const transport = await start('node-a')
    expect(transport.ticket).toBe('loop:node-a')
    expect(transport.ticket).not.toContain(String(transport.address.port))
    expect(transport.nodeIdOf('loop:node-b')).toBe('node-b')
    expect(transport.nodeIdOf('loop:')).toBeNull()
    expect(transport.nodeIdOf('mem:node-b')).toBeNull()
    expect(transport.nodeIdOf('node-b')).toBeNull()
  })

  it('carries bytes both ways and tells the listener who dialed', async () => {
    const listener = await start('listener')
    const dialer = await start('dialer')
    const incoming = accepted(listener)
    const connection = await dialer.dial(listener.ticket)
    expect(connection.peerNodeId).toBe('listener')
    const near = await dialer.openStream(connection)
    await near.write(Buffer.from('hello there'))
    const { stream: far, peer } = await incoming
    expect(peer).toBe('dialer')
    expect(await readBytes(far, 11)).toBe('hello there')
    await far.write(Buffer.from('and back'))
    expect(await readBytes(near, 8)).toBe('and back')
    near.close()
    expect(await far.read()).toBeNull()
  })

  it('delivers a large write whole, however the socket splits it', async () => {
    const listener = await start('listener')
    const dialer = await start('dialer')
    const incoming = accepted(listener)
    const connection = await dialer.dial(listener.ticket)
    const near = await dialer.openStream(connection)
    const payload = 'x'.repeat(1024 * 1024)
    const sent = near.write(Buffer.from(payload))
    const { stream: far } = await incoming
    expect(await readBytes(far, payload.length)).toBe(payload)
    await sent
    near.close()
  })

  it('opens one stream per openStream, each with its own header', async () => {
    const listener = await start('listener')
    const dialer = await start('dialer')
    const peers: string[] = []
    const streams: ByteStream[] = []
    await listener.listen((stream, peer) => {
      peers.push(peer)
      streams.push(stream)
    })
    const connection = await dialer.dial(listener.ticket)
    const first = await dialer.openStream(connection)
    const second = await dialer.openStream(connection)
    await first.write(Buffer.from('1'))
    await second.write(Buffer.from('2'))
    await expect.poll(() => streams.length).toBe(2)
    expect(peers).toEqual(['dialer', 'dialer'])
    const bytes = await Promise.all(streams.map((s) => readBytes(s, 1)))
    expect(bytes.sort()).toEqual(['1', '2'])
    connection.close()
    expect(await streams[0].read()).toBeNull()
    expect(await streams[1].read()).toBeNull()
  })

  it('refuses a ticket this transport does not read', async () => {
    const dialer = await start('dialer')
    await unreachable(() => dialer.dial('mem:listener'))
    await unreachable(() => dialer.dial('loop:'))
  })

  it('refuses a node the directory does not name', async () => {
    const dialer = await start('dialer')
    await unreachable(() => dialer.dial('loop:nobody'))
  })

  it('refuses a node whose recorded port no longer answers', async () => {
    const dialer = await start('dialer')
    const gone = createServer()
    await new Promise<void>((resolve) => gone.listen(0, LOOPBACK_HOST, resolve))
    const { port } = gone.address() as AddressInfo
    await new Promise<void>((resolve) => gone.close(() => resolve()))
    writeFileSync(join(directory, 'gone.json'), JSON.stringify({ host: LOOPBACK_HOST, port }))
    await unreachable(() => dialer.dial('loop:gone'))
  })

  it('refuses a record that names another host or no port', async () => {
    const dialer = await start('dialer')
    writeFileSync(join(directory, 'elsewhere.json'), JSON.stringify({ host: '10.0.0.1', port: 1 }))
    writeFileSync(join(directory, 'portless.json'), JSON.stringify({ host: LOOPBACK_HOST }))
    writeFileSync(join(directory, 'broken.json'), '{')
    await unreachable(() => dialer.dial('loop:elsewhere'))
    await unreachable(() => dialer.dial('loop:portless'))
    await unreachable(() => dialer.dial('loop:broken'))
  })

  it('reaches a listening node and a probe leaves no stream behind', async () => {
    const listener = await start('listener')
    const dialer = await start('dialer')
    let handled = 0
    await listener.listen(() => {
      handled += 1
    })
    const connection = await dialer.dial(listener.ticket)
    expect(connection.peerNodeId).toBe('listener')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(handled).toBe(0)
  })

  it('closes a stream that arrives before listen', async () => {
    const listener = await start('listener')
    const dialer = await start('dialer')
    const connection = await dialer.dial(listener.ticket)
    const near = await dialer.openStream(connection)
    expect(await near.read()).toBeNull()
  })

  it('closes a stream whose header line is over the bound or empty', async () => {
    const listener = await start('listener')
    const dialer = await start('dialer')
    let handled = 0
    await listener.listen(() => {
      handled += 1
    })
    const connection = await dialer.dial(listener.ticket)
    const tooLong = await dialer.openStream(connection)
    // The transport wrote its own header already; a header this long on a
    // raw socket is what the bound refuses.
    const { connect } = await import('net')
    const raw = connect({ host: LOOPBACK_HOST, port: listener.address.port })
    await new Promise<void>((resolve) => raw.once('connect', resolve))
    raw.write('y'.repeat(300))
    await new Promise<void>((resolve) => raw.once('close', resolve))
    const empty = connect({ host: LOOPBACK_HOST, port: listener.address.port })
    await new Promise<void>((resolve) => empty.once('connect', resolve))
    empty.write('\n')
    await new Promise<void>((resolve) => empty.once('close', resolve))
    tooLong.close()
    expect(handled).toBe(1)
  })

  it('refuses a connection another transport dialed', async () => {
    const listener = await start('listener')
    const dialer = await start('dialer')
    const other = await start('other')
    await listener.listen(() => {})
    const connection = await dialer.dial(listener.ticket)
    await expect(other.openStream(connection)).rejects.toThrow('not dialed from this transport')
  })

  it('close ends its streams, stops answering and removes its record', async () => {
    const listener = await start('listener')
    const dialer = await start('dialer')
    const incoming = accepted(listener)
    const connection = await dialer.dial(listener.ticket)
    const near = await dialer.openStream(connection)
    await near.write(Buffer.from('x'))
    const { stream: far } = await incoming
    await listener.close()
    // What arrived before the close is still read; the end comes after it.
    expect(await far.read()).toEqual(Uint8Array.from(Buffer.from('x')))
    expect(await far.read()).toBeNull()
    expect(await near.read()).toBeNull()
    await expect(near.write(Buffer.from('y'))).rejects.toThrow('Stream is closed')
    expect(readdirSync(directory)).toEqual(['dialer.json'])
    await unreachable(() => dialer.dial('loop:listener'))
    await expect(listener.listen(() => {})).rejects.toThrow('is closed')
    await expect(listener.dial(dialer.ticket)).rejects.toThrow('is closed')
    await listener.close()
  })

  it('listens at most once', async () => {
    const listener = await start('listener')
    await listener.listen(() => {})
    await expect(listener.listen(() => {})).rejects.toThrow('already listening')
  })
})

describe('a sync session over the loopback bridge (#1882)', () => {
  const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000001882'
  let root: string
  let A: Peer
  let B: Peer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-loopback-session-'))
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

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  it("copies the Owner's chain to the member", async () => {
    addDocument(CASE_ID, A, 1)
    const ownerChain = ownChainText(CASE_ID)
    const source = recordSource(CASE_ID, A)
    await activate(B)
    const directory = join(root, 'bridge')
    const listener = await startLoopbackTransport({ directory, nodeId: 'alice' })
    const dialer = await startLoopbackTransport({ directory, nodeId: 'bob' })
    const result = await pull(CASE_ID, source, {}, {}, { dialer, listener })
    expect(result.errors).toEqual([])
    expect(result.entriesReceived).toBe(3)
    expect(memberChainText(CASE_ID, A)).toBe(ownerChain)
    await dialer.close()
    await listener.close()
  })
})
