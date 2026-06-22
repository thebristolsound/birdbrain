import * as tls from 'node:tls'
import type { PeerCertificate, DetailedPeerCertificate } from 'node:tls'
import type {
  TlsCertSummary,
  TlsCertChain,
  TlsCertChainError,
  TlsCertChainResult
} from '@shared/types'

export type { TlsCertSummary, TlsCertChain, TlsCertChainError, TlsCertChainResult }

// Corroboration-only TLS cert-chain re-fetch (#123, ADR-0002).
//
// AFTER a capture is stored, the main process opens its own TLS connection to
// the captured origin and records whatever certificate chain the origin is
// serving at re-fetch time. This is CORROBORATION, not binding: the cert is NOT
// correlated with the specific captured HTTP transaction (a rotation, CDN
// failover, or redirect between capture and re-fetch could serve a different
// cert). Both the capture timestamp and the re-fetch timestamp are recorded so a
// reviewer understands the interval. See the #114 spike for the full rationale.
//
// The result is anchored into the signed, hash-chained manifest capture entry,
// so its serialization MUST be deterministic: stable field set, chain order
// leaf→root, SAN list sorted, no volatile fields. The field is OMITTED entirely
// when absent so legacy / cert-less entries keep identical entryHashes.

export function isTlsCertChainError(
  value: TlsCertChainResult | null | undefined
): value is TlsCertChainError {
  return !!value && 'error' in value
}

const DEFAULT_TIMEOUT_MS = 10_000

// Normalizes a Node tls.Distinguished-name object (subject / issuer) into a
// single stable string. Node exposes these as objects (e.g. { CN, O, C }); we
// join sorted key=value pairs so the same DN always serializes identically.
function formatName(name: PeerCertificate['subject'] | PeerCertificate['issuer']): string {
  if (!name || typeof name !== 'object') return ''
  return Object.keys(name as Record<string, unknown>)
    .sort()
    .map((k) => `${k}=${String((name as Record<string, unknown>)[k])}`)
    .join(', ')
}

// Splits Node's comma-separated `subjectaltname` (e.g. "DNS:a.com, DNS:b.com")
// into a sorted list. Sorted so the hashed serialization is order-independent.
function parseSanList(subjectaltname: string | undefined): string[] {
  if (!subjectaltname) return []
  return subjectaltname
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
}

function summarizeCert(cert: PeerCertificate): TlsCertSummary {
  return {
    subject: formatName(cert.subject),
    issuer: formatName(cert.issuer),
    validFrom: cert.valid_from ?? '',
    validTo: cert.valid_to ?? '',
    fingerprint256: cert.fingerprint256 ?? '',
    serialNumber: cert.serialNumber ?? '',
    subjectAltNames: parseSanList(cert.subjectaltname)
  }
}

// Walks the issuerCertificate links leaf→root, stopping at a self-signed cert
// (issuerCertificate === self) or a cycle/repeat (defensive: a misbehaving peer
// could return a loop). Node terminates the chain by pointing the root's
// issuerCertificate back at itself.
function walkChain(leaf: DetailedPeerCertificate): TlsCertSummary[] {
  const out: TlsCertSummary[] = []
  const seen = new Set<string>()
  let current: DetailedPeerCertificate | undefined = leaf
  while (current && Object.keys(current).length > 0) {
    const fp = current.fingerprint256 ?? ''
    if (fp && seen.has(fp)) break
    if (fp) seen.add(fp)
    out.push(summarizeCert(current))
    const next: DetailedPeerCertificate | undefined = current.issuerCertificate
    if (!next || next === current) break
    current = next
  }
  return out
}

export interface FetchCertChainOptions {
  timeoutMs?: number
  // Test seam: forwarded to tls.connect (e.g. rejectUnauthorized:false against a
  // self-signed local server, or a ca for the server's own CA). Never set in
  // production — the re-fetch must validate against the OS trust store.
  rejectUnauthorized?: boolean
  ca?: string | Buffer | Array<string | Buffer>
  port?: number
  host?: string
}

// Re-fetches the serving TLS cert chain for `url`. Fail-soft by contract: on any
// error/timeout it resolves to a {error, refetchedAt, url} marker — it NEVER
// throws, so the capture path is never blocked or failed by a re-fetch problem.
// Returns null only for a non-https URL (nothing to corroborate).
export function fetchCertChain(
  url: string,
  options: FetchCertChainOptions = {}
): Promise<TlsCertChainResult | null> {
  const refetchedAt = new Date().toISOString()
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return Promise.resolve({ url, refetchedAt, error: 'invalid URL' })
  }
  if (parsed.protocol !== 'https:') return Promise.resolve(null)

  const host = options.host ?? parsed.hostname
  const port = options.port ?? (parsed.port ? Number(parsed.port) : 443)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: TlsCertChainResult): void => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        // ignore — best-effort teardown
      }
      resolve(result)
    }

    // Raw tls.connect opens a fresh socket with no session cache, so the full
    // handshake always runs and the peer certificate is always present (the
    // session-resumption gap that affects the pooled https Agent — Node #7672 —
    // does not apply here). tls.connect can throw synchronously on bad
    // params/port; catch it to keep the fail-soft contract.
    let socket: tls.TLSSocket
    try {
      socket = tls.connect({
        host,
        port,
        // servername drives SNI; required for virtual-hosted origins.
        servername: parsed.hostname,
        rejectUnauthorized: options.rejectUnauthorized ?? true,
        ...(options.ca !== undefined ? { ca: options.ca } : {}),
        timeout: timeoutMs
      })
    } catch (err) {
      resolve({ url, refetchedAt, error: String(err) })
      return
    }

    socket.once('secureConnect', () => {
      try {
        const leaf = socket.getPeerCertificate(true)
        if (!leaf || Object.keys(leaf).length === 0) {
          finish({ url, refetchedAt, error: 'no peer certificate' })
          return
        }
        finish({ url, refetchedAt, chain: walkChain(leaf) })
      } catch (err) {
        finish({ url, refetchedAt, error: String(err) })
      }
    })

    socket.once('timeout', () => finish({ url, refetchedAt, error: 'timeout' }))
    socket.once('error', (err) => finish({ url, refetchedAt, error: String(err) }))
  })
}
