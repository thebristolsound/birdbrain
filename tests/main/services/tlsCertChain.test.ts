import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:tls'
import type { AddressInfo } from 'node:net'
import { fetchCertChain, isTlsCertChainError } from '@main/services/tlsCertChain'
import { LOCALHOST_KEY_PEM, LOCALHOST_CERT_PEM } from '../../helpers/tlsFixtures'

describe('fetchCertChain', () => {
  let server: Server
  let port: number

  beforeAll(async () => {
    server = createServer(
      { key: LOCALHOST_KEY_PEM, cert: LOCALHOST_CERT_PEM },
      (socket) => socket.end()
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('extracts the served cert chain (subject/issuer/fingerprint/validity/SAN)', async () => {
    const result = await fetchCertChain(`https://localhost:${port}/page`, {
      host: '127.0.0.1',
      port,
      ca: LOCALHOST_CERT_PEM
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
  })

  it('sorts the SAN list deterministically', async () => {
    const result = await fetchCertChain(`https://localhost:${port}/`, {
      host: '127.0.0.1',
      port,
      ca: LOCALHOST_CERT_PEM
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
    // 10.255.255.1 is non-routable in most environments; a short timeout fires.
    const result = await fetchCertChain('https://10.255.255.1/', {
      host: '10.255.255.1',
      port: 443,
      timeoutMs: 300
    })
    expect(isTlsCertChainError(result)).toBe(true)
  })

  it('fail-soft: an invalid URL returns an error marker, not a throw', async () => {
    const result = await fetchCertChain('not a url')
    expect(isTlsCertChainError(result)).toBe(true)
  })
})
