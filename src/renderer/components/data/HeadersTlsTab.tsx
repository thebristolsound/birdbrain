import type { ReactNode } from 'react'
import type { Capture, TlsCertChainResult, TlsCertSummary } from '@shared/types'

// The response headers and the corroboration-only TLS chain a Capture
// recorded (#119, #123). Both are read off the Capture row, which mirrors the
// signed entry; the tab states what each is and is not.

export function parseHeaders(raw: string | undefined): Array<[string, string]> {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .filter((h): h is { name: string; value: string } => !!h && typeof h === 'object')
        .map((h) => [String(h.name), String(h.value)])
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    }
  } catch {
    // Not JSON: legacy rows stored headers as text.
    return [['headers', raw]]
  }
  return []
}

export function hasHeadersOrTls(capture: Capture): boolean {
  return parseHeaders(capture.headers).length > 0 || capture.tlsCertChain !== undefined
}

export type CertRole = 'leaf' | 'intermediate' | 'root'

// The card's role pill (#1552), read from the chain alone: the re-fetch
// records it leaf first, so position 0 is the leaf, a later certificate that
// names itself as issuer is the root, and anything between is an
// intermediate. Nothing here checks a signature.
export function certRole(cert: TlsCertSummary, index: number): CertRole {
  if (index === 0) return 'leaf'
  return cert.subject === cert.issuer ? 'root' : 'intermediate'
}

// The common name from a recorded distinguished name, for the card heading;
// the full name when there is no CN part.
export function commonName(name: string): string {
  const match = /(?:^|,\s*)CN=([^,]+)/.exec(name)
  return match ? match[1].trim() : name
}

function CertField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 font-mono text-[11px] leading-[1.7]">
      <span className="w-[66px] shrink-0 text-text-faint">{label}</span>
      <span className="min-w-0 break-all text-text-muted">{children}</span>
    </div>
  )
}

function TlsBlock({ tls }: { tls: TlsCertChainResult }) {
  if ('error' in tls) {
    return (
      <p className="text-xs text-text-muted" data-testid="tls-error">
        Re-fetch at {tls.refetchedAt} failed: {tls.error}
      </p>
    )
  }
  return (
    <ol className="space-y-2" data-testid="tls-chain">
      {tls.chain.map((cert, index) => (
        <li
          key={cert.fingerprint256}
          className="rounded border border-border bg-card px-3 py-2.5"
          style={{ marginLeft: index * 12 }}
          data-testid={`tls-cert-${index}`}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className="shrink-0 rounded bg-elevated px-1.5 py-px font-mono text-[10px] text-text-muted"
              data-testid="tls-cert-role"
            >
              {certRole(cert, index)}
            </span>
            <span
              className="min-w-0 truncate font-mono text-xs font-semibold text-text-primary"
              title={cert.subject}
            >
              {commonName(cert.subject)}
            </span>
          </div>
          <CertField label="issuer">{cert.issuer}</CertField>
          <CertField label="valid">
            {cert.validFrom} → {cert.validTo}
          </CertField>
          <CertField label="fingerprint">{cert.fingerprint256}</CertField>
        </li>
      ))}
    </ol>
  )
}

export function HeadersTlsTab({ capture }: { capture: Capture }) {
  const headers = parseHeaders(capture.headers)
  const tls = capture.tlsCertChain
  return (
    <div className="space-y-5 p-4" data-testid="headers-tls-tab">
      <section>
        <h3 className="mb-2 font-display text-[10px] font-semibold uppercase tracking-label text-text-faint">
          Response headers
        </h3>
        {headers.length === 0 ? (
          <p className="text-xs text-text-faint">No headers were recorded for this capture.</p>
        ) : (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
            {headers.map(([name, value], index) => (
              // Indexed, not named: a response can repeat a header (`set-cookie`).
              <div key={`${index}-${name}`} className="contents">
                <dt className="text-text-muted">{name}</dt>
                <dd className="break-all text-text-secondary">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section>
        <h3 className="mb-2 font-display text-[10px] font-semibold uppercase tracking-label text-text-faint">
          TLS certificate chain
        </h3>
        {tls ? (
          <>
            <p className="mb-2 text-[11px] text-text-faint">
              Corroboration only: re-fetched from {tls.url} at {tls.refetchedAt}, after the capture,
              and not bound to the captured transaction.
            </p>
            <TlsBlock tls={tls} />
          </>
        ) : (
          <p className="text-xs text-text-faint">No certificate chain was re-fetched.</p>
        )}
      </section>
    </div>
  )
}
