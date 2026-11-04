import type * as IrohModule from '@number0/iroh'
import { parseRelayUrl } from '@shared/schemas'
import { logger } from '@main/services/logger'
import { updateSettings } from '@main/services/settings'
import { SharingError } from '@main/services/sharing/errors'
import { loadOrCreateNodeKey, type KeyCipher } from '@main/services/sharing/nodeKey'
import {
  PeerUnreachableError,
  TransportError,
  type ByteStream,
  type Connection,
  type Transport,
  type TransportFailure
} from '@main/services/sharing/transport'

// The transport over Iroh (#1809): QUIC between installations, through n0's
// public relays or the Operator's own. Like `MemoryTransport` it carries bytes
// and decides nothing a session accepts.
//
// Three rules from the binding spike (docs/specs/2026-10-10-anonymous-team-
// sync-spike.md, "Verdict for SC-5") hold here:
// - No `watch*` method is called. On 1.1.0 each one aborts the process, which
//   in the main process ends the app.
// - The ticket names the node id and the relay URL and no direct address
//   (ruling 74), so an invite string does not hand its reader this computer's
//   addresses. A connected peer still learns them through hole punching, which
//   the security pages say.
// - The minimal preset with a relay map, not the n0 preset: nothing is
//   published to n0's address lookup, since every dialer holds a ticket.

export type IrohBinding = typeof IrohModule

export const SYNC_ALPN = 'birdbrain-sync/1'
const ALPN_BYTES = Array.from(Buffer.from(SYNC_ALPN))

// How long a start waits for a home relay. The spike measured about 3 s.
const ONLINE_TIMEOUT_MS = 30_000
// The most a stream read asks the binding for at once.
const READ_BYTES = 64 * 1024
// Bounds on incoming connections, which anyone holding a ticket can open
// before a session checks the roster. A Case has 2 to 5 members, so one node
// gets a few connections at once and every node shares a larger backstop; a
// connection that opens no stream in time is closed, so idle connections
// cannot hold either bound.
export const MAX_CONNECTIONS_PER_NODE = 4
export const MAX_INCOMING_CONNECTIONS = 64
const FIRST_STREAM_TIMEOUT_MS = 30_000

// The binding loaded once, or null when it cannot load: 1.1.0 ships no
// `darwin-x64` build, and a packaged build missing its native file throws
// here too. The package's `main` names a file the tarball lacks, so the root
// file is required by name rather than through Node's fallback.
export function createBindingLoader(load: () => IrohBinding): () => IrohBinding | null {
  let loaded: { binding: IrohBinding | null } | null = null
  return () => {
    if (loaded === null) {
      try {
        loaded = { binding: load() }
      } catch (err) {
        logger.warn('sharing', 'sharing.binding_unavailable', undefined, err)
        loaded = { binding: null }
      }
    }
    return loaded.binding
  }
}

export const irohBinding = createBindingLoader(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require('@number0/iroh/index.js') as IrohBinding
)

// Whether sync can run on this platform: what `sharing:isAvailable` returns.
export function isSharingAvailable(load: () => IrohBinding | null = irohBinding): boolean {
  return load() !== null
}

// Stores the relay `sharing:setRelayUrl` names; '' returns to the default
// public relays. A transport already running keeps its relay until it next
// starts.
export function setRelayUrl(value: string): void {
  const url = parseRelayUrl(value)
  if (url === null) throw new SharingError('relay-url-invalid')
  updateSettings({ sharingRelayUrl: url })
}

// The binding rejects with the QUIC error's Rust debug text and the code
// GenericFailure, which the log cannot use. These are the shapes it prints;
// a peer closing its connection normally reads as the first.
const TRANSPORT_FAILURES: ReadonlyArray<[RegExp, TransportFailure]> = [
  [/^ConnectionLost\(ApplicationClosed\(ApplicationClose \{ error_code: 0,/, 'PEER_CLOSED'],
  [/^ConnectionLost\(ApplicationClosed\(/, 'PEER_CLOSED_WITH_ERROR'],
  [/^ConnectionLost\(ConnectionClosed\(/, 'CONNECTION_CLOSED'],
  [/^ConnectionLost\(TimedOut\)/, 'TIMED_OUT'],
  [/^ConnectionLost\(LocallyClosed\)/, 'LOCALLY_CLOSED'],
  [/^ConnectionLost\(Reset\)/, 'CONNECTION_RESET'],
  [/^ConnectionLost\(/, 'CONNECTION_LOST'],
  [/^Stopped\(/, 'STREAM_STOPPED'],
  [/^Reset\(/, 'STREAM_RESET'],
  [/^ClosedStream\b/, 'STREAM_CLOSED']
]

export function transportFailure(message: string): TransportFailure {
  return TRANSPORT_FAILURES.find(([shape]) => shape.test(message))?.[1] ?? 'TRANSPORT_FAILED'
}

function asTransportError(err: unknown): unknown {
  if (!(err instanceof Error)) return err
  return new TransportError(err.message, transportFailure(err.message))
}

class IrohStream implements ByteStream {
  private ended = false

  constructor(private readonly bi: IrohModule.BiStream) {}

  async write(chunk: Uint8Array): Promise<void> {
    await this.bi.send.writeAll(Array.from(chunk)).catch((err: unknown) => {
      throw asTransportError(err)
    })
  }

  async read(): Promise<Uint8Array | null> {
    if (this.ended) return null
    // The binding reads the end of the stream as an empty piece.
    const piece = await this.bi.recv.read(READ_BYTES).catch((err: unknown) => {
      throw asTransportError(err)
    })
    if (piece.length === 0) {
      this.ended = true
      return null
    }
    return Uint8Array.from(piece)
  }

  close(): void {
    // Either half may already be finished or reset by the peer, which is the
    // state close asks for, so neither refusal is an error.
    this.bi.send.finish().catch(() => {})
    this.bi.recv.stop(0n).catch(() => {})
  }
}

class IrohConnection implements Connection {
  constructor(
    readonly peerNodeId: string,
    readonly inner: IrohModule.Connection
  ) {}

  close(): void {
    this.inner.close(0n, [])
  }
}

export interface IrohTransportOptions {
  binding: IrohBinding
  // The 32-byte node key (nodeKey.ts).
  secretKey: Uint8Array
  // A self-hosted relay, or '' for the default public relays.
  relayUrl: string
  onlineTimeoutMs?: number
  firstStreamTimeoutMs?: number
}

async function online(endpoint: IrohModule.Endpoint, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([endpoint.online().then(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export class IrohTransport implements Transport {
  private listening = false
  private closed = false
  private readonly connections = new Set<IrohConnection>()
  private readonly accepted = new Set<IrohModule.Connection>()
  // Incoming connections from their handshake until they end, in all and by
  // the node that opened them.
  private serving = 0
  private readonly servingByNode = new Map<string, number>()

  private constructor(
    private readonly binding: IrohBinding,
    private readonly endpoint: IrohModule.Endpoint,
    readonly nodeId: string,
    readonly ticket: string,
    private readonly firstStreamTimeoutMs: number
  ) {}

  // Binds an endpoint under the stored key and waits for a home relay, whose
  // URL the ticket names. A relay that does not answer refuses
  // `relay-unreachable`; on that or any other failure after the bind, the
  // endpoint is closed again.
  static async start(options: IrohTransportOptions): Promise<IrohTransport> {
    const { binding, secretKey, relayUrl } = options
    const { Endpoint, EndpointAddr, EndpointTicket, RelayMode, presetMinimal } = binding
    const builder = Endpoint.builder()
    presetMinimal(builder)
    builder.secretKey(Array.from(secretKey))
    builder.relayMode(
      relayUrl === '' ? RelayMode.defaultMode() : RelayMode.customFromUrls([relayUrl])
    )
    builder.alpns([ALPN_BYTES])
    const endpoint = await builder.bind()
    try {
      const relay = (await online(endpoint, options.onlineTimeoutMs ?? ONLINE_TIMEOUT_MS))
        ? endpoint.addr().relayUrl()
        : null
      if (relay === null) throw new SharingError('relay-unreachable')
      const id = endpoint.id()
      const ticket = EndpointTicket.fromAddr(new EndpointAddr(id, relay, [])).toString()
      const firstStream = options.firstStreamTimeoutMs ?? FIRST_STREAM_TIMEOUT_MS
      return new IrohTransport(binding, endpoint, id.toString(), ticket, firstStream)
    } catch (err) {
      await endpoint.close()
      throw err
    }
  }

  async listen(onStream: (stream: ByteStream, peerNodeId: string) => void): Promise<void> {
    if (this.closed) throw new Error('Transport is closed')
    if (this.listening) throw new Error('Transport is already listening')
    this.listening = true
    void this.acceptConnections(onStream)
  }

  private async acceptConnections(
    onStream: (stream: ByteStream, peerNodeId: string) => void
  ): Promise<void> {
    for (;;) {
      let incoming: IrohModule.Incoming | null
      try {
        incoming = await this.endpoint.acceptNext()
      } catch (err) {
        if (!this.closed) logger.warn('sharing', 'sharing.accept_failed', undefined, err)
        return
      }
      if (incoming === null) return
      if (this.serving >= MAX_INCOMING_CONNECTIONS) {
        // A peer that already gave up needs no refusal, so its failure is not one.
        incoming.refuse().catch(() => {})
        continue
      }
      this.serving += 1
      this.serveConnection(incoming, onStream)
        .catch((err: unknown) => {
          if (!this.closed) logger.warn('sharing', 'sharing.connection_failed', undefined, err)
        })
        .finally(() => {
          this.serving -= 1
        })
    }
  }

  // Hands every stream the peer opens to the listener, until the connection
  // ends: `acceptBi` throws once it does, which is the ordinary way out.
  private async serveConnection(
    incoming: IrohModule.Incoming,
    onStream: (stream: ByteStream, peerNodeId: string) => void
  ): Promise<void> {
    const connection = await (await incoming.accept()).connect()
    const peerNodeId = connection.remoteId().toString()
    const fromNode = this.servingByNode.get(peerNodeId) ?? 0
    if (fromNode >= MAX_CONNECTIONS_PER_NODE) {
      connection.close(0n, [])
      return
    }
    this.servingByNode.set(peerNodeId, fromNode + 1)
    this.accepted.add(connection)
    const idle = setTimeout(() => connection.close(0n, []), this.firstStreamTimeoutMs)
    try {
      for (;;) {
        let bi: IrohModule.BiStream
        try {
          bi = await connection.acceptBi()
        } catch {
          return
        }
        clearTimeout(idle)
        onStream(new IrohStream(bi), peerNodeId)
      }
    } finally {
      clearTimeout(idle)
      this.accepted.delete(connection)
      const left = (this.servingByNode.get(peerNodeId) ?? 1) - 1
      if (left > 0) this.servingByNode.set(peerNodeId, left)
      else this.servingByNode.delete(peerNodeId)
    }
  }

  nodeIdOf(ticket: string): string | null {
    try {
      return this.binding.EndpointTicket.fromString(ticket).endpointAddr().id().toString()
    } catch {
      return null
    }
  }

  // A ticket that does not parse names no node this transport can reach, so
  // it refuses as an unreachable peer does.
  async dial(ticket: string): Promise<Connection> {
    if (this.closed) throw new Error('Transport is closed')
    let addr: IrohModule.EndpointAddr
    try {
      addr = this.binding.EndpointTicket.fromString(ticket).endpointAddr()
    } catch {
      throw new PeerUnreachableError(ticket)
    }
    let inner: IrohModule.Connection
    try {
      inner = await this.endpoint.connect(addr, ALPN_BYTES)
    } catch {
      throw new PeerUnreachableError(ticket)
    }
    const connection = new IrohConnection(inner.remoteId().toString(), inner)
    this.connections.add(connection)
    return connection
  }

  async openStream(connection: Connection): Promise<ByteStream> {
    if (!(connection instanceof IrohConnection) || !this.connections.has(connection)) {
      throw new Error('Connection was not dialed from this transport')
    }
    return new IrohStream(await connection.inner.openBi())
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const connection of this.connections) connection.close()
    this.connections.clear()
    for (const connection of this.accepted) connection.close(0n, [])
    this.accepted.clear()
    await this.endpoint.close()
  }
}

export interface StartIrohTransportOptions {
  userDataDir: string
  cipher: KeyCipher | null
  // The stored `sharingRelayUrl` setting.
  relayUrl: string
  load?: () => IrohBinding | null
}

// The sharing service's transport provider: null when the binding cannot
// load, which the service refuses as `sharing-unavailable`. A stored relay
// that no longer parses refuses `relay-url-invalid` instead of falling back
// to the public relays the Operator chose not to use.
export async function startIrohTransport(
  options: StartIrohTransportOptions
): Promise<IrohTransport | null> {
  const binding = (options.load ?? irohBinding)()
  if (binding === null) return null
  const relayUrl = parseRelayUrl(options.relayUrl)
  if (relayUrl === null) throw new SharingError('relay-url-invalid')
  const secretKey = loadOrCreateNodeKey(options.userDataDir, options.cipher)
  return IrohTransport.start({ binding, secretKey, relayUrl })
}
