import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'fs'
import { unlink } from 'fs/promises'
import { createHash, randomUUID } from 'crypto'
import { join } from 'path'
import * as db from '@main/services/database'
import { getStorageRoot } from '@main/services/storage'
import { CAPTURE_ARTIFACT_TYPES, defaultCaptureStore } from '@main/services/captureStore'
import { getSettings } from '@main/services/settings'
import { getInstallationId } from '@main/services/installationId'
import { getPublicKeyPem } from '@main/services/signingKey'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { createStoredZip } from '@main/services/zip'
import { readStoredZip } from '@main/services/zipRead'
import { canonicalStringify, verifyManifestChainText } from '@shared/verify'
import { resolveToolVersion } from '@main/services/certification'
import { MANIFEST_FILENAME } from '@shared/constants'
import type {
  ArchiveInspectReport,
  ArchiveVerificationResult,
  CaseArchiveCounts
} from '@shared/types'

export const CASE_ARCHIVE_SCHEMA_VERSION = 1

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

interface CaseArchiveArtifact {
  path: string
  sha256: string
  sizeBytes: number
}

interface CaseArchiveHeader {
  schemaVersion: 1
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
  artifacts: CaseArchiveArtifact[]
  packageHash: string
}

// Collects every row belonging to `caseId` across the tables a .birdbrain
// archive bundles, as raw snake_case DB rows (no camelCase mapping — the
// archive is a portable snapshot of the schema, not a domain model).
export function collectCaseData(caseId: string): CaseArchiveData {
  const d = db.getDb()

  const caseRow = d.prepare('SELECT * FROM cases WHERE id = ?').get(caseId) as
    Record<string, unknown> | undefined
  if (!caseRow) throw new Error(`Case not found: ${caseId}`)

  const captures = d
    .prepare('SELECT * FROM captures WHERE case_id = ? ORDER BY timestamp')
    .all(caseId) as Record<string, unknown>[]

  const tags = d
    .prepare(
      `SELECT DISTINCT t.* FROM tags t
       JOIN capture_tags ct ON ct.tag_id = t.id
       JOIN captures c ON c.id = ct.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]

  const captureTags = d
    .prepare(
      `SELECT ct.* FROM capture_tags ct
       JOIN captures c ON c.id = ct.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]

  const selectors = d.prepare('SELECT * FROM selectors WHERE case_id = ?').all(caseId) as Record<
    string,
    unknown
  >[]

  const selectorMatches = d
    .prepare(
      `SELECT sm.* FROM selector_matches sm
       JOIN captures c ON c.id = sm.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]

  const notes = d.prepare('SELECT * FROM notes WHERE case_id = ?').all(caseId) as Record<
    string,
    unknown
  >[]

  const captureFavorites = d
    .prepare(
      `SELECT cf.* FROM capture_favorites cf
       JOIN captures c ON c.id = cf.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]

  const annotations = d
    .prepare(
      `SELECT a.* FROM annotations a
       JOIN captures c ON c.id = a.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]

  const annotationPins = d
    .prepare(
      `SELECT p.* FROM annotation_pins p
       JOIN captures c ON c.id = p.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]

  const captureAnalyses = d
    .prepare('SELECT ca.* FROM capture_analyses ca WHERE ca.case_id = ?')
    .all(caseId) as Record<string, unknown>[]

  const extractedData = d
    .prepare('SELECT * FROM extracted_data WHERE case_id = ?')
    .all(caseId) as Record<string, unknown>[]

  const captureArchiveRefs = d
    .prepare(
      `SELECT ar.* FROM capture_archive_refs ar
       JOIN captures c ON c.id = ar.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]

  return {
    case: caseRow,
    captures,
    tags,
    captureTags,
    selectors,
    selectorMatches,
    notes,
    captureFavorites,
    annotations,
    annotationPins,
    captureAnalyses,
    extractedData,
    captureArchiveRefs
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// The tamper-check hash tying all artifacts together. Export and inspect MUST
// compute it identically, so the recipe lives in one place: sort by path, then
// sha256 of the canonical JSON. Never hashes the zip itself (circular).
function computePackageHash(artifacts: CaseArchiveArtifact[]): string {
  const sorted = [...artifacts].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return sha256(Buffer.from(canonicalStringify(sorted), 'utf-8'))
}

// Builds and writes a self-contained .birdbrain case archive: a raw DB
// snapshot (data.json), the case's live signed manifest, every on-disk
// capture file, and a package.json header whose packageHash commits to all
// of it. Mirrors the evidence-export pipeline in export.ts: same hashing
// accumulator, same packageHash recipe, same operator-name gate, same
// orphan-cleanup ordering on manifest-append failure.
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

  const entries: Array<{ name: string; data: Buffer | string }> = []
  const artifacts: CaseArchiveArtifact[] = []
  const add = (name: string, value: Buffer | string): string => {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf-8')
    const digest = sha256(buf)
    entries.push({ name, data: buf })
    artifacts.push({ path: name, sha256: digest, sizeBytes: buf.length })
    return digest
  }

  add('data.json', JSON.stringify(data, null, 2))

  const manifestPath = join(getStorageRoot(), caseId, MANIFEST_FILENAME)
  const manifestJsonl = existsSync(manifestPath) ? readFileSync(manifestPath) : Buffer.alloc(0)
  add('manifest.jsonl', manifestJsonl)

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
  const caseDir = join(getStorageRoot(), caseId)
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

// Tables whose primary key is a standalone row id that could collide with an
// existing local row on import. `annotations`/`capture_favorites` are keyed by
// `capture_id` and `capture_tags`/`selector_matches` by their FKs, so they
// follow the capture/selector/tag remapping automatically — they are NOT here.
const ID_REMAP_TABLES = [
  'captures',
  'notes',
  'selectors',
  'capture_analyses',
  'extracted_data',
  'capture_archive_refs',
  'annotation_pins'
] as const

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
  const d = db.getDb()
  const idMap: Record<string, string> = {}
  const tableRows: Record<(typeof ID_REMAP_TABLES)[number], Record<string, unknown>[]> = {
    captures: data.captures,
    notes: data.notes,
    selectors: data.selectors,
    capture_analyses: data.captureAnalyses,
    extracted_data: data.extractedData,
    capture_archive_refs: data.captureArchiveRefs,
    annotation_pins: data.annotationPins
  }
  for (const table of ID_REMAP_TABLES) {
    const check = d.prepare(`SELECT 1 FROM ${table} WHERE id = ?`)
    for (const row of tableRows[table]) {
      const oldId = row.id as string | undefined
      if (!oldId || idMap[oldId]) continue
      if (check.get(oldId)) idMap[oldId] = randomUUID()
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
    const insertAll = d.transaction(() => {
      insertImportedRows(d, data, newCaseId, mapId)
    })
    insertAll()
  } catch (err) {
    rmSync(caseDir, { recursive: true, force: true })
    throw err
  }

  // Step 9.
  onProgress?.('Complete', 100)
  return { newCaseId, report }
}

// Re-inserts all archived rows into the DB under `newCaseId`, remapping row ids
// via `mapId` and merging tags by case-insensitive name. Runs inside the
// caller's transaction. Reads the moved-into-place .txt sidecars through the
// capture store for the captures_fts content column.
function insertImportedRows(
  d: import('better-sqlite3').Database,
  data: CaseArchiveData,
  newCaseId: string,
  mapId: (id: string) => string
): void {
  const caseRow = data.case as Record<string, unknown>
  d.prepare(
    `INSERT INTO cases (id, name, description, type, created_at, updated_at, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newCaseId,
    caseRow.name ?? null,
    caseRow.description ?? null,
    caseRow.type ?? 'custom',
    caseRow.created_at ?? null,
    caseRow.updated_at ?? null,
    caseRow.archived ?? 0
  )

  // Tags: merge by case-insensitive name; keep the archived id when free.
  const tagIdMap: Record<string, string> = {}
  const findTag = d.prepare('SELECT id FROM tags WHERE lower(name) = lower(?)')
  const tagIdTaken = d.prepare('SELECT 1 FROM tags WHERE id = ?')
  const insertTag = d.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)')
  for (const tag of data.tags) {
    const oldId = tag.id as string
    const hit = findTag.get(tag.name as string) as { id: string } | undefined
    if (hit) {
      tagIdMap[oldId] = hit.id
      continue
    }
    const newId = tagIdTaken.get(oldId) ? randomUUID() : oldId
    insertTag.run(newId, tag.name ?? null, tag.color ?? null)
    tagIdMap[oldId] = newId
  }
  const mapTag = (id: string): string => tagIdMap[id] ?? id

  // Captures: raw INSERT mirroring insertCapture's column list, plus the
  // capture_texts row using the staged .txt sidecar content when present
  // (triggers keep captures_fts in sync).
  const insertCap = d.prepare(
    `INSERT INTO captures (
       id, case_id, url, title, html_path, screenshot_path, hash, timestamp, headers, created_at,
       format, mhtml_path, screenshot_hash, text_hash, tls_cert_chain, size_bytes, manifest_index, prev_hash, entry_hash,
       tool_version, extension_version, browser_version, user_agent, http_status,
       operator_id, operator_name, last_verified_at, last_verified_hash, last_verified_status,
       trusted_time_status, method, supersedes_capture_id, consent_suppression
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertText = d.prepare(
    'INSERT INTO capture_texts (capture_id, title, url, content) VALUES (?, ?, ?, ?)'
  )
  for (const cap of data.captures) {
    const newId = mapId(cap.id as string)
    insertCap.run(
      newId,
      newCaseId,
      cap.url ?? null,
      cap.title ?? null,
      cap.html_path ?? null,
      cap.screenshot_path ?? null,
      cap.hash ?? null,
      cap.timestamp ?? null,
      cap.headers ?? null,
      cap.created_at ?? null,
      cap.format ?? 'html',
      cap.mhtml_path ?? null,
      cap.screenshot_hash ?? null,
      cap.text_hash ?? null,
      cap.tls_cert_chain ?? null,
      cap.size_bytes ?? null,
      cap.manifest_index ?? null,
      cap.prev_hash ?? null,
      cap.entry_hash ?? null,
      cap.tool_version ?? null,
      cap.extension_version ?? null,
      cap.browser_version ?? null,
      cap.user_agent ?? null,
      cap.http_status ?? null,
      cap.operator_id ?? null,
      cap.operator_name ?? null,
      cap.last_verified_at ?? null,
      cap.last_verified_hash ?? null,
      cap.last_verified_status ?? null,
      cap.trusted_time_status ?? null,
      cap.method ?? 'extension',
      cap.supersedes_capture_id ? mapId(cap.supersedes_capture_id as string) : null,
      cap.consent_suppression ?? null
    )
    const textContent =
      defaultCaptureStore.readArtifact(newCaseId, newId, 'txt')?.toString('utf-8') ?? ''
    insertText.run(newId, (cap.title as string) ?? '', (cap.url as string) ?? '', textContent)
  }

  const insertCaptureTag = d.prepare(
    'INSERT OR IGNORE INTO capture_tags (capture_id, tag_id) VALUES (?, ?)'
  )
  for (const ct of data.captureTags) {
    insertCaptureTag.run(mapId(ct.capture_id as string), mapTag(ct.tag_id as string))
  }

  // Selectors (case_id remapped).
  const insertSelector = d.prepare(
    `INSERT INTO selectors (id, case_id, pattern, is_regex, enabled, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const s of data.selectors) {
    insertSelector.run(
      mapId(s.id as string),
      newCaseId,
      s.pattern ?? null,
      s.is_regex ?? 0,
      s.enabled ?? 1,
      s.label ?? null,
      s.created_at ?? null
    )
  }

  const insertSelectorMatch = d.prepare(
    'INSERT INTO selector_matches (selector_id, capture_id) VALUES (?, ?)'
  )
  for (const sm of data.selectorMatches) {
    insertSelectorMatch.run(mapId(sm.selector_id as string), mapId(sm.capture_id as string))
  }

  const insertFavorite = d.prepare(
    'INSERT INTO capture_favorites (capture_id, created_at) VALUES (?, ?)'
  )
  for (const f of data.captureFavorites) {
    insertFavorite.run(mapId(f.capture_id as string), f.created_at ?? null)
  }

  const insertAnnotation = d.prepare(
    `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width, image_height, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const a of data.annotations) {
    insertAnnotation.run(
      mapId(a.capture_id as string),
      a.schema_version ?? null,
      a.shapes_json ?? null,
      a.image_width ?? null,
      a.image_height ?? null,
      a.updated_at ?? null,
      a.updated_by ?? null
    )
  }

  const insertPin = d.prepare(
    `INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const p of data.annotationPins) {
    insertPin.run(
      mapId(p.id as string),
      mapId(p.capture_id as string),
      p.number ?? null,
      p.body ?? null,
      p.created_at ?? null,
      p.updated_at ?? null
    )
  }

  const insertAnalysis = d.prepare(
    `INSERT INTO capture_analyses (id, capture_id, case_id, content, model, token_usage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const ca of data.captureAnalyses) {
    insertAnalysis.run(
      mapId(ca.id as string),
      mapId(ca.capture_id as string),
      newCaseId,
      ca.content ?? null,
      ca.model ?? null,
      ca.token_usage ?? null,
      ca.created_at ?? null,
      ca.updated_at ?? null
    )
  }

  // extracted_data (case_id remapped; extracted_data_fts maintained by trigger).
  const insertExtracted = d.prepare(
    `INSERT INTO extracted_data (id, capture_id, case_id, category, subcategory, value, source_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const ed of data.extractedData) {
    insertExtracted.run(
      mapId(ed.id as string),
      mapId(ed.capture_id as string),
      newCaseId,
      ed.category ?? null,
      ed.subcategory ?? null,
      ed.value ?? null,
      ed.source_url ?? null,
      ed.created_at ?? null
    )
  }

  const insertArchiveRef = d.prepare(
    `INSERT INTO capture_archive_refs (id, capture_id, snapshot_timestamp, snapshot_url, original_url, digest, status_code, mime_type, checked_at, pinned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const ar of data.captureArchiveRefs) {
    insertArchiveRef.run(
      mapId(ar.id as string),
      mapId(ar.capture_id as string),
      ar.snapshot_timestamp ?? null,
      ar.snapshot_url ?? null,
      ar.original_url ?? null,
      ar.digest ?? null,
      ar.status_code ?? null,
      ar.mime_type ?? null,
      ar.checked_at ?? null,
      ar.pinned_at ?? null
    )
  }

  // notes (case_id remapped; capture_id remapped; notes_fts maintained by trigger).
  const insertNote = d.prepare(
    `INSERT INTO notes (id, case_id, capture_id, title, body, source_url, screenshot_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const n of data.notes) {
    insertNote.run(
      mapId(n.id as string),
      newCaseId,
      n.capture_id ? mapId(n.capture_id as string) : null,
      n.title ?? '',
      n.body ?? '',
      n.source_url ?? null,
      n.screenshot_path ?? null,
      n.created_at ?? null,
      n.updated_at ?? null
    )
  }
}
