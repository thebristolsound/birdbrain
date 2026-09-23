import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'fs'
import { unlink } from 'fs/promises'
import { createHash, randomUUID } from 'crypto'
import { join } from 'path'
import {
  withTransaction,
  hasRowWithId,
  ID_PROBE_TABLES,
  type ImportCtx
} from '@main/services/db/core'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import * as exhibitRepo from '@main/services/db/exhibitRepo'
import * as stagingRepo from '@main/services/db/stagingRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as waybackRefRepo from '@main/services/db/waybackRefRepo'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import {
  collectAnnotationsForCase,
  collectAnnotationPinsForCase,
  importAnnotationRows,
  importAnnotationPinRows
} from '@main/services/annotations'
import {
  collectCaptureAnalysesForCase,
  importCaptureAnalysisRows
} from '@main/services/ai/analysisService'
import { getStorageRoot } from '@main/services/storage'
import {
  CAPTURE_ARTIFACT_TYPES,
  defaultCaptureStore,
  EXHIBIT_KIND_SUBDIRECTORIES,
  STAGING_SUBDIRECTORY
} from '@main/services/captureStore'
import { getSettings } from '@main/services/settings'
import { getInstallationId } from '@main/services/installationId'
import { getPublicKeyPem } from '@main/services/signingKey'
import {
  appendManifestEntry,
  createArtifactAccumulator,
  initManifest,
  packageHash as computePackageHash,
  readManifestSnapshot,
  verifyManifestChainText
} from '@main/services/manifest'
import type { PackagedArtifact } from '@main/services/manifest'
import { createStoredZip } from '@main/services/zip'
import { readStoredZip } from '@main/services/zipRead'
import { canonicalStringify } from '@shared/verify'
import { resolveToolVersion } from '@main/services/toolVersion'
import { IMPORT_ID_MAP_FILENAME, MANIFEST_FILENAME } from '@shared/constants'
import type {
  ArchiveInspectReport,
  ArchiveVerificationResult,
  CaseArchiveCounts
} from '@shared/types'

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
export const CASE_ARCHIVE_SCHEMA_VERSION = 6

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
  captureAnalyses: Record<string, unknown>[]
  extractedData: Record<string, unknown>[]
  captureArchiveRefs: Record<string, unknown>[]
  /** Absent on archives written before schemaVersion 6 (#1148). */
  exhibits?: Record<string, unknown>[]
  /** Absent on archives written before schemaVersion 6 (#1148). */
  stagingFiles?: Record<string, unknown>[]
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
    captureAnalyses: collectCaptureAnalysesForCase(caseId),
    extractedData: extractedDataRepo.collectExtractedDataForCase(caseId),
    captureArchiveRefs: waybackRefRepo.collectWaybackRefsForCase(caseId),
    exhibits: exhibitRepo.collectExhibitsForCase(caseId),
    stagingFiles: stagingRepo.collectStagingFilesForCase(caseId)
  }
}

// Zip entry names for the bytes that are not Capture artifacts. A committed
// non-Capture Exhibit and a pooled file are each named by row id plus the
// stored extension, which is what lets the import re-root the path.
const EXHIBIT_FILES_PREFIX = 'files/exhibits/'
const STAGING_FILES_PREFIX = 'files/staging/'

function fileExt(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot)
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
  add('manifest.jsonl', readManifestSnapshot(caseDir).jsonl)

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
  const manifestBuf = entries.get('manifest.jsonl') ?? Buffer.alloc(0)
  const chainResult = verifyManifestChainText(manifestBuf.toString('utf-8'), {
    publicKeyPem: header.signingPublicKeyPem
  })

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
  // A pooled path the header does not flag `staged`, or a flag on a path that
  // is not pooled, is a header that lies about anchoring (X12).
  const stagedDeclared = new Set(header.staged ?? [])
  for (const name of declaredPaths) {
    const isPooledPath = name.startsWith(STAGING_FILES_PREFIX)
    if (isPooledPath !== stagedDeclared.has(name)) artifactFailureCount++
  }

  const verification: ArchiveVerificationResult = {
    overallValid: artifactFailureCount === 0 && chainResult.valid && captureHashFailureCount === 0,
    chainValid: chainResult.valid,
    chainReason: chainResult.reason,
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
    verification
  }
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

  const newCaseId = randomUUID()
  const idMap: Record<string, string> = {}
  const tableRows: Record<(typeof ID_PROBE_TABLES)[number], Record<string, unknown>[]> = {
    captures: data.captures,
    exhibits: data.exhibits ?? [],
    staging_files: data.stagingFiles ?? [],
    notes: data.notes,
    selectors: data.selectors,
    capture_analyses: data.captureAnalyses,
    extracted_data: data.extractedData,
    capture_archive_refs: data.captureArchiveRefs,
    annotation_pins: data.annotationPins
  }
  for (const table of ID_PROBE_TABLES) {
    for (const row of tableRows[table]) {
      const oldId = row.id as string | undefined
      if (!oldId || idMap[oldId]) continue
      if (hasRowWithId(table, oldId)) idMap[oldId] = randomUUID()
    }
  }
  const mapId = (id: string): string => idMap[id] ?? id

  const sourceCaseId = header.case.id
  const idMapPayload = { sourceCaseId, caseId: newCaseId, remapped: idMap }
  const idMapSha256 = sha256(Buffer.from(canonicalStringify(idMapPayload), 'utf-8'))

  // Step 4: stage files + manifest + id-map into a side directory.
  onProgress?.('Staging files...', 20)
  const storageRoot = getStorageRoot()
  const stagingDir = join(storageRoot, '.import-staging-' + randomUUID())
  mkdirSync(stagingDir, { recursive: true })
  // Where a non-Capture Exhibit's bytes land is the kind's subdirectory (X4),
  // read off the row the archive carries for it.
  const exhibitKinds = new Map(
    ((data.exhibits ?? []) as Array<{ id: string; kind: string }>).map((row) => [row.id, row.kind])
  )
  try {
    for (const [name, buf] of entries) {
      if (!name.startsWith('files/')) continue
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
      const dot = base.lastIndexOf('.')
      const oldId = dot === -1 ? base : base.slice(0, dot)
      const ext = dot === -1 ? '' : base.slice(dot)
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
    writeFileSync(
      join(stagingDir, MANIFEST_FILENAME),
      entries.get(MANIFEST_FILENAME) ?? Buffer.alloc(0)
    )
    writeFileSync(join(stagingDir, IMPORT_ID_MAP_FILENAME), JSON.stringify(idMapPayload, null, 2))

    // Step 5: append the signed import entry to the STAGED manifest — it
    // continues the source chain (getManifestHead reads the staged file).
    initManifest(stagingDir)
    appendManifestEntry(stagingDir, {
      type: 'import',
      caseId: newCaseId,
      sourceCaseId,
      sourceInstallationId: report.sourceInstallationId,
      sourcePublicKeyPem: header.signingPublicKeyPem,
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
    withTransaction(() => {
      insertImportedRows(data, newCaseId, mapId)
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
// (a policy of this module, not of the repos). Runs inside the caller's
// transaction. The staged .txt sidecars reach captureRepo through ctx.getText —
// repos never touch the filesystem.
function insertImportedRows(
  data: CaseArchiveData,
  newCaseId: string,
  mapId: (id: string) => string
): void {
  // Tags: merge by case-insensitive name against BOTH the persisted tags and
  // names already seen earlier in this same archive batch (an archive can carry
  // Foo and foo — neither is persisted, so only pendingByName catches them).
  const tagIdMap: Record<string, string> = {}
  const tagRowsToInsert: Record<string, unknown>[] = []
  const pendingByName = new Map<string, string>()
  for (const tag of data.tags) {
    const oldId = tag.id as string
    const name = tag.name as string
    const normalized = name.toLowerCase()
    const hit = tagRepo.findTagIdByNameInsensitive(name) ?? pendingByName.get(normalized)
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
  importCaptureAnalysisRows(data.captureAnalyses, ctx)
  extractedDataRepo.importExtractedDataRows(data.extractedData, ctx)
  waybackRefRepo.importWaybackRefRows(data.captureArchiveRefs, ctx)
  noteRepo.importNoteRows(data.notes, ctx)
  // Strictly after the notes, whose rows note_tags has a foreign key onto. An
  // archive written before schemaVersion 4 carries no key at all (#391).
  tagRepo.importNoteTagRows(data.noteTags ?? [], ctx)
  stagingRepo.importStagingFileRows(data.stagingFiles ?? [], ctx)
}
