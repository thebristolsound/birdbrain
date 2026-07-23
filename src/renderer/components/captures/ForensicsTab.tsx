import { useEffect, useId, useState } from 'react'
import type { Capture } from '@shared/types'
import { useVerifyMutation } from '@renderer/components/captures/useVerifyMutation'
import { getProvenanceColor } from '@renderer/components/captures/getProvenanceColor'

interface Props {
  capture: Capture
  caseId: string
}

export function ForensicsTab({ capture, caseId }: Props) {
  const verify = useVerifyMutation(capture.id, caseId)
  const provenance = getProvenanceColor(capture.lastVerifiedStatus)
  const [headersOpen, setHeadersOpen] = useState(false)
  const headersRegionId = useId()
  const isMhtml = capture.format === 'mhtml'
  const hasHeaders = hasMeaningfulHeaders(capture.headers)

  useEffect(() => {
    setHeadersOpen(false)
  }, [capture.id])

  return (
    <div>
      {capture.format === 'html' && (
        <div
          className="mx-5 mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-500"
          data-testid="forensics-legacy-banner"
        >
          Legacy HTML capture — captured before forensic chain (v2). Hash present, chain metadata
          unavailable.
        </div>
      )}

      {isMhtml && (
        <Section title="Hash chain">
          <Row label="Hash (SHA-256)" value={capture.hash} />
          <Row label="Previous hash" value={capture.prevHash} />
          <Row label="Entry hash" value={capture.entryHash} />
          <Row label="Manifest index" value={capture.manifestIndex} />
          <div>
            <div className="text-text-faint">Chain status</div>
            <div className={`flex items-center gap-2 ${provenance.text}`}>
              <span
                data-testid="forensics-chain-status-dot"
                className={`inline-block h-1.5 w-1.5 rounded-full ${provenance.dot} ${
                  verify.isPending ? 'animate-pulse' : ''
                }`}
              />
              <span data-testid="forensics-chain-status-label">{provenance.label}</span>
            </div>
          </div>
        </Section>
      )}

      <Section title="Identity">
        <Row label="URL" value={capture.url} />
        <Row label="Title" value={capture.title} />
        <Row label="Captured at" value={new Date(capture.timestamp).toLocaleString()} />
        <Row label="Created at" value={new Date(capture.createdAt).toLocaleString()} />
        {!isMhtml && <Row label="Hash (SHA-256)" value={capture.hash} />}
      </Section>

      {isMhtml && (
        <Section title="Capture environment">
          <Row label="Tool version" value={capture.toolVersion} />
          <Row label="Extension version" value={capture.extensionVersion} />
          <Row label="Browser version" value={capture.browserVersion} />
          <Row label="User agent" value={capture.userAgent} />
          <Row label="HTTP status" value={capture.httpStatus || undefined} />
        </Section>
      )}

      {isMhtml && (capture.operatorName || capture.operatorId) && (
        <Section title="Operator">
          <Row label="Operator name" value={capture.operatorName} />
          <Row label="Operator ID" value={capture.operatorId} />
        </Section>
      )}

      {hasHeaders && (
        <Section
          title="Headers"
          action={
            <button
              type="button"
              onClick={() => setHeadersOpen((v) => !v)}
              aria-label={headersOpen ? 'Hide headers' : 'Show headers'}
              aria-controls={headersRegionId}
              aria-expanded={headersOpen}
              className="rounded-md px-2 py-0.5 text-[11px] text-accent hover:bg-accent-subtle"
              data-testid="forensics-headers-toggle"
            >
              {headersOpen ? 'Hide' : 'Show'}
            </button>
          }
        >
          {headersOpen && (
            <pre
              id={headersRegionId}
              className="whitespace-pre-wrap break-all text-[11px] text-text-muted"
            >
              {capture.headers}
            </pre>
          )}
        </Section>
      )}
    </div>
  )
}

function Section({
  title,
  children,
  action
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="border-b border-border px-5 py-4 [&:last-child]:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-faint">{title}</h3>
        {action}
      </div>
      <div className="space-y-3 font-mono text-xs">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string | number | undefined | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div>
      <div className="text-text-faint">{label}</div>
      <div className="break-all text-text-secondary">{String(value)}</div>
    </div>
  )
}

function hasMeaningfulHeaders(headers: string | null | undefined) {
  const trimmed = headers?.trim()
  if (!trimmed) return false

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.length > 0
    if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0
  } catch {
    return !trimmed.startsWith('{') && !trimmed.startsWith('[')
  }

  return true
}
