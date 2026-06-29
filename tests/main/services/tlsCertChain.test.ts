import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls'
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net'
import type { AddressInfo, Socket } from 'node:net'
import { fetchCertChain, isTlsCertChainError } from '@main/services/tlsCertChain'
import { createLocalhostCert } from '../../helpers/tlsFixtures'
import { HAS_OPENSSL } from '../../helpers/openssl'

describe('fetchCertChain', () => {
  let server: TlsServer | undefined
  let port: number
  let cert: string
  let hangingServer: TcpServer
  let hangingPort: number
  const hangingSockets = new Set<Socket>()

  beforeAll(async () => {
    // The cert is generated at test time (no committed private key, #157), which
    // needs openssl. Where it is absent the cert-dependent cases skipIf below;
    // the fail-soft cases need no TLS server and still run.
    if (HAS_OPENSSL) {
      const generated = createLocalhostCert()
      cert = generated.cert
      server = createTlsServer({ key: generated.key, cert: generated.cert }, (socket) =>
        socket.end()
      )
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
      port = (server!.address() as AddressInfo).port
    }

    // A TCP server that accepts connections but never speaks TLS, so the
    // handshake hangs and a short timeout fires deterministically (no reliance on
    // an unreachable external IP). Server-side sockets are tracked so teardown
    // can destroy them — otherwise hangingServer.close() blocks on the open
    // (hung) connection.
    hangingServer = createTcpServer((conn) => {
      hangingSockets.add(conn)
      conn.once('close', () => hangingSockets.delete(conn))
    })
    await new Promise<void>((resolve) => hangingServer.listen(0, '127.0.0.1', resolve))
    hangingPort = (hangingServer.address() as AddressInfo).port
  })

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    for (const conn of hangingSockets) conn.destroy()
    await new Promise<void>((resolve) => hangingServer.close(() => resolve()))
  })

  it.skipIf(!HAS_OPENSSL)(
    'extracts the served cert chain (subject/issuer/fingerprint/validity/SAN)',
    async () => {
      const result = await fetchCertChain(`https://localhost:${port}/page`, {
        host: '127.0.0.1',
        port,
        ca: cert
      })
      expect(result).not.toBeNull()
      expect(isTlsCertChainError(result)).toBe(false)
      if (!result || isTlsCertChainError(result)) throw new Error('expected a chain')

      expect(result.url).toBe(`https://localhost:${port}/page`)
      expect(typeof result.refetchedAt).toBe('string')
      expect(result.chain.length).toBeGreaterThanOrEqual(1)

      const leaf = result.chain[0]
      expect(leaf.subject).toContain('CN=localhost')
      expect(leaf.issuer).toContain('CN=localhost')
      expect(leaf.fingerprint256).toMatch(/^[0-9A-F:]+$/)
      expect(leaf.serialNumber.length).toBeGreaterThan(0)
      expect(leaf.validFrom.length).toBeGreaterThan(0)
      expect(leaf.validTo.length).toBeGreaterThan(0)
      expect(leaf.subjectAltNames).toContain('DNS:localhost')
    }
  )

  it.skipIf(!HAS_OPENSSL)('sorts the SAN list deterministically', async () => {
    const result = await fetchCertChain(`https://localhost:${port}/`, {
      host: '127.0.0.1',
      port,
      ca: cert
    })
    if (!result || isTlsCertChainError(result)) throw new Error('expected a chain')
    const sans = result.chain[0].subjectAltNames
    const sorted = [...sans].sort()
    expect(sans).toEqual(sorted)
  })

  it('returns null for a non-https URL (nothing to corroborate)', async () => {
    const result = await fetchCertChain('http://example.com/')
    expect(result).toBeNull()
  })

  it('fail-soft: an unreachable host returns an error marker and never throws', async () => {
    // Port 1 is reserved and not listening; connection refused.
    const result = await fetchCertChain('https://127.0.0.1:1/', {
      host: '127.0.0.1',
      port: 1,
      timeoutMs: 2000
    })
    expect(isTlsCertChainError(result)).toBe(true)
    if (!isTlsCertChainError(result)) throw new Error('expected error marker')
    expect(result.error.length).toBeGreaterThan(0)
    expect(typeof result.refetchedAt).toBe('string')
  })

  it('fail-soft: a connection timeout returns an error marker', async () => {
    const result = await fetchCertChain(`https://127.0.0.1:${hangingPort}/`, {
      host: '127.0.0.1',
      port: hangingPort,
      timeoutMs: 300
    })
    expect(isTlsCertChainError(result)).toBe(true)
  })

  it('fail-soft: an invalid URL returns an error marker, not a throw', async () => {
    const result = await fetchCertChain('not a url')
    expect(isTlsCertChainError(result)).toBe(true)
  })
})
