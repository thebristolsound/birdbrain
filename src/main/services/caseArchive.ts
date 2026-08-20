import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'fs'
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
import { CAPTURE_ARTIFACT_TYPES, defaultCaptureStore } from '@main/services/captureStore'
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
import { resolveToolVersion } from '@main/services/certification'
import { MANIFEST_FILENAME } from '@shared/constants'
import type {
  ArchiveInspectReport,
  ArchiveVerificationResult,
  CaseArchiveCounts
} from '@shared/types'

// 3 since note Mentions (#389): a note's body_doc may carry Mention inline
// nodes. A pre-Mention Birdbrain's parseNoteDoc rejects the unknown node type,
// so importing a mention-bearing archive there would fail mid-transaction with
// an opaque schema error; the `schemaVersion >` gate in inspectCaseArchive
// turns that into the clean "update Birdbrain" refusal instead. The references
// index derived from those Mentions never travels — it is re-extracted after
// id remapping on import.
// 2 since anchored notes (schema v27): note rows carry anchor_kind and
// anchor_json, which a pre-v27 import would silently drop. Bump this whenever
// an archive gains data an older release would silently discard or reject
// opaquely.
export const CASE_ARCHIVE_SCHEMA_VERSION = 3

export interface CaseArchiveData {
  case: Record<string, unknown>
  captures: Record<string, unknown>[]
  tags: Record<string, unknown>[]
  captureTags: Record<string, unknown>[]
  selectors: Record<string, unknown>[]
  selectorMatches: Record<string, unknown>[]
  notes: Record<string, unknown>[]
  captureFavorites: Record<string, unknown>[]
  annotations: Record<string, unknown>[]
  annotationPins: Record<string, unknown>[]
  captureAnalyses: Record<string, unknown>[]
  extractedData: Record<string, unknown>[]
  captureArchiveRefs: Record<string, unknown>[]
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
    selectors: selectorRepo.collectSelectorsForCase(caseId),
    selectorMatches: selectorRepo.collectSelectorMatchesForCase(caseId),
    notes: noteRepo.collectNotesForCase(caseId),
    captureFavorites: captureRepo.collectCaptureFavoritesForCase(caseId),
    annotations: collectAnnotationsForCase(caseId),
    annotationPins: collectAnnotationPinsForCase(caseId),
    captureAnalyses: collectCaptureAnalysesForCase(caseId),
    extractedData: extractedDataRepo.collectExtractedDataForCase(caseId),
    captureArchiveRefs: waybackRefRepo.collectWaybackRefsForCase(caseId)
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// Builds and writes a self-contained .birdbrain case archive: a raw DB
// snapshot (data.json), the case's live signed manifest, every on-disk
// capture file, and a package.json header whose packageHash commits to all
// of it. Mirrors the evidence-export pipeline in export.ts: same shared
// accumulator + packageHash recipe (owned by manifest.ts), same operator-name
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
    packageHash
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
// by `capture_id` and `capture_tags`/`selector_matches` by their FKs, so they
// follow the capture/selector/tag remapping automatically — they are NOT there.

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
  opts?: { overrideTamper?: boolean },
  onProgress?: (step: string, percent: number) => void
): Promise<{ newCaseId: string; report: ArchiveInspectReport }> {
  // Step 1: operator gate.
  const settings = getSettings()
  if (!settings.operatorName?.trim()) {
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
  try {
    for (const [name, buf] of entries) {
      if (!name.startsWith('files/')) continue
      const base = name.slice('files/'.length) // <oldCaptureId>.<ext>
      // Zip-slip guard: the entry name is attacker-controlled (a crafted archive
      // can self-sign as valid), and stagingDir is later renamed into the live
      // storage root. Only a bare filename is ever legitimate here.
      if (base.length === 0 || base.includes('/') || base.includes('\\') || base.includes('..')) {
        throw new Error('Not a valid Birdbrain archive: malformed file entry name')
      }
      const dot = base.lastIndexOf('.')
      const oldCaptureId = dot === -1 ? base : base.slice(0, dot)
      const ext = dot === -1 ? '' : base.slice(dot)
      writeFileSync(join(stagingDir, mapId(oldCaptureId) + ext), buf)
    }
    writeFileSync(
      join(stagingDir, MANIFEST_FILENAME),
      entries.get(MANIFEST_FILENAME) ?? Buffer.alloc(0)
    )
    writeFileSync(join(stagingDir, 'import-id-map.json'), JSON.stringify(idMapPayload, null, 2))

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
      operatorName: settings.operatorName,
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
}
