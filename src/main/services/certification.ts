import { app } from 'electron'
import type { ExportPreflight, HashVerification, Capture, TrustedTime } from '@shared/types'

// Minimal shape of the export-time data the certification needs. Kept structural
// (not a hard import of ExportData) so the certifier can be exercised in tests
// without constructing the full export pipeline.
export interface CertificationInput {
  caseName: string
  exportTimestamp: string
  installationId: string
  operatorName: string
  operatorRole: string
  operatorOrganization: string
  tsaUrl: string
  preflight: ExportPreflight
  captures: Capture[]
  verifications: HashVerification[]
}

export interface CertificationCaptureRow {
  id: string
  title: string
  url: string
  trustedTime: TrustedTime
  tsaName?: string
  stampedAt?: string
}

export interface CertificationFields {
  toolName: string
  toolVersion: string
  hashAlgorithm: 'SHA-256'
  processDescription: string
  tsaIdentity: string
  certifier: {
    operatorName: string
    operatorRole: string
    operatorOrganization: string
    installationId: string
  }
  trustedTime: {
    stampedCount: number
    pendingCount: number
    noneCount: number
    allStamped: boolean
  }
  captures: CertificationCaptureRow[]
  exportTimestamp: string
  caseName: string
}

const LAWYER_TBD_MARKER = '[LEGAL WORDING TO BE SUPPLIED BY COUNSEL]'

// Resolve the real application version. The unit-test/vitest harness runs via
// ELECTRON_RUN_AS_NODE where the electron `app` module is unavailable, so guard
// the lookup and fall back to a sentinel rather than throwing.
export function resolveToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}

export function buildCertificationFields(
  data: CertificationInput,
  toolVersion: string
): CertificationFields {
  const captures: CertificationCaptureRow[] = data.captures.map((capture) => {
    const verification = data.verifications.find((v) => v.captureId === capture.id)
    const trustedTime = verification?.trustedTime ?? capture.trustedTimeStatus ?? 'none'
    return {
      id: capture.id,
      title: capture.title,
      url: capture.url,
      trustedTime,
      tsaName: verification?.tsaName,
      stampedAt: verification?.stampedAt
    }
  })

  const stampedCount = data.preflight.stampedCaptureCount
  const pendingCount = data.preflight.pendingCaptureCount
  const noneCount = data.preflight.noneCaptureCount

  return {
    toolName: 'Birdbrain',
    toolVersion,
    hashAlgorithm: 'SHA-256',
    processDescription:
      'Each web page was captured as a self-contained MHTML archive. The captured bytes ' +
      'were hashed with SHA-256 and recorded in a hash-chained append-only manifest, so that ' +
      'any later alteration of a capture or of the manifest is detectable. Where enabled, the ' +
      'capture content hash was submitted to an RFC 3161 Time-Stamping Authority and the ' +
      'returned timestamp token was retained alongside the capture.',
    tsaIdentity: data.tsaUrl,
    certifier: {
      operatorName: data.operatorName,
      operatorRole: data.operatorRole,
      operatorOrganization: data.operatorOrganization,
      installationId: data.installationId
    },
    trustedTime: {
      stampedCount,
      pendingCount,
      noneCount,
      allStamped: data.preflight.unstampedCaptureCount === 0 && data.preflight.captureCount > 0
    },
    captures,
    exportTimestamp: data.exportTimestamp,
    caseName: data.caseName
  }
}

export function buildCertification(data: CertificationInput, toolVersion: string): string {
  const fields = buildCertificationFields(data, toolVersion)
  return renderCertificationHtml(fields)
}

function renderCertificationHtml(fields: CertificationFields): string {
  const { certifier, trustedTime } = fields

  const stamped = fields.captures.filter((c) => c.trustedTime === 'rfc3161')
  const unstamped = fields.captures.filter((c) => c.trustedTime !== 'rfc3161')

  const trustedTimeSection = trustedTime.allStamped
    ? `<p>All ${stamped.length} capture${stamped.length === 1 ? '' : 's'} in this export carry an
        RFC 3161 trusted timestamp asserting the time at which the capture content hash existed.</p>`
    : `<p>RFC 3161 trusted time is asserted <strong>only</strong> for the
        ${stamped.length} capture${stamped.length === 1 ? '' : 's'} listed as timestamped below.
        For the ${unstamped.length} remaining capture${unstamped.length === 1 ? '' : 's'}
        (${trustedTime.pendingCount} pending, ${trustedTime.noneCount} none),
        <strong>no trusted timestamp is asserted</strong>; the recorded capture time is the
        operator's local system clock only.</p>`

  const stampedRows = stamped
    .map((c) => {
      const who = c.tsaName ? esc(c.tsaName) : 'RFC 3161 TSA'
      const when = c.stampedAt ? esc(new Date(c.stampedAt).toISOString()) : ''
      return `<tr><td>${esc(c.title)}</td><td class="mono url">${esc(c.url)}</td><td>${who}${
        when ? ' — ' + when : ''
      }</td></tr>`
    })
    .join('')

  const unstampedRows = unstamped
    .map(
      (c) =>
        `<tr><td>${esc(c.title)}</td><td class="mono url">${esc(c.url)}</td><td>${esc(
          c.trustedTime
        )} — no trusted timestamp asserted</td></tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Certificate of Authenticity — ${esc(fields.caseName)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; background: #fff; padding: 3rem; max-width: 50rem; margin: 0 auto; line-height: 1.5; }
  h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin: 1.75rem 0 0.5rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
  p { margin: 0.5rem 0; }
  .subtitle { color: #555; font-size: 0.9rem; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; font-size: 0.85rem; }
  th, td { padding: 0.4rem 0.5rem; text-align: left; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { font-size: 0.75rem; text-transform: uppercase; color: #555; }
  .mono { font-family: 'Courier New', monospace; font-size: 0.8rem; }
  .url { word-break: break-all; }
  dl { margin: 0.5rem 0; }
  dt { font-weight: bold; margin-top: 0.5rem; }
  dd { margin-left: 0; }
  .lawyer-tbd { margin: 1.5rem 0; padding: 1rem; border: 2px dashed #b00; background: #fff5f5; color: #800; font-weight: bold; text-align: center; }
  .self-asserted { margin: 1rem 0; padding: 0.75rem; border-left: 4px solid #b8860b; background: #fffbeb; }
  .signature-block { margin-top: 2.5rem; }
  .sig-line { margin-top: 2rem; border-top: 1px solid #111; width: 22rem; padding-top: 0.25rem; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Certificate of Authenticity</h1>
<p class="subtitle">FRE 902(13)/(14) supporting certification — Case: ${esc(fields.caseName)}</p>

<!-- LAWYER-TBD: The sworn declaration / certification legal wording for the applicable
     jurisdiction and rule (e.g. FRE 902(13)/(14), 28 U.S.C. § 1746) has NOT been drafted.
     Counsel must supply the operative certifying language. Do not treat the placeholder
     banner below as finalized legal text. ${LAWYER_TBD_MARKER} -->
<div class="lawyer-tbd">${LAWYER_TBD_MARKER}<br>
<span style="font-weight: normal; font-size: 0.8rem;">The operative sworn declaration / certification wording must be supplied by counsel for the relevant jurisdiction and rule. This document is scaffolding only.</span>
</div>

<h2>Capturing Tool</h2>
<dl>
  <dt>Tool name</dt><dd>${esc(fields.toolName)}</dd>
  <dt>Tool version</dt><dd>${esc(fields.toolVersion)}</dd>
  <dt>Hash algorithm</dt><dd>${esc(fields.hashAlgorithm)}</dd>
  <dt>RFC 3161 Time-Stamping Authority (configured)</dt><dd class="mono">${
    fields.tsaIdentity ? esc(fields.tsaIdentity) : 'none configured'
  }</dd>
</dl>

<h2>Process</h2>
<p>${esc(fields.processDescription)}</p>

<h2>Trusted Time</h2>
${trustedTimeSection}
${
  stampedRows
    ? `<h3 style="font-size:0.95rem;margin-top:1rem;">Timestamped captures</h3>
<table><thead><tr><th>Title</th><th>URL</th><th>Timestamp authority</th></tr></thead><tbody>${stampedRows}</tbody></table>`
    : ''
}
${
  unstampedRows
    ? `<h3 style="font-size:0.95rem;margin-top:1rem;">Captures without trusted time</h3>
<table><thead><tr><th>Title</th><th>URL</th><th>Status</th></tr></thead><tbody>${unstampedRows}</tbody></table>`
    : ''
}

<h2>Certifier</h2>
<dl>
  <dt>Name</dt><dd>${esc(certifier.operatorName)}</dd>
  <dt>Role</dt><dd>${certifier.operatorRole ? esc(certifier.operatorRole) : '—'}</dd>
  <dt>Organization</dt><dd>${
    certifier.operatorOrganization ? esc(certifier.operatorOrganization) : '—'
  }</dd>
  <dt>Birdbrain installation ID</dt><dd class="mono">${esc(certifier.installationId)}</dd>
  <dt>Export generated</dt><dd class="mono">${esc(fields.exportTimestamp)}</dd>
</dl>

<div class="self-asserted">
  <strong>Self-asserted identity.</strong> The certifier identity above (name, role, and
  organization) is self-asserted by the operator. It is <strong>not</strong> cryptographically
  authenticated by Birdbrain. Birdbrain does not verify the operator's real-world identity.
</div>

<div class="signature-block">
  <div class="sig-line">Signature of certifier</div>
  <div class="sig-line">Date</div>
</div>

</body>
</html>`
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
