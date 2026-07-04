import { existsSync, readFileSync, writeFileSync } from 'fs'
import { unlink } from 'fs/promises'
import { createHash } from 'crypto'
import { join } from 'path'
import * as db from '@main/services/database'
import { getStorageRoot, readCaptureFile } from '@main/services/storage'
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
  const fileTypes = ['mhtml', 'html', 'png', 'txt'] as const
  const totalFileChecks = captures.length * fileTypes.length || 1
  let fileChecks = 0
  for (const capture of captures) {
    for (const type of fileTypes) {
      const buf = readCaptureFile(caseId, capture.id, type)
      if (buf) add(`files/${capture.id}.${type}`, buf)
      fileChecks++
      onProgress?.(
        `Packaging capture files...`,
        20 + Math.round((fileChecks / totalFileChecks) * 60)
      )
    }
  }

  const sortedArtifacts = [...artifacts].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  )
  const packageHash = sha256(Buffer.from(canonicalStringify(sortedArtifacts), 'utf-8'))

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
  writeFileSync(outputPath, createStoredZip(entries))

  const caseDir = join(getStorageRoot(), caseId)
  initManifest(caseDir)
  try {
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
  const header = JSON.parse(packageEntry.toString('utf-8')) as CaseArchiveHeader

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
  const sortedArtifacts = [...header.artifacts].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  )
  const recomputedPackageHash = sha256(Buffer.from(canonicalStringify(sortedArtifacts), 'utf-8'))
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
  const data = dataEntry
    ? (JSON.parse(dataEntry.toString('utf-8')) as CaseArchiveData)
    : ({ captures: [] } as unknown as CaseArchiveData)
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
