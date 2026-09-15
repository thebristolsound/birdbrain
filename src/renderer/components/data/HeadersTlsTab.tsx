import type { Capture, TlsCertChainResult } from '@shared/types'

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
          className="rounded border border-border bg-card p-2 font-mono text-[11px] text-text-secondary"
          style={{ marginLeft: index * 12 }}
        >
          <div className="text-text-primary">{cert.subject}</div>
          <div className="text-text-muted">issuer {cert.issuer}</div>
          <div className="text-text-muted">
            valid {cert.validFrom} → {cert.validTo}
          </div>
          <div className="break-all text-text-faint">sha256 {cert.fingerprint256}</div>
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
            {headers.map(([name, value]) => (
              <div key={name} className="contents">
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
