import { randomUUID } from 'crypto'
import { getDb } from '@main/services/db/core'
import type { DerivedFile } from '@shared/types'

// Derived Files: bytes computed FROM an Exhibit (ADR-0023, X3/X17). Every row
// records what produced it — the parent, the derivation name, the tool version
// and the time — which is what lets an investigation graph be reconstructed
// later without Entity or Link tables.

interface DerivedFileRow {
  id: string
  exhibit_id: string
  derivation: string
  tool_version: string
  content_hash: string
  path: string
  created_at: string
  manifest_seq: number | null
}

function toDerivedFile(row: DerivedFileRow): DerivedFile {
  return {
    id: row.id,
    exhibitId: row.exhibit_id,
    derivation: row.derivation,
    toolVersion: row.tool_version,
    contentHash: row.content_hash,
    path: row.path,
    createdAt: row.created_at,
    manifestSeq: row.manifest_seq
  }
}

export interface InsertDerivedFileParams {
  exhibitId: string
  derivation: string
  toolVersion: string
  contentHash: string
  path: string
  createdAt: string
  // Omitted or null means the file is recorded but NOT anchored — X34's case: a
  // legacy thumbnail whose source screenshot is missing or fails verification.
  manifestSeq?: number | null
  id?: string
}

export function insertDerivedFile(params: InsertDerivedFileParams): DerivedFile {
  const {
    exhibitId,
    derivation,
    toolVersion,
    contentHash,
    path,
    createdAt,
    manifestSeq = null
  } = params
  const id = params.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO derived_files (
         id, exhibit_id, derivation, tool_version, content_hash, path, created_at, manifest_seq
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, exhibitId, derivation, toolVersion, contentHash, path, createdAt, manifestSeq)
  return getDerivedFile(id)!
}

export function getDerivedFile(id: string): DerivedFile | undefined {
  const row = getDb().prepare('SELECT * FROM derived_files WHERE id = ?').get(id) as
    DerivedFileRow | undefined
  return row ? toDerivedFile(row) : undefined
}

export function listDerivedFilesForExhibit(exhibitId: string): DerivedFile[] {
  const rows = getDb()
    .prepare('SELECT * FROM derived_files WHERE exhibit_id = ? ORDER BY derivation, created_at')
    .all(exhibitId) as DerivedFileRow[]
  return rows.map(toDerivedFile)
}

export function listDerivedFilesForCase(caseId: string): DerivedFile[] {
  const rows = getDb()
    .prepare(
      `SELECT d.* FROM derived_files d
         JOIN exhibits e ON e.id = d.exhibit_id
        WHERE e.case_id = ?
        ORDER BY e.exhibit_number, d.derivation, d.created_at`
    )
    .all(caseId) as DerivedFileRow[]
  return rows.map(toDerivedFile)
}

// Whether a parent already carries a Derived File of this derivation. The
// thumbnail backfill's idempotence key: a second run must not re-anchor bytes
// the chain already covers.
export function hasDerivation(exhibitId: string, derivation: string): boolean {
  return (
    getDb()
      .prepare('SELECT 1 FROM derived_files WHERE exhibit_id = ? AND derivation = ?')
      .get(exhibitId, derivation) !== undefined
  )
}
