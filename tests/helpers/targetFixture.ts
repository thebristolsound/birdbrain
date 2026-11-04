import { createServer, type Server } from 'http'
import type { Socket } from 'net'

// A loopback HTTP server for the launched-browser suites. It serves the given pages as HTML,
// answers any other path with 204, and logs the path and query of every request it receives.

export interface TargetFixture {
  origin: string
  requests: string[]
  close: () => Promise<void>
}

export async function startTargetFixture(
  pages: Readonly<Record<string, string>>
): Promise<TargetFixture> {
  const requests: string[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer((request, response) => {
    const url = request.url ?? '/'
    requests.push(url)
    const page = pages[url.split('?')[0]]
    if (page === undefined) {
      response.writeHead(204)
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no TCP address')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      })
  }
}
