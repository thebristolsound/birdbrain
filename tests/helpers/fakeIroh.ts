import type { IrohBinding } from '@main/services/sharing/irohTransport'

// An in-process stand-in for the slice of `@number0/iroh` 1.1.0 that
// irohTransport.ts calls, so the transport's own code runs in CI without the
// network. It keeps the binding's shapes: byte arrays as `number[]`, the end
// of a stream read as an empty array, `acceptBi` throwing once a connection
// closes, and `acceptNext` answering null once the endpoint closes. Every
// `watch*` method throws, as calling one on 1.1.0 aborts the process.
// The real binding runs in irohTransport.smoke.test.ts behind a flag.

class Queue<T> {
  private items: T[] = []
  private waiters: Array<{ resolve: (item: T | null) => void }> = []
  closed = false

  push(item: T): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(item)
    else this.items.push(item)
  }

  next(): Promise<T | null> {
    const item = this.items.shift()
    if (item !== undefined) return Promise.resolve(item)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => this.waiters.push({ resolve }))
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter.resolve(null)
  }
}

function aborts(name: string): () => never {
  return () => {
    throw new Error(`${name} aborts the process on @number0/iroh 1.1.0`)
  }
}

class FakeId {
  constructor(private readonly value: string) {}
  toString(): string {
    return this.value
  }
}

class FakeAddr {
  constructor(
    private readonly endpointId: FakeId,
    private readonly relay: string | null = null,
    private readonly addresses: string[] = []
  ) {}
  id(): FakeId {
    return this.endpointId
  }
  relayUrl(): string | null {
    return this.relay
  }
  directAddresses(): string[] {
    return [...this.addresses]
  }
}

const TICKET_PREFIX = 'fakeendpoint:'

class FakeTicket {
  constructor(private readonly addr: FakeAddr) {}
  static fromAddr(addr: FakeAddr): FakeTicket {
    return new FakeTicket(addr)
  }
  static fromString(text: string): FakeTicket {
    if (!text.startsWith(TICKET_PREFIX)) throw new Error('wrong prefix, expected endpoint')
    const { id, relay, addresses } = JSON.parse(text.slice(TICKET_PREFIX.length)) as {
      id: string
      relay: string | null
      addresses: string[]
    }
    return new FakeTicket(new FakeAddr(new FakeId(id), relay, addresses))
  }
  endpointAddr(): FakeAddr {
    return this.addr
  }
  toString(): string {
    const { addr } = this
    return (
      TICKET_PREFIX +
      JSON.stringify({
        id: addr.id().toString(),
        relay: addr.relayUrl(),
        addresses: addr.directAddresses()
      })
    )
  }
}

type RelayModeValue = { kind: 'default' } | { kind: 'custom'; urls: string[] }

class FakeSend {
  constructor(private readonly into: Queue<number[]>) {}
  async writeAll(buf: number[]): Promise<void> {
    if (this.into.closed) throw new Error('sending stopped by peer')
    this.into.push([...buf])
  }
  async finish(): Promise<void> {
    if (this.into.closed) throw new Error('stream already finished')
    this.into.close()
  }
}

class FakeRecv {
  private held: number[] = []
  constructor(
    private readonly from: Queue<number[]>,
    private readonly connection: FakeConnection
  ) {}
  async read(sizeLimit: number): Promise<number[]> {
    if (this.connection.lostWith !== null) throw new Error(this.connection.lostWith)
    if (this.held.length === 0) this.held = (await this.from.next()) ?? []
    const piece = this.held.slice(0, sizeLimit)
    this.held = this.held.slice(sizeLimit)
    return piece
  }
  async stop(): Promise<void> {
    this.from.close()
  }
}

class FakeBiStream {
  constructor(
    readonly send: FakeSend,
    readonly recv: FakeRecv
  ) {}
}

class FakeConnection {
  readonly incomingStreams = new Queue<FakeBiStream>()
  peer!: FakeConnection
  closed = false
  // The binding's text for why the connection was lost; set, every read on it rejects.
  lostWith: string | null = null
  watchPaths = aborts('Connection.watchPaths')
  watchPathEvents = aborts('Connection.watchPathEvents')

  constructor(private readonly remote: FakeId) {}

  remoteId(): FakeId {
    return this.remote
  }

  async openBi(): Promise<FakeBiStream> {
    if (this.closed) throw new Error('connection lost')
    const outbound = new Queue<number[]>()
    const inbound = new Queue<number[]>()
    this.peer.incomingStreams.push(
      new FakeBiStream(new FakeSend(inbound), new FakeRecv(outbound, this.peer))
    )
    return new FakeBiStream(new FakeSend(outbound), new FakeRecv(inbound, this))
  }

  async acceptBi(): Promise<FakeBiStream> {
    const stream = await this.incomingStreams.next()
    if (stream === null) throw new Error('connection lost')
    return stream
  }

  close(): void {
    for (const side of [this, this.peer]) {
      side.closed = true
      side.incomingStreams.close()
    }
  }

  lose(message: string): void {
    for (const side of [this, this.peer]) side.lostWith = message
  }
}

export interface FakeBindOptions {
  secretKey: number[] | null
  relayMode: RelayModeValue | null
  alpns: number[][]
  preset: 'minimal' | null
}

export class FakeIrohNetwork {
  readonly endpoints = new Map<string, FakeEndpoint>()
  // Every builder's settings at bind, in order.
  readonly binds: FakeBindOptions[] = []
  // When false, `online()` never resolves, as with no relay reachable.
  relayReachable = true
  // When true, `online()` rejects.
  onlineFails = false
  // When true, the next `acceptNext()` throws, as when the endpoint's driver stops.
  acceptFails = false
  // Incoming connections the listener refused.
  refused = 0
  // Every connection either side made, so a test can see them closed.
  readonly connections: FakeConnection[] = []

  binding(): IrohBinding {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the classes below close over the network
    const net = this
    class FakeBuilder {
      private readonly options: FakeBindOptions = {
        secretKey: null,
        relayMode: null,
        alpns: [],
        preset: null
      }
      secretKey(bytes: number[]): void {
        this.options.secretKey = [...bytes]
      }
      relayMode(mode: RelayModeValue): void {
        this.options.relayMode = mode
      }
      alpns(alpns: number[][]): void {
        this.options.alpns = alpns
      }
      markMinimal(): void {
        this.options.preset = 'minimal'
      }
      async bind(): Promise<FakeEndpoint> {
        net.binds.push(this.options)
        const { secretKey, relayMode } = this.options
        if (secretKey === null || secretKey.length !== 32) throw new Error('fake needs a key')
        const id = Buffer.from(secretKey).toString('hex')
        if (net.endpoints.has(id)) throw new Error(`endpoint ${id} is already bound`)
        const relay =
          relayMode?.kind === 'custom' ? relayMode.urls[0] : 'https://relay.example.test./'
        const endpoint = new FakeEndpoint(net, new FakeId(id), relay)
        net.endpoints.set(id, endpoint)
        return endpoint
      }
    }
    const fake = {
      Endpoint: { builder: () => new FakeBuilder() },
      EndpointAddr: FakeAddr,
      EndpointTicket: FakeTicket,
      RelayMode: {
        defaultMode: (): RelayModeValue => ({ kind: 'default' }),
        customFromUrls: (urls: string[]): RelayModeValue => ({ kind: 'custom', urls })
      },
      presetMinimal: (builder: FakeBuilder) => builder.markMinimal()
    }
    return fake as unknown as IrohBinding
  }
}

interface FakeIncoming {
  accept: () => Promise<{ connect: () => Promise<FakeConnection> }>
  refuse: () => Promise<void>
}

class FakeEndpoint {
  private readonly incoming = new Queue<FakeIncoming>()
  closed = false
  watchAddr = aborts('Endpoint.watchAddr')
  watchHomeRelay = aborts('Endpoint.watchHomeRelay')
  watchNetworkChange = aborts('Endpoint.watchNetworkChange')

  constructor(
    private readonly net: FakeIrohNetwork,
    private readonly endpointId: FakeId,
    private readonly relay: string
  ) {}

  id(): FakeId {
    return this.endpointId
  }

  // What the binding reports after `online()`: the relay and this machine's
  // interface addresses, which a ticket must leave out.
  addr(): FakeAddr {
    return new FakeAddr(this.endpointId, this.relay, ['192.0.2.10:41641', '[fd00::10]:41641'])
  }

  online(): Promise<void> {
    if (this.net.onlineFails) return Promise.reject(new Error('relay handshake failed'))
    return this.net.relayReachable ? Promise.resolve() : new Promise<void>(() => {})
  }

  async acceptNext(): Promise<FakeIncoming | null> {
    if (this.net.acceptFails) throw new Error('endpoint driver stopped')
    return this.incoming.next()
  }

  async connect(addr: FakeAddr, alpn: number[]): Promise<FakeConnection> {
    const target = this.net.endpoints.get(addr.id().toString())
    if (!target || target.closed) throw new Error('timed out')
    void alpn
    const near = new FakeConnection(target.id())
    const far = new FakeConnection(this.endpointId)
    near.peer = far
    far.peer = near
    this.net.connections.push(near, far)
    target.incoming.push({
      accept: async () => ({ connect: async () => far }),
      refuse: async () => {
        this.net.refused += 1
        near.close()
      }
    })
    return near
  }

  async close(): Promise<void> {
    this.closed = true
    this.incoming.close()
    this.net.endpoints.delete(this.endpointId.toString())
  }
}
