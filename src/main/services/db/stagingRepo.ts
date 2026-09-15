import { randomUUID } from 'crypto'
import { getDb, type ImportCtx } from '@main/services/db/core'
import type { StagingFile } from '@shared/types'
import { rerootPath } from '@main/services/db/exhibitRepo'

// The Staging Pool's rows (ADR-0024): files that have arrived and been hashed
// but are NOT evidence until the operator commits them. Nothing here writes a
// Manifest Entry, because the pool sits outside the chain by design — commit
// (`803p`) is what anchors a pooled file, and discard writes nothing (X29).

interface StagingFileRow {
  id: string
  case_id: string
  kind: string
  origin: string
  name: string
  content_hash: string
  path: string
  size_bytes: number
  arrived_at: string
  source_url: string | null
  source_claims: string | null
}

function toStagingFile(row: StagingFileRow): StagingFile {
  return {
    id: row.id,
    caseId: row.case_id,
    kind: row.kind,
    origin: row.origin,
    name: row.name,
    contentHash: row.content_hash,
    path: row.path,
    sizeBytes: row.size_bytes,
    arrivedAt: row.arrived_at,
    sourceUrl: row.source_url,
    sourceClaims: row.source_claims
  }
}

export interface InsertStagingFileParams {
  caseId: string
  kind: string
  origin: string
  name: string
  contentHash: string
  path: string
  sizeBytes: number
  arrivedAt: string
  // Stated, unverified provenance. Kept nullable so an absent claim stays
  // absent rather than becoming an empty one.
  sourceUrl?: string | null
  sourceClaims?: string | null
  id?: string
}

export function insertStagingFile(params: InsertStagingFileParams): StagingFile {
  const {
    caseId,
    kind,
    origin,
    name,
    contentHash,
    path,
    sizeBytes,
    arrivedAt,
    sourceUrl = null,
    sourceClaims = null
  } = params
  const id = params.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO staging_files (
         id, case_id, kind, origin, name, content_hash, path, size_bytes,
         arrived_at, source_url, source_claims
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      caseId,
      kind,
      origin,
      name,
      contentHash,
      path,
      sizeBytes,
      arrivedAt,
      sourceUrl,
      sourceClaims
    )
  return getStagingFile(id)!
}

export function getStagingFile(id: string): StagingFile | undefined {
  const row = getDb().prepare('SELECT * FROM staging_files WHERE id = ?').get(id) as
    StagingFileRow | undefined
  return row ? toStagingFile(row) : undefined
}

export function listStagingFiles(caseId: string): StagingFile[] {
  const rows = getDb()
    .prepare('SELECT * FROM staging_files WHERE case_id = ? ORDER BY arrived_at, id')
    .all(caseId) as StagingFileRow[]
  return rows.map(toStagingFile)
}

export function deleteStagingFile(id: string): boolean {
  return getDb().prepare('DELETE FROM staging_files WHERE id = ?').run(id).changes > 0
}

// --- Archive round trip (#1148, X12) ----------------------------------------

export function collectStagingFilesForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare('SELECT * FROM staging_files WHERE case_id = ? ORDER BY arrived_at, id')
    .all(caseId) as Record<string, unknown>[]
}

// Pooled rows come back to the pool and never as anchored (X12): this writes
// `staging_files` only, and nothing here can reach `exhibits` or the manifest.
export function importStagingFileRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT INTO staging_files (
       id, case_id, kind, origin, name, content_hash, path, size_bytes,
       arrived_at, source_url, source_claims
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const row of rows) {
    const oldId = row.id as string
    const newId = ctx.mapId(oldId)
    insert.run(
      newId,
      ctx.newCaseId,
      row.kind,
      row.origin,
      row.name,
      row.content_hash,
      rerootPath(row.path as string, ctx.newCaseId, oldId, newId),
      row.size_bytes,
      row.arrived_at,
      row.source_url ?? null,
      row.source_claims ?? null
    )
  }
}
