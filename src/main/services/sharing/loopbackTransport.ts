import { createServer, connect, type AddressInfo, type Server, type Socket } from 'net'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  PeerUnreachableError,
  type ByteStream,
  type Connection,
  type Transport
} from '@main/services/sharing/transport'

// A test-only transport between two Birdbrain processes on one machine
// (#1882), for the two-instance Shared Case e2e spec. `MemoryHub` lives in
// one process, so it cannot join two Electron processes; this bridge carries
// the same byte streams over TCP sockets bound to 127.0.0.1, one socket per
// stream. Each node listens on a port the operating system picks and records
// it under its node id in a rendezvous directory both launches are given, so
// a ticket names a node and never an address or a port (ruling 74), and
// `dial` finds the port in the directory. The dialer's node id opens every
// stream as one line, which the listener takes as said: this bridge proves
// nothing about who is on the other end, and the session checks identity by
// signature as it does over any transport.
//
// Selected by `BIRDBRAIN_E2E_SHARING_BRIDGE=<directory>`, read only in an
// unpackaged build (sharingBridgeDirectory), so no installed copy of
// Birdbrain can be pointed at it. Like `transport.ts`, it reads no message
// and decides nothing about what a session accepts.

export const E2E_SHARING_BRIDGE_SWITCH = 'BIRDBRAIN_E2E_SHARING_BRIDGE'
export const LOOPBACK_HOST = '127.0.0.1'

const TICKET_PREFIX = 'loop:'
// The dialer's node id and a newline open every stream; a first line longer
// than this is no stream.
const MAX_HEADER_BYTES = 256
// Chunks held for a reader that has not asked yet before the socket is paused.
const MAX_QUEUED_CHUNKS = 64

// The rendezvous directory the switch names, or null when the build is
// packaged or the switch is unset or blank.
export function sharingBridgeDirectory(
  value: string | undefined,
  allowOverride: boolean
): string | null {
  if (!allowOverride) return null
  const directory = value?.trim() ?? ''
  return directory.length === 0 ? null : directory
}

function rendezvousFile(directory: string, nodeId: string): string {
  return join(directory, `${encodeURIComponent(nodeId)}.json`)
}

function connected(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: LOOPBACK_HOST, port })
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.off('error', reject)
      resolve(socket)
    })
  })
}

// One stream over one socket. The listener may hand in bytes that arrived
// with the header line, which the reader sees first.
class SocketStream implements ByteStream {
  private readonly chunks: Uint8Array[] = []
  private readonly waiters: Array<(chunk: Uint8Array | null) => void> = []
  private ended = false

  constructor(
    private readonly socket: Socket,
    initial: Uint8Array | null,
    private readonly onClose: () => void
  ) {
    if (initial !== null && initial.length > 0) this.chunks.push(initial)
    socket.on('data', (data: Buffer) => this.push(Uint8Array.from(data)))
    socket.on('end', () => this.end())
    socket.on('close', () => this.end())
    socket.on('error', () => this.end())
  }

  private push(chunk: Uint8Array): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(chunk)
      return
    }
    this.chunks.push(chunk)
    if (this.chunks.length >= MAX_QUEUED_CHUNKS) this.socket.pause()
  }

  private end(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter(null)
    this.onClose()
  }

  write(chunk: Uint8Array): Promise<void> {
    if (this.ended || this.socket.destroyed) return Promise.reject(new Error('Stream is closed'))
    return new Promise((resolve, reject) => {
      this.socket.write(chunk, (err) => (err ? reject(err) : resolve()))
    })
  }

  read(): Promise<Uint8Array | null> {
    const next = this.chunks.shift()
    if (next) {
      if (this.chunks.length < MAX_QUEUED_CHUNKS && this.socket.isPaused()) this.socket.resume()
      return Promise.resolve(next)
    }
    if (this.ended) return Promise.resolve(null)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  close(): void {
    this.socket.destroy()
    this.end()
  }
}

class LoopbackConnection implements Connection {
  private readonly streams = new Set<ByteStream>()
  private closed = false

  constructor(
    readonly peerNodeId: string,
    private readonly port: number
  ) {}

  async open(fromNodeId: string): Promise<ByteStream> {
    if (this.closed) throw new Error(`Connection to ${this.peerNodeId} is closed`)
    const socket = await connected(this.port)
    const stream: SocketStream = new SocketStream(socket, null, () => this.streams.delete(stream))
    this.streams.add(stream)
    await stream.write(Buffer.from(`${fromNodeId}\n`))
    return stream
  }

  close(): void {
    this.closed = true
    for (const stream of [...this.streams]) stream.close()
  }
}

export interface LoopbackTransportOptions {
  // Where every node on this machine records its port.
  directory: string
  nodeId: string
}

export class LoopbackTransport implements Transport {
  private onStream: ((stream: ByteStream, peerNodeId: string) => void) | null = null
  private readonly connections = new Set<LoopbackConnection>()
  private readonly accepted = new Set<ByteStream>()
  private readonly sockets = new Set<Socket>()
  private closed = false

  private constructor(
    readonly nodeId: string,
    private readonly directory: string,
    private readonly server: Server
  ) {
    server.on('connection', (socket) => this.accept(socket))
  }

  // Listens on a port the operating system picks and records it under the
  // node id, so a peer given the same directory can dial this node by name.
  static async start(options: LoopbackTransportOptions): Promise<LoopbackTransport> {
    const { directory, nodeId } = options
    mkdirSync(directory, { recursive: true })
    const server = createServer()
    const transport = new LoopbackTransport(nodeId, directory, server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, LOOPBACK_HOST, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const file = rendezvousFile(directory, nodeId)
    const partial = `${file}.partial`
    writeFileSync(partial, JSON.stringify({ host: LOOPBACK_HOST, port: transport.address.port }))
    renameSync(partial, file)
    return transport
  }

  get ticket(): string {
    return `${TICKET_PREFIX}${this.nodeId}`
  }

  // Where this node listens, as the socket reports it.
  get address(): AddressInfo {
    return this.server.address() as AddressInfo
  }

  nodeIdOf(ticket: string): string | null {
    if (!ticket.startsWith(TICKET_PREFIX)) return null
    const nodeId = ticket.slice(TICKET_PREFIX.length)
    return nodeId.length === 0 ? null : nodeId
  }

  async listen(onStream: (stream: ByteStream, peerNodeId: string) => void): Promise<void> {
    if (this.closed) throw new Error(`Node ${this.nodeId} is closed`)
    if (this.onStream) throw new Error(`Node ${this.nodeId} is already listening`)
    this.onStream = onStream
  }

  // Reads the header line, then hands the socket on as a stream. A socket that
  // ends before the line, a line over the bound, an empty node id, and any
  // socket that arrives before `listen` reach no handler.
  private accept(socket: Socket): void {
    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    let header = Buffer.alloc(0)
    const onHeader = (data: Buffer): void => {
      header = Buffer.concat([header, data])
      const newline = header.indexOf(0x0a)
      if (newline === -1) {
        if (header.length > MAX_HEADER_BYTES) socket.destroy()
        return
      }
      socket.off('data', onHeader)
      const peerNodeId = header.subarray(0, newline).toString()
      const rest = header.subarray(newline + 1)
      const handler = this.onStream
      if (handler === null || peerNodeId.length === 0 || newline > MAX_HEADER_BYTES) {
        socket.destroy()
        return
      }
      const stream: SocketStream = new SocketStream(
        socket,
        rest.length > 0 ? Uint8Array.from(rest) : null,
        () => this.accepted.delete(stream)
      )
      this.accepted.add(stream)
      handler(stream, peerNodeId)
    }
    socket.on('data', onHeader)
  }

  // The port a node recorded, or null when the directory does not name it.
  private portOf(nodeId: string): number | null {
    let text: string
    try {
      text = readFileSync(rendezvousFile(this.directory, nodeId), 'utf-8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return null
    }
    if (typeof parsed !== 'object' || parsed === null) return null
    const { host, port } = parsed as { host?: unknown; port?: unknown }
    if (host !== LOOPBACK_HOST || typeof port !== 'number' || !Number.isInteger(port)) return null
    return port
  }

  // A node the directory does not name, or whose port no longer answers, is
  // unreachable, as a node whose relay does not answer is over Iroh.
  async dial(ticket: string): Promise<Connection> {
    if (this.closed) throw new Error(`Node ${this.nodeId} is closed`)
    const peerNodeId = this.nodeIdOf(ticket)
    if (peerNodeId === null) throw new PeerUnreachableError(ticket)
    const port = this.portOf(peerNodeId)
    if (port === null) throw new PeerUnreachableError(ticket)
    let probe: Socket
    try {
      probe = await connected(port)
    } catch {
      throw new PeerUnreachableError(ticket)
    }
    probe.destroy()
    const connection = new LoopbackConnection(peerNodeId, port)
    this.connections.add(connection)
    return connection
  }

  async openStream(connection: Connection): Promise<ByteStream> {
    if (!(connection instanceof LoopbackConnection) || !this.connections.has(connection)) {
      throw new Error('Connection was not dialed from this transport')
    }
    return connection.open(this.nodeId)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onStream = null
    for (const connection of this.connections) connection.close()
    this.connections.clear()
    for (const stream of [...this.accepted]) stream.close()
    this.accepted.clear()
    for (const socket of [...this.sockets]) socket.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    rmSync(rendezvousFile(this.directory, this.nodeId), { force: true })
  }
}

export function startLoopbackTransport(
  options: LoopbackTransportOptions
): Promise<LoopbackTransport> {
  return LoopbackTransport.start(options)
}
