import { createServer, connect, type Server, type Socket } from 'net'

// A SOCKS5 proxy for the Egress specs (ADR-0032), written by hand so no test-only
// dependency is needed. It speaks the no-authentication method and the CONNECT
// command (RFC 1928), connects only to the destinations a spec allows, and records
// each connection it opened, so a spec can tell a request that came through it from
// one that left directly. Any other destination is refused with "connection not
// allowed by ruleset", so a run never reaches the internet through it.

export interface Socks5Proxy {
  port: number
  // `host:port` of every CONNECT the proxy accepted, in order.
  connects: string[]
  // Local ports of the proxy's own outbound connections. A target server that sees
  // a request arrive from one of these ports got it through the proxy.
  outboundPorts: Set<number>
  close: () => Promise<void>
}

export async function startSocks5Proxy(allowed: (host: string, port: number) => boolean) {
  const connects: string[] = []
  const outboundPorts = new Set<number>()
  const sockets = new Set<Socket>()

  const server: Server = createServer((client) => {
    sockets.add(client)
    client.on('close', () => sockets.delete(client))
    client.on('error', () => client.destroy())
    let buffered = Buffer.alloc(0)
    let stage: 'greeting' | 'request' | 'piping' = 'greeting'

    client.on('data', (chunk: Buffer) => {
      if (stage === 'piping') return
      buffered = Buffer.concat([buffered, chunk])
      if (stage === 'greeting') {
        if (buffered.length < 2 || buffered.length < 2 + buffered[1]) return
        const methods = buffered.subarray(2, 2 + buffered[1])
        buffered = buffered.subarray(2 + buffered[1])
        if (!methods.includes(0x00)) {
          client.end(Buffer.from([0x05, 0xff]))
          return
        }
        client.write(Buffer.from([0x05, 0x00]))
        stage = 'request'
      }
      if (stage === 'request') {
        const request = parseConnect(buffered)
        if (!request) return
        stage = 'piping'
        const reply = (code: number) => Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        if (request.command !== 0x01 || !allowed(request.host, request.port)) {
          client.end(reply(0x02))
          return
        }
        const upstream = connect(request.port, request.host, () => {
          connects.push(`${request.host}:${request.port}`)
          if (upstream.localPort) outboundPorts.add(upstream.localPort)
          client.write(reply(0x00))
          if (request.rest.length > 0) upstream.write(request.rest)
          client.pipe(upstream)
          upstream.pipe(client)
        })
        sockets.add(upstream)
        upstream.on('close', () => sockets.delete(upstream))
        upstream.on('error', () => client.end(reply(0x05)))
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  const proxy: Socks5Proxy = {
    port,
    connects,
    outboundPorts,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      })
  }
  return proxy
}

function parseConnect(
  data: Buffer
): { command: number; host: string; port: number; rest: Buffer } | null {
  if (data.length < 5) return null
  const command = data[1]
  const type = data[3]
  let host: string
  let offset: number
  if (type === 0x01) {
    if (data.length < 10) return null
    host = Array.from(data.subarray(4, 8)).join('.')
    offset = 8
  } else if (type === 0x03) {
    const length = data[4]
    if (data.length < 5 + length + 2) return null
    host = data.subarray(5, 5 + length).toString('latin1')
    offset = 5 + length
  } else if (type === 0x04) {
    if (data.length < 22) return null
    const groups: string[] = []
    for (let i = 4; i < 20; i += 2) groups.push(data.readUInt16BE(i).toString(16))
    host = groups.join(':')
    offset = 20
  } else {
    return null
  }
  return { command, host, port: data.readUInt16BE(offset), rest: data.subarray(offset + 2) }
}
