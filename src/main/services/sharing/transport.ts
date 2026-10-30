// The transport a sync session runs over (docs/specs/2026-09-19-collaborative-
// cases-design.md, "Transport interface"). A transport carries bytes between
// two installations and nothing else: it never reads a message and never
// decides what a session accepts, which is why it sits off the blocking tier
// of the evidence path list. `IrohTransport` (#1809) implements it over QUIC;
// `MemoryTransport` below is the in-process form the unit suite runs the
// protocol on, so the acceptance code is tested against real files and a real
// database without native code.

// One bidirectional byte stream. Chunk boundaries are not preserved: a write
// may arrive in any number of pieces, so the session frames its own messages.
export interface ByteStream {
  write(chunk: Uint8Array): Promise<void>
  // The next piece, or null once the other side closed the stream.
  read(): Promise<Uint8Array | null>
  close(): void
}

export interface Connection {
  readonly peerNodeId: string
  close(): void
}

export interface Transport {
  readonly nodeId: string
  // What a peer dials to reach this node: an Iroh ticket, or the hub name of
  // an in-process node.
  readonly ticket: string
  // Accepts incoming streams. Called at most once per transport.
  listen(onStream: (stream: ByteStream, peerNodeId: string) => void): Promise<void>
  dial(ticket: string): Promise<Connection>
  // The node a ticket names, or null when it is not a ticket this transport
  // reads.
  nodeIdOf(ticket: string): string | null
  openStream(connection: Connection): Promise<ByteStream>
  close(): Promise<void>
}

export class PeerUnreachableError extends Error {
  constructor(ticket: string) {
    super(`No listening node answers ticket ${ticket}`)
    this.name = 'PeerUnreachableError'
  }
}

// Why the network ended a stream, in the log's code form. The Iroh transport
// names these from the binding's errors (irohTransport.ts).
export type TransportFailure =
  | 'PEER_CLOSED'
  | 'PEER_CLOSED_WITH_ERROR'
  | 'CONNECTION_CLOSED'
  | 'TIMED_OUT'
  | 'LOCALLY_CLOSED'
  | 'CONNECTION_RESET'
  | 'CONNECTION_LOST'
  | 'STREAM_STOPPED'
  | 'STREAM_RESET'
  | 'STREAM_CLOSED'
  | 'TRANSPORT_FAILED'

// A stream read or write the network refused. The message is the binding's
// own text, which a failed session's detail still shows; the log keeps only
// the name and `code`.
export class TransportError extends Error {
  constructor(
    message: string,
    readonly code: TransportFailure
  ) {
    super(message)
    this.name = 'TransportError'
  }
}

const MEMORY_TICKET_PREFIX = 'mem:'

// One direction of an in-process stream: a queue the writer fills and the
// reader drains, with a waiting reader woken by the next chunk or the close.
class Channel {
  private chunks: Uint8Array[] = []
  private waiters: Array<(chunk: Uint8Array | null) => void> = []
  closed = false

  push(chunk: Uint8Array): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter(chunk)
    else this.chunks.push(chunk)
  }

  pull(): Promise<Uint8Array | null> {
    const next = this.chunks.shift()
    if (next) return Promise.resolve(next)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter(null)
  }
}

class MemoryStream implements ByteStream {
  constructor(
    private readonly outbound: Channel,
    private readonly inbound: Channel,
    private readonly chunkSize: number | undefined,
    private readonly onClose: () => void
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.outbound.closed) throw new Error('Stream is closed')
    // Copied, so a buffer the writer reuses cannot change what was sent. Split
    // when the hub asks for it, which is how the suite proves the session's
    // framing survives a transport that re-chunks.
    const size = this.chunkSize ?? Math.max(chunk.length, 1)
    for (let at = 0; at < chunk.length; at += size) {
      this.outbound.push(Uint8Array.from(chunk.subarray(at, at + size)))
    }
  }

  read(): Promise<Uint8Array | null> {
    return this.inbound.pull()
  }

  close(): void {
    this.outbound.close()
    this.inbound.close()
    this.onClose()
  }
}

export interface MemoryHubOptions {
  // When set, every write is delivered in pieces of this many bytes.
  chunkSize?: number
}

// The in-process network: n nodes addressed by name, each a `MemoryTransport`.
// Three-peer tests run on one hub.
export class MemoryHub {
  private readonly nodes = new Map<string, MemoryTransport>()

  constructor(private readonly options: MemoryHubOptions = {}) {
    if (options.chunkSize !== undefined && options.chunkSize < 1) {
      throw new Error('chunkSize must be at least 1')
    }
  }

  createTransport(nodeId: string): MemoryTransport {
    if (this.nodes.has(nodeId)) throw new Error(`Node ${nodeId} already exists on this hub`)
    const transport = new MemoryTransport(nodeId, this)
    this.nodes.set(nodeId, transport)
    return transport
  }

  // The listening node a ticket names, or undefined.
  listeningNode(ticket: string): MemoryTransport | undefined {
    if (!ticket.startsWith(MEMORY_TICKET_PREFIX)) return undefined
    const node = this.nodes.get(ticket.slice(MEMORY_TICKET_PREFIX.length))
    return node?.isListening ? node : undefined
  }

  // A connected pair of stream ends; closing either end closes both.
  streamPair(onClose: () => void): [ByteStream, ByteStream] {
    const forward = new Channel()
    const backward = new Channel()
    const { chunkSize } = this.options
    return [
      new MemoryStream(forward, backward, chunkSize, onClose),
      new MemoryStream(backward, forward, chunkSize, onClose)
    ]
  }

  remove(nodeId: string): void {
    this.nodes.delete(nodeId)
  }
}

class MemoryConnection implements Connection {
  private readonly streams = new Set<ByteStream>()
  private closed = false

  constructor(
    readonly peerNodeId: string,
    private readonly target: MemoryTransport,
    private readonly hub: MemoryHub
  ) {}

  open(fromNodeId: string): ByteStream {
    if (this.closed) throw new Error(`Connection to ${this.peerNodeId} is closed`)
    const [near, far] = this.hub.streamPair(() => this.streams.delete(near))
    this.streams.add(near)
    this.target.accept(far, fromNodeId)
    return near
  }

  close(): void {
    this.closed = true
    for (const stream of [...this.streams]) stream.close()
  }
}

export class MemoryTransport implements Transport {
  private onStream: ((stream: ByteStream, peerNodeId: string) => void) | null = null
  private readonly connections = new Set<MemoryConnection>()
  private readonly accepted = new Set<ByteStream>()
  private closed = false

  constructor(
    readonly nodeId: string,
    private readonly hub: MemoryHub
  ) {}

  get ticket(): string {
    return `${MEMORY_TICKET_PREFIX}${this.nodeId}`
  }

  nodeIdOf(ticket: string): string | null {
    return ticket.startsWith(MEMORY_TICKET_PREFIX)
      ? ticket.slice(MEMORY_TICKET_PREFIX.length)
      : null
  }

  get isListening(): boolean {
    return this.onStream !== null && !this.closed
  }

  async listen(onStream: (stream: ByteStream, peerNodeId: string) => void): Promise<void> {
    if (this.closed) throw new Error(`Node ${this.nodeId} is closed`)
    if (this.onStream) throw new Error(`Node ${this.nodeId} is already listening`)
    this.onStream = onStream
  }

  // An incoming stream from `peerNodeId`, delivered on a later turn of the
  // event loop as a network would, so the dialer's `openStream` returns before
  // the listener runs.
  accept(stream: ByteStream, peerNodeId: string): void {
    const handler = this.onStream
    if (!handler) {
      stream.close()
      return
    }
    this.accepted.add(stream)
    queueMicrotask(() => handler(stream, peerNodeId))
  }

  async dial(ticket: string): Promise<Connection> {
    if (this.closed) throw new Error(`Node ${this.nodeId} is closed`)
    const target = this.hub.listeningNode(ticket)
    if (!target) throw new PeerUnreachableError(ticket)
    const connection = new MemoryConnection(target.nodeId, target, this.hub)
    this.connections.add(connection)
    return connection
  }

  async openStream(connection: Connection): Promise<ByteStream> {
    if (!(connection instanceof MemoryConnection) || !this.connections.has(connection)) {
      throw new Error('Connection was not dialed from this transport')
    }
    return connection.open(this.nodeId)
  }

  async close(): Promise<void> {
    this.closed = true
    this.onStream = null
    for (const connection of this.connections) connection.close()
    this.connections.clear()
    for (const stream of [...this.accepted]) stream.close()
    this.accepted.clear()
    this.hub.remove(this.nodeId)
  }
}
