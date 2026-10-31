import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync
} from 'fs'
import { unlink } from 'fs/promises'
import { createHash, randomUUID } from 'crypto'
import { dirname, join } from 'path'
import {
  withTransaction,
  hasRowWithId,
  ID_PROBE_TABLES,
  type ImportCtx
} from '@main/services/db/core'
import * as caseRepo from '@main/services/db/caseRepo'
import { collectCaseMembersForCase } from '@main/services/db/caseMemberRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import * as exhibitRepo from '@main/services/db/exhibitRepo'
import * as stagingRepo from '@main/services/db/stagingRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as waybackRefRepo from '@main/services/db/waybackRefRepo'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import * as subjectRepo from '@main/services/db/investigationSubjectRepo'
import * as decisionRepo from '@main/services/db/investigationDecisionRepo'
import * as markRepo from '@main/services/db/exhibitMarkRepo'
import * as runRepo from '@main/services/db/investigationRunRepo'
import { insertDerivedFile } from '@main/services/db/derivedFileRepo'
import {
  collectAnnotationsForCase,
  collectAnnotationPinsForCase,
  importAnnotationRows,
  importAnnotationPinRows
} from '@main/services/annotations'
import { getStorageRoot } from '@main/services/storage'
import {
  CAPTURE_ARTIFACT_TYPES,
  defaultCaptureStore,
  EXHIBIT_KIND_SUBDIRECTORIES,
  parseArtifactFilename,
  splitArtifactFilename,
  STAGING_SUBDIRECTORY
} from '@main/services/captureStore'
import { getSettings } from '@main/services/settings'
import { getInstallationId } from '@main/services/installationId'
import { getPublicKeyPem } from '@main/services/signingKey'
import { safeCasePath } from '@main/services/sharing/blobAcceptance'
import {
  appendManifestEntry,
  createArtifactAccumulator,
  initManifest,
  isSharedCase,
  packageHash as computePackageHash,
  readChainFileSnapshots,
  readEntries,
  readManifestSnapshot,
  sharedCaseChains,
  verifyManifestChainText
} from '@main/services/manifest'
import type {
  ChainFileSnapshot,
  ChainVerifyResult,
  PackagedArtifact
} from '@main/services/manifest'
import { createStoredZip } from '@main/services/zip'
import { readStoredZip } from '@main/services/zipRead'
import {
  canonicalStringify,
  describeUnsupportedEntry,
  verifySharedCaseReplica
} from '@shared/verify'
import type { SharedCaseMember, SharedCaseVerifyResult } from '@shared/verify'
import {
  inCasePath,
  lineageChainPath,
  parseChainPath
} from '../../packages/evidence-package-layout/index'
import { resolveToolVersion } from '@main/services/toolVersion'
import {
  carriedIdMapName,
  composeIdMaps,
  isIdMapDigest,
  parseIdMap,
  renamesOntoSignedId
} from '@main/services/importIdMaps'
import {
  IMPORT_ID_MAP_FILENAME,
  IMPORT_ID_MAPS_DIRECTORY,
  MANIFEST_FILENAME
} from '@shared/constants'
import { ManifestEntrySchema, type ManifestEntry } from '@shared/schemas'
import type {
  ArchiveInspectReport,
  ArchiveVerificationResult,
  CaseArchiveCounts
} from '@shared/types'

// 14 since link Capture provenance (ADR-0040, schema v44): data.json's
// captures carry `linked_from_capture_id`, `linked_from_content_hash` and
// `link_href`, and the import remaps `linked_from_capture_id`. A Birdbrain from
// before them drops the three columns without an error, so a link Capture
// loses the source the viewer and report show. The gate refuses instead.
// 13 since the capture engine's columns and files (#1907 and #1925, schema
// v43): data.json's captures carry `transaction_record_hash`, `pdf_hash`,
// `inventory`, `scroll_to_load`, `bound_tls` and `bound_tls_absent`, and the
// zip carries a Capture's Transaction Record as `files/<id>.warc.gz` and its
// PDF as `files/<id>.pdf`. A Birdbrain from before them drops the six columns
// without an error, and splits `<id>.warc.gz` at its last dot, so a Capture
// whose id the import remaps keeps its Transaction Record under the source id.
// The gate refuses instead.
// 12 since id maps travel (#1017): the zip carries the id map of every import
// on the exporter's chain that its Case holds, its own included, under
// `import-id-maps/<idMapSha256>.json` as the canonical bytes that digest
// covers, and an import keeps the maps it received beside its own. A map
// counts only when a verified `import` entry on the chain the new Case
// continues signs its digest and the carried set passes its structural checks,
// which the binding applies again, so a row renamed at any earlier import
// still binds to its entries and its Derived Files travel. A Birdbrain from
// before them passes the archive's checks, drops the maps without an error and
// reads a Derived File only a carried map anchors as unclaimed, failing an
// honest archive, so the gate refuses instead.
// 11 since Derived Files travel (#1813): the zip carries a Derived File under
// `files/derived/<in-Case path>` when a verified chain signs it for a parent
// row the archive holds, at a path the import may write, and its bytes still
// match. The import restores it with its `derived_files` row only when its
// bytes hash to the signed `outputHash`. A Birdbrain from before them passes
// the archive's checks, then rejects the nested entry name as malformed and
// abandons the import, so the gate refuses instead.
// 10 since the investigation records (#1909, schema v40): data.json carries
// the Subjects, Joints and their spans, the decisions on them, the marks on
// Exhibits and the run records. A Birdbrain from before them imports the Case
// without them, every decision lost with no error, so the gate refuses. The
// Case revision and its change log stay behind: the import's triggers start the
// new Case a fresh one (ADR-0042, ruling 61 of 2026-10-10).
// 9 since per-author working-layer keys (#1512, schema v39): data.json's tag
// applications and pins carry their author, tags their `created_at`, and the
// import reads the author of every working-layer row. A Birdbrain from before
// them drops those columns and merges two members' same-name tags into one,
// and its import fails outright on two members' annotation layers on one
// Capture, which its annotations key refuses. The gate refuses instead.
// 8 since Shared Cases (#1511): the archive carries every other member's chain
// as `manifest.<installationId>.jsonl` and every lineage chain under
// `lineage/`, and data.json carries the `caseMembers` roster. A Birdbrain from
// before them inspects the exporter's chain alone and imports a Case missing
// every other member's history and Exhibits' chains, so the gate refuses.
// 7 since embedded note images: a note's body_doc may carry image nodes. A
// Birdbrain from before them rejects the unknown node type in parseNoteDoc and
// abandons the whole import with an opaque schema error; the gate turns that
// into the clean "update Birdbrain" refusal, as it did for Mentions at 3.
// 6 since the Exhibit model and the Staging Pool (#1148, ADR-0023/0024, X12,
// X30): data.json carries `exhibits` and `stagingFiles`, the zip carries a
// committed non-Capture Exhibit's bytes under `files/exhibits/` and a pooled
// file's under `files/staging/`, and the header lists the pooled paths as
// `staged` so an importer cannot mistake them for anchored ones. A pre-v34
// Birdbrain has no `exhibits` table to import into and no per-kind directory
// to put the bytes in, so the gate refuses rather than dropping an anchored
// Exhibit on the way in.
// 5 since duplicate provenance (#827, schema v33): the manifest may carry
// capture entries with `method: 'duplicate'` and captures rows may carry
// `duplicate_of_capture_id`. A pre-#827 Birdbrain hits BOTH arms of the bump
// criterion below: its strict `ManifestEntrySchema` enum rejects the method
// value, so inspectCaseArchive reports a valid archive as failed verification
// (a false tamper reading), and an override import feeds a CAPTURE_COLUMNS map
// without the column, silently dropping the provenance link. The gate turns
// both into the clean "update Birdbrain" refusal.
// 4 since note tags (#391, schema v32): data.json carries a `noteTags` table.
// A pre-v32 Birdbrain reading one has no `note_tags` table to import it into,
// so every tag an investigator raised from a note would be silently dropped on
// the way in — the note keeps its text and loses the classification. The
// `schemaVersion >` gate in inspectCaseArchive turns that into the clean
// "update Birdbrain" refusal instead. Reading in the other direction still
// works: an archive written before this bump has no `noteTags` key and imports
// as a case whose notes carry no tags, which is what it is.
// 3 since note Mentions (#389): a note's body_doc may carry Mention inline
// nodes. A pre-Mention Birdbrain's parseNoteDoc rejects the unknown node type,
// so importing a mention-bearing Case Archive there would fail mid-transaction
// with an opaque schema error; the `schemaVersion >` gate in
// inspectCaseArchive turns that into the clean "update Birdbrain" refusal
// instead. The references index derived from those Mentions never travels — it
// is re-extracted after id remapping on import.
// 2 since anchored notes (schema v27): note rows carry anchor_kind and
// anchor_json, which a pre-v27 import would silently drop. Bump this whenever a
// Case Archive gains data an older release would silently discard or reject
// opaquely.
export const CASE_ARCHIVE_SCHEMA_VERSION = 14

export interface CaseArchiveData {
  case: Record<string, unknown>
  captures: Record<string, unknown>[]
  tags: Record<string, unknown>[]
  captureTags: Record<string, unknown>[]
  /** Absent on archives written before schemaVersion 4 (#391). */
  noteTags?: Record<string, unknown>[]
  selectors: Record<string, unknown>[]
  selectorMatches: Record<string, unknown>[]
  notes: Record<string, unknown>[]
  captureFavorites: Record<string, unknown>[]
  annotations: Record<string, unknown>[]
  annotationPins: Record<string, unknown>[]
  /**
   * Retired with AI analysis. Written empty, because releases from before the
   * retirement iterate this key unguarded on import and would throw on an
   * archive without it; never read, so an older archive's analysis rows are
   * dropped on import.
   */
  captureAnalyses?: Record<string, unknown>[]
  extractedData: Record<string, unknown>[]
  captureArchiveRefs: Record<string, unknown>[]
  /** Absent on archives written before schemaVersion 6 (#1148). */
  exhibits?: Record<string, unknown>[]
  /** Absent on archives written before schemaVersion 6 (#1148). */
  stagingFiles?: Record<string, unknown>[]
  /**
   * The Shared Case roster cache (#1511). Absent before schemaVersion 8. Carried
   * for completeness and never read back: an import makes a new Case with one
   * member, and the roster it came from is in the chains it keeps as lineage.
   */
  caseMembers?: Record<string, unknown>[]
  /** The investigation records (#1909). Each absent before schemaVersion 10. */
  subjects?: Record<string, unknown>[]
  joints?: Record<string, unknown>[]
  jointSpans?: Record<string, unknown>[]
  subjectSpans?: Record<string, unknown>[]
  jointDecisions?: Record<string, unknown>[]
  spanDecisions?: Record<string, unknown>[]
  sourceClassMarks?: Record<string, unknown>[]
  copyMarks?: Record<string, unknown>[]
  withheldFlags?: Record<string, unknown>[]
  ownIdentifiers?: Record<string, unknown>[]
  investigationRuns?: Record<string, unknown>[]
  investigationRunBasis?: Record<string, unknown>[]
  investigationRunCandidates?: Record<string, unknown>[]
  investigationRunProposals?: Record<string, unknown>[]
}

interface CaseArchiveHeader {
  // Not the current version as a literal: this type also describes archives
  // being read, which may have been written by any earlier release.
  schemaVersion: number
  generatedBy: 'Birdbrain'
  exportedAt: string
  toolVersion: string
  source: {
    installationId: string
    operatorName: string
    operatorRole: string
    operatorOrganization: string
  }
  signingPublicKeyPem: string
  case: { id: string; name: string; description: string | null }
  counts: CaseArchiveCounts
  artifacts: PackagedArtifact[]
  packageHash: string
  /**
   * Artifact paths that are pooled, not anchored (X12). Absent before schema 6.
   * Listed here rather than flagged on `PackagedArtifact` so the packageHash
   * recipe every verifier shares is untouched.
   */
  staged?: string[]
}

// Collects every row belonging to `caseId` across the tables a .birdbrain
// archive bundles, as raw snake_case DB rows (no camelCase mapping — the
// archive is a portable snapshot of the schema, not a domain model). Each
// table's SELECT lives on the repo that owns the aggregate.
export function collectCaseData(caseId: string): CaseArchiveData {
  return {
    case: caseRepo.collectCaseRow(caseId),
    captures: captureRepo.collectCapturesForCase(caseId),
    tags: tagRepo.collectTagsForCase(caseId),
    captureTags: tagRepo.collectCaptureTagsForCase(caseId),
    noteTags: tagRepo.collectNoteTagsForCase(caseId),
    selectors: selectorRepo.collectSelectorsForCase(caseId),
    selectorMatches: selectorRepo.collectSelectorMatchesForCase(caseId),
    notes: noteRepo.collectNotesForCase(caseId),
    captureFavorites: captureRepo.collectCaptureFavoritesForCase(caseId),
    annotations: collectAnnotationsForCase(caseId),
    annotationPins: collectAnnotationPinsForCase(caseId),
    captureAnalyses: [],
    extractedData: extractedDataRepo.collectExtractedDataForCase(caseId),
    captureArchiveRefs: waybackRefRepo.collectWaybackRefsForCase(caseId),
    exhibits: exhibitRepo.collectExhibitsForCase(caseId),
    stagingFiles: stagingRepo.collectStagingFilesForCase(caseId),
    caseMembers: collectCaseMembersForCase(caseId),
    subjects: subjectRepo.collectSubjectsForCase(caseId),
    joints: subjectRepo.collectJointsForCase(caseId),
    jointSpans: subjectRepo.collectJointSpansForCase(caseId),
    subjectSpans: subjectRepo.collectSubjectSpansForCase(caseId),
    jointDecisions: decisionRepo.collectJointDecisionsForCase(caseId),
    spanDecisions: decisionRepo.collectSpanDecisionsForCase(caseId),
    sourceClassMarks: markRepo.collectSourceClassMarksForCase(caseId),
    copyMarks: markRepo.collectCopyMarksForCase(caseId),
    withheldFlags: markRepo.collectWithheldFlagsForCase(caseId),
    ownIdentifiers: markRepo.collectOwnIdentifiersForCase(caseId),
    investigationRuns: runRepo.collectInvestigationRunsForCase(caseId),
    investigationRunBasis: runRepo.collectInvestigationRunBasisForCase(caseId),
    investigationRunCandidates: runRepo.collectInvestigationRunCandidatesForCase(caseId),
    investigationRunProposals: runRepo.collectInvestigationRunProposalsForCase(caseId)
  }
}

// Zip entry names for the bytes that are not Capture artifacts. A committed
// non-Capture Exhibit and a pooled file are each named by row id plus the
// stored extension, which is what lets the import re-root the path.
const EXHIBIT_FILES_PREFIX = 'files/exhibits/'
const STAGING_FILES_PREFIX = 'files/staging/'
// A Derived File is named by the in-Case path its signed `derivation` entry
// gives it. The name is only a lookup key into `anchoredDerivedFiles`, built
// from a verified entry, and is never parsed back into a filesystem path.
const DERIVED_FILES_PREFIX = 'files/derived/'
// A carried id map is named by the digest its signed `import` entry records
// (#1017), outside `files/`, which an older import would stage as a Capture.
const ID_MAPS_PREFIX = `${IMPORT_ID_MAPS_DIRECTORY}/`

function fileExt(path: string): string {
  return splitArtifactFilename(path.split('/').pop() ?? path).ext
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// Builds and writes a self-contained .birdbrain case archive: a raw DB
// snapshot (data.json), the case's live signed manifest, every on-disk
// capture file, and a package.json header whose packageHash commits to all
// of it. Mirrors the evidence-export pipeline in export.ts: same shared
// accumulator + packageHash recipe (owned by @shared/verify/packageHash), same operator-name
// gate, same orphan-cleanup ordering on manifest-append failure.
export async function exportCaseArchive(
  caseId: string,
  outputPath: string,
  onProgress?: (step: string, percent: number) => void
): Promise<void> {
  const settings = getSettings()
  if (!settings.operatorName?.trim()) {
    throw new Error(
      'Operator name required. Configure your name in Birdbrain settings before exporting.'
    )
  }

  onProgress?.('Collecting case data...', 10)
  const data = collectCaseData(caseId)
  const caseDir = join(getStorageRoot(), caseId)

  const { entries, artifacts, add } = createArtifactAccumulator()

  add('data.json', JSON.stringify(data, null, 2))
  const manifest = readManifestSnapshot(caseDir).jsonl
  add(MANIFEST_FILENAME, manifest)
  // Every other member's chain and every lineage chain, byte-for-byte under
  // the name it has in the Case directory (#1511).
  const chainFiles = readChainFileSnapshots(caseDir)
  for (const chain of chainFiles) add(chain.path, chain.jsonl)

  const captures = data.captures as Array<{ id: string }>
  const totalFileChecks = captures.length * CAPTURE_ARTIFACT_TYPES.length || 1
  let fileChecks = 0
  for (const capture of captures) {
    for (const type of CAPTURE_ARTIFACT_TYPES) {
      const buf = defaultCaptureStore.readArtifact(caseId, capture.id, type)
      if (buf) add(`files/${capture.id}.${type}`, buf)
      fileChecks++
      onProgress?.(
        `Packaging capture files...`,
        20 + Math.round((fileChecks / totalFileChecks) * 60)
      )
    }
  }

  // Committed non-Capture Exhibits ship with their bytes (X30) and pooled
  // files ship flagged `staged` (X12); a row whose file is missing at source
  // is carried as a row only, as a Capture with no artifact already is.
  const staged: string[] = []
  const exhibits = (data.exhibits ?? []) as Array<{ id: string; kind: string; path: string | null }>
  for (const exhibit of exhibits) {
    if (exhibit.kind === 'capture' || !exhibit.path) continue
    const abs = defaultCaptureStore.resolveAbsolute(exhibit.path)
    if (!existsSync(abs)) continue
    add(`${EXHIBIT_FILES_PREFIX}${exhibit.id}${fileExt(exhibit.path)}`, readFileSync(abs))
  }
  const pooled = (data.stagingFiles ?? []) as Array<{ id: string; path: string }>
  for (const file of pooled) {
    const abs = defaultCaptureStore.resolveAbsolute(file.path)
    if (!existsSync(abs)) continue
    const name = `${STAGING_FILES_PREFIX}${file.id}${fileExt(file.path)}`
    add(name, readFileSync(abs))
    staged.push(name)
  }

  // Id maps and Derived Files, chosen from the same chain bytes this archive
  // ships (#1813, #1017). A file whose bytes no longer match a signed hash is
  // left behind, as a file missing at source is: carrying it would only make
  // the archive fail.
  const shipped = new Map([
    [MANIFEST_FILENAME, manifest],
    ...chainFiles.map((chain): [string, Buffer] => [chain.path, chain.jsonl])
  ])
  const archiveChains = verifyArchiveChains(shipped, getPublicKeyPem())
  const manifestText = manifest.toString('utf-8')
  const carried = acceptCarriedIdMaps(
    archiveChains,
    manifestText,
    data,
    heldIdMaps(caseDir, caseId, importEntriesIn(manifestText))
  )
  for (const [name, bytes] of carried.accepted) add(name, bytes)
  const derived = anchoredDerivedFiles(archiveChains, manifestText, data, carried.trail)
  for (const [name, file] of derived) {
    const abs = join(caseDir, ...file.inCase.split('/'))
    if (!existsSync(abs) || !lstatSync(abs).isFile()) continue
    const bytes = readFileSync(abs)
    const hash = sha256(bytes)
    if (file.entries.some((entry) => entry.outputHash === hash)) add(name, bytes)
  }

  const packageHash = computePackageHash(artifacts)

  const counts: CaseArchiveCounts = {
    captures: data.captures.length,
    notes: data.notes.length,
    tags: data.tags.length,
    selectors: data.selectors.length,
    annotations: data.annotations.length,
    extractedData: data.extractedData.length,
    archiveRefs: data.captureArchiveRefs.length
  }

  const exportedAt = new Date().toISOString()
  const caseRow = data.case as { id: string; name: string; description: string | null }
  const header: CaseArchiveHeader = {
    schemaVersion: CASE_ARCHIVE_SCHEMA_VERSION,
    generatedBy: 'Birdbrain',
    exportedAt,
    toolVersion: resolveToolVersion(),
    source: {
      installationId: getInstallationId(),
      operatorName: settings.operatorName,
      operatorRole: settings.operatorRole ?? '',
      operatorOrganization: settings.operatorOrganization ?? ''
    },
    signingPublicKeyPem: getPublicKeyPem(),
    case: {
      id: caseRow.id,
      name: caseRow.name,
      description: caseRow.description ?? null
    },
    counts,
    artifacts,
    packageHash,
    staged
  }

  entries.unshift({ name: 'package.json', data: JSON.stringify(header, null, 2) })

  onProgress?.('Writing archive...', 90)
  // Any failure from here on can leave a partial/orphaned .birdbrain on disk:
  // the write itself, initManifest, or the signed append. Clean up on all of them.
  try {
    writeFileSync(outputPath, createStoredZip(entries))
    initManifest(caseDir)
    appendManifestEntry(caseDir, {
      type: 'archive-export',
      caseId,
      timestamp: exportedAt,
      operatorId: header.source.installationId,
      operatorName: header.source.operatorName,
      toolVersion: header.toolVersion,
      packageHash
    })
  } catch (err) {
    await unlink(outputPath).catch(() => {})
    throw err
  }

  onProgress?.('Complete', 100)
}

interface ArchiveChains {
  chain: ChainVerifyResult
  // The member and lineage chains the archive encloses, by the Package
  // Layout's names.
  chains: ChainFileSnapshot[]
  // The Shared Case walk, when the archive holds a Shared Case or a fork.
  shared?: SharedCaseVerifyResult
}

// The archive's chains, verified against the archive's OWN bundled key: the
// exporter's chain alone, and for a Shared Case the replica walk anchored at
// that key, since the exporter can be any member (#1511).
function verifyArchiveChains(entries: Map<string, Buffer>, publicKeyPem: string): ArchiveChains {
  const manifest = (entries.get(MANIFEST_FILENAME) ?? Buffer.alloc(0)).toString('utf-8')
  const local = { jsonl: manifest, publicKeyPem }
  const chain = verifyManifestChainText(manifest, { publicKeyPem: local.publicKeyPem })
  const chains = [...entries].flatMap(([path, jsonl]) => {
    const parsed = parseChainPath(path)
    return parsed ? [{ path, ...parsed, jsonl }] : []
  })
  if (!isSharedCase(readEntries(manifest), chains)) return { chain, chains }
  const shared = verifySharedCaseReplica({ local, ...sharedCaseChains(chains) })
  return { chain, chains, shared }
}

type DerivationEntry = Extract<ManifestEntry, { type: 'derivation' }>

// One Derived File the archive's verified chains anchor: where it sits in the
// Case, the Exhibit it was computed from, and every entry that names it (a
// re-derivation appends another).
interface AnchoredDerivedFile {
  inCase: string
  parentExhibitId: string
  // The data.json row the signed parent names once the carried id maps apply.
  rowId: string
  entries: DerivationEntry[]
}

// The in-Case paths an import writes for its own files, lower-cased. A signed
// derivation path is attacker-chosen in a self-signed archive, and one landing
// on any of these would replace a Capture's bytes, an Exhibit's, the chain or
// the id map that rename binding trusts.
function ownedInCasePaths(data: CaseArchiveData): Set<string> {
  const owned = new Set([IMPORT_ID_MAP_FILENAME, MANIFEST_FILENAME].map((n) => n.toLowerCase()))
  for (const capture of data.captures as Array<{ id: string }>) {
    for (const type of CAPTURE_ARTIFACT_TYPES) owned.add(`${capture.id}.${type}`.toLowerCase())
  }
  const rows = [
    ...((data.exhibits ?? []) as Array<{ kind: string; path: string | null }>).filter(
      (row) => row.kind !== 'capture'
    ),
    ...((data.stagingFiles ?? []) as Array<{ path: string | null }>)
  ]
  for (const { path } of rows) if (path) owned.add(inCasePath(path).toLowerCase())
  return owned
}

// The in-Case path a signed `outputPath` names, or null when the import must
// not write there: outside the Case, at a name the replica owns, at a file
// the import itself stages, at a name with a colon (NTFS opens `a.jpg::$DATA`
// as `a.jpg`), or anywhere the archive's own reader would refuse the entry
// name. The first segment is dropped, since the new Case replaces it.
function acceptedInCasePath(outputPath: string, owned: ReadonlySet<string>): string | null {
  const normalized = outputPath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  if (segments.length < 2 || segments[0] === '' || segments[0] === '.') return null
  if (normalized.includes('..') || normalized.includes(':')) return null
  // Only the refusal is read, so inspect needs no storage root to judge a path.
  if (safeCasePath('', segments[0], normalized) === null) return null
  const inCase = segments.slice(1).join('/')
  return owned.has(inCase.toLowerCase()) ? null : inCase
}

// Whether a file directly in the Case is named as another Capture's artifact
// (`<id>_thumb.jpg`). That name is the other Capture's: its backfill would
// write over the file, and a delete or the orphan report would read it as
// belonging to that Capture. Any artifact-shaped name under any spelling counts
// unless it is one of the parent's own, exactly: two Captures' ids may differ
// only in case. A renamed parent has a name for each id on its trail through
// the carried maps (#1017): the id its entries sign, which a thumbnail restored
// from the source carries, and every row id it has held since, which a
// thumbnail backfilled after one of the renames carries. None of them is
// another Capture's: no carried map renames onto a signed id, and no row keeps
// an id the maps rename away.
function namesAnotherCapture(inCase: string, parentIds: readonly string[]): boolean {
  if (inCase.includes('/') || !parseArtifactFilename(inCase.toLowerCase())) return false
  const named = parseArtifactFilename(inCase)?.captureId
  return named === undefined || !parentIds.includes(named)
}

// Every entry the archive's verified chains hold, each once: a Shared Case
// walk accepts the exporter's own chain too, so its entries arrive twice. Null
// when any chain fails, since a chain that does not verify vouches for nothing.
function verifiedEntries(
  { chain, shared }: ArchiveChains,
  manifestText: string
): ManifestEntry[] | null {
  if (!chain.valid || (shared && !shared.valid)) return null
  const lines = [...readEntries(manifestText), ...[...(shared?.entries.values() ?? [])].flat()]
  const seen = new Set<string>()
  const entries: ManifestEntry[] = []
  for (const line of lines) {
    const parsed = ManifestEntrySchema.safeParse(line)
    if (!parsed.success || seen.has(parsed.data.entryHash)) continue
    seen.add(parsed.data.entryHash)
    entries.push(parsed.data)
  }
  return entries
}

type ImportEntry = Extract<ManifestEntry, { type: 'import' }>

// The `import` entries of the chain the archive's manifest holds, oldest first.
function importEntriesIn(manifestText: string): ImportEntry[] {
  return readEntries(manifestText).flatMap((line) => {
    const parsed = ManifestEntrySchema.safeParse(line)
    return parsed.success && parsed.data.type === 'import' ? [parsed.data] : []
  })
}

// The id maps a Case holds for imports on its chain, by zip name, as the
// canonical bytes each entry hashes (#1017): its own map re-encoded, and every
// map an import kept. A file that does not parse, does not hash to its name or
// no entry records is left behind, as a Derived File whose bytes changed is.
function heldIdMaps(caseDir: string, caseId: string, imports: ImportEntry[]): Map<string, Buffer> {
  const held = new Map<string, Buffer>()
  const own = imports.find((entry) => entry.caseId === caseId)
  const ownPath = join(caseDir, IMPORT_ID_MAP_FILENAME)
  if (own && existsSync(ownPath) && lstatSync(ownPath).isFile()) {
    const text = readFileSync(ownPath, 'utf-8')
    if (parseIdMap(text, own, { canonical: false })) {
      const bytes = Buffer.from(canonicalStringify(JSON.parse(text)), 'utf-8')
      held.set(carriedIdMapName(own.idMapSha256), bytes)
    }
  }
  const dir = join(caseDir, IMPORT_ID_MAPS_DIRECTORY)
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return held
  for (const file of readdirSync(dir)) {
    const digest = file.endsWith('.json') ? file.slice(0, -'.json'.length) : ''
    if (!isIdMapDigest(digest) || !lstatSync(join(dir, file)).isFile()) continue
    const bytes = readFileSync(join(dir, file))
    if (sha256(bytes) !== digest) continue
    const text = bytes.toString('utf-8')
    const owners = imports.filter((entry) => entry.idMapSha256 === digest)
    if (
      owners.length > 0 &&
      owners.every((entry) => parseIdMap(text, entry, { canonical: true }))
    ) {
      held.set(carriedIdMapName(digest), bytes)
    }
  }
  return held
}

interface CarriedIdMaps {
  // The `import-id-maps/` entries the archive may carry and the import keeps.
  accepted: Map<string, Buffer>
  // The ids a signed id passes through as every import's map applies, the
  // signed id first and the row it names last: the signed id alone unless
  // every import on the chain has an accepted map.
  trail: (id: string) => string[]
}

// Which carried id maps count (#1017). One function for export, inspect and
// import, as `anchoredDerivedFiles` is. Every key before the local import is
// the exporter's to choose, so a digest match proves only what that signer
// recorded; the checks below keep a map from binding one signed identity to
// another row. A map counts when its name is the digest a verified `import`
// entry records on the chain the importing Case continues (for a fork, the
// source Owner's, which the binding then reads), its bytes are those canonical
// bytes, its payload names that entry's Cases (`parseIdMap`), and none of its
// values is an id a `capture` or `exhibit` entry signs. No value may appear at
// two imports (`composeIdMaps`), and when every import has a map, no data.json
// row may keep an id the maps rename away. Any failure refuses the whole set,
// as the binding refuses it: dropping one honest map must not let another
// bind its value. An absent map is no failure, and leaves the identity.
// Nothing reads the unsigned header.
function acceptCarriedIdMaps(
  archiveChains: ArchiveChains,
  manifestText: string,
  data: CaseArchiveData,
  candidates: ReadonlyMap<string, Buffer>
): CarriedIdMaps {
  const none = (): CarriedIdMaps => ({ accepted: new Map(), trail: (id) => [id] })
  const verified = verifiedEntries(archiveChains, manifestText)
  if (!verified || candidates.size === 0) return none()
  const manifest = Buffer.from(manifestText, 'utf-8')
  const imports = importEntriesIn(
    (forkedChain(manifest, archiveChains) ?? manifest).toString('utf-8')
  )
  const maps = new Map<string, Map<string, string>>()
  for (const [name, bytes] of candidates) {
    const digest = name.slice(ID_MAPS_PREFIX.length, -'.json'.length)
    if (!isIdMapDigest(digest) || carriedIdMapName(digest) !== name) return none()
    if (sha256(bytes) !== digest) return none()
    const owners = imports.filter((entry) => entry.idMapSha256 === digest)
    const text = bytes.toString('utf-8')
    const parsed = owners.map((entry) => parseIdMap(text, entry, { canonical: true }))
    const [map] = parsed
    if (!map || parsed.some((each) => !each)) return none()
    maps.set(digest, map)
  }
  if (renamesOntoSignedId([...maps.values()], verified)) return none()
  const positions = imports.map((entry) => maps.get(entry.idMapSha256))
  const present = positions.filter((map): map is Map<string, string> => map !== undefined)
  const composed = composeIdMaps(present)
  if (!composed) return none()
  const accepted = new Map(candidates)
  if (present.length < positions.length) return { accepted, trail: (id) => [id] }
  const rows = [...data.captures, ...(data.exhibits ?? [])].map((row) => row.id)
  if (rows.some((id) => typeof id === 'string' && composed.resolve(id) !== id)) return none()
  return { accepted, trail: composed.trail }
}

// The archive's `import-id-maps/` entries, by name.
function carriedIdMapEntries(entries: Map<string, Buffer>): Map<string, Buffer> {
  return new Map([...entries].filter(([name]) => name.startsWith(ID_MAPS_PREFIX)))
}

// Which Derived Files an archive carries, by zip entry name. One function for
// export, inspect and import, so an exporter carries exactly what an importer
// will restore and an honest archive never reads as holding an unclaimed file.
//
// Only verified chains vouch (all or nothing, as the app's binding is), and a
// file is anchored when a `derivation` entry on them names a parent the archive
// carries a row for, through the carried id maps (`trail`), at a path the
// import may write and not named as another Capture's artifact. A path two
// signed parents claim, or one spelt two ways, is refused whole: either reading
// could be the forgery.
function anchoredDerivedFiles(
  archiveChains: ArchiveChains,
  manifestText: string,
  data: CaseArchiveData,
  trail: (id: string) => string[]
): Map<string, AnchoredDerivedFile> {
  const resolve = (id: string): string => trail(id).at(-1)!
  const anchored = new Map<string, AnchoredDerivedFile>()
  const verified = verifiedEntries(archiveChains, manifestText)
  if (!verified) return anchored
  const parents = new Set(((data.exhibits ?? []) as Array<{ id: string }>).map((row) => row.id))
  const owned = ownedInCasePaths(data)
  const groups = new Map<
    string,
    { spellings: Set<string>; parents: Set<string>; entries: DerivationEntry[] }
  >()
  for (const entry of verified) {
    if (entry.type !== 'derivation' || !parents.has(resolve(entry.parentExhibitId))) continue
    const inCase = acceptedInCasePath(entry.outputPath, owned)
    if (inCase === null) continue
    const key = inCase.toLowerCase()
    const group = groups.get(key) ?? { spellings: new Set(), parents: new Set(), entries: [] }
    group.spellings.add(inCase)
    group.parents.add(entry.parentExhibitId)
    group.entries.push(entry)
    groups.set(key, group)
  }
  for (const { spellings, parents: named, entries } of groups.values()) {
    if (spellings.size !== 1 || named.size !== 1) continue
    const [inCase] = spellings
    const [parentExhibitId] = named
    const parentIds = trail(parentExhibitId)
    if (namesAnotherCapture(inCase, parentIds)) continue
    const rowId = parentIds[parentIds.length - 1]
    anchored.set(`${DERIVED_FILES_PREFIX}${inCase}`, { inCase, parentExhibitId, rowId, entries })
  }
  return anchored
}

// Reads a .birdbrain archive and fully re-verifies it — artifact hashes,
// manifest chain (against the archive's OWN bundled signing key, since this
// is the source instance's signature, not this machine's), and per-capture
// content hashes — without writing anything to disk or touching the DB.
export function inspectCaseArchive(archivePath: string): ArchiveInspectReport {
  const zipData = readFileSync(archivePath)
  const entries = readStoredZip(zipData)

  const packageEntry = entries.get('package.json')
  if (!packageEntry) throw new Error('Not a valid Birdbrain archive: missing package.json')
  let header: CaseArchiveHeader
  try {
    header = JSON.parse(packageEntry.toString('utf-8')) as CaseArchiveHeader
  } catch {
    throw new Error('Not a valid Birdbrain archive')
  }

  if (header.schemaVersion > CASE_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(
      'This archive was created by a newer version of Birdbrain. Update Birdbrain to import it.'
    )
  }

  // Artifact check: every declared artifact exists with a matching hash, and
  // every zip entry other than package.json is declared as an artifact.
  let artifactFailureCount = 0
  for (const artifact of header.artifacts) {
    const buf = entries.get(artifact.path)
    if (!buf || sha256(buf) !== artifact.sha256 || buf.length !== artifact.sizeBytes) {
      artifactFailureCount++
    }
  }
  const declaredPaths = new Set(header.artifacts.map((a) => a.path))
  for (const name of entries.keys()) {
    if (name !== 'package.json' && !declaredPaths.has(name)) {
      artifactFailureCount++
    }
  }
  const recomputedPackageHash = computePackageHash(header.artifacts)
  if (recomputedPackageHash !== header.packageHash) {
    artifactFailureCount++
  }

  // Chain check: verified against the archive's OWN bundled public key — the
  // source instance's key, not this instance's local signing key.
  const archiveChains = verifyArchiveChains(entries, header.signingPublicKeyPem)
  const { chain: chainResult, shared } = archiveChains
  // A Shared Case's other chains are part of the chain check: a member chain
  // that fails is the same tamper reading as the exporter's own failing. A
  // walk that could only say "too old" is reported as that, below.
  const sharedFinding =
    shared && !shared.valid ? `${shared.outcome}: ${shared.reason ?? ''}` : undefined
  const chainValid = chainResult.valid && sharedFinding === undefined
  const unsupportedReason = chainResult.unsupported
    ? describeUnsupportedEntry(chainResult.unsupported)
    : shared?.unsupported
      ? sharedFinding
      : undefined

  // Capture content check: for each data.json capture row with a hash,
  // recompute the sha256 of its files/<id>.<ext> entry and compare. A
  // capture with no corresponding artifact entry never had content exported
  // (missing at source) and is excluded rather than counted as a failure.
  const dataEntry = entries.get('data.json')
  if (!dataEntry) throw new Error('Not a valid Birdbrain archive')
  let data: CaseArchiveData
  try {
    data = JSON.parse(dataEntry.toString('utf-8')) as CaseArchiveData
  } catch {
    throw new Error('Not a valid Birdbrain archive')
  }
  const captures = data.captures as Array<{ id: string; hash?: string; format?: string }>
  let captureHashFailureCount = 0
  for (const capture of captures) {
    if (!capture.hash) continue
    const ext = capture.format === 'mhtml' ? 'mhtml' : 'html'
    const path = `files/${capture.id}.${ext}`
    if (!declaredPaths.has(path)) continue
    const buf = entries.get(path)
    if (!buf || sha256(buf) !== capture.hash) {
      captureHashFailureCount++
    }
  }

  // The same check for a non-Capture Exhibit's bytes and for a pooled file's
  // (#1148): the packaged bytes must hash to what the row records. Counted
  // with the artifact failures because `ArchiveVerificationResult` is the
  // shape the signed `import` entry carries, and a new field there would be a
  // schema change every distributed verifier would have to learn.
  const rowHashChecks = [
    ...(
      (data.exhibits ?? []) as Array<{
        id: string
        kind: string
        path: string | null
        content_hash: string
      }>
    )
      .filter((row) => row.kind !== 'capture' && row.path)
      .map((row) => ({
        path: `${EXHIBIT_FILES_PREFIX}${row.id}${fileExt(row.path!)}`,
        hash: row.content_hash
      })),
    ...((data.stagingFiles ?? []) as Array<{ id: string; path: string; content_hash: string }>).map(
      (row) => ({
        path: `${STAGING_FILES_PREFIX}${row.id}${fileExt(row.path)}`,
        hash: row.content_hash
      })
    )
  ]
  for (const check of rowHashChecks) {
    if (!declaredPaths.has(check.path)) continue
    const buf = entries.get(check.path)
    if (!buf || sha256(buf) !== check.hash) artifactFailureCount++
  }
  // A Derived File's bytes are checked against the signed `outputHash`, never
  // against a row: the header's sha256 is unsigned, so bytes swapped with the
  // header repaired pass every check above. A file no verified entry claims is
  // counted too, and so is every carried id map when the set fails its check
  // (#1017). Not gated on `schemaVersion`, which is unsigned as well. With the
  // chain broken nothing can claim a file and the chain finding already fails
  // the archive.
  if (chainValid) {
    const manifestText = (entries.get(MANIFEST_FILENAME) ?? Buffer.alloc(0)).toString('utf-8')
    const idMaps = carriedIdMapEntries(entries)
    const carried = acceptCarriedIdMaps(archiveChains, manifestText, data, idMaps)
    for (const name of idMaps.keys()) if (!carried.accepted.has(name)) artifactFailureCount++
    const anchored = anchoredDerivedFiles(archiveChains, manifestText, data, carried.trail)
    for (const [name, buf] of entries) {
      if (!name.startsWith(DERIVED_FILES_PREFIX)) continue
      const hash = sha256(buf)
      const claimed = anchored.get(name)?.entries.some((entry) => entry.outputHash === hash)
      if (!claimed) artifactFailureCount++
    }
  }
  // A pooled path the header does not flag `staged`, or a flag on a path that
  // is not pooled, is a header that lies about anchoring (X12).
  const stagedDeclared = new Set(header.staged ?? [])
  for (const name of declaredPaths) {
    const isPooledPath = name.startsWith(STAGING_FILES_PREFIX)
    if (isPooledPath !== stagedDeclared.has(name)) artifactFailureCount++
  }

  const verification: ArchiveVerificationResult = {
    overallValid: artifactFailureCount === 0 && chainValid && captureHashFailureCount === 0,
    chainValid,
    chainReason: chainResult.reason ?? sharedFinding,
    artifactCount: header.artifacts.length,
    artifactFailureCount,
    captureCount: captures.length,
    captureHashFailureCount
  }

  return {
    archivePath,
    schemaVersion: header.schemaVersion,
    exportedAt: header.exportedAt,
    toolVersion: header.toolVersion,
    caseName: header.case.name,
    caseDescription: header.case.description,
    sourceInstallationId: header.source.installationId,
    sourceOperatorName: header.source.operatorName,
    counts: header.counts,
    verification,
    ...(unsupportedReason !== undefined ? { verifierTooOld: { reason: unsupportedReason } } : {})
  }
}

// How an archive's chains land in the new Case, and who the `import` names.
interface ImportChains {
  manifest: Buffer
  // The Case the `import` names as its source: for a fork, the id the source
  // Owner's own `member-add` states, never the archive header's.
  sourceCaseId: string
  sourceInstallationId: string
  sourcePublicKeyPem: string
  // Chains written under `lineage/`, by path.
  lineage: Array<{ path: string; jsonl: Buffer }>
  // Set for a fork: the source Case's exporter and roster, which attribute
  // the rows that were the exporter's own.
  fork?: { exporterId: string; members: SharedCaseMember[] }
}

// The chain a fork continues: the source Owner's, whichever member exported
// it. Undefined for an archive that is no fork, which continues its exporter's
// chain (`manifest`). The import and the carried id map check both read it,
// so the maps are checked against the imports the binding composes them over.
function forkedChain(manifest: Buffer, { chains, shared }: ArchiveChains): Buffer | undefined {
  const owner = shared?.members.find((m) => m.role === 'owner')
  const exporterId = shared?.localInstallationId
  if (!owner || exporterId === undefined) return undefined
  if (owner.installationId === exporterId) return manifest
  return chains.find(
    (c) => c.sourceCaseId === undefined && c.installationId === owner.installationId
  )?.jsonl
}

// A Shared Case archive is forked (decision 18, #1511): the new chain continues
// the source Owner's, its `import` names the Owner's key, and every other
// chain of the source Case — the exporter's own included when it was not the
// Owner — is kept under `lineage/<sourceCaseId>/`. Any other archive continues
// its exporter's chain, as imports always have; chains it carries but no
// roster names are kept as lineage too, so nothing the archive held is dropped
// and the new Case's verification reports them.
function planImportChains(
  entries: Map<string, Buffer>,
  header: CaseArchiveHeader,
  archiveChains: ArchiveChains
): ImportChains {
  const { chains, shared } = archiveChains
  const manifest = entries.get(MANIFEST_FILENAME) ?? Buffer.alloc(0)
  const carried = chains
    .filter((c) => c.sourceCaseId !== undefined)
    .map(({ path, jsonl }) => ({ path, jsonl }))
  const current = chains.filter((c) => c.sourceCaseId === undefined)
  const owner = shared?.members.find((m) => m.role === 'owner')
  const sourceCaseId = (owner && shared?.caseId) ?? header.case.id
  const asLineage = (installationId: string, jsonl: Buffer): { path: string; jsonl: Buffer } => {
    const path = lineageChainPath(sourceCaseId, installationId)
    // The Case id comes from the archive, which is not trusted to name a path:
    // a lineage path that does not read back as one would leave the staging
    // directory.
    if (!parseChainPath(path)) {
      throw new Error('Not a valid Birdbrain archive: malformed source Case id')
    }
    return { path, jsonl }
  }
  const exporterId = shared?.localInstallationId
  const ownerChain = forkedChain(manifest, archiveChains)
  if (!owner || exporterId === undefined || ownerChain === undefined) {
    return {
      manifest,
      sourceCaseId,
      sourceInstallationId: header.source.installationId,
      sourcePublicKeyPem: header.signingPublicKeyPem,
      lineage: [...carried, ...current.map((c) => asLineage(c.installationId, c.jsonl))]
    }
  }
  const others = current
    .filter((c) => c.installationId !== owner.installationId)
    .map((c) => asLineage(c.installationId, c.jsonl))
  if (exporterId !== owner.installationId) others.unshift(asLineage(exporterId, manifest))
  return {
    manifest: ownerChain,
    sourceCaseId,
    sourceInstallationId: owner.installationId,
    sourcePublicKeyPem: owner.publicKeyPem,
    lineage: [...carried, ...others],
    fork: { exporterId, members: shared?.members ?? [] }
  }
}

// A fork's Exhibits all belong to the source Case's members. The exporter's
// own rows were "this installation" there and would read as the importer's
// here, so each row is stamped with its author and that author's Member Code,
// which its citation then carries.
function attributeForkedExhibits(
  rows: Record<string, unknown>[],
  { exporterId, members }: NonNullable<ImportChains['fork']>
): Record<string, unknown>[] {
  const codeOf = new Map(members.map((m) => [m.installationId, m.memberCode]))
  return rows.map((row) => {
    const author = (row.author_installation_id as string | null | undefined) ?? exporterId
    return {
      ...row,
      author_installation_id: author,
      member_code: row.member_code ?? codeOf.get(author) ?? null
    }
  })
}

// The id-keyed tables that could collide with an existing local row on import
// live in db/core as ID_PROBE_TABLES, so this remap loop and hasRowWithId's SQL
// allowlist share one definition. `annotations`/`capture_favorites` are keyed
// by `capture_id` and `exhibit_tags`/`note_tags`/`selector_matches` by their
// FKs, so they follow the capture/note/selector/tag remapping automatically —
// they are NOT there. `note_tags` in particular has no `id` column at all, so
// listing it would make hasRowWithId's `WHERE id = ?` a SQL error rather than
// a probe.

// Imports a .birdbrain case archive as a NEW case: re-verifies it, allocates a
// fresh case id, remaps any colliding row ids, stages the files + manifest off
// to the side, appends a signed `import` genesis-of-custody entry that continues
// the source chain, atomically moves the staging dir into place, then re-inserts
// every table row in one DB transaction. The ordering is load-bearing: the
// custody entry is signed BEFORE the case dir exists on disk and BEFORE any DB
// row is written, so a failure never leaves a half-imported case or an unsigned
// manifest. On any failure the staging dir (pre-move) or the moved case dir
// (post-move) is removed and the error rethrown.
export async function importCaseArchive(
  archivePath: string,
  opts?: { overrideTamper?: boolean; operatorName?: string },
  onProgress?: (step: string, percent: number) => void
): Promise<{ newCaseId: string; report: ArchiveInspectReport }> {
  // Step 1: operator gate. `opts.operatorName` is an explicit synthetic
  // attribution, NOT a way past the gate: the seeding of the bundled demo case
  // runs before any operator has configured a name (#405, R7), so it names
  // itself instead. The gate below still refuses an empty name from either
  // source, and whatever name is used is what the custody entry records — so
  // the manifest says truthfully who imported the archive.
  const settings = getSettings()
  const operatorName = opts?.operatorName?.trim() || settings.operatorName?.trim()
  if (!operatorName) {
    throw new Error(
      'Operator name required. Configure your name in Birdbrain settings before importing.'
    )
  }

  // Step 2: verify. A tamper failure blocks unless explicitly overridden.
  onProgress?.('Verifying archive...', 5)
  const report = inspectCaseArchive(archivePath)
  if (!report.verification.overallValid && !opts?.overrideTamper) {
    throw new Error(
      'Archive failed verification. Import blocked — re-run with override to import anyway; the tamper result will be permanently recorded in the case manifest.'
    )
  }

  // Step 3: parse data.json + package.json, allocate the new case id, and build
  // the id-collision remap for every standalone-PK table.
  const entries = readStoredZip(readFileSync(archivePath))
  const header = JSON.parse(entries.get('package.json')!.toString('utf-8')) as CaseArchiveHeader
  const data = JSON.parse(entries.get('data.json')!.toString('utf-8')) as CaseArchiveData

  // Restoration is decided from this read, the one the bytes come from.
  const archiveChains = verifyArchiveChains(entries, header.signingPublicKeyPem)
  const plan = planImportChains(entries, header, archiveChains)
  const manifestText = (entries.get(MANIFEST_FILENAME) ?? Buffer.alloc(0)).toString('utf-8')
  const carried = acceptCarriedIdMaps(
    archiveChains,
    manifestText,
    data,
    carriedIdMapEntries(entries)
  )
  const anchored = anchoredDerivedFiles(archiveChains, manifestText, data, carried.trail)

  const newCaseId = randomUUID()
  const idMap: Record<string, string> = {}
  const tableRows: Record<(typeof ID_PROBE_TABLES)[number], Record<string, unknown>[]> = {
    captures: data.captures,
    exhibits: data.exhibits ?? [],
    staging_files: data.stagingFiles ?? [],
    notes: data.notes,
    selectors: data.selectors,
    extracted_data: data.extractedData,
    capture_archive_refs: data.captureArchiveRefs,
    annotation_pins: data.annotationPins,
    subjects: data.subjects ?? [],
    joints: data.joints ?? [],
    joint_spans: data.jointSpans ?? [],
    subject_spans: data.subjectSpans ?? [],
    joint_decisions: data.jointDecisions ?? [],
    span_decisions: data.spanDecisions ?? [],
    source_class_marks: data.sourceClassMarks ?? [],
    copy_marks: data.copyMarks ?? [],
    withheld_flags: data.withheldFlags ?? [],
    own_identifiers: data.ownIdentifiers ?? [],
    investigation_runs: data.investigationRuns ?? []
  }
  for (const table of ID_PROBE_TABLES) {
    for (const row of tableRows[table]) {
      const oldId = row.id as string | undefined
      if (!oldId || idMap[oldId]) continue
      if (hasRowWithId(table, oldId)) idMap[oldId] = randomUUID()
    }
  }
  const mapId = (id: string): string => idMap[id] ?? id

  const { sourceCaseId } = plan
  const idMapPayload = { sourceCaseId, caseId: newCaseId, remapped: idMap }
  const idMapSha256 = sha256(Buffer.from(canonicalStringify(idMapPayload), 'utf-8'))

  // Step 4: stage files + manifest + id-map into a side directory.
  onProgress?.('Staging files...', 20)
  const storageRoot = getStorageRoot()
  const stagingDir = join(storageRoot, '.import-staging-' + randomUUID())
  mkdirSync(stagingDir, { recursive: true })
  // The Derived Files staged below, whose rows the transaction writes.
  const restored: Array<{ inCase: string; rowId: string; match: DerivationEntry }> = []
  // Where a non-Capture Exhibit's bytes land is the kind's subdirectory (X4),
  // read off the row the archive carries for it.
  const exhibitKinds = new Map(
    ((data.exhibits ?? []) as Array<{ id: string; kind: string }>).map((row) => [row.id, row.kind])
  )
  try {
    for (const [name, buf] of entries) {
      if (!name.startsWith('files/')) continue
      // Staged last, below, from the verified entry rather than the name.
      if (name.startsWith(DERIVED_FILES_PREFIX)) continue
      const isExhibit = name.startsWith(EXHIBIT_FILES_PREFIX)
      const isPooled = name.startsWith(STAGING_FILES_PREFIX)
      const base = isExhibit
        ? name.slice(EXHIBIT_FILES_PREFIX.length)
        : isPooled
          ? name.slice(STAGING_FILES_PREFIX.length)
          : name.slice('files/'.length) // <oldCaptureId>.<ext>
      // Zip-slip guard: the entry name is attacker-controlled (a crafted archive
      // can self-sign as valid), and stagingDir is later renamed into the live
      // storage root. Only a bare filename is ever legitimate here.
      if (base.length === 0 || base.includes('/') || base.includes('\\') || base.includes('..')) {
        throw new Error('Not a valid Birdbrain archive: malformed file entry name')
      }
      const { stem: oldId, ext } = splitArtifactFilename(base)
      let subdir = ''
      if (isPooled) subdir = STAGING_SUBDIRECTORY
      else if (isExhibit) {
        const kind = exhibitKinds.get(oldId)
        if (!kind) throw new Error('Not a valid Birdbrain archive: exhibit file with no row')
        subdir = EXHIBIT_KIND_SUBDIRECTORIES[kind] ?? ''
      }
      const dir = subdir ? join(stagingDir, subdir) : stagingDir
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, mapId(oldId) + ext), buf)
    }
    writeFileSync(join(stagingDir, MANIFEST_FILENAME), plan.manifest)
    // Paths built from ids `parseChainPath` accepted as single segments, so
    // none of them leaves the staging directory.
    for (const { path, jsonl } of plan.lineage) {
      const target = join(stagingDir, ...path.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, jsonl)
    }
    writeFileSync(join(stagingDir, IMPORT_ID_MAP_FILENAME), JSON.stringify(idMapPayload, null, 2))
    // The earlier imports' maps, kept beside this one so a row any of them
    // renamed still binds (#1017). Only a set that passed its own check
    // reaches here: an override import keeps none when the maps failed, and
    // keeps them when the archive failed for another reason. Each path is
    // built from the signed digest its bytes hash to, never from the entry name.
    if (carried.accepted.size > 0) mkdirSync(join(stagingDir, IMPORT_ID_MAPS_DIRECTORY))
    for (const bytes of carried.accepted.values()) {
      writeFileSync(join(stagingDir, ...carriedIdMapName(sha256(bytes)).split('/')), bytes)
    }

    // Derived Files, written after everything else the import stages so one
    // can never replace a Capture's bytes, an Exhibit's, a chain or the id map.
    // Bytes that match no signed hash reach this point only on an override
    // import, which inspect has already recorded, and are not written.
    for (const [name, file] of anchored) {
      const bytes = entries.get(name)
      if (!bytes) continue
      const hash = sha256(bytes)
      // The latest entry for these bytes, which the backfill's re-record names.
      const match = [...file.entries].reverse().find((entry) => entry.outputHash === hash)
      if (!match) continue
      const target = join(stagingDir, ...file.inCase.split('/'))
      if (existsSync(target)) {
        throw new Error(
          'Not a valid Birdbrain archive: a derived file path collides with an imported file'
        )
      }
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
      restored.push({ inCase: file.inCase, rowId: file.rowId, match })
    }

    // Step 5: append the signed import entry to the STAGED manifest — it
    // continues the source chain (getManifestHead reads the staged file):
    // for a fork, the source Owner's chain under the Owner's key.
    initManifest(stagingDir)
    appendManifestEntry(stagingDir, {
      type: 'import',
      caseId: newCaseId,
      sourceCaseId,
      sourceInstallationId: plan.sourceInstallationId,
      sourcePublicKeyPem: plan.sourcePublicKeyPem,
      packageHash: header.packageHash,
      idMapSha256,
      verificationResult: report.verification,
      timestamp: new Date().toISOString(),
      operatorId: getInstallationId(),
      operatorName,
      toolVersion: resolveToolVersion()
    })
  } catch (err) {
    // Failure BEFORE the move: clean up staging only.
    rmSync(stagingDir, { recursive: true, force: true })
    throw err
  }

  // Step 6: atomically move staging into the case directory.
  const caseDir = join(storageRoot, newCaseId)
  onProgress?.('Finalizing...', 70)
  try {
    renameSync(stagingDir, caseDir)
  } catch (err) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw err
  }

  // Step 7: re-insert every table row in a single transaction. Step 8: on any
  // throw after the move, remove the case dir and rethrow (the transaction
  // self-rolls-back).
  try {
    // A fork has one member: `case_members` stays empty and the Case row
    // carries no sharing columns, so it reads as a Case nobody shared.
    const rows = plan.fork
      ? { ...data, exhibits: attributeForkedExhibits(data.exhibits ?? [], plan.fork) }
      : data
    // The exporter of a fork is the installation its verified roster names; the
    // header's copy is unsigned, so an edit there must not reassign the records.
    const exporterId = plan.fork?.exporterId ?? header.source.installationId
    withTransaction(() => {
      insertImportedRows(rows, newCaseId, mapId, exporterId)
      // After the Exhibits, which derived_files has a foreign key onto. Every
      // column comes from the verified entry, and the path keeps the signed
      // file name even when the parent was renamed: binding and both package
      // verifiers look for the file under that name. The row is the one the
      // carried id maps resolve the signed parent to, then this import's map.
      for (const { inCase, rowId, match } of restored) {
        insertDerivedFile({
          exhibitId: mapId(rowId),
          derivation: match.derivation,
          toolVersion: match.derivationToolVersion,
          contentHash: match.outputHash,
          path: join(newCaseId, ...inCase.split('/')),
          createdAt: match.timestamp,
          manifestSeq: match.index
        })
      }
    })
  } catch (err) {
    rmSync(caseDir, { recursive: true, force: true })
    throw err
  }

  // Step 9.
  onProgress?.('Complete', 100)
  return { newCaseId, report }
}

// Re-inserts all archived rows into the DB under `newCaseId` via the repo bulk
// ops, remapping row ids via `mapId` and merging tags by case-insensitive name
// within one author (a policy of this module, not of the repos). Runs inside
// the caller's transaction. The staged .txt sidecars reach captureRepo through
// ctx.getText — repos never touch the filesystem.
function insertImportedRows(
  data: CaseArchiveData,
  newCaseId: string,
  mapId: (id: string) => string,
  sourceInstallationId: string
): void {
  // Tags: merge by case-insensitive name against BOTH the persisted tags and
  // names already seen earlier in this same archive batch (an archive can carry
  // Foo and foo — neither is persisted, so only pendingByName catches them).
  // Only a tag of the same author merges, so two members' `Evidence` tags stay
  // two rows, as they were in the source Case.
  const tagIdMap: Record<string, string> = {}
  const tagRowsToInsert: Record<string, unknown>[] = []
  const pendingByName = new Map<string, string>()
  for (const tag of data.tags) {
    const oldId = tag.id as string
    const name = tag.name as string
    const author = (tag.author_installation_id as string | null | undefined) ?? null
    const normalized = JSON.stringify([author ?? '', name.toLowerCase()])
    const hit = tagRepo.findTagIdByNameInsensitive(name, author) ?? pendingByName.get(normalized)
    if (hit) {
      tagIdMap[oldId] = hit
      continue
    }
    const newId = tagRepo.tagIdExists(oldId) ? randomUUID() : oldId
    tagRowsToInsert.push({ ...tag, id: newId })
    tagIdMap[oldId] = newId
    pendingByName.set(normalized, newId)
  }
  const mapTag = (id: string): string => tagIdMap[id] ?? id

  const ctx: ImportCtx = {
    newCaseId,
    mapId,
    mapTag,
    getText: (_oldId, newId) =>
      defaultCaptureStore.readArtifact(newCaseId, newId, 'txt')?.toString('utf-8') ?? ''
  }

  caseRepo.importCaseRow(data.case, ctx)
  tagRepo.importTagRows(tagRowsToInsert)
  // Exhibit rows travel verbatim from schema 6 so the source's numbers survive
  // (X18, X30). Before the Captures on purpose: `importCaptureRows` backfills a
  // row for any Capture still without one, which numbers an older archive's
  // Captures and is a no-op here, and the tag import after it keys on the
  // Exhibit row. Pooled rows come back to the pool and never as anchored (X12).
  exhibitRepo.importExhibitRows(data.exhibits ?? [], ctx)
  captureRepo.importCaptureRows(data.captures, ctx)
  tagRepo.importCaptureTagRows(data.captureTags, ctx)
  selectorRepo.importSelectorRows(data.selectors, ctx)
  selectorRepo.importSelectorMatchRows(data.selectorMatches, ctx)
  captureRepo.importCaptureFavoriteRows(data.captureFavorites, ctx)
  importAnnotationRows(data.annotations, ctx)
  importAnnotationPinRows(data.annotationPins, ctx)
  extractedDataRepo.importExtractedDataRows(data.extractedData, ctx)
  waybackRefRepo.importWaybackRefRows(data.captureArchiveRefs, ctx)
  noteRepo.importNoteRows(data.notes, ctx)
  // Strictly after the notes, whose rows note_tags has a foreign key onto. An
  // archive written before schemaVersion 4 carries no key at all (#391).
  tagRepo.importNoteTagRows(data.noteTags ?? [], ctx)
  stagingRepo.importStagingFileRows(data.stagingFiles ?? [], ctx)
  // The investigation records, parents before the rows that name them. A row
  // with no author was the exporter's own, and here would read as the
  // importer's, so it takes the exporter's installation (ruling 62 of
  // 2026-10-10): for a fork `plan.fork.exporterId`, the installation
  // `attributeForkedExhibits` stamps on the exporter's Exhibits, and otherwise
  // `header.source.installationId`.
  const src = sourceInstallationId
  subjectRepo.importSubjectRows(data.subjects ?? [], ctx, src)
  subjectRepo.importJointRows(data.joints ?? [], ctx, src)
  subjectRepo.importJointSpanRows(data.jointSpans ?? [], ctx, src)
  subjectRepo.importSubjectSpanRows(data.subjectSpans ?? [], ctx, src)
  decisionRepo.importJointDecisionRows(data.jointDecisions ?? [], ctx, src)
  decisionRepo.importSpanDecisionRows(data.spanDecisions ?? [], ctx, src)
  markRepo.importSourceClassMarkRows(data.sourceClassMarks ?? [], ctx, src)
  markRepo.importCopyMarkRows(data.copyMarks ?? [], ctx, src)
  markRepo.importWithheldFlagRows(data.withheldFlags ?? [], ctx, src)
  markRepo.importOwnIdentifierRows(data.ownIdentifiers ?? [], ctx, src)
  runRepo.importInvestigationRunRows(data.investigationRuns ?? [], ctx, src)
  runRepo.importInvestigationRunBasisRows(data.investigationRunBasis ?? [], ctx, src)
  runRepo.importInvestigationRunCandidateRows(data.investigationRunCandidates ?? [], ctx, src)
  runRepo.importInvestigationRunProposalRows(data.investigationRunProposals ?? [], ctx, src)
}
