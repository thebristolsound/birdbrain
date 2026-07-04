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
import { canonicalStringify } from '@shared/verify'
import { resolveToolVersion } from '@main/services/certification'
import { MANIFEST_FILENAME } from '@shared/constants'
import type { CaseArchiveCounts } from '@shared/types'

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
    | Record<string, unknown>
    | undefined
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

  const selectors = d
    .prepare('SELECT * FROM selectors WHERE case_id = ?')
    .all(caseId) as Record<string, unknown>[]

  const selectorMatches = d
    .prepare(
      `SELECT sm.* FROM selector_matches sm
       JOIN captures c ON c.id = sm.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]

  const notes = d
    .prepare('SELECT * FROM notes WHERE case_id = ?')
    .all(caseId) as Record<string, unknown>[]

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
