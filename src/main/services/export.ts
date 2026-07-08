import { existsSync, readFileSync, writeFileSync } from 'fs'
import { unlink } from 'fs/promises'
import { createHash } from 'crypto'
import { join } from 'path'
import * as db from '@main/services/database'
import { getStorageRoot } from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import { getAnnotations } from '@main/services/annotations'
import { burnAnnotations } from '@main/services/burnAnnotations'
import { getSettings } from '@main/services/settings'
import { getInstallationId } from '@main/services/installationId'
import { getPublicKeyPem } from '@main/services/signingKey'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { buildTrustedTimeIndex } from '@main/services/trustedTime'
import type { ExportVerificationResult } from '@main/services/manifest'
import { createStoredZip } from '@main/services/zip'
import { getTsaTrustBundle } from '@main/services/tsaTrust'
import { canonicalStringify, extractTimestampTokenCertificatesPem } from '@shared/verify'
import { buildCertification, resolveToolVersion } from '@main/services/certification'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'
import { MANIFEST_FILENAME } from '@shared/constants'
import type {
  ExportOptions,
  ExportPreflight,
  HashVerification,
  Capture,
  AnnotationPin,
  TrustedTime
} from '@shared/types'

interface ExportData {
  caseName: string
  caseDescription?: string
  dateRange: { first: string; last: string } | null
  investigatorName: string
  exportTimestamp: string
  captures: Capture[]
  verifications: HashVerification[]
  screenshots: Map<string, string> // captureId -> base64
  pins: Map<string, AnnotationPin[]>
  installationId: string
  operatorName: string
  operatorRole: string
  operatorOrganization: string
  tsaUrl: string
  preflight: ExportPreflight
}

interface ManifestTimestampEntry {
  [key: string]: unknown
  index: number
  type: 'timestamp'
  captureContentHash: string
  tsaToken?: string
}

interface EvidenceArtifact {
  path: string
  sha256: string
  sizeBytes: number
}

export async function verifyCaptures(
  caseId: string,
  captureLifecycle: CaptureLifecycle,
  onItem?: (done: number, total: number) => void
): Promise<HashVerification[]> {
  const captures = db.listCaptures(caseId)
  const results: HashVerification[] = []
  for (const [index, capture] of captures.entries()) {
    // Delegate to the MHTML-aware pipeline so export-time verification matches the
    // badge's manual flow: streams bytes, checks the manifest chain, and persists
    // the outcome back onto the capture row.
    results.push(await captureLifecycle.verify(capture.id))
    onItem?.(index + 1, captures.length)
  }
  return results
}

export function getExportPreflight(caseId: string): ExportPreflight {
  const captures = db.listCaptures(caseId)
  const trustedTimes = buildTrustedTimeIndex(join(getStorageRoot(), caseId))
  const counts: Record<TrustedTime, number> = { rfc3161: 0, pending: 0, none: 0 }

  for (const capture of captures) {
    const trustedTime =
      trustedTimes.get(capture.hash)?.trustedTime ?? capture.trustedTimeStatus ?? 'none'
    counts[trustedTime]++
  }

  return {
    captureCount: captures.length,
    stampedCaptureCount: counts.rfc3161,
    unstampedCaptureCount: counts.pending + counts.none,
    pendingCaptureCount: counts.pending,
    noneCaptureCount: counts.none
  }
}

export async function generateReport(
  caseId: string,
  options: ExportOptions,
  captureLifecycle: CaptureLifecycle,
  onProgress?: (step: string, percent: number) => void
): Promise<void> {
  const settings = getSettings()
  if (!settings.operatorName?.trim()) {
    throw new Error(
      'Operator name required. Configure your name in Birdbrain settings before exporting.'
    )
  }

  const caseData = db.getCase(caseId)
  if (!caseData) throw new Error(`Case not found: ${caseId}`)

  onProgress?.('Loading captures...', 10)
  const captures = db.listCaptures(caseId)

  // Build export data
  const data: ExportData = {
    caseName: caseData.name,
    caseDescription: caseData.description,
    dateRange:
      captures.length > 0
        ? { first: captures[captures.length - 1].timestamp, last: captures[0].timestamp }
        : null,
    investigatorName: options.investigatorName,
    exportTimestamp: new Date().toISOString(),
    captures,
    verifications: [],
    screenshots: new Map(),
    pins: new Map(),
    installationId: getInstallationId(),
    operatorName: settings.operatorName,
    operatorRole: settings.operatorRole ?? '',
    operatorOrganization: settings.operatorOrganization ?? '',
    tsaUrl: settings.tsaUrl,
    preflight: getExportPreflight(caseId)
  }

  if (options.include.auditTrail) {
    onProgress?.('Verifying capture integrity...', 10)
    // Per-item progress across the 10–50% band so a large case advances
    // continuously instead of parking on a single milestone.
    data.verifications = await verifyCaptures(caseId, captureLifecycle, (done, total) =>
      onProgress?.(`Verifying capture ${done} of ${total}...`, 10 + Math.round((done / total) * 40))
    )
  }

  if (options.include.screenshots) {
    onProgress?.('Loading screenshots...', 60)
    const total = captures.length
    for (const [index, cap] of captures.entries()) {
      // Emit before the early-continue so skipped (screenshot-less) captures
      // still advance the 60–80% band.
      onProgress?.(
        `Loading screenshot ${index + 1} of ${total}...`,
        60 + Math.round(((index + 1) / total) * 20)
      )
      const screenshotBuffer = defaultCaptureStore.readArtifact(cap.caseId, cap.id, 'png')
      if (!screenshotBuffer) continue

      let finalBuffer: Buffer = screenshotBuffer
      if (options.include.annotations === 'burned') {
        const bundle = getAnnotations(cap.id)
        if (bundle.annotations) {
          finalBuffer = await burnAnnotations(screenshotBuffer, bundle.annotations)
        }
        data.pins.set(cap.id, bundle.pins)
      }
      data.screenshots.set(cap.id, finalBuffer.toString('base64'))
    }
  }

  onProgress?.('Generating report...', 80)
  const html = buildHtmlReport(data, options)

  if (options.format === 'zip') {
    onProgress?.('Packaging evidence...', 90)
    const { zip, packageHash, verificationResult } = buildEvidenceZip(caseId, data, html)
    writeFileSync(options.outputPath, zip)

    // Record the export as a signed, hash-chained audit entry (#124). Ordering
    // is deliberate: the evidence (and thus packageHash) is built from the
    // manifest tail BEFORE this append, so packageHash does not — and must not —
    // cover this entry. The bundled manifest.jsonl copy therefore lags the live
    // case manifest by exactly this one entry; that is acceptable because
    // packageHash commits to artifact content, not to the manifest.
    //
    // The append happens after the .zip is written. If it throws (signing key
    // failure, disk error), best-effort delete the orphaned package so we never
    // leave a zip on disk without its corresponding audit entry, then re-throw.
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)
    try {
      appendManifestEntry(caseDir, {
        type: 'export',
        caseId,
        timestamp: data.exportTimestamp,
        operatorId: data.installationId,
        operatorName: data.operatorName,
        toolVersion: resolveToolVersion(),
        packageHash,
        verificationResult
      })
    } catch (err) {
      await unlink(options.outputPath).catch(() => {})
      throw err
    }
  } else {
    writeFileSync(options.outputPath, html, 'utf-8')
  }
  onProgress?.('Complete', 100)
}

interface EvidenceZipResult {
  zip: Buffer
  packageHash: string
  verificationResult: ExportVerificationResult
}

function buildEvidenceZip(caseId: string, data: ExportData, reportHtml: string): EvidenceZipResult {
  const entries: Array<{ name: string; data: Buffer | string }> = []
  const artifacts: EvidenceArtifact[] = []
  const add = (name: string, value: Buffer | string): string => {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf-8')
    const digest = sha256(buf)
    entries.push({ name, data: buf })
    artifacts.push({ path: name, sha256: digest, sizeBytes: buf.length })
    return digest
  }

  const manifestPath = join(getStorageRoot(), caseId, MANIFEST_FILENAME)
  const manifestJsonl = existsSync(manifestPath) ? readFileSync(manifestPath) : Buffer.alloc(0)
  const manifestEntries = readManifestEntries(manifestJsonl.toString('utf-8'))
  const timestampEntries = manifestEntries.filter(isTimestampEntry)
  const latestManifestEntry = manifestEntries.at(-1) as
    | { index?: number; entryHash?: string }
    | undefined

  const timestampPathsByHash = new Map<string, string[]>()
  const timestampTokenChainPems: string[] = []
  for (const entry of timestampEntries) {
    if (typeof entry.tsaToken !== 'string') continue
    const token = Buffer.from(entry.tsaToken, 'base64')
    try {
      const chainPem = extractTimestampTokenCertificatesPem(token)
      if (chainPem) timestampTokenChainPems.push(chainPem)
    } catch {
      // Malformed tokens still belong in the evidence package; they simply
      // cannot contribute certificate material to the TSA chain bundle.
    }
    const captures = data.captures.filter((capture) => capture.hash === entry.captureContentHash)
    for (const capture of captures) {
      if (timestampPathsByHash.get(capture.hash)?.length) continue
      const path = `timestamps/${capture.id}.tst`
      add(path, token)
      timestampPathsByHash.set(capture.hash, [path])
    }
  }

  add('manifest.jsonl', manifestJsonl)
  add('report.html', reportHtml)
  add(
    'certification.html',
    buildCertification(
      {
        caseName: data.caseName,
        exportTimestamp: data.exportTimestamp,
        installationId: data.installationId,
        operatorName: data.operatorName,
        operatorRole: data.operatorRole,
        operatorOrganization: data.operatorOrganization,
        tsaUrl: data.tsaUrl,
        preflight: data.preflight,
        captures: data.captures,
        verifications: data.verifications
      },
      resolveToolVersion()
    )
  )
  add('signing-public-key.pem', getPublicKeyPem())
  add('VERIFY.md', VERIFY_RUNBOOK)

  const tsaTrust = getTsaTrustBundle(data.tsaUrl)
  add('tsa-ca-chain.pem', [...timestampTokenChainPems, tsaTrust.pem].join('\n'))

  const capturesMissingContent: string[] = []
  const emittedScreenshotPaths = new Set<string>()
  const captureEvidence = data.captures.map((capture) => {
    const mhtml = defaultCaptureStore.readArtifact(capture.caseId, capture.id, 'mhtml')
    const mhtmlPath = `pages/${capture.id}.mhtml`
    const mhtmlSha256 = mhtml ? add(mhtmlPath, mhtml) : null
    if (!mhtml) capturesMissingContent.push(capture.id)
    const verification = data.verifications.find((v) => v.captureId === capture.id)
    const trustedTime = verification?.trustedTime ?? capture.trustedTimeStatus ?? 'none'

    // Content-address the screenshot into the package (#118): the file name IS
    // its sha256, and add() records it into artifacts[] so the package is
    // self-describing. Scoped to the export package only — live on-disk storage
    // is untouched. The .txt sidecar's integrity is bound by textSha256 in the
    // per-capture record + the signed manifest entry; it is not re-bundled here
    // (its content already surfaces in report.html / the MHTML page).
    // Gated on data.screenshots, which loadExportData only populates when
    // include.screenshots is set — so an export that omits screenshots does not
    // ship them via the content-addressed sidecar. The raw on-disk bytes are
    // used (not the possibly-annotated report copy) so the digest matches the
    // screenshotHash anchored at ingest.
    const screenshot = data.screenshots.has(capture.id)
      ? defaultCaptureStore.readArtifact(capture.caseId, capture.id, 'png')
      : null
    let screenshotPath: string | null = null
    let screenshotSha256: string | null = null
    if (screenshot) {
      screenshotSha256 = sha256(screenshot)
      screenshotPath = `screenshots/${screenshotSha256}.png`
      // Content-addressed: identical screenshot bytes across captures resolve to
      // the same path. Emit the zip entry once; multiple capture records may
      // still reference it. createStoredZip does not dedupe entry names.
      if (!emittedScreenshotPaths.has(screenshotPath)) {
        add(screenshotPath, screenshot)
        emittedScreenshotPaths.add(screenshotPath)
      }
    }

    return {
      id: capture.id,
      title: capture.title,
      url: capture.url,
      capturedAt: capture.timestamp,
      manifestIndex: capture.manifestIndex,
      entryHash: capture.entryHash,
      storedHash: capture.hash,
      integrityStatus: verification?.status,
      trustedTime,
      tsaName: verification?.tsaName,
      stampedAt: verification?.stampedAt,
      mhtmlPath: mhtml ? mhtmlPath : null,
      mhtmlSha256,
      screenshotPath,
      screenshotSha256,
      textSha256: capture.textHash ?? null,
      // Corroboration-only TLS cert chain (#123, ADR-0002). NOT bound to the
      // captured transaction — the origin was re-contacted from the main process
      // AFTER storage, so this records the cert served at `refetchedAt`, which
      // differs from `capturedAt`. Surfaced labelled as corroboration; both
      // timestamps are present so a reviewer understands the interval.
      tlsCorroboration: capture.tlsCertChain ?? null,
      timestampTokenPaths: timestampPathsByHash.get(capture.hash) ?? []
    }
  })

  const evidence = {
    schemaVersion: 1,
    generatedBy: 'Birdbrain',
    exportedAt: data.exportTimestamp,
    case: {
      id: caseId,
      name: data.caseName,
      description: data.caseDescription ?? null,
      dateRange: data.dateRange
    },
    operator: {
      installationId: data.installationId,
      name: data.operatorName,
      role: data.operatorRole,
      organization: data.operatorOrganization
    },
    investigatorName: data.investigatorName,
    warnings: {
      unstampedCaptureCount: data.preflight.unstampedCaptureCount,
      pendingCaptureCount: data.preflight.pendingCaptureCount,
      noneCaptureCount: data.preflight.noneCaptureCount,
      missingContentCaptureCount: capturesMissingContent.length,
      tsaTrustAnchorNote: tsaTrust.note ?? null
    },
    verificationMaterials: {
      manifestPath: 'manifest.jsonl',
      manifestHeadIndex: latestManifestEntry?.index ?? null,
      manifestHeadHash: latestManifestEntry?.entryHash ?? null,
      signingPublicKeyPath: 'signing-public-key.pem',
      tsaCaChainPath: 'tsa-ca-chain.pem',
      tsaCaChainBundled: tsaTrust.bundled,
      reportPath: 'report.html'
    },
    captures: captureEvidence,
    artifacts
  }

  entries.unshift({
    name: 'evidence.json',
    data: JSON.stringify(evidence, null, 2)
  })

  // packageHash commits to every packaged file's content via the artifact list,
  // sorted by path for determinism. It deliberately does NOT hash the final
  // .zip: this hash feeds the export manifest entry, which is bundled inside
  // that very zip, so hashing the zip would be circular. evidence.json itself
  // is excluded from `artifacts` (it is unshifted above, not run through `add`),
  // which is what keeps packageHash independent of the entry it informs.
  const sortedArtifacts = [...artifacts].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  )
  const packageHash = sha256(Buffer.from(canonicalStringify(sortedArtifacts), 'utf-8'))

  const captureCount = data.captures.length
  const verifiedCount = data.verifications.filter((v) => v.status === 'verified').length

  // overallValid means every capture has a passing verification. An empty
  // verification set (e.g. auditTrail-excluded exports) must NOT report true:
  // [].every(...) is true, but no verification ran, so the package is unverified.
  const verificationResult: ExportVerificationResult = {
    overallValid: captureCount > 0 && verifiedCount === captureCount,
    captureCount,
    verifiedCount,
    tamperedCount: data.verifications.filter((v) => v.status === 'tampered').length,
    missingCount: data.verifications.filter((v) => v.status === 'missing').length
  }

  return { zip: createStoredZip(entries), packageHash, verificationResult }
}

function readManifestEntries(manifestJsonl: string): Record<string, unknown>[] {
  return manifestJsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        return {}
      }
    })
}

function isTimestampEntry(entry: Record<string, unknown>): entry is ManifestTimestampEntry {
  return (
    entry.type === 'timestamp' &&
    typeof entry.index === 'number' &&
    typeof entry.captureContentHash === 'string'
  )
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function buildHtmlReport(data: ExportData, options: ExportOptions): string {
  const sections: string[] = []

  // Cover
  sections.push(`
    <div class="cover">
      <h1>${esc(data.caseName)}</h1>
      ${data.caseDescription ? `<p class="desc">${esc(data.caseDescription)}</p>` : ''}
      ${data.dateRange ? `<p class="date-range">${new Date(data.dateRange.first).toLocaleDateString()} — ${new Date(data.dateRange.last).toLocaleDateString()}</p>` : ''}
      <p class="meta">Investigator: ${esc(data.investigatorName)}</p>
      <p class="meta">Operator: ${esc(data.operatorName)}${data.operatorRole ? ` — ${esc(data.operatorRole)}` : ''}${data.operatorOrganization ? `, ${esc(data.operatorOrganization)}` : ''}</p>
      <p class="meta">Installation ID: <span class="mono">${esc(data.installationId)}</span></p>
      <p class="meta">Exported: ${new Date(data.exportTimestamp).toLocaleString()}</p>
      <p class="meta">Captures: ${data.captures.length}</p>
    </div>
  `)

  // Summary
  const domainSet = new Set(
    data.captures.map((c) => {
      try {
        return new URL(c.url).hostname
      } catch {
        return ''
      }
    })
  )

  sections.push(`
    <div class="section">
      <h2>Summary</h2>
      ${
        data.preflight.unstampedCaptureCount > 0
          ? `<div class="warning-banner">Trusted time warning: ${data.preflight.unstampedCaptureCount} capture${data.preflight.unstampedCaptureCount === 1 ? '' : 's'} exported without an RFC 3161 timestamp (${data.preflight.pendingCaptureCount} pending, ${data.preflight.noneCaptureCount} none). Export was not blocked.</div>`
          : `<div class="success-banner">All captures include RFC 3161 trusted time.</div>`
      }
      <table>
        <tr><td>Total Captures</td><td>${data.captures.length}</td></tr>
        <tr><td>Unique Domains</td><td>${domainSet.size}</td></tr>
      </table>
    </div>
  `)

  // Capture Log
  if (options.include.captures) {
    sections.push(`
      <div class="section">
        <h2>Capture Log</h2>
        <table class="full-width">
          <thead><tr><th>Timestamp</th><th>Title</th><th>URL</th><th>Hash</th></tr></thead>
          <tbody>
            ${data.captures
              .map(
                (c) => `
              <tr>
                <td class="mono">${new Date(c.timestamp).toLocaleString()}</td>
                <td>${esc(c.title)}</td>
                <td class="mono url">${esc(c.url)}</td>
                <td class="mono hash">${c.hash.slice(0, 12)}...</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `)
  }

  // Capture Details with screenshots
  if (options.include.captures && options.include.screenshots) {
    sections.push(`
      <div class="section">
        <h2>Capture Details</h2>
        ${data.captures
          .map((c) => {
            const screenshot = data.screenshots.get(c.id)
            const pins = data.pins.get(c.id) ?? []
            const legend =
              pins.length > 0
                ? `<ol class="pin-legend">${pins
                    .slice()
                    .sort((a, b) => a.number - b.number)
                    .map((p) => `<li><strong>${p.number}.</strong> ${esc(p.body)}</li>`)
                    .join('')}</ol>`
                : ''
            return `
            <div class="capture-detail">
              <h3>${esc(c.title)}</h3>
              <p class="mono url">${esc(c.url)}</p>
              <p class="mono">${new Date(c.timestamp).toLocaleString()}</p>
              ${screenshot ? `<img src="data:image/png;base64,${screenshot}" alt="Screenshot" class="screenshot" />` : ''}
              ${legend}
            </div>
          `
          })
          .join('')}
      </div>
    `)
  }

  // Audit Trail
  if (options.include.auditTrail && data.verifications.length > 0) {
    sections.push(`
      <div class="section">
        <h2>Audit Trail — Integrity &amp; Trusted Time</h2>
        <table class="full-width">
          <thead><tr><th>Integrity</th><th>Trusted Time</th><th>Title</th><th>URL</th><th>Manifest #</th><th>Stored Hash</th><th>Computed Hash</th></tr></thead>
          <tbody>
            ${data.verifications
              .map(
                (v) => `
              <tr class="verify-${v.status}">
                <td>${statusGlyph(v.status)} ${v.status}</td>
                <td class="tt-${v.trustedTime}">${trustedTimeCell(v)}</td>
                <td>${esc(v.title)}</td>
                <td class="mono url">${esc(v.url)}</td>
                <td class="mono">${v.manifestIndex !== undefined ? '#' + v.manifestIndex : '-'}</td>
                <td class="mono hash">${v.storedHash ? v.storedHash.slice(0, 16) + '...' : '-'}</td>
                <td class="mono hash">${v.computedHash ? v.computedHash.slice(0, 16) + '...' : '-'}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `)
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Birdbrain Report — ${esc(data.caseName)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 2rem; }
  .cover { text-align: center; padding: 3rem 0; border-bottom: 2px solid #f59e0b; margin-bottom: 2rem; }
  .cover h1 { font-size: 2rem; color: #f59e0b; }
  .cover .desc { margin-top: 0.5rem; color: #a3a3a3; }
  .cover .date-range { margin-top: 0.5rem; font-family: monospace; color: #737373; }
  .cover .meta { margin-top: 0.25rem; font-size: 0.875rem; color: #737373; }
  .section { margin-bottom: 2rem; page-break-inside: avoid; }
  .section h2 { font-size: 1.5rem; color: #f59e0b; border-bottom: 1px solid #262626; padding-bottom: 0.5rem; margin-bottom: 1rem; }
  .section h3 { font-size: 1.1rem; color: #d4d4d4; margin: 1rem 0 0.5rem; }
  table { border-collapse: collapse; margin-bottom: 1rem; }
  table.full-width { width: 100%; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #262626; }
  th { color: #a3a3a3; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
  .mono { font-family: 'Courier New', monospace; font-size: 0.8rem; }
  .url { word-break: break-all; max-width: 300px; }
  .hash { color: #737373; }
  .context { color: #a3a3a3; font-size: 0.8rem; max-width: 300px; }
  .ai-summary { margin-top: 1rem; padding: 1rem; background: #1a1a0a; border-left: 3px solid #f59e0b; }
  .card { padding: 1rem; margin-bottom: 0.5rem; background: #171717; border: 1px solid #262626; border-radius: 0.5rem; }
  .capture-detail { padding: 1rem 0; border-bottom: 1px solid #262626; page-break-inside: avoid; }
  .screenshot { max-width: 100%; max-height: 400px; margin: 0.5rem 0; border: 1px solid #262626; }
  .pin-legend { font-size: 0.875rem; line-height: 1.4; padding-left: 1.5rem; }
  .pin-legend li { margin: 0.25rem 0; }
  .warning-banner { margin-bottom: 1rem; padding: 0.75rem; border-left: 3px solid #f59e0b; background: #1a1a0a; color: #fbbf24; }
  .success-banner { margin-bottom: 1rem; padding: 0.75rem; border-left: 3px solid #22c55e; background: #071a0f; color: #86efac; }
  .verify-verified td:first-child { color: #22c55e; }
  .verify-tampered td:first-child { color: #f59e0b; }
  .verify-chain-broken td:first-child { color: #f59e0b; }
  .verify-legacy td:first-child { color: #a3a3a3; }
  .verify-missing td:first-child { color: #ef4444; }
  .tt-rfc3161 { color: #22c55e; }
  .tt-pending { color: #f59e0b; }
  .tt-none { color: #a3a3a3; }
  .tt-detail { color: #737373; font-size: 0.7rem; }
  @media print { body { background: white; color: black; } .cover h1, .section h2 { color: #d97706; } }
</style>
</head>
<body>
${sections.join('\n')}
<footer style="text-align: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #262626; font-size: 0.75rem; color: #525252;">
  Generated by Birdbrain v${esc(resolveToolVersion())}
</footer>
</body>
</html>`
}

function statusGlyph(status: HashVerification['status']): string {
  switch (status) {
    case 'verified':
      return '✓'
    case 'tampered':
    case 'chain-broken':
      return '⚠'
    case 'legacy':
      return '○'
    case 'missing':
      return '✗'
  }
}

// Renders the orthogonal trusted-time axis for the audit trail. 'rfc3161'
// includes the TSA identity and asserted time so the cell is self-describing.
function trustedTimeCell(v: HashVerification): string {
  switch (v.trustedTime) {
    case 'rfc3161': {
      const when = v.stampedAt ? new Date(v.stampedAt).toLocaleString() : ''
      const who = v.tsaName ? esc(v.tsaName) : 'RFC 3161 TSA'
      return `✓ RFC 3161<br><span class="tt-detail">${who}${when ? ' — ' + esc(when) : ''}</span>`
    }
    case 'pending':
      return '⧗ Pending'
    case 'none':
      return '— None'
  }
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
