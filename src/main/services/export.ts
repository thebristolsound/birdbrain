import { existsSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as waybackRefRepo from '@main/services/db/waybackRefRepo'
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
  readManifestSnapshot,
  rollbackManifestEntry
} from '@main/services/manifest'
import { buildTrustedTimeIndex } from '@main/services/trustedTime'
import type {
  ArtifactAccumulator,
  ExportVerificationResult,
  ManifestSnapshot
} from '@main/services/manifest'
import { createStoredZip } from '@main/services/zip'
import {
  getTsaTrustBundle,
  TSA_INTERMEDIATES_FILENAME,
  TSA_ROOT_FILENAME
} from '@main/services/tsaTrust'
import {
  buildTrustedTimeIndexFromEntries,
  extractTimestampTokenCertificatesPem
} from '@shared/verify'
import type { TrustedTimeResult } from '@shared/verify'
import { buildCertification, resolveToolVersion } from '@main/services/certification'
import { buildHtmlReport } from '@main/services/reportHtml'
import type { EntrySignatureStatus, PackagedArtifacts, ReportData } from '@main/services/reportHtml'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'
import { VERIFY_SCRIPT, VERIFY_SCRIPT_FILENAME } from '@main/services/verifyScript'
import { WORKING_COPY_MARKER_FILENAME } from '@shared/schemas'
import type {
  Capture,
  ExportOptions,
  ExportPreflight,
  HashVerification,
  Note,
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
  captures: Capture[],
  captureLifecycle: CaptureLifecycle,
  onItem?: (done: number, total: number) => void
): Promise<HashVerification[]> {
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
// and resolving the real counts from the manifest snapshot, which happens before
// anything reads them. The zeroes are NOT a safe default: rendered by mistake
// they read as a case with nothing to disclose, which is the opposite of the
// truth. So nothing counts a disclosure from this — report.html folds every
// figure it prints out of its own rows, and evidence.json's warnings block is
// the only reader left.
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
 * Per-capture signature status, folded out of the same manifest snapshot the
 * package is built from (#581). Pre-signing entries carry no `signature` and are
 * grandfathered by manifestChain.ts, so the report has to name them rather than
 * present them as plain "Verified".
 *
 * The discriminator is `schemaVersion`, not `toolVersion`: schemaVersion is what
 * the verifier itself branches on, and reading the version that decides
 * enforcement keeps this from drifting away from it. Absent schemaVersion means
 * a v1 entry, matching readEntries' lenient dialect.
 *
 * Where a capture has more than one entry — a recapture supersedes an earlier
 * one — the LAST entry wins, since that is the entry the package's own chain
 * position cites.
 */
export function resolveEntrySignatures(
  captures: Capture[],
  entries: Record<string, unknown>[]
): Map<string, EntrySignatureStatus> {
  const byCaptureId = new Map<string, EntrySignatureStatus>()

  for (const entry of entries) {
    if (entry.type !== 'capture' || typeof entry.captureId !== 'string') continue
    const schemaVersion = typeof entry.schemaVersion === 'number' ? entry.schemaVersion : 1
    byCaptureId.set(
      entry.captureId,
      schemaVersion >= 2 && typeof entry.signature === 'string' ? 'signed' : 'unsigned-legacy'
    )
  }

  // Captures with no chain entry are stated as such rather than left absent, so
  // a missing key in the report can only mean a capture this export never saw.
  for (const capture of captures) {
    if (!byCaptureId.has(capture.id)) byCaptureId.set(capture.id, 'no-entry')
  }

  return byCaptureId
}

/**
 * Chain-vs-case reconciliation (#580). The manifest is append-only, so a
 * capture entry with no matching deletion entry is a standing claim that the
 * case still holds that capture. If the case does not hold it, the chain and
 * the tool's own records disagree and a reader has no way to account for the
 * difference — which is what a third-party review of an alpha export found,
 * reading it as unexplained missing evidence.
 *
 * `caseCaptures` is the FULL live capture list, never a selection-scoped
 * subset (#398, ADR-0009): a capture the operator deliberately left out of a
 * selection export is accounted for by the signed export entry's scope, not an
 * orphan — reporting it here would present designed behaviour as a gap and
 * bury real orphans in noise.
 *
 * Resolved once, from the same snapshot, and consumed by both report.html and
 * evidence.json. Two derivations could disagree, and a document that contradicts
 * its own machine-readable index is worse than one that says nothing.
 *
 * Existing chains carry self-test entries that predate the fix, so this reports
 * rather than throws: the point is to make an old package explainable, not to
 * refuse to export it.
 */
export function resolveUnreconciledChainCaptures(
  caseCaptures: Capture[],
  entries: Record<string, unknown>[]
): string[] {
  const deletedCaptureIds = new Set(
    entries.filter((e) => e.type === 'deletion').map((e) => e.captureId)
  )
  const heldCaptureIds = new Set(caseCaptures.map((c) => c.id))
  return [
    ...new Set(
      entries
        .filter((e) => e.type === 'capture')
        .map((e) => e.captureId)
        .filter(
          (id): id is string =>
            typeof id === 'string' && !deletedCaptureIds.has(id) && !heldCaptureIds.has(id)
        )
    )
  ]
}

/**
 * Live manifest read, for the pre-export dialog: nothing is being packaged, so
 * there is no snapshot to resolve against and the freshest answer is the right
 * one. generateReport deliberately does not call this — it resolves once from
 * the snapshot it packages.
 */
export function getExportPreflight(caseId: string, captureIds?: string[]): ExportPreflight {
  // Scoped to the selection when the dialog was opened from the selection
  // toolbar: an unstamped capture the operator did not select is not going to
  // export, so counting it would warn about evidence the package will not
  // contain (PR #842 review).
  const all = captureRepo.listCaptures(caseId)
  const captures = captureIds ? all.filter((c) => captureIds.includes(c.id)) : all
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

  const workingCopy = options.exportClass === 'working-copy'
  // A Working Copy has no standalone report to fall back to — its whole output
  // is the marked zip — so any other format is a caller error, not a variant.
  if (workingCopy && options.format !== 'zip') {
    throw new Error('A Working Copy export is always a zip package')
  }

  const caseData = caseRepo.getCase(caseId)
  if (!caseData) throw new Error(`Case not found: ${caseId}`)

  // X44: the Evidence Package enumerates Captures only until #1156 lands, and
  // its Certification claims to describe the Case's evidence. A committed
  // attachment silently left out of a package that makes that claim is the
  // dishonest third option ADR-0023 rejected, so the export is refused rather
  // than narrowed. The Working Copy and the standalone report are unchanged.
  if (options.format === 'zip' && !workingCopy) {
    const committed = listExhibits(caseId).filter((exhibit) => exhibit.kind !== 'capture')
    if (committed.length > 0) {
      throw new Error(
        `Evidence Package export is refused: this case holds ${committed.length} committed ` +
          `non-capture exhibit${committed.length === 1 ? '' : 's'} and the package format covers ` +
          'captures only until #1156 lands. Export a Working Copy instead.'
      )
    }
  }

  onProgress?.('Loading captures...', 10)
  const allCaptures = captureRepo.listCaptures(caseId)
  const captures = resolveScopedCaptures(allCaptures, options.captureIds)
  const scoped = options.captureIds !== undefined

  // Build export data
  const data: ExportData = {
    caseId,
    caseName: caseData.name,
    caseDescription: caseData.description,
    dateRange:
      captures.length > 0
        ? { first: captures[captures.length - 1].timestamp, last: captures[0].timestamp }
        : null,
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
    entrySignatureByCaptureId: new Map(),
    unreconciledChainCaptureIds: [],
    tsaTrustAnchorBundled: getTsaTrustBundle(settings.tsaUrl).bundled,
    // Pinned archive.org references, read per exported capture (#401). Scoped
    // with the captures, so a pin on a capture outside the selection does not
    // appear in a package that does not contain the exhibit it hangs off.
    // Corroboration only: nothing is fetched from archive.org here, and no
    // artefact is added to the package.
    waybackRefsByCaptureId: new Map(
      captures.map((capture) => [capture.id, waybackRefRepo.listWaybackRefs(capture.id)])
    ),
    selectionScope: scoped
      ? { selectedCaptureCount: captures.length, caseCaptureCount: allCaptures.length }
      : null
  }

  if (options.include.auditTrail) {
    onProgress?.('Verifying capture integrity...', 10)
    // Per-item progress across the 10–50% band so a large case advances
    // continuously instead of parking on a single milestone.
    data.verifications = await verifyCaptures(captures, captureLifecycle, (done, total) =>
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

  // Operator notes as package content (#399). Null means excluded; an empty
  // array means the toggle was on and the case simply has none — notes.md is
  // still written then, so "no notes existed" stays distinguishable from
  // "notes were excluded".
  const notes = options.include.notes ? noteRepo.listNotes(caseId) : null

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
  data.entrySignatureByCaptureId = resolveEntrySignatures(captures, manifest.entries)
  // Reconciled against the FULL case, not the exported selection — see the
  // resolver's comment for why a deliberately unselected capture is no orphan.
  data.unreconciledChainCaptureIds = resolveUnreconciledChainCaptures(allCaptures, manifest.entries)

  if (options.format === 'zip') {
    const packageMeta: PackageMeta = {
      caseNumber: caseData.caseNumber,
      isDemo: caseData.isDemo,
      purposeOrAuthority: options.purposeOrAuthority,
      notes
    }
    let zip: EvidenceZipResult
    if (workingCopy) {
      // No report, no certification: the Working Copy deliberately carries no
      // evidentiary documents at all (#399, ADR-0010).
      onProgress?.('Packaging working copy...', 90)
      zip = buildWorkingCopyZip(caseId, data, packageMeta)
    } else {
      onProgress?.('Generating report...', 80)
      const html = buildHtmlReport(data, options)
      onProgress?.('Packaging evidence...', 90)
      zip = buildEvidenceZip(caseId, data, html, manifest, packageMeta)
    }
    const { entries, packageHash, verificationResult } = zip

    // Record the export as a signed, hash-chained audit entry (#124) — for
    // BOTH classes: a Working Copy extraction must not go silent on the audit
    // trail, it is recorded and marked as one (#399). Ordering is deliberate:
    // the entries (and thus packageHash) are built from the manifest tail
    // BEFORE this append, so packageHash does not — and must not — cover this
    // entry. The bundled manifest.jsonl copy therefore lags the live case
    // manifest by exactly this one entry; the entry itself ships beside it as
    // export-entry.json, so a reviewer can still reconcile the two files.
    //
    // Write-ahead + rollback (#398): the entry is appended BEFORE the zip is
    // written so its signed line can be packaged. If the append throws, nothing
    // has been written; if the zip write then fails, the manifest is truncated
    // back to its anchor so it never records an export that produced no
    // package. Everything between the snapshot read above and this append is
    // synchronous, so the entry's prevHash is the bundled chain head — the link
    // the verifier checks before trusting the entry's scope.
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)
    const appended = appendManifestEntry(caseDir, {
      type: 'export',
      caseId,
      timestamp: data.exportTimestamp,
      operatorId: data.installationId,
      operatorName: data.operatorName,
      toolVersion: resolveToolVersion(),
      packageHash,
      verificationResult,
      // Omitted — never ''/[]/null — on case-scoped exports so their entries
      // stay byte-identical to pre-scope ones (#398, ADR-0009).
      ...(scoped ? { scope: 'selection' as const, captureIds: captures.map((c) => c.id) } : {}),
      // Omitted — never 'evidence'/null — on evidence exports, the same
      // omit-when-absent discipline as `scope` (#399, ADR-0010).
      ...(workingCopy ? { exportClass: 'working-copy' as const } : {})
    })
    try {
      // The signed line itself, unshifted exactly like evidence.json: outside
      // `artifacts` and outside packageHash, which was computed before the
      // entry existed — covering it would be circular. This is the package's
      // trusted statement of its own scope: the verifier checks its signature,
      // its prevHash against the bundled chain head, and its recomputed
      // entryHash before trusting captureIds (#398).
      //
      // Not shipped in a Working Copy: with no bundled manifest or signing key
      // the line proves nothing there, and shipping evidence-shaped material
      // in a non-evidentiary export is exactly what the class split forbids.
      if (!workingCopy) entries.unshift({ name: 'export-entry.json', data: appended.line })
      writeFileSync(options.outputPath, createStoredZip(entries))
    } catch (err) {
      rollbackManifestEntry(caseDir, appended.anchorBytes)
      throw err
    }
  } else {
    onProgress?.('Generating report...', 80)
    writeFileSync(options.outputPath, buildHtmlReport(data, options), 'utf-8')
  }
  onProgress?.('Complete', 100)
}

// Per-package facts that ride beside ExportData (which is the report
// renderer's shape and deliberately not widened here): the Case fields the
// Certification and the Working Copy marker state, and the notes packaged as
// content. `notes` null means excluded; [] means included-but-none.
interface PackageMeta {
  caseNumber?: string
  isDemo: boolean
  purposeOrAuthority?: string
  notes: Note[] | null
}

/**
 * Resolves the exported capture set (#398). A selection must name at least one
 * capture and every id must exist in the case: silently narrowing what the
 * operator asked to export would sign a scope the operator never chose.
 */
function resolveScopedCaptures(allCaptures: Capture[], captureIds?: string[]): Capture[] {
  if (captureIds === undefined) return allCaptures
  if (captureIds.length === 0) {
    throw new Error('Selection-scoped export requires at least one capture')
  }
  const selected = new Set(captureIds)
  const captures = allCaptures.filter((c) => selected.has(c.id))
  if (captures.length !== selected.size) {
    const found = new Set(captures.map((c) => c.id))
    const missing = [...selected].filter((id) => !found.has(id))
    throw new Error(`Selected captures not found in this case: ${missing.join(', ')}`)
  }
  return captures
}

interface EvidenceZipResult {
  // Zip entries ready for createStoredZip. Returned unwritten so the caller can
  // append the export manifest entry first and unshift its signed line as
  // export-entry.json before sealing the package (#398).
  entries: ArtifactAccumulator['entries']
  packageHash: string
  verificationResult: ExportVerificationResult
}

function buildEvidenceZip(
  caseId: string,
  data: ExportData,
  reportHtml: string,
  manifest: ManifestSnapshot,
  meta: PackageMeta
): EvidenceZipResult {
  const { entries, artifacts, add } = createArtifactAccumulator()

  const manifestJsonl = manifest.jsonl
  const timestampEntries = manifest.entries.filter(isTimestampEntry)
  const latestManifestEntry = manifest.head

  // Same path rule the report was rendered against — see buildTimestampTokenPaths.
  const timestampPathsByHash = buildTimestampTokenPaths(data.captures, timestampEntries)
  const emittedTokenPaths = new Set<string>()
  // Deduped by PEM block: every token of one authority carries the same
  // responder/intermediate certs, and a chain repeated per token is noise a
  // verifier has to wade through (#579).
  const timestampTokenCertPems = new Set<string>()
  for (const entry of timestampEntries) {
    if (typeof entry.tsaToken !== 'string') continue
    const token = Buffer.from(entry.tsaToken, 'base64')
    try {
      for (const pem of splitPemBlocks(extractTimestampTokenCertificatesPem(token))) {
        timestampTokenCertPems.add(pem)
      }
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

  const publicKeyPem = getPublicKeyPem()

  add('manifest.jsonl', manifestJsonl)
  add('report.html', reportHtml)
  add(
    'certification.html',
    buildCertification(
      {
        caseName: data.caseName,
        caseNumber: meta.caseNumber,
        isDemo: meta.isDemo,
        purposeOrAuthority: meta.purposeOrAuthority,
        manifestHead: data.manifestHead,
        signingKeyFingerprint: sha256(Buffer.from(publicKeyPem, 'utf-8')),
        contents: {
          captureCount: data.captures.length,
          screenshotCount: data.screenshots.size,
          noteCount: meta.notes?.length ?? 0
        },
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
  add('signing-public-key.pem', publicKeyPem)
  add('VERIFY.md', VERIFY_RUNBOOK)
  // The runbook's executable form (#584). Written through add() like every other
  // packaged document, so it lands in artifacts[] and in packageHash: a script
  // that verifies the package is worth no more than the package's own account of
  // it, and step 1 re-hashes it along with everything else.
  add(VERIFY_SCRIPT_FILENAME, VERIFY_SCRIPT)
  // Operator notes as package content (#399): written through add() so the
  // file participates in packageHash and the artifact index like every other
  // packaged document. Written even when the case has none — "0 notes existed"
  // must stay distinguishable from "notes were excluded" (the Court exhibit).
  if (meta.notes !== null) {
    add('notes.md', buildNotesMarkdown(data.caseName, data.exportTimestamp, meta.notes))
  }

  // Anchor and chain-building material ship as separate files (#579): a single
  // bundle that mixes the token-carried cross-signed root with the self-signed
  // one makes `openssl ts -verify -CAfile` resolve the wrong root and fail, and
  // leaves ambiguous which certificate the verifier is being asked to trust.
  const tsaTrust = getTsaTrustBundle(data.tsaUrl)
  add(TSA_INTERMEDIATES_FILENAME, [...timestampTokenCertPems].join('\n') + '\n')
  if (tsaTrust.bundled) add(TSA_ROOT_FILENAME, tsaTrust.pem)

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
      // Case number and demo status (#399/#405): informational — the schema is
      // non-strict, so older verifiers strip rather than reject them.
      caseNumber: meta.caseNumber ?? null,
      isDemo: meta.isDemo,
      dateRange: data.dateRange
    },
    operator: {
      installationId: data.installationId,
      name: data.operatorName,
      role: data.operatorRole,
      organization: data.operatorOrganization
    },
    warnings: {
      unstampedCaptureCount: data.preflight.unstampedCaptureCount,
      pendingCaptureCount: data.preflight.pendingCaptureCount,
      noneCaptureCount: data.preflight.noneCaptureCount,
      missingContentCaptureCount: capturesMissingContent.length,
      // Captures the chain still claims but the package does not contain (#580).
      unreconciledChainCaptureCount: data.unreconciledChainCaptureIds.length,
      unreconciledChainCaptureIds: data.unreconciledChainCaptureIds,
      tsaTrustAnchorNote: tsaTrust.note ?? null
    },
    verificationMaterials: {
      manifestPath: 'manifest.jsonl',
      manifestHeadIndex: latestManifestEntry?.index ?? null,
      manifestHeadHash: latestManifestEntry?.entryHash ?? null,
      // Informational pointer only: the file is unshifted by generateReport
      // after this index is built, and the verifier reads it by its fixed name.
      exportEntryPath: 'export-entry.json',
      signingPublicKeyPath: 'signing-public-key.pem',
      tsaRootPath: tsaTrust.bundled ? TSA_ROOT_FILENAME : null,
      tsaRootSha256: tsaTrust.rootSha256 ?? null,
      tsaIntermediatesPath: TSA_INTERMEDIATES_FILENAME,
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

  // Recipe owned by packageHash() in @shared/verify/packageHash. evidence.json itself is
  // excluded from `artifacts` (it is unshifted above, not run through `add`),
  // which is what keeps packageHash independent of the entry it informs.
  return {
    entries,
    packageHash: computePackageHash(artifacts),
    verificationResult: foldVerificationResult(data)
  }
}

// overallValid means every capture has a passing verification. An empty
// verification set (e.g. auditTrail-excluded exports and Working Copies) must
// NOT report true: [].every(...) is true, but no verification ran, so the
// package is unverified.
function foldVerificationResult(data: ExportData): ExportVerificationResult {
  const captureCount = data.captures.length
  const verifiedCount = data.verifications.filter((v) => v.status === 'verified').length
  return {
    overallValid: captureCount > 0 && verifiedCount === captureCount,
    captureCount,
    verifiedCount,
    tamperedCount: data.verifications.filter((v) => v.status === 'tampered').length,
    missingCount: data.verifications.filter((v) => v.status === 'missing').length
  }
}

const WORKING_COPY_STATEMENT =
  'This is a non-evidentiary Working Copy export produced by Birdbrain. It is not an ' +
  'evidence package: it contains no certification, no signed manifest, no signing key and ' +
  'no verification materials, and it cannot be verified.'

/**
 * The Working Copy zip (#399, ADR-0010): page archives, the operator-facing
 * screenshots, operator notes, and the WORKING-COPY.json marker that names the
 * class — nothing else. No manifest.jsonl, no report, no certification, no
 * signing key, no evidence.json, no VERIFY.md and no TSA material: every one
 * of those is evidentiary-shaped, and shipping any of them would blur the two
 * classes back together.
 *
 * The marker doubles as the human-readable index (path + sha256 per file), is
 * unshifted like evidence.json — outside `artifacts` and outside packageHash —
 * and is what the standalone verifier keys its "not a verifiable object"
 * outcome on.
 */
function buildWorkingCopyZip(
  caseId: string,
  data: ExportData,
  meta: PackageMeta
): EvidenceZipResult {
  const { entries, artifacts, add } = createArtifactAccumulator()

  const captureIndex = data.captures.map((capture) => {
    const mhtml = defaultCaptureStore.readArtifact(capture.caseId, capture.id, 'mhtml')
    const pagePath = `pages/${capture.id}.mhtml`
    if (mhtml) add(pagePath, mhtml)

    // The operator-facing copy — annotation-burned when the option says so —
    // keyed by capture id. Content addressing and ingest-hash matching are
    // evidence-package concepts; this class ships what the operator works with.
    const screenshotBase64 = data.screenshots.get(capture.id)
    const screenshotPath = screenshotBase64 ? `screenshots/${capture.id}.png` : null
    if (screenshotBase64 && screenshotPath) {
      add(screenshotPath, Buffer.from(screenshotBase64, 'base64'))
    }

    return {
      id: capture.id,
      title: capture.title,
      url: capture.url,
      capturedAt: capture.timestamp,
      pagePath: mhtml ? pagePath : null,
      screenshotPath
    }
  })

  if (meta.notes !== null) {
    add('notes.md', buildNotesMarkdown(data.caseName, data.exportTimestamp, meta.notes))
  }

  const marker = {
    exportClass: 'working-copy' as const,
    statement: WORKING_COPY_STATEMENT,
    generatedBy: 'Birdbrain',
    toolVersion: data.toolVersion,
    exportedAt: data.exportTimestamp,
    case: {
      id: caseId,
      name: data.caseName,
      caseNumber: meta.caseNumber ?? null,
      isDemo: meta.isDemo,
      ...(meta.isDemo
        ? {
            demoStatement:
              'This case is the demonstration case seeded by Birdbrain. Its captures are ' +
              'fixture data supplied with the tool, not evidence collected by the operator.'
          }
        : {})
    },
    operator: {
      installationId: data.installationId,
      name: data.operatorName,
      role: data.operatorRole,
      organization: data.operatorOrganization
    },
    purposeOrAuthority: meta.purposeOrAuthority ?? null,
    contents: {
      captureCount: data.captures.length,
      screenshotCount: data.screenshots.size,
      noteCount: meta.notes?.length ?? 0
    },
    captures: captureIndex,
    artifacts
  }

  // Unshifted, not add()ed, exactly like evidence.json: the marker indexes the
  // artifacts, so packageHash must stay independent of it.
  entries.unshift({ name: WORKING_COPY_MARKER_FILENAME, data: JSON.stringify(marker, null, 2) })

  return {
    entries,
    packageHash: computePackageHash(artifacts),
    verificationResult: foldVerificationResult(data)
  }
}

/**
 * Operator notes rendered as one Markdown document (#399). Notes are operator
 * work product: the header says so, and says what integrity cover the file has
 * (packageHash + the artifact index) and has not (the capture manifest chain).
 */
export function buildNotesMarkdown(caseName: string, exportedAt: string, notes: Note[]): string {
  const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()
  const head = [
    `# Operator notes — ${oneLine(caseName)}`,
    '',
    `Exported ${exportedAt}. ${notes.length} note${notes.length === 1 ? '' : 's'}.`,
    '',
    'Operator work product: these notes were written by the operator in Birdbrain. They are',
    'not captured page content and are not anchored in the capture manifest chain.'
  ]
  const sections = notes.map((note) => {
    const facts = [
      `- Created: ${note.createdAt}`,
      `- Updated: ${note.updatedAt}`,
      ...(note.captureId ? [`- Attached to capture: ${note.captureId}`] : []),
      ...(note.sourceUrl ? [`- Source URL: ${note.sourceUrl}`] : [])
    ]
    // The blank line before '---' matters: a rule directly under a text line
    // would turn that line into a setext heading.
    return [
      '',
      '',
      '---',
      '',
      `## ${oneLine(note.title) || 'Untitled note'}`,
      '',
      ...facts,
      '',
      note.body.trim() || '_(no text)_'
    ].join('\n')
  })
  return head.join('\n') + sections.join('') + '\n'
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

function splitPemBlocks(pem: string): string[] {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []
}
