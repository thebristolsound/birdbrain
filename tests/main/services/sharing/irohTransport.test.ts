import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase } from '@main/services/db/core'
import { resetInstallationId } from '@main/services/installationId'
import { getSettings, initSettings, updateSettings } from '@main/services/settings'
import { resetSigningKey } from '@main/services/signingKey'
import { SharingError } from '@main/services/sharing/errors'
import {
  IrohTransport,
  MAX_CONNECTIONS_PER_NODE,
  MAX_INCOMING_CONNECTIONS,
  SYNC_ALPN,
  createBindingLoader,
  irohBinding,
  isSharingAvailable,
  setRelayUrl,
  startIrohTransport,
  transportFailure,
  type IrohBinding
} from '@main/services/sharing/irohTransport'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import {
  PeerUnreachableError,
  TransportError,
  type ByteStream
} from '@main/services/sharing/transport'
import { FakeIrohNetwork } from '../../../helpers/fakeIroh'
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

// The Iroh transport (#1809) over an in-process stand-in for the binding
// (tests/helpers/fakeIroh.ts), so the transport's own code runs in CI. The
// same transport over the real binding and n0's relays is in
// irohTransport.smoke.test.ts, behind BIRDBRAIN_IROH_SMOKE=1.

const key = (fill: number): Uint8Array => new Uint8Array(32).fill(fill)

async function refused(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (err) {
    if (err instanceof SharingError) return err.code
    throw err
  }
  throw new Error('expected a SharingError')
}

// Reads until `length` bytes have arrived, however the transport splits them.
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

async function readAll(stream: ByteStream): Promise<string> {
  const pieces: Uint8Array[] = []
  for (;;) {
    const piece = await stream.read()
    if (piece === null) return Buffer.concat(pieces).toString()
    pieces.push(piece)
  }
}

describe('the Iroh binding loader (#1809)', () => {
  it('reports sharing unavailable, without throwing, when loading the binding throws', () => {
    let calls = 0
    const load = createBindingLoader(() => {
      calls += 1
      throw new Error('Cannot find module @number0/iroh-darwin-x64')
    })
    expect(isSharingAvailable(load)).toBe(false)
    expect(isSharingAvailable(load)).toBe(false)
    // The failure is kept, not retried on every call.
    expect(calls).toBe(1)
  })

  it('reports sharing available when the binding loads', () => {
    const net = new FakeIrohNetwork()
    expect(isSharingAvailable(createBindingLoader(() => net.binding()))).toBe(true)
  })

  // 1.1.0 ships every desktop build but darwin-x64, where the loader reads null.
  const intelMac = process.platform === 'darwin' && process.arch === 'x64'
  it.skipIf(intelMac)("loads this platform's real binding", () => {
    const binding = irohBinding()
    expect(binding).not.toBeNull()
    expect(typeof binding?.Endpoint.builder).toBe('function')
  })
})

describe('the Iroh transport over a stand-in binding (#1809)', () => {
  let net: FakeIrohNetwork
  let binding: IrohBinding

  beforeEach(() => {
    net = new FakeIrohNetwork()
    binding = net.binding()
  })

  const start = (fill: number): Promise<IrohTransport> =>
    IrohTransport.start({ binding, secretKey: key(fill), relayUrl: '' })

  it('binds under the stored key with the minimal preset, the sync ALPN and the public relays', async () => {
    const transport = await start(1)
    expect(net.binds).toEqual([
      {
        secretKey: Array.from(key(1)),
        relayMode: { kind: 'default' },
        alpns: [Array.from(Buffer.from(SYNC_ALPN))],
        preset: 'minimal'
      }
    ])
    expect(transport.nodeId).toBe(Buffer.from(key(1)).toString('hex'))
    await transport.close()
  })

  it('hands out a ticket naming the node id and relay and no direct address', async () => {
    const transport = await start(1)
    const addr = binding.EndpointTicket.fromString(transport.ticket).endpointAddr()
    expect(addr.id().toString()).toBe(transport.nodeId)
    expect(addr.relayUrl()).toBe('https://relay.example.test./')
    expect(addr.directAddresses()).toEqual([])
    await transport.close()
  })

  it('uses a self-hosted relay when one is set', async () => {
    const transport = await IrohTransport.start({
      binding,
      secretKey: key(1),
      relayUrl: 'https://relay.example.org/'
    })
    expect(net.binds[0].relayMode).toEqual({
      kind: 'custom',
      urls: ['https://relay.example.org/']
    })
    expect(binding.EndpointTicket.fromString(transport.ticket).endpointAddr().relayUrl()).toBe(
      'https://relay.example.org/'
    )
    await transport.close()
  })

  it('refuses relay-unreachable and closes the endpoint when no relay answers', async () => {
    net.relayReachable = false
    const code = await refused(() =>
      IrohTransport.start({ binding, secretKey: key(1), relayUrl: '', onlineTimeoutMs: 5 })
    )
    expect(code).toBe('relay-unreachable')
    expect(net.endpoints.size).toBe(0)
  })

  it('closes the endpoint and rethrows when the relay handshake fails after the bind', async () => {
    net.onlineFails = true
    await expect(start(1)).rejects.toThrow('relay handshake failed')
    expect(net.endpoints.size).toBe(0)
  })

  it(`closes a node's connections beyond ${MAX_CONNECTIONS_PER_NODE} at once, and no other node's`, async () => {
    const listener = await start(1)
    const stranger = await start(2)
    const member = await start(3)
    await listener.listen(() => {})
    for (let i = 0; i <= MAX_CONNECTIONS_PER_NODE; i++) await stranger.dial(listener.ticket)
    const closedPairs = () => net.connections.filter((c) => c.closed).length / 2
    await expect.poll(closedPairs).toBe(1)
    // The member still gets through while the stranger holds its share.
    await member.dial(listener.ticket)
    await new Promise((resolve) => setImmediate(resolve))
    expect(closedPairs()).toBe(1)
    for (const t of [stranger, member, listener]) await t.close()
  })

  it(`refuses connections beyond ${MAX_INCOMING_CONNECTIONS} at once from all nodes`, async () => {
    const listener = await start(1)
    await listener.listen(() => {})
    const dialers: IrohTransport[] = []
    for (let i = 0; i <= MAX_INCOMING_CONNECTIONS; i++) {
      const dialer = await IrohTransport.start({
        binding,
        secretKey: new Uint8Array(32).fill(10).map((b, at) => (at === 0 ? i : b)),
        relayUrl: ''
      })
      dialers.push(dialer)
      await dialer.dial(listener.ticket)
    }
    await expect.poll(() => net.refused).toBe(1)
    for (const t of [...dialers, listener]) await t.close()
  })

  it('closes an incoming connection that opens no stream in time', async () => {
    const listener = await IrohTransport.start({
      binding,
      secretKey: key(1),
      relayUrl: '',
      firstStreamTimeoutMs: 5
    })
    const dialer = await start(2)
    const onStream = vi.fn()
    await listener.listen(onStream)
    await dialer.dial(listener.ticket)
    await expect.poll(() => net.connections.every((c) => c.closed)).toBe(true)
    expect(onStream).not.toHaveBeenCalled()
    await dialer.close()
    await listener.close()
  })

  it('stops listening, without throwing, when the endpoint stops accepting', async () => {
    const listener = await start(1)
    const dialer = await start(2)
    net.acceptFails = true
    const onStream = vi.fn()
    await listener.listen(onStream)
    const stream = await dialer.openStream(await dialer.dial(listener.ticket))
    await stream.write(Buffer.from('x'))
    await new Promise((resolve) => setImmediate(resolve))
    expect(onStream).not.toHaveBeenCalled()
    await dialer.close()
    await listener.close()
  })

  it('carries bytes both ways and tells the listener who dialed', async () => {
    const listener = await start(1)
    const dialer = await start(2)
    const seen: Array<{ peer: string; text: string }> = []
    await listener.listen((stream, peer) => {
      void readBytes(stream, 11).then(async (text) => {
        seen.push({ peer, text })
        await stream.write(Buffer.from(text.toUpperCase()))
        stream.close()
      })
    })
    const connection = await dialer.dial(listener.ticket)
    expect(connection.peerNodeId).toBe(listener.nodeId)
    const stream = await dialer.openStream(connection)
    await stream.write(Buffer.from('hello '))
    await stream.write(Buffer.from('relay'))
    expect(await readAll(stream)).toBe('HELLO RELAY')
    expect(seen).toEqual([{ peer: dialer.nodeId, text: 'hello relay' }])
    // A read after the end stays at the end.
    expect(await stream.read()).toBeNull()
    stream.close()
    await dialer.close()
    await listener.close()
  })

  it('rejects a write the peer stopped with a TransportError that keeps the message', async () => {
    const listener = await start(1)
    const dialer = await start(2)
    await listener.listen((stream) => stream.close())
    const stream = await dialer.openStream(await dialer.dial(listener.ticket))
    await stream.write(Buffer.from('x'))
    await new Promise((resolve) => setImmediate(resolve))
    const failure = await stream.write(Buffer.from('y')).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(TransportError)
    expect(failure).toMatchObject({ code: 'TRANSPORT_FAILED', message: 'sending stopped by peer' })
    await dialer.close()
    await listener.close()
  })

  it('serves every stream a connection opens', async () => {
    const listener = await start(1)
    const dialer = await start(2)
    const texts: string[] = []
    await listener.listen((stream) => {
      void readAll(stream).then((text) => texts.push(text))
    })
    const connection = await dialer.dial(listener.ticket)
    for (const text of ['one', 'two']) {
      const stream = await dialer.openStream(connection)
      await stream.write(Buffer.from(text))
      stream.close()
    }
    await expect.poll(() => [...texts].sort()).toEqual(['one', 'two'])
    connection.close()
    await dialer.close()
    await listener.close()
  })

  it('refuses a ticket that names no listening node, or does not parse, as unreachable', async () => {
    const dialer = await start(2)
    const gone = await start(3)
    await gone.close()
    await expect(dialer.dial(gone.ticket)).rejects.toBeInstanceOf(PeerUnreachableError)
    await expect(dialer.dial('not a ticket')).rejects.toBeInstanceOf(PeerUnreachableError)
    await dialer.close()
  })

  it('opens streams only on its own connections, and refuses work once closed', async () => {
    const listener = await start(1)
    const dialer = await start(2)
    const other = await start(3)
    await listener.listen(() => {})
    const connection = await other.dial(listener.ticket)
    await expect(dialer.openStream(connection)).rejects.toThrow('not dialed from this transport')
    await expect(listener.listen(() => {})).rejects.toThrow('already listening')
    await dialer.close()
    await dialer.close()
    await expect(dialer.dial(listener.ticket)).rejects.toThrow('closed')
    await expect(dialer.listen(() => {})).rejects.toThrow('closed')
    await other.close()
    await listener.close()
  })

  it('closes every connection it dialed or accepted when it closes', async () => {
    const listener = await start(1)
    const dialer = await start(2)
    const accepted: ByteStream[] = []
    await listener.listen((stream) => accepted.push(stream))
    const connection = await dialer.dial(listener.ticket)
    const stream = await dialer.openStream(connection)
    await stream.write(Buffer.from('x'))
    await expect.poll(() => accepted.length).toBe(1)
    await listener.close()
    expect(net.connections.every((c) => c.closed)).toBe(true)
    // Closing a stream whose connection is gone is not an error.
    stream.close()
    await dialer.close()
  })
})

// The strings are what the 1.2.0 binding printed in a probe against n0's
// relays on 2026-10-30; the first is a peer closing its connection normally.
describe('naming why the Iroh binding ended a stream', () => {
  it.each([
    [
      'ConnectionLost(ApplicationClosed(ApplicationClose { error_code: 0, reason: b"" }))',
      'PEER_CLOSED'
    ],
    [
      'ConnectionLost(ApplicationClosed(ApplicationClose { error_code: 7, reason: b"" }))',
      'PEER_CLOSED_WITH_ERROR'
    ],
    ['ConnectionLost(TimedOut)', 'TIMED_OUT'],
    ['ConnectionLost(LocallyClosed)', 'LOCALLY_CLOSED'],
    ['ConnectionLost(Reset)', 'CONNECTION_RESET'],
    ['ConnectionLost(VersionMismatch)', 'CONNECTION_LOST'],
    ['Stopped(0)', 'STREAM_STOPPED'],
    ['Reset(0)', 'STREAM_RESET'],
    ['ClosedStream', 'STREAM_CLOSED'],
    ['something new', 'TRANSPORT_FAILED']
  ])('reads %s as %s', (message, code) => {
    expect(transportFailure(message)).toBe(code)
  })
})

describe('the transport provider and the relay setting (#1809)', () => {
  let dir: string
  let net: FakeIrohNetwork

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bb-iroh-provider-'))
    initSettings(dir)
    net = new FakeIrohNetwork()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const provide = (relayUrl = getSettings().sharingRelayUrl) =>
    startIrohTransport({ userDataDir: dir, cipher: null, relayUrl, load: () => net.binding() })

  it('returns no transport where the binding does not load', async () => {
    const transport = await startIrohTransport({
      userDataDir: dir,
      cipher: null,
      relayUrl: '',
      load: () => null
    })
    expect(transport).toBeNull()
  })

  it('keeps one node id across starts over the same user-data directory', async () => {
    const first = await provide()
    const nodeId = first!.nodeId
    await first!.close()
    const second = await provide()
    expect(second!.nodeId).toBe(nodeId)
    await second!.close()
  })

  it('persists a relay URL, and the next start uses it', async () => {
    setRelayUrl('  https://relay.example.org/  ')
    expect(getSettings().sharingRelayUrl).toBe('https://relay.example.org/')
    const transport = await provide()
    expect(net.binds.at(-1)?.relayMode).toEqual({
      kind: 'custom',
      urls: ['https://relay.example.org/']
    })
    await transport!.close()
  })

  it('refuses a value that does not parse as a URL with a named error, and stores nothing', async () => {
    setRelayUrl('https://relay.example.org/')
    for (const value of ['relay.example.org', 'not a url', 'ftp://relay.example.org/']) {
      expect(await refused(async () => setRelayUrl(value))).toBe('relay-url-invalid')
    }
    expect(getSettings().sharingRelayUrl).toBe('https://relay.example.org/')
  })

  it('restores the default relays on an empty value', async () => {
    setRelayUrl('https://relay.example.org/')
    setRelayUrl('')
    expect(getSettings().sharingRelayUrl).toBe('')
    const transport = await provide()
    expect(net.binds.at(-1)?.relayMode).toEqual({ kind: 'default' })
    await transport!.close()
  })

  it('refuses a stored relay that no longer parses rather than using the public relays', async () => {
    expect(await refused(() => provide('relay.example.org'))).toBe('relay-url-invalid')
    expect(net.binds).toEqual([])
  })

  it('refuses the same value through settings:update', () => {
    expect(() => updateSettings({ sharingRelayUrl: 'not a url' })).toThrow('sharingRelayUrl')
  })
})

describe('a sync session over the Iroh transport (#1809)', () => {
  const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000001809'
  let root: string
  let A: Peer
  let B: Peer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-iroh-session-'))
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
    const binding = new FakeIrohNetwork().binding()
    const listener = await IrohTransport.start({ binding, secretKey: key(1), relayUrl: '' })
    const dialer = await IrohTransport.start({ binding, secretKey: key(2), relayUrl: '' })
    const result = await pull(CASE_ID, source, {}, {}, { dialer, listener })
    expect(result.errors).toEqual([])
    expect(result.entriesReceived).toBe(3)
    expect(memberChainText(CASE_ID, A)).toBe(ownerChain)
    await dialer.close()
    await listener.close()
  })
})

describe('the sharing modules call no watch method (#1809)', () => {
  it('git grep finds no .watch call under src/main/services/sharing', () => {
    let found = ''
    try {
      found = execFileSync(
        'git',
        ['grep', '--untracked', '-n', '\\.watch', '--', 'src/main/services/sharing'],
        {
          encoding: 'utf-8'
        }
      )
    } catch (err) {
      // git grep exits 1 when nothing matches, which is the pass.
      if ((err as { status?: number }).status !== 1) throw err
    }
    expect(found).toBe('')
  })
})
