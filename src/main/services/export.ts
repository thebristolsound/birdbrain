import { existsSync, writeFileSync } from 'fs'
import { unlink } from 'fs/promises'
import { createHash } from 'crypto'
import { join } from 'path'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import { getStorageRoot } from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import { getAnnotations } from '@main/services/annotations'
import { burnAnnotations } from '@main/services/burnAnnotations'
import { getSettings } from '@main/services/settings'
import { getInstallationId } from '@main/services/installationId'
import { getPublicKeyPem } from '@main/services/signingKey'
import {
  appendManifestEntry,
  createArtifactAccumulator,
  initManifest,
  packageHash as computePackageHash,
  readManifestSnapshot
} from '@main/services/manifest'
import { buildTrustedTimeIndex } from '@main/services/trustedTime'
import type { ExportVerificationResult, ManifestSnapshot } from '@main/services/manifest'
import { createStoredZip } from '@main/services/zip'
import { getTsaTrustBundle } from '@main/services/tsaTrust'
import {
  buildTrustedTimeIndexFromEntries,
  extractTimestampTokenCertificatesPem
} from '@shared/verify'
import type { TrustedTimeResult } from '@shared/verify'
import { buildCertification, resolveToolVersion } from '@main/services/certification'
import { buildHtmlReport } from '@main/services/reportHtml'
import type { PackagedArtifacts, ReportData } from '@main/services/reportHtml'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'
import type {
  Capture,
  ExportOptions,
  ExportPreflight,
  HashVerification,
  TrustedTime
} from '@shared/types'

// The report renderer owns this shape. Aliasing rather than restating it keeps
// the two from drifting apart, since every field here exists to be rendered.
type ExportData = ReportData

/** evidence.json keeps this as a list; a capture has at most one token path. */
function packagedTimestampTokenPaths(byHash: Map<string, string>, capture: Capture): string[] {
  const path = byHash.get(capture.hash)
  return path ? [path] : []
}

interface ManifestTimestampEntry {
  [key: string]: unknown
  index: number
  type: 'timestamp'
  captureContentHash: string
  tsaToken?: string
}

export async function verifyCaptures(
  caseId: string,
  captureLifecycle: CaptureLifecycle,
  onItem?: (done: number, total: number) => void
): Promise<HashVerification[]> {
  const captures = captureRepo.listCaptures(caseId)
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

/**
 * The one trusted-time resolution an export gets: the summary counts and the
 * per-capture rows printed beneath them, produced in a single pass over a single
 * index (#492).
 *
 * They are two views of one resolution because resolving twice is what let them
 * contradict each other — the timestamp worker appends to the manifest at any
 * moment, so two reads taken either side of an await can disagree about the same
 * capture, and the document then claims "0 remaining captures (1 pending)" above
 * a timestamped row.
 *
 * The captures.trustedTimeStatus mirror feeds neither view: it is rebuildable
 * state that can disagree with the tokens actually retained. A capture absent
 * from the index resolves 'none' — the honest floor, not whatever the mirror
 * last held.
 *
 * `byContentHash` is keyed by content hash, which is what the trusted-time index
 * carries; `byCaptureId` re-keys the same result objects by capture id. Whole
 * objects, not just `.trustedTime`: `stampFor` has already parsed the TSA name
 * and asserted time out of the token, and dropping them makes a stamped row
 * print a bare "RFC 3161 TSA" with no time.
 */
export interface ExportTrustedTime {
  preflight: ExportPreflight
  byCaptureId: Map<string, TrustedTimeResult>
}

const UNSTAMPED: TrustedTimeResult = { trustedTime: 'none' }

// Placeholder for the window inside generateReport between building ExportData
// and taking the manifest snapshot the real counts are resolved from. Zeroed
// rather than plausible so that rendering it by mistake reads as obviously
// unpopulated instead of as a case with nothing to report.
const UNRESOLVED_PREFLIGHT: ExportPreflight = {
  captureCount: 0,
  stampedCaptureCount: 0,
  unstampedCaptureCount: 0,
  pendingCaptureCount: 0,
  noneCaptureCount: 0
}

export function resolveExportTrustedTime(
  captures: Capture[],
  byContentHash: Map<string, TrustedTimeResult>
): ExportTrustedTime {
  const counts: Record<TrustedTime, number> = { rfc3161: 0, pending: 0, none: 0 }
  const byCaptureId = new Map<string, TrustedTimeResult>()

  for (const capture of captures) {
    const resolved = byContentHash.get(capture.hash) ?? UNSTAMPED
    counts[resolved.trustedTime]++
    byCaptureId.set(capture.id, resolved)
  }

  return {
    preflight: {
      captureCount: captures.length,
      stampedCaptureCount: counts.rfc3161,
      unstampedCaptureCount: counts.pending + counts.none,
      pendingCaptureCount: counts.pending,
      noneCaptureCount: counts.none
    },
    byCaptureId
  }
}

/**
 * Live manifest read, for the pre-export dialog: nothing is being packaged, so
 * there is no snapshot to resolve against and the freshest answer is the right
 * one. generateReport deliberately does not call this — it resolves once from
 * the snapshot it packages.
 */
export function getExportPreflight(caseId: string): ExportPreflight {
  const captures = captureRepo.listCaptures(caseId)
  return resolveExportTrustedTime(captures, buildTrustedTimeIndex(join(getStorageRoot(), caseId)))
    .preflight
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

  const caseData = caseRepo.getCase(caseId)
  if (!caseData) throw new Error(`Case not found: ${caseId}`)

  onProgress?.('Loading captures...', 10)
  const captures = captureRepo.listCaptures(caseId)

  // Build export data
  const data: ExportData = {
    caseId,
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
    toolVersion: resolveToolVersion(),
    // Filled in below, once the awaited stages are done and the manifest can be
    // snapshotted at the same instant the package is built from. Nothing reads
    // these before then.
    preflight: UNRESOLVED_PREFLIGHT,
    manifestHead: null,
    packagedPaths: new Map(),
    trustedTimeByCaptureId: new Map(),
    tsaTrustAnchorBundled: getTsaTrustBundle(settings.tsaUrl).bundled
  }

  if (options.include.auditTrail) {
    onProgress?.('Verifying capture integrity...', 10)
    // Per-item progress across the 10–50% band so a large case advances
    // continuously instead of parking on a single milestone.
    data.verifications = await verifyCaptures(caseId, captureLifecycle, (done, total) =>
      onProgress?.(`Verifying capture ${done} of ${total}...`, 10 + Math.round((done / total) * 40))
    )
  }

  // captureId -> sha256 of the raw on-disk screenshot, and whether the copy
  // reproduced in the report had annotations burned into its pixels.
  const screenshotDigests = new Map<string, string>()
  const annotatedCaptureIds = new Set<string>()

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
          // Shapes are what burnAnnotations actually draws; pins are numbered
          // notes that may exist without any. Only shapes change the pixels, so
          // only shapes make the reproduced image differ from the packaged copy.
          if (bundle.annotations.shapes.length > 0) annotatedCaptureIds.add(cap.id)
        }
        data.pins.set(cap.id, bundle.pins)
      }
      // Digest the raw bytes, not the possibly-annotated copy: the package
      // content-addresses the unannotated original.
      screenshotDigests.set(cap.id, sha256(screenshotBuffer))
      data.screenshots.set(cap.id, finalBuffer.toString('base64'))
    }
  }

  // One manifest snapshot, taken after every awaited stage and shared by the
  // report and the package. Reading it twice would let the timestamp worker
  // append between the two, so report.html could cite a head the bundled
  // manifest.jsonl does not end at — telling reviewers to reconcile a valid
  // package against a stale hash.
  const manifest = readManifestSnapshot(join(getStorageRoot(), caseId))
  data.manifestHead = manifest.head
  data.packagedPaths = buildPackagedPaths(
    data,
    options,
    manifest,
    screenshotDigests,
    annotatedCaptureIds
  )

  // Resolved from the snapshot above and nowhere else — see resolveExportTrustedTime.
  const trustedTime = resolveExportTrustedTime(
    captures,
    buildTrustedTimeIndexFromEntries(manifest.entries)
  )
  data.preflight = trustedTime.preflight
  data.trustedTimeByCaptureId = trustedTime.byCaptureId

  onProgress?.('Generating report...', 80)
  const html = buildHtmlReport(data, options)

  if (options.format === 'zip') {
    onProgress?.('Packaging evidence...', 90)
    const { zip, packageHash, verificationResult } = buildEvidenceZip(caseId, data, html, manifest)
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

function buildEvidenceZip(
  caseId: string,
  data: ExportData,
  reportHtml: string,
  manifest: ManifestSnapshot
): EvidenceZipResult {
  const { entries, artifacts, add } = createArtifactAccumulator()

  const manifestJsonl = manifest.jsonl
  const timestampEntries = manifest.entries.filter(isTimestampEntry)
  const latestManifestEntry = manifest.head

  // Same path rule the report was rendered against — see buildTimestampTokenPaths.
  const timestampPathsByHash = buildTimestampTokenPaths(data.captures, timestampEntries)
  const emittedTokenPaths = new Set<string>()
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
    const path = timestampPathsByHash.get(entry.captureContentHash)
    if (path && !emittedTokenPaths.has(path)) {
      add(path, token)
      emittedTokenPaths.add(path)
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
        captures: data.captures,
        trustedTimeByCaptureId: data.trustedTimeByCaptureId
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
    // Same single resolution report.html and certification.html render, for the
    // same reason plus one this artifact has on its own: the package verifier
    // re-derives the axis from the bundled manifest.jsonl (evidencePackage.ts,
    // `chain.trustedTimes`), and that file IS this snapshot. Reading anything else
    // here — the verification's earlier manifest read, or the DB mirror — puts
    // evidence.json at odds with the manifest it ships beside.
    const trusted = data.trustedTimeByCaptureId.get(capture.id) ?? UNSTAMPED

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
      trustedTime: trusted.trustedTime,
      tsaName: trusted.tsaName,
      stampedAt: trusted.stampedAt,
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
      timestampTokenPaths: packagedTimestampTokenPaths(timestampPathsByHash, capture)
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

  // Recipe owned by packageHash() in manifest.ts. evidence.json itself is
  // excluded from `artifacts` (it is unshifted above, not run through `add`),
  // which is what keeps packageHash independent of the entry it informs.
  const packageHash = computePackageHash(artifacts)

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

/**
 * Maps a capture content hash to the single timestamp-token path the package
 * uses for it. Captures that share a content hash share one token file, named
 * after the first such capture — so a per-capture path would be wrong for the
 * rest. Defined once here and consumed by both the packager and the report to
 * remove any chance of the two disagreeing.
 */
function buildTimestampTokenPaths(
  captures: Capture[],
  timestampEntries: ManifestTimestampEntry[]
): Map<string, string> {
  const byHash = new Map<string, string>()
  for (const entry of timestampEntries) {
    if (typeof entry.tsaToken !== 'string') continue
    for (const capture of captures) {
      if (capture.hash !== entry.captureContentHash) continue
      if (byHash.has(capture.hash)) break
      byHash.set(capture.hash, `timestamps/${capture.id}.tst`)
      break
    }
  }
  return byHash
}

/**
 * What the package will actually contain for each capture. Paths are derived
 * from the same manifest snapshot and the same filesystem the packager reads,
 * so the report cannot cite a file that was never written; a non-package export
 * encloses nothing and therefore gets no paths at all.
 *
 * imageAnnotated is deliberately NOT gated on the format: burning happens
 * whenever annotations are set to 'burned', so a standalone HTML report must
 * disclose it just as loudly as a packaged one.
 */
function buildPackagedPaths(
  data: ExportData,
  options: ExportOptions,
  manifest: ManifestSnapshot,
  screenshotDigests: Map<string, string>,
  annotatedCaptureIds: Set<string>
): Map<string, PackagedArtifacts> {
  const paths = new Map<string, PackagedArtifacts>()
  const isPackage = options.format === 'zip'
  const tokenPaths = isPackage
    ? buildTimestampTokenPaths(data.captures, manifest.entries.filter(isTimestampEntry))
    : new Map<string, string>()

  for (const capture of data.captures) {
    // existsSync rather than a read: the packager skips exactly the artifacts
    // that are absent, and the archives can be large.
    const { abs } = defaultCaptureStore.artifactPaths(capture.caseId, capture.id, 'mhtml')
    const screenshotDigest = screenshotDigests.get(capture.id)
    paths.set(capture.id, {
      pageArchive: isPackage && existsSync(abs) ? `pages/${capture.id}.mhtml` : null,
      screenshot: isPackage && screenshotDigest ? `screenshots/${screenshotDigest}.png` : null,
      timestampToken: tokenPaths.get(capture.hash) ?? null,
      // Recorded regardless of format: the exhibit reproduces the image either
      // way, so it must be able to label it with the digest of what it shows.
      screenshotDigest: screenshotDigest ?? null,
      imageAnnotated: annotatedCaptureIds.has(capture.id)
    })
  }
  return paths
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
