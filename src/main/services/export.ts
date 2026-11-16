import { readFileSync, writeFileSync } from 'fs'
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
  MIN_READER_SCHEMA_VERSION,
  packageHash as computePackageHash,
  readEntries,
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
  verifyManifestChainText
} from '@shared/verify'
import type { SharedCaseMember } from '@shared/verify'
import { PACKAGE_ROOT_FILES } from '../../packages/evidence-package-layout/index'
import {
  decidePackageContents,
  readOnce,
  type DerivedFileContents,
  type PackageByteSource,
  type PackageContents
} from '../../packages/evidence-package-contents/index'
import type { TrustedTimeResult } from '@shared/verify'
import {
  buildCertification,
  type CertificationCaptureInput,
  type SigningKeyRange
} from '@main/services/certification'
import { resolveToolVersion } from '@main/services/toolVersion'
import {
  buildHtmlReport,
  resolveCaptureEngineFacts,
  resolveLinkSources
} from '@main/services/reportHtml'
import type {
  CaptureEngineEntry,
  EntrySignatureStatus,
  ExportDerivedFile,
  ExportFileExhibit,
  ExportSharedCase,
  ExportSharedCaseMember,
  LinkSourceEntry,
  ReportData
} from '@main/services/reportHtml'
import { buildVerifyRunbook } from '@main/services/verifyRunbook'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { EVIDENCE_INDEX_SCHEMA_VERSION, WORKING_COPY_MARKER_FILENAME } from '@shared/schemas'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { extractNoteMentions } from '@shared/noteDoc'
import type {
  Capture,
  DerivedFile,
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

/**
 * The capture engine's fields per Capture, from the snapshot the package is
 * built from. The local chain is verified over that same read, as
 * readCaptureEntryAt does, so no earlier verification of a separate read
 * vouches for values written in between. Another member's entries are the
 * accepted entries of a chain the Shared Case walk verified (caseEntriesOf).
 */
export function resolveExportCaptureEngine(
  manifest: ManifestSnapshot,
  sharedCase: SharedCaseSnapshot
): Map<string, CaptureEngineEntry> {
  const localVerified = verifyManifestChainText(manifest.jsonl.toString('utf-8'), {
    publicKeyPem: getPublicKeyPem()
  }).valid
  const remote = caseEntriesOf(manifest, sharedCase).slice(manifest.entries.length)
  return new Map([
    ...resolveCaptureEngineFacts(manifest.entries, localVerified),
    ...resolveCaptureEngineFacts(remote, true)
  ])
}

/**
 * A link Capture's source per Capture (ADR-0040), from the same snapshot and over the same
 * chain verdicts as resolveExportCaptureEngine, so a row edit never reaches the report.
 */
export function resolveExportLinkSources(
  manifest: ManifestSnapshot,
  sharedCase: SharedCaseSnapshot
): Map<string, LinkSourceEntry> {
  const localVerified = verifyManifestChainText(manifest.jsonl.toString('utf-8'), {
    publicKeyPem: getPublicKeyPem()
  }).valid
  const remote = caseEntriesOf(manifest, sharedCase).slice(manifest.entries.length)
  return new Map([
    ...resolveLinkSources(manifest.entries, localVerified),
    ...resolveLinkSources(remote, true)
  ])
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
 * Pairs each capture with its trusted-time resolution for certification.html,
 * which accepts no capture without one (#1110). resolveExportTrustedTime sets an
 * entry for every capture it is given, and generateReport gives it the list it
 * packages, so an absent entry is a broken invariant: refuse rather than
 * certify a state nothing resolved.
 */
export function pairCapturesWithTrustedTime(
  captures: Capture[],
  byCaptureId: Map<string, TrustedTimeResult>
): CertificationCaptureInput[] {
  return captures.map((capture) => {
    const trustedTime = byCaptureId.get(capture.id)
    if (trustedTime === undefined) {
      throw new Error(`certification: no trusted time resolved for capture ${capture.id}`)
    }
    return { capture, trustedTime }
  })
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
 *
 * Every capture's row id is a key. A capture its own id names no entry for
 * takes the status of the entry under its chain name (`chainIdOf`, see
 * resolveChainNames), so a capture an import renamed reads its inherited entry
 * (#1472).
 */
export function resolveEntrySignatures(
  captures: Capture[],
  entries: Record<string, unknown>[],
  chainIdOf: (id: string) => string
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
    if (byCaptureId.has(capture.id)) continue
    byCaptureId.set(capture.id, byCaptureId.get(chainIdOf(capture.id)) ?? 'no-entry')
  }

  return byCaptureId
}

/**
 * The manifest schema a verifier must read to verify the package (ADR-0023):
 * the highest `schemaVersion` among the entries it encloses. Every member and
 * lineage chain is read from the bytes the package ships, not from the entries
 * the Shared Case walk accepted: the package ships every line, accepted or not.
 * A value that is not a whole number names no version. The floor is the export
 * entry's stamp: `export-entry.json` is appended after the package is sealed,
 * so its line cannot be read here.
 */
export function resolveRequiredReaderSchemaVersion(
  manifest: ManifestSnapshot,
  sharedCase: SharedCaseSnapshot
): number {
  const chains = sharedCase.chains.map(({ jsonl }) => readEntries(jsonl.toString('utf-8')))
  return [manifest.entries, ...chains]
    .flat()
    .reduce<number>(
      (required, { schemaVersion }) =>
        typeof schemaVersion === 'number' && Number.isInteger(schemaVersion)
          ? Math.max(required, schemaVersion)
          : required,
      MIN_READER_SCHEMA_VERSION.export
    )
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
  const index = buildTrustedTimeIndex(join(getStorageRoot(), caseId), listExhibits(caseId))
  return resolveExportTrustedTime(captures, index).preflight
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
 * rather than treated as outside the selection. `anchor_json` and `body_doc`
 * are plain TEXT that keep the deleted id, so a stale one is a dangling
 * pointer, not a statement about the selection. `notes.capture_id` is
 * cleared when its Capture goes, except in a Shared Case, where it keeps the
 * deleted id as signed (#1877) and holds the note back as outside the
 * selection, as a NULL one does.
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
    captureEngineByCaptureId: new Map(),
    linkSourceByCaptureId: new Map(),
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

  // Every file this export encloses is read through this, once. The report
  // reproduces a screenshot from the same read the package encloses it from.
  const source = readOnce(caseDirectoryByteSource())
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
      const screenshotBuffer = source.captureFile(cap, 'png')
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
  // The one decision of what this export encloses, read by the report,
  // evidence.json, the Certification and the zip builders. An Evidence Package
  // encloses every screenshot a signed capture entry anchors, whatever
  // include.screenshots says (#1986); the option still governs the image the
  // report reproduces, which comes from data.screenshots, filled only when it
  // is on.
  const contents = decidePackageContents({
    form:
      options.format !== 'zip'
        ? { kind: 'report' }
        : workingCopy
          ? {
              kind: 'working-copy',
              pageArchives: options.include.captures,
              // The copy the report would reproduce: annotation-burned when
              // the option says so.
              operatorScreenshots: new Map(
                [...data.screenshots].map(([id, base64]) => [id, Buffer.from(base64, 'base64')])
              )
            }
          : { kind: 'evidence-package', screenshots: options.include.screenshots },
    entries: caseEntries,
    chainNames,
    captures,
    fileExhibits: scope.fileExhibits,
    derivedFiles: derivedByExhibitId,
    derivedVerifications,
    source
  })
  data.packagedPaths = new Map(
    captures.map((capture) => {
      const { pageArchive, screenshot, timestampTokenPath } = contents.ofCapture(capture.id)
      return [
        capture.id,
        {
          pageArchive: pageArchive?.path ?? null,
          screenshot: screenshot?.path ?? null,
          timestampToken: timestampTokenPath,
          // Recorded regardless of format: the exhibit reproduces the image
          // either way, so it must be able to label it with the digest of
          // what it shows.
          screenshotDigest: screenshotDigests.get(capture.id) ?? screenshot?.sha256 ?? null,
          // Not gated on the format either: burning happens whenever
          // annotations are set to 'burned', so a standalone HTML report
          // must disclose it just as loudly as a packaged one.
          imageAnnotated: annotatedCaptureIds.has(capture.id)
        }
      ]
    })
  )

  // Resolved from the snapshot above and nowhere else — see resolveExportTrustedTime.
  const trustedTimeByHash = buildTrustedTimeIndexFromEntries(caseEntries)
  const trustedTime = resolveExportTrustedTime(captures, trustedTimeByHash)
  data.preflight = trustedTime.preflight
  data.trustedTimeByCaptureId = trustedTime.byCaptureId
  data.entrySignatureByCaptureId = resolveEntrySignatures(captures, caseEntries, chainIdOf)
  data.captureEngineByCaptureId = resolveExportCaptureEngine(manifest, sharedCase)
  data.linkSourceByCaptureId = resolveExportLinkSources(manifest, sharedCase)
  data.fileExhibits = buildFileExhibitRecords(scope.fileExhibits, {
    verifications: exhibitVerifications,
    trustedTimeByHash,
    entrySignatures: resolveExhibitEntrySignatures(scope.fileExhibits, caseEntries, chainIdOf),
    chainNames,
    contents,
    cite
  })
  data.derivedFilesByCaptureId = new Map(
    captures.map((capture) => [
      capture.id,
      describeDerivedFiles(contents.ofCapture(capture.id).derivedFiles)
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
      notes: notes?.map((note) => noteNamedByChain(note, chainIdOf)) ?? null,
      deletedCaptureIds: new Set(
        (notes ?? []).flatMap(({ captureId }) =>
          captureId && captureRepo.getCapture(captureId) === undefined ? [captureId] : []
        )
      )
    }
    let zip: EvidenceZipResult
    if (workingCopy) {
      // No report, no certification: the Working Copy deliberately carries no
      // evidentiary documents at all (#399, ADR-0010).
      onProgress?.('Packaging working copy...', 90)
      zip = buildWorkingCopyZip(caseId, data, packageMeta, contents)
    } else {
      onProgress?.('Generating report...', 80)
      const html = buildHtmlReport(data, options)
      onProgress?.('Packaging evidence...', 90)
      zip = buildEvidenceZip(caseId, data, html, manifest, sharedCase, packageMeta, contents)
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
// `deletedCaptureIds` are the Captures those notes link that this database no
// longer holds: a note of a Shared Case keeps its link to a deleted Capture
// (#1877). A link to a live Capture of another Case is not among them.
interface PackageMeta {
  caseNumber?: string
  isDemo: boolean
  purposeOrAuthority?: string
  notes: Note[] | null
  deletedCaptureIds: ReadonlySet<string>
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
 * same way: the LAST `exhibit` entry for an id wins, an Exhibit its own id
 * names no entry for is looked up under its chain name, and an Exhibit with no
 * entry under either is stated as `no-entry` rather than left absent.
 */
export function resolveExhibitEntrySignatures(
  exhibits: Exhibit[],
  entries: Record<string, unknown>[],
  chainIdOf: (id: string) => string
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
    if (byExhibitId.has(exhibit.id)) continue
    byExhibitId.set(exhibit.id, byExhibitId.get(chainIdOf(exhibit.id)) ?? 'no-entry')
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
 * The Derived Files of one Exhibit as the documents report them (X17): the
 * row's facts beside what the contents decision found for it. A file no
 * manifest line names is not enclosed and not listed in evidence.json, and the
 * omission is disclosed by whatever each class carries: report.html and the
 * certification's contents line in an Evidence Package, the count in
 * WORKING-COPY.json in a Working Copy.
 */
function describeDerivedFiles(decided: readonly DerivedFileContents[]): ExportDerivedFile[] {
  return decided.map(({ file, verification, anchoring, enclosed }) => ({
    id: file.id,
    derivation: file.derivation,
    toolVersion: file.toolVersion,
    contentHash: file.contentHash,
    storedPath: file.path,
    anchoring,
    packagedPath: enclosed?.path ?? null,
    manifestIndex: file.manifestSeq,
    ...(verification !== undefined ? { verification } : {})
  }))
}

/** Everything the report, the certification and evidence.json say about one
 * committed non-Capture Exhibit, resolved once from the snapshot the package is
 * built from — the same discipline the capture axes follow (#492, #611). */
interface FileExhibitInputs {
  verifications: Map<string, ExhibitVerification>
  trustedTimeByHash: Map<string, TrustedTimeResult>
  entrySignatures: Map<string, EntrySignatureStatus>
  chainNames: Map<string, ChainName>
  contents: PackageContents
  cite: ExhibitCitationResolver
}

function buildFileExhibitRecords(
  exhibits: Exhibit[],
  inputs: FileExhibitInputs
): ExportFileExhibit[] {
  return exhibits.map((exhibit) => {
    const decided = inputs.contents.ofFileExhibit(exhibit.id)
    const verification = inputs.verifications.get(exhibit.id)
    // Named as its signed entry names it — see resolveChainNames. Everything
    // keyed above and below still reads the row's own id.
    const named = inputs.chainNames.get(exhibit.id)
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
      packagedPath: decided.enclosed?.path ?? null,
      timestampTokenPath: decided.timestampTokenPath,
      derivedFiles: describeDerivedFiles(decided.derivedFiles),
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
 * The Case directory as the byte source of an export (#1156 round 5). The
 * contents decision reads each file it encloses through this, once, and every
 * downstream fact about that file (the zip entry, the evidence.json row, the
 * report's enclosure sentence, the certification's counts) comes from what
 * that one read returned. A probe at classification and a second read at
 * assembly is what let report.html name a path the zip did not contain.
 *
 * It is not the only read of those bytes: `verifyCaseDerivedFiles` hashes
 * every chain-anchored Derived File on every export, and `verifyExhibit`
 * hashes committed Exhibits when the audit trail is included. A read failure
 * there is the `missing` verification status the documents render. What this
 * read decides, and nothing else does, is whether the file is in the package.
 *
 * A non-Capture Exhibit or a Derived File that exists and cannot be read (a
 * lock, a permission, a disconnected share) is not an error: it is disclosed
 * as not enclosed, and the export carries on.
 *
 * A Capture's own file is different. `CaptureStore.readArtifact` does not
 * catch, so one that is present but unreadable fails the whole export with
 * that error and writes no package: loud, and never a package narrowed
 * without saying so.
 */
function caseDirectoryByteSource(): PackageByteSource {
  return {
    captureFile: ({ caseId, id }, type) => defaultCaptureStore.readArtifact(caseId, id, type),
    storedFile: (storedPath) => {
      try {
        return readFileSync(defaultCaptureStore.resolveAbsolute(storedPath))
      } catch {
        return null
      }
    }
  }
}

/**
 * The index rows of an Exhibit's Derived Files (X31).
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
 */
function derivedFileRows(
  files: ExportDerivedFile[]
): Array<{ derivation: string; contentHash: string; path: string }> {
  return files.flatMap(({ derivation, contentHash, packagedPath }) =>
    packagedPath ? [{ derivation, contentHash, path: packagedPath }] : []
  )
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
  contents: PackageContents
): EvidenceZipResult {
  const { entries, artifacts, add } = createArtifactAccumulator()

  const manifestJsonl = manifest.jsonl
  const caseEntries = caseEntriesOf(manifest, sharedCase)
  const latestManifestEntry = manifest.head

  const chainIdOf = (id: string): string => data.chainIdByCaptureId.get(id) ?? id
  for (const token of contents.timestampTokens) add(token.path, token.bytes)
  // Certificate material is gathered from every token the manifest carries,
  // including one the contents decision refuses to enclose: the bundle is
  // chain-building material for the authority rather than a claim about any
  // Exhibit, and narrowing it is not what #1108 ruled on.
  //
  // Deduped by PEM block: every token of one authority carries the same
  // responder/intermediate certs, and a chain repeated per token is noise a
  // verifier has to wade through (#579).
  const timestampTokenCertPems = new Set<string>()
  for (const entry of caseEntries.filter(isTimestampEntry)) {
    if (typeof entry.tsaToken !== 'string') continue
    const token = Buffer.from(entry.tsaToken, 'base64')
    try {
      for (const pem of splitPemBlocks(extractTimestampTokenCertificatesPem(token))) {
        timestampTokenCertPems.add(pem)
      }
    } catch {
      // A malformed token contributes no certificate material to the TSA chain
      // bundle, and the contents decision keeps it out of the package too.
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
          captureCount: data.captures.filter(({ method }) => method !== 'duplicate').length,
          duplicateCount: data.captures.filter(({ method }) => method === 'duplicate').length,
          // Captures whose screenshot the package encloses, which with
          // screenshots off is more than the report reproduces.
          screenshotCount: data.captures.filter(({ id }) => data.packagedPaths.get(id)?.screenshot)
            .length,
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
        captures: pairCapturesWithTrustedTime(data.captures, data.trustedTimeByCaptureId),
        entrySignatureByCaptureId: data.entrySignatureByCaptureId,
        // Numbered Captures only, the rule report.html cites by.
        exhibitCitationByCaptureId: new Map(
          [...data.exhibitCitationByCaptureId].filter(
            ([id]) => (data.exhibitNumberByCaptureId.get(id) ?? 0) > 0
          )
        ),
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
  add(
    PACKAGE_ROOT_FILES.verifyRunbook,
    buildVerifyRunbook({
      requiredSchemaVersion: resolveRequiredReaderSchemaVersion(manifest, sharedCase),
      readerSchemaVersion: MANIFEST_SCHEMA_VERSION,
      // The version report.html names, so the two documents cannot disagree.
      appVersion: data.toolVersion
    })
  )
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
      buildNotesMarkdown(
        data.caseName,
        data.exportTimestamp,
        meta.notes,
        data.selectionScope,
        meta.deletedCaptureIds
      )
    )
  }

  // Anchor and chain-building material ship as separate files (#579): a single
  // bundle that mixes the token-carried cross-signed root with the self-signed
  // one makes `openssl ts -verify -CAfile` resolve the wrong root and fail, and
  // leaves ambiguous which certificate the verifier is being asked to trust.
  const tsaTrust = getTsaTrustBundle(data.tsaUrl)
  add(PACKAGE_ROOT_FILES.tsaIntermediates, [...timestampTokenCertPems].join('\n') + '\n')
  if (tsaTrust.bundled) add(PACKAGE_ROOT_FILES.tsaRoot, tsaTrust.pem)

  // Every enclosed file, in the order the contents decision gives: each
  // Capture's own files, then each other Exhibit's file and Derived Files
  // under the kind subdirectory the Case store uses, then each Capture's
  // Derived Files. The paths come from the same helpers the standalone
  // verifier derives them with, so a file this writes is a file the verifier
  // looks for.
  for (const file of contents.files) add(file.path, file.bytes)

  const capturesMissingContent = data.captures
    .filter(({ id }) => contents.ofCapture(id).pageArchive === null)
    .map(({ id }) => id)
  const captureEvidence = data.captures.map((capture) => {
    const id = chainIdOf(capture.id)
    const { pageArchive, screenshot, transactionRecord, pdf, timestampTokenPath } =
      contents.ofCapture(capture.id)
    const verification = data.verifications.find((v) => v.captureId === capture.id)
    // Same single resolution report.html and certification.html render, for the
    // same reason plus one this artifact has on its own: the package verifier
    // re-derives the axis from the bundled manifest.jsonl (evidencePackage.ts,
    // `chain.trustedTimes`), and that file IS this snapshot. Reading anything else
    // here — the verification's earlier manifest read, or the DB mirror — puts
    // evidence.json at odds with the manifest it ships beside.
    const trusted = data.trustedTimeByCaptureId.get(capture.id) ?? UNSTAMPED

    // The screenshot is content-addressed (#118): its file name is the sha256
    // of the raw on-disk bytes, not of the possibly-annotated report copy, so
    // the digest matches the screenshotHash anchored at ingest. The .txt
    // sidecar's integrity is bound by textSha256 below and the signed entry;
    // it is not re-bundled (its content already surfaces in report.html and
    // the MHTML page).
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
      mhtmlPath: pageArchive?.path ?? null,
      mhtmlSha256: pageArchive?.sha256 ?? null,
      screenshotPath: screenshot?.path ?? null,
      screenshotSha256: screenshot?.sha256 ?? null,
      transactionRecordPath: transactionRecord?.path ?? null,
      transactionRecordSha256: transactionRecord?.sha256 ?? null,
      pdfPath: pdf?.path ?? null,
      pdfSha256: pdf?.sha256 ?? null,
      textSha256: capture.textHash ?? null,
      // Corroboration-only TLS cert chain (#123, ADR-0002). NOT bound to the
      // captured transaction — the origin was re-contacted from the main process
      // AFTER storage, so this records the cert served at `refetchedAt`, which
      // differs from `capturedAt`. Surfaced labelled as corroboration; both
      // timestamps are present so a reviewer understands the interval.
      tlsCorroboration: capture.tlsCertChain ?? null,
      // evidence.json keeps this as a list; an Exhibit has at most one token path.
      timestampTokenPaths: timestampTokenPath ? [timestampTokenPath] : []
    }
  })

  // Every committed Exhibit of every other kind, keyed by Exhibit id with the
  // stored extension (D1), with its Derived Files beside it.
  const exhibitsMissingContent = data.fileExhibits
    .filter(({ packagedPath }) => !packagedPath)
    .map(({ id }) => id)
  const exhibitEvidence = data.fileExhibits.map((exhibit) => ({
    ...describeExhibit(exhibit, exhibit.packagedPath !== null),
    derivedFiles: derivedFileRows(exhibit.derivedFiles)
  }))

  // A Capture is an Exhibit too (X35), so it appears in the same list — the
  // index a reader consults to see what the package holds is one list over
  // every kind, not one per kind.
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
      path: contents.ofCapture(capture.id).pageArchive?.path ?? null,
      derivedFiles: derivedFileRows(derived)
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
 * class — nothing else. Unlike the Evidence Package's, its page archives ship
 * only when include.captures is set (#844). No manifest.jsonl, no report, no
 * certification, no signing key, no evidence.json, no VERIFY.md and no TSA
 * material: every one of those is evidentiary-shaped, and shipping any of them
 * would blur the two classes back together.
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
  contents: PackageContents
): EvidenceZipResult {
  const { entries, artifacts, add } = createArtifactAccumulator()
  // Named as the Evidence Package names them — see resolveChainNames.
  const chainIdOf = (id: string): string => data.chainIdByCaptureId.get(id) ?? id

  // Every enclosed file, in the order the contents decision gives: each
  // Capture's page archive, operator-facing screenshot and Derived Files, then
  // each other Exhibit's file and Derived Files.
  for (const file of contents.files) add(file.path, file.bytes)

  const captureIndex = data.captures.map((capture) => {
    const { pageArchive, screenshot } = contents.ofCapture(capture.id)
    return {
      id: chainIdOf(capture.id),
      title: capture.title,
      url: capture.url,
      capturedAt: capture.timestamp,
      pagePath: pageArchive?.path ?? null,
      screenshotPath: screenshot?.path ?? null,
      derivedFiles: derivedFileRows(data.derivedFilesByCaptureId.get(capture.id) ?? [])
    }
  })

  // The same committed Exhibits of every other kind the Evidence Package ships
  // (#1156), in the same layout and with the same Derived Files beside them.
  // What the Working Copy still does NOT carry is the material that makes a
  // package verifiable — no manifest, no signed entry, no certification — so
  // the class split is untouched: this is the operator's working set of the
  // Case's files, not a second evidentiary object.
  const exhibitIndex = data.fileExhibits.map((exhibit) => ({
    id: exhibit.id,
    kind: exhibit.kind,
    origin: exhibit.origin,
    exhibitNumber: exhibit.exhibitNumber,
    name: exhibit.name,
    committedAt: exhibit.committedAt,
    path: exhibit.packagedPath,
    derivedFiles: derivedFileRows(exhibit.derivedFiles)
  }))

  if (meta.notes !== null) {
    add(
      PACKAGE_ROOT_FILES.notes,
      buildNotesMarkdown(
        data.caseName,
        data.exportTimestamp,
        meta.notes,
        data.selectionScope,
        meta.deletedCaptureIds
      )
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
  scope?: NotesSelectionScope | null,
  deletedCaptureIds?: ReadonlySet<string>
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
      // A note in a Shared Case keeps its link to a deleted Capture (#1877),
      // which the package does not carry; the line says so, as the screens do.
      ...(note.captureId
        ? [
            `- Attached to capture: ${note.captureId}` +
              (deletedCaptureIds?.has(note.captureId)
                ? ' (deleted capture, not in this export)'
                : '')
          ]
        : []),
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
