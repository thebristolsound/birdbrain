import { v4 as uuid } from 'uuid'
import type { ArchiveRef, WaybackSnapshot } from '@shared/types'
import { getDb, type ImportCtx } from '@main/services/db/core'

export function createArchiveRef(params: {
  captureId: string
  snapshot: WaybackSnapshot
  checkedAt: string
}): ArchiveRef {
  const id = uuid()
  const now = new Date().toISOString()
  const { snapshot } = params
  getDb()
    .prepare(
      `INSERT INTO capture_archive_refs
         (id, capture_id, snapshot_timestamp, snapshot_url, original_url, digest, status_code, mime_type, checked_at, pinned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.captureId,
      snapshot.timestamp,
      snapshot.snapshotUrl,
      snapshot.originalUrl,
      snapshot.digest ?? null,
      snapshot.statusCode ?? null,
      snapshot.mimeType ?? null,
      params.checkedAt,
      now
    )
  return getArchiveRef(id)!
}

export function getArchiveRef(id: string): ArchiveRef | undefined {
  const row = getDb().prepare('SELECT * FROM capture_archive_refs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToArchiveRef(row) : undefined
}

export function listArchiveRefs(captureId: string): ArchiveRef[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM capture_archive_refs WHERE capture_id = ? ORDER BY snapshot_timestamp DESC'
    )
    .all(captureId) as Array<Record<string, unknown>>
  return rows.map(rowToArchiveRef)
}

export function deleteArchiveRef(id: string): boolean {
  const result = getDb().prepare('DELETE FROM capture_archive_refs WHERE id = ?').run(id)
  return result.changes > 0
}

function rowToArchiveRef(row: Record<string, unknown>): ArchiveRef {
  return {
    id: row.id as string,
    captureId: row.capture_id as string,
    snapshotTimestamp: row.snapshot_timestamp as string,
    snapshotUrl: row.snapshot_url as string,
    originalUrl: row.original_url as string,
    digest: (row.digest as string) || undefined,
    statusCode: (row.status_code as number) ?? undefined,
    mimeType: (row.mime_type as string) || undefined,
    checkedAt: row.checked_at as string,
    pinnedAt: row.pinned_at as string
  }
}

// --- Archive bulk ops ---

export function collectArchiveRefsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT ar.* FROM capture_archive_refs ar
       JOIN captures c ON c.id = ar.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]
}

export function importArchiveRefRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT INTO capture_archive_refs (id, capture_id, snapshot_timestamp, snapshot_url, original_url, digest, status_code, mime_type, checked_at, pinned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const ar of rows) {
    insert.run(
      ctx.mapId(ar.id as string),
      ctx.mapId(ar.capture_id as string),
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
}
