import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import {
  exhibitCitationResolver,
  type ExhibitCitationResolver
} from '@main/services/db/caseMemberRepo'
import { listDerivedFilesForCase } from '@main/services/db/derivedFileRepo'
import { verifyCaseDerivedFiles, verifyExhibit } from '@main/services/exhibits'
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
  readSharedCaseSnapshot,
  rollbackManifestEntry
} from '@main/services/manifest'
import { buildTrustedTimeIndex } from '@main/services/trustedTime'
import type {
  ArtifactAccumulator,
  ExportVerificationResult,
  ManifestSnapshot,
  SharedCaseSnapshot
} from '@main/services/manifest'
import { createStoredZip } from '@main/services/zip'
import { getTsaTrustBundle } from '@main/services/tsaTrust'
import {
  buildTrustedTimeIndexFromEntries,
  extractTimestampTokenCertificatesPem,
  SHARED_CASE_SCHEMA_VERSION,
  stampFor
} from '@shared/verify'
import type { SharedCaseMember } from '@shared/verify'
import {
  PACKAGE_ROOT_FILES,
  capturePagePath,
  derivedFilePackagePath,
  exhibitPackageDirectory,
  exhibitPackagePath,
  screenshotPath as packagedScreenshotPath,
  timestampTokenPath
} from '../../packages/evidence-package-layout/index'
import type { TrustedTimeResult } from '@shared/verify'
import { buildCertification, type SigningKeyRange } from '@main/services/certification'
import { resolveToolVersion } from '@main/services/toolVersion'
import { buildHtmlReport } from '@main/services/reportHtml'
import type {
  EntrySignatureStatus,
  ExportDerivedFile,
  ExportFileExhibit,
  ExportSharedCase,
  ExportSharedCaseMember,
  PackagedArtifacts,
  ReportData
} from '@main/services/reportHtml'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { EVIDENCE_INDEX_SCHEMA_VERSION, WORKING_COPY_MARKER_FILENAME } from '@shared/schemas'
import { extractNoteMentions } from '@shared/noteDoc'
import type {
  Capture,
  DerivedFile,
  DerivedFileVerification,
  Exhibit,
  ExhibitVerification,
  ExportOptions,
  ExportPreflight,
  HashVerification,
  Note,
  TrustedTime
} from '@shared/types'

// The report renderer owns this shape. Aliasing rather than restating it keeps
// the two from drifting apart, since every field here exists to be rendered.
type ExportData = ReportData

/**
 * Every entry the package vouches for: the local chain's, and in a Shared Case
 * the accepted entries of every other member and lineage chain. A remote
 * Exhibit's trusted time and entry signature are its author's, read from its
 * author's chain exactly as the package verifier reads them.
 */
function caseEntriesOf(
  manifest: ManifestSnapshot,
  sharedCase: SharedCaseSnapshot
): Record<string, unknown>[] {
  const verification = sharedCase.verification
  if (!verification) return manifest.entries
  const remote = [...verification.entries]
    .filter(([id]) => id !== verification.localInstallationId)
    .flatMap(([, accepted]) => accepted)
  return [...manifest.entries, ...remote]
}

function exportSharedCaseMember(member: SharedCaseMember): ExportSharedCaseMember {
  const { installationId, memberCode, operatorName, role, revokedAt } = member
  return { installationId, memberCode, operatorName, role, revoked: revokedAt !== undefined }
}

/**
 * The Shared Case the export states, from the walk over the snapshot it
 * encloses. Null for a Case never shared or forked, which keeps its documents
 * and index exactly as they were before Shared Cases. `inExport` says which
 * Exhibits the export's scope holds.
 */
export function resolveExportSharedCase(
  sharedCase: SharedCaseSnapshot,
  inExport: (exhibitId: string) => boolean
): ExportSharedCase | null {
  const verification = sharedCase.verification
  if (!verification) return null
  const citationByExhibitId = new Map(
    [...verification.citations.values()].map((c) => [c.exhibitId, c.citation])
  )
  return {
    verified: verification.valid,
    finding: verification.reason ?? null,
    members: verification.members.map(exportSharedCaseMember),
    lineage: verification.lineage.map(({ sourceCaseId, members }) => ({
      sourceCaseId,
      members: members.map(exportSharedCaseMember)
    })),
    exclusions: verification.exclusions.map((exclusion) => ({
      exhibitId: exclusion.exhibitId,
      citation: citationByExhibitId.get(exclusion.exhibitId) ?? null,
      authorInstallationId: exclusion.authorInstallationId,
      excludedBy: exclusion.operatorName,
      excludedAt: exclusion.timestamp,
      manifestIndex: exclusion.index,
      reason: exclusion.reason ?? null,
      sourceCaseId: exclusion.sourceCaseId ?? null,
      inExport: inExport(exclusion.exhibitId)
    })),
    chainPaths: sharedCase.chains.map((chain) => chain.path)
  }
}

/** evidence.json keeps this as a list; an Exhibit has at most one token path. */
function packagedTimestampTokenPaths(byHash: Map<string, string>, contentHash: string): string[] {
  const path = byHash.get(contentHash)
  return path ? [path] : []
}

/**
 * What a timestamp token can be packaged for: any Exhibit, by its Content Hash
 * (X26). A committed attachment runs the same RFC 3161 path a Capture does, so
 * its token is packaged and bound the same way — dropping it, which this did
 * before #1156, left the chain asserting a trusted time whose token the package
 * did not enclose.
 */
interface TokenSubject {
  id: string
  contentHash: string
}

function tokenSubjects(
  captures: Capture[],
  exhibits: Array<{ id: string; contentHash: string }>,
  chainIdOf: (id: string) => string
): TokenSubject[] {
  return [
    ...captures.map((capture) => ({ id: chainIdOf(capture.id), contentHash: capture.hash })),
    ...exhibits.map((exhibit) => ({ id: chainIdOf(exhibit.id), contentHash: exhibit.contentHash }))
  ]
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

/**
 * Whether a note travels with a selection export (#985).
 *
 * A note carries two independent pointers at a Capture. `capture_id` is the
 * column the app itself lists a Capture's notes by (`CaptureDetailsPanel`);
 * `anchor` is the structured pointer, and all four anchor kinds embed a
 * `captureId`. Four write paths set `notes.anchor_json` — `createNote`,
 * `updateNote`, the archive importer and the Database Admin hatch — and
 * `assertAnchorInCase` requires only that the anchored Capture belong to the
 * note's own Case, so a stored row may carry an anchor and a NULL
 * `capture_id`, or two pointers naming different Captures. Neither shape is a
 * corruption to be ignored.
 *
 * Attachment is `capture_id`, per the maintainer correction of 2026-08-31,
 * which names that column as the app's own definition of a Capture's notes and
 * withdraws the anchor-only reading as one that would ship an empty notes.md
 * for every export the shipped interface can produce. The anchor is read, but
 * only to withhold: a note attached to a selected Capture that also points at
 * another of the Case's Captures the export leaves out does not travel, which
 * is the 2026-08-30 ruling's own ground — a note that names a withheld Capture
 * discloses what the selection was drawn to withhold.
 *
 * A Capture Mention in the note's body is a third pointer, read the same way:
 * it prints the Capture's label into notes.md, so one naming a Case Capture
 * outside the selection withholds the note on the same ground.
 *
 * An anchor or Mention naming a Capture the Case no longer holds is ignored
 * rather than treated as outside the selection. `notes.capture_id` is
 * `ON DELETE SET NULL` while `anchor_json` and `body_doc` are plain TEXT that
 * keep the deleted id, so a stale one is a dangling pointer, not a statement
 * about the selection.
 *
 * The predicate is a strict subset of both live candidate answers to
 * maintainer question 1 — read `capture_id`, or read either pointer — so every
 * note it withholds that those answers would ship is withheld, and it ships
 * nothing either of them would hold back. `notes follow the selection scope`
 * pins that property against both predicates rather than leaving it asserted
 * here. It is not a subset of the withdrawn anchor-only reading, and it does
 * not settle the question: answering it narrows or widens this one expression.
 */
export function noteTravelsWithSelection(
  note: Note,
  selectedCaptureIds: ReadonlySet<string>,
  caseCaptureIds: ReadonlySet<string>
): boolean {
  if (note.captureId === undefined || !selectedCaptureIds.has(note.captureId)) return false
  const mentioned = note.bodyDoc
    ? extractNoteMentions(note.bodyDoc)
        .filter((mention) => mention.targetType === 'capture')
        .map((mention) => mention.targetId)
    : []
  const pointers = [note.anchor?.captureId, ...mentioned]
  return pointers.every(
    (id) => id === undefined || !caseCaptureIds.has(id) || selectedCaptureIds.has(id)
  )
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

  onProgress?.('Loading captures...', 10)
  const allCaptures = captureRepo.listCaptures(caseId)
  const allExhibits = listExhibits(caseId)
  // An export always shows the Member Code when the Case has a roster
  // (decision 7); the app's one-member hiding rule does not apply here.
  const cite = exhibitCitationResolver(caseId, 'export')
  // Every kind the case holds is packaged, reported and certified (ADR-0023,
  // #1156). The X44 refusal that stood here until this ticket — an Evidence
  // Package refused outright while a committed attachment existed — was the
  // honest answer while the package covered Captures only; it is not needed
  // once the package covers every kind.
  const scope = resolveScopedExhibits(allCaptures, allExhibits, options.captureIds)
  const { captures } = scope
  const derivedByExhibitId = groupDerivedFiles(listDerivedFilesForCase(caseId))
  const scoped = options.captureIds !== undefined

  // Operator notes as package content (#399). Null means excluded; an empty
  // array means the toggle was on and the case simply has none — notes.md is
  // still written then, so "no notes existed" stays distinguishable from
  // "notes were excluded".
  //
  // Scoped with the Exhibits on a selection export (#985): `noteTravelsWithSelection`
  // holds the rule and its grounds.
  const caseNotes = options.include.notes ? noteRepo.listNotes(caseId) : null
  const selectedCaptureIds = new Set(captures.map((capture) => capture.id))
  const caseCaptureIds = new Set(allCaptures.map((capture) => capture.id))
  const notes =
    caseNotes !== null && scoped
      ? caseNotes.filter((note) =>
          noteTravelsWithSelection(note, selectedCaptureIds, caseCaptureIds)
        )
      : caseNotes
  // Stated rather than left to be counted, exactly as the excluded-Exhibit count
  // is: without it a notes.md holding three of the Case's ten notes reads as the
  // operator's complete work product.
  const omittedNoteCount =
    caseNotes !== null && notes !== null ? caseNotes.length - notes.length : 0

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
    tsaEnabled: settings.tsaEnabled,
    toolVersion: resolveToolVersion(),
    // Filled in below, once the awaited stages are done and the manifest can be
    // snapshotted at the same instant the package is built from. Nothing reads
    // these before then.
    preflight: UNRESOLVED_PREFLIGHT,
    manifestHead: null,
    packagedPaths: new Map(),
    chainIdByCaptureId: new Map(),
    entriesUnderCarriedKeys: false,
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
    fileExhibits: [],
    exhibitNumberByCaptureId: new Map(
      allExhibits
        .filter((exhibit) => exhibit.kind === 'capture')
        .map((exhibit) => [exhibit.id, exhibit.exhibitNumber])
    ),
    exhibitCitationByCaptureId: new Map(
      allExhibits
        .filter((exhibit) => exhibit.kind === 'capture')
        .map((exhibit) => [exhibit.id, cite(exhibit)])
    ),
    derivedFilesByCaptureId: new Map(),
    selectionScope: scoped
      ? {
          selectedCaptureCount: captures.length,
          caseCaptureCount: allCaptures.length,
          excludedExhibitCount: scope.excludedExhibitCount,
          omittedNoteCount
        }
      : null,
    // Resolved from the manifest snapshot below, with the chains beside it.
    sharedCase: null
  }

  // Filled by the verification run below when one is asked for; empty otherwise,
  // which the documents state as "not verified in this export" rather than as a
  // clean result.
  let exhibitVerifications = new Map<string, ExhibitVerification>()

  if (options.include.auditTrail) {
    onProgress?.('Verifying capture integrity...', 10)
    // Per-item progress across the 10–50% band so a large case advances
    // continuously instead of parking on a single milestone.
    data.verifications = await verifyCaptures(captures, captureLifecycle, (done, total) =>
      onProgress?.(`Verifying capture ${done} of ${total}...`, 10 + Math.round((done / total) * 40))
    )
    if (scope.fileExhibits.length > 0) {
      onProgress?.('Verifying exhibit integrity...', 50)
      exhibitVerifications = await verifyFileExhibits(caseId, scope.fileExhibits)
    }
  }

  // NOT gated on the audit-trail toggle, because this decides what the package
  // CONTAINS and not only what it reports: a Derived File the chain does not
  // anchor (X34 — a legacy thumbnail whose source screenshot could not be
  // verified) must not ship, and that question has to be answered on every
  // export. Resolved through the same binding predicate the standalone verifier
  // uses, so the app and the verifier cannot disagree about which files the
  // chain covers.
  const derivedVerifications = await verifyCaseDerivedFiles(caseId)

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
  // The other member and lineage chains, read straight after with nothing
  // awaited between, so the package encloses one state of the Case directory.
  const sharedCase = readSharedCaseSnapshot(join(getStorageRoot(), caseId), manifest)
  const caseEntries = caseEntriesOf(manifest, sharedCase)
  data.manifestHead = manifest.head
  // The ids the documents below write for an Exhibit are the chain's (see
  // resolveChainNames); lookups into this export's own maps keep the row id.
  // Resolved over every row of the Case, so no row takes an id another holds.
  const chainNames = resolveChainNames(
    allCaptures,
    allExhibits.filter((exhibit) => exhibit.kind !== 'capture'),
    caseEntries
  )
  const chainIdOf = (id: string): string => chainNames.get(id)?.id ?? id
  // An exclusion names the Exhibit by the id its chain carries.
  const inScope = new Set([...captures, ...scope.fileExhibits].map(({ id }) => chainIdOf(id)))
  data.sharedCase = resolveExportSharedCase(sharedCase, (id) => inScope.has(id))
  data.chainIdByCaptureId = new Map(captures.map(({ id }) => [id, chainIdOf(id)]))
  data.entriesUnderCarriedKeys = signingKeyRanges(manifest.entries, getPublicKeyPem()).some(
    ({ carriedByImportAt }) => carriedByImportAt !== null
  )
  // One reader for the whole export: it reads each enclosed non-Capture
  // Exhibit and each enclosed Derived File exactly once, classification reads
  // its outcome, and the zip builders consume the buffers it already holds. A
  // Capture's own artifacts are outside it — see createPackageReader.
  const reader = createPackageReader()
  // One token-path resolution over every Exhibit in scope, shared by the
  // report, evidence.json and the packager (X26).
  const tokenPaths =
    options.format === 'zip'
      ? buildTimestampTokenPaths(
          tokenSubjects(captures, scope.fileExhibits, chainIdOf),
          caseEntries.filter(isTimestampEntry)
        )
      : new Map<string, string>()
  data.packagedPaths = buildPackagedPaths(
    data,
    options,
    tokenPaths,
    screenshotDigests,
    annotatedCaptureIds
  )

  // Resolved from the snapshot above and nowhere else — see resolveExportTrustedTime.
  const trustedTimeByHash = buildTrustedTimeIndexFromEntries(caseEntries)
  const trustedTime = resolveExportTrustedTime(captures, trustedTimeByHash)
  data.preflight = trustedTime.preflight
  data.trustedTimeByCaptureId = trustedTime.byCaptureId
  data.entrySignatureByCaptureId = resolveEntrySignatures(captures, caseEntries)
  data.fileExhibits = buildFileExhibitRecords(scope.fileExhibits, {
    derivedByExhibitId,
    derivedVerifications,
    verifications: exhibitVerifications,
    trustedTimeByHash,
    entrySignatures: resolveExhibitEntrySignatures(scope.fileExhibits, caseEntries),
    tokenPaths,
    chainNames,
    isPackage: options.format === 'zip',
    reader,
    cite
  })
  data.derivedFilesByCaptureId = new Map(
    captures.map((capture) => [
      capture.id,
      buildDerivedFiles(
        derivedByExhibitId.get(capture.id) ?? [],
        exhibitPackageDirectory('capture', capture.mhtmlPath ?? null),
        options.format === 'zip',
        derivedVerifications.get(capture.id),
        reader
      )
    ])
  )
  // Reconciled against the FULL case, not the exported selection — see the
  // resolver's comment for why a deliberately unselected capture is no orphan.
  // A row the chain names by another id is held under that id.
  data.unreconciledChainCaptureIds = resolveUnreconciledChainCaptures(
    allCaptures.map((capture) => ({ ...capture, id: chainIdOf(capture.id) })),
    manifest.entries
  )

  if (options.format === 'zip') {
    const packageMeta: PackageMeta = {
      caseNumber: caseData.caseNumber,
      isDemo: caseData.isDemo,
      purposeOrAuthority: options.purposeOrAuthority,
      notes: notes?.map((note) => noteNamedByChain(note, chainIdOf)) ?? null
    }
    let zip: EvidenceZipResult
    if (workingCopy) {
      // No report, no certification: the Working Copy deliberately carries no
      // evidentiary documents at all (#399, ADR-0010).
      onProgress?.('Packaging working copy...', 90)
      zip = buildWorkingCopyZip(caseId, data, packageMeta, reader)
    } else {
      onProgress?.('Generating report...', 80)
      const html = buildHtmlReport(data, options)
      onProgress?.('Packaging evidence...', 90)
      zip = buildEvidenceZip(caseId, data, html, manifest, sharedCase, packageMeta, reader)
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
      //
      // The list carries the Exhibit ids in scope, of every kind (#1156, D3):
      // a Capture's Exhibit id IS its capture id, so the field's name, shape
      // and meaning are unchanged and a capture-only selection produces the
      // same entry it always did. It is the package's only signed statement of
      // what it encloses, so an Exhibit left out has to be accounted for here
      // or the verifier has nothing to read its absence from. Each id is the
      // one the Exhibit's own entry carries, which is the id the verifier
      // matches it against (#1657).
      ...(scoped
        ? {
            scope: 'selection' as const,
            captureIds: [...captures, ...scope.fileExhibits].map(({ id }) => chainIdOf(id))
          }
        : {}),
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
      if (!workingCopy)
        entries.unshift({ name: PACKAGE_ROOT_FILES.exportEntry, data: appended.line })
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

/** The Exhibits one export covers, and what a selection leaves behind. */
interface ExportScope {
  captures: Capture[]
  /** Committed Exhibits of every other kind, in Exhibit Number order. */
  fileExhibits: Exhibit[]
  /** Committed non-Capture Exhibits the case holds and this export omits. */
  excludedExhibitCount: number
}

/**
 * Resolves the exported Exhibit set (#398, and #1156 D3).
 *
 * `captureIds` carries Exhibit ids, not a second id space: a Capture's Exhibit
 * id IS its capture id (X35), so a selection naming an attachment needs no new
 * key on ExportOptions and no manifest schema bump — the signed export entry
 * keeps the field and the shape it has always had.
 *
 * A selection must name at least one Exhibit and every id must exist in the
 * case: silently narrowing what the operator asked to export would sign a scope
 * the operator never chose.
 */
function resolveScopedExhibits(
  allCaptures: Capture[],
  allExhibits: Exhibit[],
  captureIds?: string[]
): ExportScope {
  const committed = allExhibits.filter((exhibit) => exhibit.kind !== 'capture')
  if (captureIds === undefined) {
    return { captures: allCaptures, fileExhibits: committed, excludedExhibitCount: 0 }
  }
  if (captureIds.length === 0) {
    throw new Error('Selection-scoped export requires at least one exhibit')
  }
  const selected = new Set(captureIds)
  const captures = allCaptures.filter((c) => selected.has(c.id))
  const fileExhibits = committed.filter((exhibit) => selected.has(exhibit.id))
  const found = new Set([...captures.map((c) => c.id), ...fileExhibits.map((e) => e.id)])
  if (found.size !== selected.size) {
    const missing = [...selected].filter((id) => !found.has(id))
    throw new Error(`Selected exhibits not found in this case: ${missing.join(', ')}`)
  }
  return {
    captures,
    fileExhibits,
    excludedExhibitCount: committed.length - fileExhibits.length
  }
}

/**
 * Per-entry signature status for committed Exhibits, read from the same
 * manifest snapshot `resolveEntrySignatures` reads for Captures and folded the
 * same way: the LAST `exhibit` entry for an id wins, and an Exhibit with no
 * entry is stated as `no-entry` rather than left absent.
 */
export function resolveExhibitEntrySignatures(
  exhibits: Exhibit[],
  entries: Record<string, unknown>[]
): Map<string, EntrySignatureStatus> {
  const byExhibitId = new Map<string, EntrySignatureStatus>()
  for (const entry of entries) {
    if (entry.type !== 'exhibit' || typeof entry.exhibitId !== 'string') continue
    // `exhibit` entries are schema 3 by construction, so they are signed or
    // they are not entries this build wrote; the discriminator is the same one
    // the capture axis uses rather than the entry type's minimum version.
    const schemaVersion = typeof entry.schemaVersion === 'number' ? entry.schemaVersion : 1
    byExhibitId.set(
      entry.exhibitId,
      schemaVersion >= 2 && typeof entry.signature === 'string' ? 'signed' : 'unsigned-legacy'
    )
  }
  for (const exhibit of exhibits) {
    if (!byExhibitId.has(exhibit.id)) byExhibitId.set(exhibit.id, 'no-entry')
  }
  return byExhibitId
}

/** How a signed entry names one Exhibit: its id, and a non-Capture Exhibit's storage path. */
export interface ChainName {
  id: string
  path: string | null
}

/**
 * The name each renamed Exhibit's signed entry gives it, keyed by row id
 * (#1657). An archive import that renames a colliding row id leaves the
 * inherited entry naming the id it was signed under, and both verifiers look
 * for an Exhibit's file, its index rows and its place in a signed selection
 * under the entry's id. So every document an export writes names a renamed
 * Exhibit the way its entry does.
 *
 * A row counts as renamed only when no entry of its kind, in any chain the
 * package encloses, carries its own id: a row its own id is signed under keeps
 * it whatever its stored index says, since that index is editable and can land
 * on another row's entry for the same bytes. A renamed row takes the id of the
 * entry at its own index, of its kind and over its bytes (a Shared Case's
 * chains share index numbers), and only when that is one id, held by no other
 * row of the Case and claimed by no other renamed row. Any other row is absent
 * here and keeps its own name.
 */
export function resolveChainNames(
  captures: Capture[],
  exhibits: Exhibit[],
  entries: Record<string, unknown>[]
): Map<string, ChainName> {
  const idIn = (entry: Record<string, unknown>, type: 'capture' | 'exhibit'): unknown =>
    entry.type !== type ? undefined : type === 'capture' ? entry.captureId : entry.exhibitId
  const byIndex = new Map<number, Record<string, unknown>[]>()
  const signedIds = new Set<string>()
  for (const entry of entries) {
    for (const type of ['capture', 'exhibit'] as const) {
      const id = idIn(entry, type)
      if (typeof id === 'string') signedIds.add(`${type}:${id}`)
    }
    if (typeof entry.index !== 'number') continue
    const atIndex = byIndex.get(entry.index) ?? []
    atIndex.push(entry)
    byIndex.set(entry.index, atIndex)
  }
  const rows = [
    ...captures.map(({ id, manifestIndex, hash }) => ({
      id,
      index: manifestIndex,
      contentHash: hash,
      type: 'capture' as const
    })),
    ...exhibits.map(({ id, manifestSeq, contentHash }) => ({
      id,
      index: manifestSeq,
      contentHash,
      type: 'exhibit' as const
    }))
  ]
  const rowIds = new Set(rows.map(({ id }) => id))
  const claims = new Map<string, Array<{ rowId: string; name: ChainName }>>()
  for (const { id: rowId, index, contentHash, type } of rows) {
    if (typeof index !== 'number' || signedIds.has(`${type}:${rowId}`)) continue
    const candidates = (byIndex.get(index) ?? []).flatMap((entry): ChainName[] => {
      const id = idIn(entry, type)
      if (typeof id !== 'string' || entry.contentHash !== contentHash) return []
      return [{ id, path: typeof entry.path === 'string' ? entry.path : null }]
    })
    if (new Set(candidates.map(({ id }) => id)).size !== 1) continue
    const [name] = candidates
    if (rowIds.has(name.id)) continue
    claims.set(name.id, [...(claims.get(name.id) ?? []), { rowId, name }])
  }
  const names = new Map<string, ChainName>()
  for (const claimants of claims.values()) {
    if (claimants.length === 1) names.set(claimants[0].rowId, claimants[0].name)
  }
  return names
}

/** A note as notes.md states it: its Capture pointers in the ids the chain uses. */
function noteNamedByChain(note: Note, chainIdOf: (id: string) => string): Note {
  return {
    ...note,
    ...(note.captureId ? { captureId: chainIdOf(note.captureId) } : {}),
    ...(note.anchor
      ? { anchor: { ...note.anchor, captureId: chainIdOf(note.anchor.captureId) } }
      : {})
  }
}

/**
 * Verifies committed non-Capture Exhibits through the app's own Exhibit verify
 * path (X37), so `exhibits:verify` and an export's verification run cannot
 * report different states for the same bytes. Captures keep the MHTML-aware
 * capture path above for exactly the same reason.
 */
async function verifyFileExhibits(
  caseId: string,
  exhibits: Exhibit[],
  onItem?: (done: number, total: number) => void
): Promise<Map<string, ExhibitVerification>> {
  const results = new Map<string, ExhibitVerification>()
  for (const [index, exhibit] of exhibits.entries()) {
    results.set(exhibit.id, await verifyExhibit(caseId, exhibit.id))
    onItem?.(index + 1, exhibits.length)
  }
  return results
}

/**
 * The Derived Files of one Exhibit, as this export packages and reports them
 * (X17). `parentDirectory` is where the parent's bytes sit in the package, so a
 * Derived File lands beside its parent under the same directory — the layout
 * evidence.json, VERIFY.md and verify.sh all name.
 *
 * A file NO manifest line names is NOT packaged, in either export class, and is
 * not listed in evidence.json: the Derived File rows are a database mirror, and
 * bytes covered by nothing but a mirror have no place in a package whose whole
 * claim is that the chain covers what it holds (ADR-0024's rule for pooled
 * files, X41's for an unanchored row). The omission is disclosed by whatever
 * each class carries: the Evidence Package states it in report.html and in the
 * certification's contents line, and the Working Copy — which has neither
 * document by design (#399, ADR-0010) — carries the count in
 * WORKING-COPY.json. An omission a reader cannot see is the dishonest option
 * X44 rejected.
 *
 * A failing chain is NOT that case and does not hold anything back: the entry
 * is there, nothing vouches for it, and the documents say exactly that.
 */
function buildDerivedFiles(
  files: DerivedFile[],
  parentDirectory: string,
  isPackage: boolean,
  verifications: DerivedFileVerification[] | undefined,
  reader: PackageReader
): ExportDerivedFile[] {
  const byId = new Map((verifications ?? []).map((result) => [result.derivedFileId, result]))
  return files.map((file) => {
    const verification = byId.get(file.id)
    // 'unverified' with cause `no-entry` is X34's case and is the only one
    // held back; 'chain-unverified' means a `derivation` entry names the file
    // and the chain does not verify, which is a statement about the chain and
    // not about the file, so it ships and the documents say so. `verified`,
    // `tampered` and `missing` all mean the verified chain carries an entry
    // for it — `missing` is decided AFTER that question, so it means anchored
    // with unreadable bytes and never "no entry, and unreadable too".
    //
    // No verification at all fails closed to `no-entry`: nothing established
    // an entry, so nothing may be enclosed on the strength of one. Unreachable
    // today — `verifyCaseDerivedFiles` runs on every export and is total over
    // the Case's rows — and the conservative answer if that ever changes.
    const anchoring: ExportDerivedFile['anchoring'] =
      verification === undefined
        ? 'no-entry'
        : verification.status !== 'unverified'
          ? 'anchored'
          : verification.unanchoredCause === 'chain-unverified'
            ? 'chain-unverified'
            : 'no-entry'
    // The read itself decides enclosure. Nothing probes and then reads.
    const enclosed = isPackage && anchoring !== 'no-entry' ? reader.read(file.path) !== null : false
    return {
      id: file.id,
      derivation: file.derivation,
      toolVersion: file.toolVersion,
      contentHash: file.contentHash,
      storedPath: file.path,
      anchoring,
      packagedPath: enclosed ? derivedFilePackagePath(parentDirectory, file.path) : null,
      manifestIndex: file.manifestSeq,
      ...(verification !== undefined ? { verification } : {})
    }
  })
}

/** Everything the report, the certification and evidence.json say about one
 * committed non-Capture Exhibit, resolved once from the snapshot the package is
 * built from — the same discipline the capture axes follow (#492, #611). */
interface FileExhibitInputs {
  derivedByExhibitId: Map<string, DerivedFile[]>
  derivedVerifications: Map<string, DerivedFileVerification[]>
  verifications: Map<string, ExhibitVerification>
  trustedTimeByHash: Map<string, TrustedTimeResult>
  entrySignatures: Map<string, EntrySignatureStatus>
  tokenPaths: Map<string, string>
  chainNames: Map<string, ChainName>
  isPackage: boolean
  reader: PackageReader
  cite: ExhibitCitationResolver
}

function buildFileExhibitRecords(
  exhibits: Exhibit[],
  inputs: FileExhibitInputs
): ExportFileExhibit[] {
  const { isPackage, reader } = inputs
  return exhibits.map((exhibit) => {
    const directory = exhibitPackageDirectory(exhibit.kind, exhibit.path)
    // The bytes are read here, once, and assembly encloses what this read
    // returned — the same rule the Derived Files follow, for the same reason.
    const enclosed = isPackage ? reader.read(exhibit.path) !== null : false
    const verification = inputs.verifications.get(exhibit.id)
    // Named as its signed entry names it — see resolveChainNames. Everything
    // keyed above and below still reads the row's own id.
    const named = inputs.chainNames.get(exhibit.id)
    const packagedFrom = named?.path ?? exhibit.path
    return {
      id: named?.id ?? exhibit.id,
      kind: exhibit.kind,
      origin: exhibit.origin,
      exhibitNumber: exhibit.exhibitNumber,
      citation: inputs.cite(exhibit),
      name: exhibit.name,
      contentHash: exhibit.contentHash,
      storedPath: exhibit.path,
      sizeBytes: exhibit.sizeBytes,
      committedAt: exhibit.committedAt,
      manifestIndex: exhibit.manifestSeq,
      packagedPath: enclosed && packagedFrom ? exhibitPackagePath(packagedFrom) : null,
      timestampTokenPath: isPackage ? (inputs.tokenPaths.get(exhibit.contentHash) ?? null) : null,
      derivedFiles: buildDerivedFiles(
        inputs.derivedByExhibitId.get(exhibit.id) ?? [],
        directory,
        isPackage,
        inputs.derivedVerifications.get(exhibit.id),
        reader
      ),
      trustedTime: inputs.trustedTimeByHash.get(exhibit.contentHash) ?? UNSTAMPED,
      entrySignature: inputs.entrySignatures.get(exhibit.id) ?? 'no-entry',
      ...(verification !== undefined ? { verification } : {})
    }
  })
}

/**
 * What the package holds, counted by kind (ADR-0023). The Certification's
 * contents line and the Working Copy marker both state these: "1 capture" over
 * a package that also encloses three committed documents describes something
 * the package is not.
 */
function exhibitKindCounts(data: ExportData): {
  exhibitCountsByKind: Record<string, number>
  derivedFileCount: number
  unanchoredDerivedFileCount: number
  unverifiableDerivedFileCount: number
  missingDerivedFileCount: number
} {
  const exhibitCountsByKind: Record<string, number> = {}
  let derivedFileCount = 0
  let unanchoredDerivedFileCount = 0
  let unverifiableDerivedFileCount = 0
  let missingDerivedFileCount = 0
  // Two axes, not one. ENCLOSURE is decided by `packagedPath` alone — the same
  // field the zip and evidence.json are built from — and partitions the Case's
  // Derived Files three ways. ANCHORING is a separate disclosure over the same
  // files: counting a `chain-unverified` file as unverifiable INSTEAD of
  // answering the enclosure question put a file whose bytes could not be read
  // under the certification's "enclosed" clause, which the zip and the report
  // both correctly omitted.
  const count = (files: ExportDerivedFile[]): void => {
    for (const file of files) {
      if (file.packagedPath) derivedFileCount++
      else if (file.anchoring === 'no-entry') unanchoredDerivedFileCount++
      // A manifest entry names it and the export's single read of its bytes
      // failed, so it is in neither the package nor evidence.json.
      else missingDerivedFileCount++
      if (file.anchoring === 'chain-unverified') unverifiableDerivedFileCount++
    }
  }
  for (const exhibit of data.fileExhibits) {
    exhibitCountsByKind[exhibit.kind] = (exhibitCountsByKind[exhibit.kind] ?? 0) + 1
    count(exhibit.derivedFiles)
  }
  for (const files of data.derivedFilesByCaptureId.values()) count(files)
  return {
    exhibitCountsByKind,
    derivedFileCount,
    unanchoredDerivedFileCount,
    unverifiableDerivedFileCount,
    missingDerivedFileCount
  }
}

/** Derived Files grouped by the Exhibit they were computed from. */
function groupDerivedFiles(files: DerivedFile[]): Map<string, DerivedFile[]> {
  const byExhibitId = new Map<string, DerivedFile[]>()
  for (const file of files) {
    const existing = byExhibitId.get(file.exhibitId)
    if (existing) existing.push(file)
    else byExhibitId.set(file.exhibitId, [file])
  }
  return byExhibitId
}

interface EvidenceZipResult {
  // Zip entries ready for createStoredZip. Returned unwritten so the caller can
  // append the export manifest entry first and unshift its signed line as
  // export-entry.json before sealing the package (#398).
  entries: ArtifactAccumulator['entries']
  packageHash: string
  verificationResult: ExportVerificationResult
}

/**
 * The one read that decides ENCLOSURE for every non-Capture Exhibit and every
 * Derived File this export encloses (#1156 round 5). It is not the only read
 * of those bytes: `verifyCaseDerivedFiles` hashes every chain-anchored Derived
 * File on every export, and `verifyExhibit` hashes committed Exhibits when the
 * audit trail is included, and a read failure there is interpreted too — as
 * the `missing` verification status the documents render. What is decided here
 * and nowhere else is whether the file is in the package.
 *
 * For those files every downstream fact — the zip entry, the evidence.json
 * row, the report's enclosure sentence, the certification's counts — is
 * derived from the outcome recorded here, and assembly consumes these buffers
 * rather than reading again. Splitting the decision across an `existsSync`
 * probe at classification and a read at assembly is what let report.html name
 * a path the zip did not contain: the probe said the file was there, the read
 * failed, and the silent `catch` between them reached only the assembly half.
 * A file that exists and cannot be read (a lock, a permission, a disconnected
 * share) is the state that produced it, and a wide window between the two
 * reads produced it without any lock at all. For these files a read failure is
 * a classification, not an error: the file is disclosed as not enclosed, and
 * the export carries on.
 *
 * A CAPTURE'S OWN ARTIFACTS ARE NOT READ HERE. Its page archive and screenshot
 * keep the path they had before #1156: probed with `existsSync` in
 * `buildPackagedPaths` and read separately in the zip builders, where
 * `CaptureStore.readArtifact` does not catch. A Capture whose MHTML or
 * screenshot is present but unreadable therefore fails the whole export with
 * that error and writes no package — loud, and never a package narrowed
 * without saying so, which is why this ticket leaves it rather than widening
 * its scope into the Capture path. The PR's findings list carries it as a
 * follow-up candidate.
 */
function createPackageReader(): {
  read: (storedPath: string | null) => Buffer | null
  bytesFor: (storedPath: string) => Buffer
} {
  const cache = new Map<string, Buffer>()
  return {
    read: (storedPath) => {
      if (!storedPath) return null
      const cached = cache.get(storedPath)
      if (cached) return cached
      let bytes: Buffer
      try {
        bytes = readFileSync(defaultCaptureStore.resolveAbsolute(storedPath))
      } catch {
        return null
      }
      cache.set(storedPath, bytes)
      return bytes
    },
    // Assembly's view of the same read. A packaged path is recorded only when
    // the read above succeeded, so a miss here is a broken invariant between
    // classification and assembly — exactly the drift this replaced — and it
    // throws rather than quietly enclosing nothing.
    bytesFor: (storedPath) => {
      const bytes = cache.get(storedPath)
      if (!bytes) throw new Error(`export: no bytes were read for ${storedPath}`)
      return bytes
    }
  }
}

type PackageReader = ReturnType<typeof createPackageReader>

/**
 * Encloses an Exhibit's Derived Files and returns their index rows (X31).
 *
 * The index lists exactly what the package encloses, and nothing else — it
 * writes a row only where `packagedPath` is set, which is set only where the
 * export's single read of the bytes succeeded. A file no entry names is
 * neither packaged nor listed, so the index cannot attribute to an Exhibit a
 * file nothing in the chain says was computed from it; a file that IS anchored
 * but whose bytes could not be read is not listed either, because a row with a
 * null path is a row the two verifiers read differently — the standalone one
 * calls it a fabricated row the manifest does not anchor at that path, while
 * verify.sh, which never reads the index, says nothing. Both still FAIL the
 * package through the chain-side check that the anchored file is absent, which
 * is the finding that matters and the one they agree on.
 *
 * Every omission is disclosed by whatever each class carries: report.html and
 * the certification's contents line in an Evidence Package, the counts in
 * WORKING-COPY.json in a Working Copy.
 */
function addDerivedFiles(
  files: ExportDerivedFile[],
  add: ArtifactAccumulator['add'],
  reader: PackageReader
): Array<{ derivation: string; contentHash: string; path: string }> {
  const rows: Array<{ derivation: string; contentHash: string; path: string }> = []
  for (const file of files) {
    // `packagedPath` IS the read's outcome, so this encloses exactly what the
    // report says it encloses and the index lists exactly that.
    if (!file.packagedPath) continue
    add(file.packagedPath, reader.bytesFor(file.storedPath))
    rows.push({
      derivation: file.derivation,
      contentHash: file.contentHash,
      path: file.packagedPath
    })
  }
  return rows
}

/** One committed non-Capture Exhibit as evidence.json lists it. */
function describeExhibit(exhibit: ExportFileExhibit, enclosed: boolean) {
  return {
    id: exhibit.id,
    kind: exhibit.kind,
    origin: exhibit.origin,
    exhibitNumber: exhibit.exhibitNumber,
    name: exhibit.name,
    contentHash: exhibit.contentHash,
    path: enclosed ? exhibit.packagedPath : null,
    sizeBytes: exhibit.sizeBytes,
    committedAt: exhibit.committedAt,
    manifestIndex: exhibit.manifestIndex,
    trustedTime: exhibit.trustedTime.trustedTime,
    tsaName: exhibit.trustedTime.tsaName,
    stampedAt: exhibit.trustedTime.stampedAt,
    timestampTokenPaths: exhibit.timestampTokenPath ? [exhibit.timestampTokenPath] : []
  }
}

/**
 * Which key signed which entries of the bundled chain (#1657), by the rule the
 * package verifier applies (the KEY RULE in `@shared/verify/manifestChain`) and
 * verify.sh step 2 repeats: an entry verifies under the key the first `import`
 * entry after it carries, or under this installation's key when none follows.
 */
function signingKeyRanges(
  entries: Record<string, unknown>[],
  publicKeyPem: string
): SigningKeyRange[] {
  const fingerprint = (pem: string): string => sha256(Buffer.from(pem, 'utf-8'))
  const ranges: SigningKeyRange[] = []
  let fromIndex = 0
  entries.forEach(({ type, sourcePublicKeyPem }, position) => {
    if (type !== 'import' || typeof sourcePublicKeyPem !== 'string') return
    if (position > fromIndex) {
      ranges.push({
        fromIndex,
        toIndex: position - 1,
        fingerprint: fingerprint(sourcePublicKeyPem),
        carriedByImportAt: position
      })
    }
    fromIndex = position
  })
  if (entries.length > fromIndex) {
    ranges.push({
      fromIndex,
      toIndex: entries.length - 1,
      fingerprint: fingerprint(publicKeyPem),
      carriedByImportAt: null
    })
  }
  return ranges
}

function buildEvidenceZip(
  caseId: string,
  data: ExportData,
  reportHtml: string,
  manifest: ManifestSnapshot,
  sharedCase: SharedCaseSnapshot,
  meta: PackageMeta,
  reader: PackageReader
): EvidenceZipResult {
  const { entries, artifacts, add } = createArtifactAccumulator()

  const manifestJsonl = manifest.jsonl
  const timestampEntries = caseEntriesOf(manifest, sharedCase).filter(isTimestampEntry)
  const latestManifestEntry = manifest.head

  // Same path rule the report was rendered against, over the same Exhibits in
  // the same order and under the same names — see buildTimestampTokenPaths.
  // `fileExhibits` already carry the chain's ids.
  const chainIdOf = (id: string): string => data.chainIdByCaptureId.get(id) ?? id
  const timestampPathsByHash = buildTimestampTokenPaths(
    tokenSubjects(data.captures, data.fileExhibits, chainIdOf),
    timestampEntries
  )
  const emittedTokenPaths = new Set<string>()
  // Certificate material is gathered from every token the manifest carries,
  // including one the admission rule below refuses to enclose: the bundle is
  // chain-building material for the authority rather than a claim about any
  // Exhibit, and narrowing it is not what #1108 ruled on.
  //
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
      // A malformed token contributes no certificate material to the TSA chain
      // bundle, and the admission rule below keeps it out of the package too.
    }
    // The same rule the paths were built under, applied per entry so the bytes
    // enclosed for a content hash are the bytes of the entry that satisfied it:
    // where a hash carries a rejected token as well as an accepted one, the
    // first entry naming that hash is not necessarily the accepted one.
    if (!stampFor(entry, entry.captureContentHash)) continue
    const path = timestampPathsByHash.get(entry.captureContentHash)
    if (path && !emittedTokenPaths.has(path)) {
      add(path, token)
      emittedTokenPaths.add(path)
    }
  }

  const publicKeyPem = getPublicKeyPem()

  add(PACKAGE_ROOT_FILES.manifest, manifestJsonl)
  // Every other member's chain and every lineage chain, byte-for-byte and
  // under the name it has in the Case directory: each verifies under its own
  // member's key, which the Owner's `member-add` entries carry.
  for (const chain of sharedCase.chains) add(chain.path, chain.jsonl)
  add(PACKAGE_ROOT_FILES.report, reportHtml)
  add(
    PACKAGE_ROOT_FILES.certification,
    buildCertification(
      {
        caseName: data.caseName,
        caseNumber: meta.caseNumber,
        isDemo: meta.isDemo,
        purposeOrAuthority: meta.purposeOrAuthority,
        manifestHead: data.manifestHead,
        signingKeyFingerprint: sha256(Buffer.from(publicKeyPem, 'utf-8')),
        signingKeyRanges: signingKeyRanges(manifest.entries, publicKeyPem),
        contents: {
          captureCount: data.captures.length,
          screenshotCount: data.screenshots.size,
          noteCount: meta.notes?.length ?? 0,
          ...exhibitKindCounts(data)
        },
        exportTimestamp: data.exportTimestamp,
        installationId: data.installationId,
        operatorName: data.operatorName,
        operatorRole: data.operatorRole,
        operatorOrganization: data.operatorOrganization,
        tsaUrl: data.tsaUrl,
        tsaEnabled: data.tsaEnabled,
        captures: data.captures,
        trustedTimeByCaptureId: data.trustedTimeByCaptureId,
        entrySignatureByCaptureId: data.entrySignatureByCaptureId,
        // The same single resolution the report renders, so the two documents
        // cannot report different states for one Exhibit (#492, #611).
        exhibits: data.fileExhibits.map((exhibit) => ({
          id: exhibit.id,
          kind: exhibit.kind,
          name: exhibit.name,
          exhibitNumber: exhibit.exhibitNumber,
          trustedTime: exhibit.trustedTime,
          entrySignature: exhibit.entrySignature
        })),
        sharedCase: data.sharedCase
      },
      resolveToolVersion()
    )
  )
  add(PACKAGE_ROOT_FILES.signingPublicKey, publicKeyPem)
  add(PACKAGE_ROOT_FILES.verifyRunbook, VERIFY_RUNBOOK)
  // The runbook's executable form (#584). Written through add() like every other
  // packaged document, so it lands in artifacts[] and in packageHash: a script
  // that verifies the package is worth no more than the package's own account of
  // it, and step 1 re-hashes it along with everything else.
  add(PACKAGE_ROOT_FILES.verifyScript, VERIFY_SCRIPT)
  // Operator notes as package content (#399): written through add() so the
  // file participates in packageHash and the artifact index like every other
  // packaged document. Written even when the case has none — "0 notes existed"
  // must stay distinguishable from "notes were excluded" (the Court exhibit).
  if (meta.notes !== null) {
    add(
      PACKAGE_ROOT_FILES.notes,
      buildNotesMarkdown(data.caseName, data.exportTimestamp, meta.notes, data.selectionScope)
    )
  }

  // Anchor and chain-building material ship as separate files (#579): a single
  // bundle that mixes the token-carried cross-signed root with the self-signed
  // one makes `openssl ts -verify -CAfile` resolve the wrong root and fail, and
  // leaves ambiguous which certificate the verifier is being asked to trust.
  const tsaTrust = getTsaTrustBundle(data.tsaUrl)
  add(PACKAGE_ROOT_FILES.tsaIntermediates, [...timestampTokenCertPems].join('\n') + '\n')
  if (tsaTrust.bundled) add(PACKAGE_ROOT_FILES.tsaRoot, tsaTrust.pem)

  const capturesMissingContent: string[] = []
  const emittedScreenshotPaths = new Set<string>()
  const captureEvidence = data.captures.map((capture) => {
    const id = chainIdOf(capture.id)
    const mhtml = defaultCaptureStore.readArtifact(capture.caseId, capture.id, 'mhtml')
    const mhtmlPath = capturePagePath(id)
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
      screenshotPath = packagedScreenshotPath(screenshotSha256)
      // Content-addressed: identical screenshot bytes across captures resolve to
      // the same path. Emit the zip entry once; multiple capture records may
      // still reference it. createStoredZip does not dedupe entry names.
      if (!emittedScreenshotPaths.has(screenshotPath)) {
        add(screenshotPath, screenshot)
        emittedScreenshotPaths.add(screenshotPath)
      }
    }

    return {
      id,
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
      timestampTokenPaths: packagedTimestampTokenPaths(timestampPathsByHash, capture.hash)
    }
  })

  // Every committed Exhibit of every other kind, under the kind subdirectory
  // the Case store uses and keyed by Exhibit id with the stored extension (D1),
  // with its Derived Files beside it. The paths come from the same helpers the
  // standalone verifier derives them with, so a file this writes is a file the
  // verifier looks for.
  const exhibitsMissingContent: string[] = []
  const exhibitEvidence = data.fileExhibits.map((exhibit) => {
    if (exhibit.packagedPath && exhibit.storedPath) {
      add(exhibit.packagedPath, reader.bytesFor(exhibit.storedPath))
    } else {
      exhibitsMissingContent.push(exhibit.id)
    }
    return {
      ...describeExhibit(exhibit, exhibit.packagedPath !== null),
      derivedFiles: addDerivedFiles(exhibit.derivedFiles, add, reader)
    }
  })

  // A Capture is an Exhibit too (X35), so it appears in the same list — the
  // index a reader consults to see what the package holds is one list over
  // every kind, not one per kind. Its bytes were enclosed by the capture pass
  // above; only its Derived Files are added here.
  const captureExhibits = data.captures.map((capture) => {
    const derived = data.derivedFilesByCaptureId.get(capture.id) ?? []
    // Total over the captures by construction: `insertCapture` writes the
    // Exhibit row in the same transaction, and the v34 migration numbered every
    // Capture that predates it.
    const number = data.exhibitNumberByCaptureId.get(capture.id) ?? 0
    const id = chainIdOf(capture.id)
    return {
      id,
      kind: 'capture',
      origin: capture.method ?? 'extension',
      exhibitNumber: number,
      name: capture.title,
      contentHash: capture.hash,
      path: capturesMissingContent.includes(capture.id) ? null : capturePagePath(id),
      derivedFiles: addDerivedFiles(derived, add, reader)
    }
  })

  const evidence = {
    // 2: the additive `exhibits` list below, and the package's era (#853).
    // Every evidence-class zip is sealed with export-entry.json, so this
    // version is also the index's statement that one was written — which is
    // what lets the verifier read its absence as a stripped file.
    schemaVersion: EVIDENCE_INDEX_SCHEMA_VERSION,
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
      // Committed Exhibits of other kinds whose stored bytes could not be read
      // at export time, counted rather than left to be noticed by absence.
      missingContentExhibitCount: exhibitsMissingContent.length,
      missingContentExhibitIds: exhibitsMissingContent,
      // Captures the chain still claims but the package does not contain (#580).
      unreconciledChainCaptureCount: data.unreconciledChainCaptureIds.length,
      unreconciledChainCaptureIds: data.unreconciledChainCaptureIds,
      tsaTrustAnchorNote: tsaTrust.note ?? null
    },
    verificationMaterials: {
      manifestPath: PACKAGE_ROOT_FILES.manifest,
      manifestHeadIndex: latestManifestEntry?.index ?? null,
      manifestHeadHash: latestManifestEntry?.entryHash ?? null,
      // Informational pointer only: the file is unshifted by generateReport
      // after this index is built, and the verifier reads it by its fixed name.
      exportEntryPath: PACKAGE_ROOT_FILES.exportEntry,
      signingPublicKeyPath: PACKAGE_ROOT_FILES.signingPublicKey,
      tsaRootPath: tsaTrust.bundled ? PACKAGE_ROOT_FILES.tsaRoot : null,
      tsaRootSha256: tsaTrust.rootSha256 ?? null,
      tsaIntermediatesPath: PACKAGE_ROOT_FILES.tsaIntermediates,
      tsaCaChainBundled: tsaTrust.bundled,
      reportPath: PACKAGE_ROOT_FILES.report
    },
    // Informational like every index field: the verifier re-derives the roster
    // and the exclusions from the enclosed chains. Omitted for a Case never
    // shared or forked, so its index is unchanged.
    ...(data.sharedCase
      ? { sharedCase: { manifestSchemaVersion: SHARED_CASE_SCHEMA_VERSION, ...data.sharedCase } }
      : {}),
    captures: captureEvidence,
    // Every Exhibit the package holds, of every kind, in Exhibit Number order
    // (ADR-0023). Additive: `captures` above keeps its rows and its shape.
    exhibits: [...captureExhibits, ...exhibitEvidence].sort(
      (a, b) => a.exhibitNumber - b.exhibitNumber
    ),
    artifacts
  }

  entries.unshift({
    name: PACKAGE_ROOT_FILES.evidenceIndex,
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
  meta: PackageMeta,
  reader: PackageReader
): EvidenceZipResult {
  const { entries, artifacts, add } = createArtifactAccumulator()
  // Named as the Evidence Package names them — see resolveChainNames.
  const chainIdOf = (id: string): string => data.chainIdByCaptureId.get(id) ?? id

  const captureIndex = data.captures.map((capture) => {
    const id = chainIdOf(capture.id)
    const mhtml = defaultCaptureStore.readArtifact(capture.caseId, capture.id, 'mhtml')
    const pagePath = capturePagePath(id)
    if (mhtml) add(pagePath, mhtml)

    // The operator-facing copy — annotation-burned when the option says so —
    // keyed by capture id. Content addressing and ingest-hash matching are
    // evidence-package concepts; this class ships what the operator works with.
    // A Working Copy is not a verifiable object (ADR-0010) and has no reader
    // to agree with, so its id-addressed screenshot is not in the Package
    // Layout module; see docs/plans/2026-09-22-evidence-package-layout.md.
    const screenshotBase64 = data.screenshots.get(capture.id)
    const screenshotPath = screenshotBase64 ? `screenshots/${id}.png` : null // layout-exempt: Working Copy
    if (screenshotBase64 && screenshotPath) {
      add(screenshotPath, Buffer.from(screenshotBase64, 'base64'))
    }

    return {
      id,
      title: capture.title,
      url: capture.url,
      capturedAt: capture.timestamp,
      pagePath: mhtml ? pagePath : null,
      screenshotPath,
      derivedFiles: addDerivedFiles(data.derivedFilesByCaptureId.get(capture.id) ?? [], add, reader)
    }
  })

  // The same committed Exhibits of every other kind the Evidence Package ships
  // (#1156), in the same layout and with the same Derived Files beside them.
  // What the Working Copy still does NOT carry is the material that makes a
  // package verifiable — no manifest, no signed entry, no certification — so
  // the class split is untouched: this is the operator's working set of the
  // Case's files, not a second evidentiary object.
  const exhibitIndex = data.fileExhibits.map((exhibit) => {
    if (exhibit.packagedPath && exhibit.storedPath) {
      add(exhibit.packagedPath, reader.bytesFor(exhibit.storedPath))
    }
    return {
      id: exhibit.id,
      kind: exhibit.kind,
      origin: exhibit.origin,
      exhibitNumber: exhibit.exhibitNumber,
      name: exhibit.name,
      committedAt: exhibit.committedAt,
      path: exhibit.packagedPath,
      derivedFiles: addDerivedFiles(exhibit.derivedFiles, add, reader)
    }
  })

  if (meta.notes !== null) {
    add(
      PACKAGE_ROOT_FILES.notes,
      buildNotesMarkdown(data.caseName, data.exportTimestamp, meta.notes, data.selectionScope)
    )
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
      noteCount: meta.notes?.length ?? 0,
      ...exhibitKindCounts(data)
    },
    captures: captureIndex,
    exhibits: exhibitIndex,
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
 * What a selection export's notes.md says about its own scope (#985). The
 * fields are a subset of the report's `selectionScope` and are read from that
 * same object, so the two documents cannot state different numbers. They do
 * not state them in the same places: report.html mentions notes.md only when
 * the scope actually left a note out, matching how it treats the excluded
 * Exhibit count, while this header states the scope on every selection export
 * — a Working Copy has no report, so "none left out" has to be legible here.
 */
export interface NotesSelectionScope {
  selectedCaptureCount: number
  caseCaptureCount: number
  omittedNoteCount: number
}

/**
 * Operator notes rendered as one Markdown document (#399). Notes are operator
 * work product: the header says so, and says what integrity cover the file has
 * (packageHash + the artifact index) and has not (the capture manifest chain).
 *
 * On a selection export the header also says that the file is a subset and how
 * many of the Case's notes the scope left out (#985). The Working Copy carries
 * no report and no certification, so for that class this header is the only
 * place a recipient can read the omission — which is why the statement lives
 * here and not only in report.html.
 */
export function buildNotesMarkdown(
  caseName: string,
  exportedAt: string,
  notes: Note[],
  scope?: NotesSelectionScope | null
): string {
  const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()
  const head = [
    `# Operator notes — ${oneLine(caseName)}`,
    '',
    `Exported ${exportedAt}. ${notes.length} note${notes.length === 1 ? '' : 's'}.`,
    '',
    'Operator work product: these notes were written by the operator in Birdbrain. They are',
    'not captured page content and are not anchored in the capture manifest chain.',
    ...(scope
      ? [
          '',
          `Selection-scoped export: this export covers ${scope.selectedCaptureCount} of the ` +
            `case's ${scope.caseCaptureCount} captures, and this`,
          `file holds the notes attached to them. ${scope.omittedNoteCount} ` +
            `note${scope.omittedNoteCount === 1 ? '' : 's'} in the case ` +
            `${scope.omittedNoteCount === 1 ? 'is' : 'are'} not included`,
          'here: a note attached to no capture, or to a capture outside the selection, is left',
          'behind by the scope, and so is a note attached to a selected capture that also points',
          "at another of the case's captures this export leaves out."
        ]
      : [])
  ]
  const sections = notes.map((note) => {
    const facts = [
      `- Created: ${note.createdAt}`,
      `- Updated: ${note.updatedAt}`,
      ...(note.captureId ? [`- Attached to capture: ${note.captureId}`] : []),
      // The anchor is a second, independent pointer at a Capture, and the
      // selection scope reads it to withhold (#985), so a recipient has to be
      // able to see it: on a scoped package it is either a second selected
      // Capture or a Capture the Case no longer holds, and in both cases the
      // reader can only reconcile the note against the header by reading it.
      // Printed only when it names a Capture the line above does not.
      ...(note.anchor && note.anchor.captureId !== note.captureId
        ? [`- Anchored to capture: ${note.anchor.captureId}`]
        : []),
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
 * Maps an Exhibit content hash to the single timestamp-token path the package
 * uses for it. Exhibits that share a content hash share one token file, named
 * after the first such Exhibit — so a per-Exhibit path would be wrong for the
 * rest. Defined once here and consumed by both the packager and the report, so
 * the file the zip writes and the path the documents cite are one decision.
 *
 * That agreement was only ever packager-versus-report. Admission is now the
 * resolver's own verdict too (#1108): an entry contributes a path only where
 * `stampFor` — the function the trusted-time axis is resolved with — accepts
 * it, which it does not for a token that fails to parse or whose message
 * imprint attests other content. Before this, such a token was enclosed and
 * cited beside an exhibit the same documents called unstamped.
 */
function buildTimestampTokenPaths(
  subjects: TokenSubject[],
  timestampEntries: ManifestTimestampEntry[]
): Map<string, string> {
  const byHash = new Map<string, string>()
  for (const entry of timestampEntries) {
    if (!stampFor(entry, entry.captureContentHash)) continue
    for (const subject of subjects) {
      if (subject.contentHash !== entry.captureContentHash) continue
      if (byHash.has(subject.contentHash)) break
      byHash.set(subject.contentHash, timestampTokenPath(subject.id))
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
  tokenPaths: Map<string, string>,
  screenshotDigests: Map<string, string>,
  annotatedCaptureIds: Set<string>
): Map<string, PackagedArtifacts> {
  const paths = new Map<string, PackagedArtifacts>()
  const isPackage = options.format === 'zip'

  for (const capture of data.captures) {
    // The CAPTURE path, which `createPackageReader` deliberately does not
    // cover: `existsSync` here, and a separate `readArtifact` in the zip
    // builders. It predates #1156 and stays as it was, so an archive that can
    // be large is not held in memory from classification to assembly.
    //
    // A Capture artifact that is present but unreadable when the export
    // classifies it fails the whole export with that error and writes no
    // package (test: refuses the export when a capture artifact is present but
    // unreadable). An artifact that disappears between classification and
    // assembly is the pre-existing Capture path: the package is written with
    // the report naming a file the zip lacks, and both verifiers FAIL it on
    // the missing artifact (evidencePackage.ts:505). The reader closes that
    // window for non-Capture Exhibits and Derived Files only; closing it for
    // Captures is the follow-up named in the findings list.
    const { abs } = defaultCaptureStore.artifactPaths(capture.caseId, capture.id, 'mhtml')
    const screenshotDigest = screenshotDigests.get(capture.id)
    const pageArchive = capturePagePath(data.chainIdByCaptureId.get(capture.id) ?? capture.id)
    paths.set(capture.id, {
      pageArchive: isPackage && existsSync(abs) ? pageArchive : null,
      screenshot: isPackage && screenshotDigest ? packagedScreenshotPath(screenshotDigest) : null,
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
