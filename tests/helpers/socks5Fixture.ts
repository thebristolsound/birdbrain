import { connect, createServer, isIP, type Server, type Socket } from 'net'

// A SOCKS5 proxy for the launched-browser suites (RFC 1928, no authentication, CONNECT only).
// It forwards to loopback and refuses every other destination, so the browser's own traffic to
// outside hosts is logged here by name and goes nowhere. Each request is logged before it is
// answered.

export interface Socks5Request {
  host: string
  port: number
  allowed: boolean
}

export interface Socks5Fixture {
  port: number
  url: string
  requests: Socks5Request[]
  close: () => Promise<void>
}

const VERSION = 0x05
const NO_AUTH = 0x00
const NO_ACCEPTABLE_METHOD = 0xff
const CONNECT = 0x01
const REPLY = {
  succeeded: 0x00,
  notAllowed: 0x02,
  refused: 0x05,
  commandNotSupported: 0x07,
  addressNotSupported: 0x08
}

export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost') return true
  if (isIP(host) === 4) return host.startsWith('127.')
  return isIP(host) === 6 && /^(0*:)*:?0*1$/.test(host)
}

function reply(socket: Socket, code: number): void {
  // The bound address is not used by the browser; 0.0.0.0:0 is what many proxies send.
  socket.write(Buffer.from([VERSION, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
}

// Reads exact byte counts from a socket that has not been piped yet.
function reader(socket: Socket): {
  take: (n: number) => Promise<Buffer>
  release: () => Buffer
} {
  let buffered = Buffer.alloc(0)
  let waiting: { n: number; resolve: (bytes: Buffer) => void; reject: (e: Error) => void } | null =
    null
  const pump = (): void => {
    if (!waiting || buffered.length < waiting.n) return
    const { n, resolve } = waiting
    waiting = null
    const bytes = buffered.subarray(0, n)
    buffered = buffered.subarray(n)
    resolve(bytes)
  }
  const onData = (chunk: Buffer): void => {
    buffered = Buffer.concat([buffered, chunk])
    pump()
  }
  const onEnd = (): void => waiting?.reject(new Error('client closed during the handshake'))
  socket.on('data', onData)
  socket.on('close', onEnd)
  return {
    take: (n) =>
      new Promise((resolve, reject) => {
        waiting = { n, resolve, reject }
        pump()
      }),
    release: () => {
      socket.pause()
      socket.off('data', onData)
      socket.off('close', onEnd)
      return buffered
    }
  }
}

async function readAddress(take: (n: number) => Promise<Buffer>, type: number): Promise<string> {
  if (type === 0x01) return [...(await take(4))].join('.')
  if (type === 0x03) {
    const [length] = await take(1)
    return (await take(length)).toString('utf8')
  }
  if (type === 0x04) {
    const bytes = await take(16)
    const groups: string[] = []
    for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16))
    return groups.join(':')
  }
  throw new Error(`address type ${type}`)
}

export async function startSocks5Fixture(
  allow: (host: string, port: number) => boolean = (host) => isLoopbackHost(host)
): Promise<Socks5Fixture> {
  const requests: Socks5Request[] = []
  const sockets = new Set<Socket>()
  const track = (socket: Socket): void => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
  }

  async function handle(client: Socket): Promise<void> {
    const { take, release } = reader(client)
    const [version, methodCount] = await take(2)
    const methods = await take(methodCount)
    if (version !== VERSION || !methods.includes(NO_AUTH)) {
      client.end(Buffer.from([VERSION, NO_ACCEPTABLE_METHOD]))
      return
    }
    client.write(Buffer.from([VERSION, NO_AUTH]))
    const [, command, , addressType] = await take(4)
    let host: string
    try {
      host = await readAddress(take, addressType)
    } catch {
      reply(client, REPLY.addressNotSupported)
      client.end()
      return
    }
    const port = (await take(2)).readUInt16BE(0)
    if (command !== CONNECT) {
      reply(client, REPLY.commandNotSupported)
      client.end()
      return
    }
    const allowed = allow(host, port)
    requests.push({ host, port, allowed })
    if (!allowed) {
      reply(client, REPLY.notAllowed)
      client.end()
      return
    }
    const upstream = connect({ host, port })
    track(upstream)
    upstream.once('error', () => {
      if (!client.destroyed) {
        reply(client, REPLY.refused)
        client.end()
      }
    })
    upstream.once('connect', () => {
      reply(client, REPLY.succeeded)
      const early = release()
      if (early.length > 0) upstream.write(early)
      client.pipe(upstream)
      upstream.pipe(client)
    })
  }

  const server: Server = createServer((client) => {
    track(client)
    handle(client).catch(() => client.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no TCP address')
  const { port } = address
  return {
    port,
    url: `socks5://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      })
  }
}
