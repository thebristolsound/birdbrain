// Pinned Wayback Machine corroboration references (#wayback).
//
// Name mapping: this module reads and writes the SQLite table
// `capture_archive_refs` (index `idx_archive_refs_capture`), created in
// migration v21 under the domain's older "archive" name. The table keeps that
// name — renaming it would be a migration for zero user value — so "archive"
// in a SQL string here means this Wayback table, not the .birdbrain case
// archive and not the `archived` soft-delete flag.

import { v4 as uuid } from 'uuid'
import type { CaseWaybackRef, WaybackRef, WaybackSnapshot } from '@shared/types'
import { getDb, type ImportCtx } from '@main/services/db/core'

export function createWaybackRef(params: {
  captureId: string
  snapshot: WaybackSnapshot
  checkedAt: string
}): WaybackRef {
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
  return getWaybackRef(id)!
}

export function getWaybackRef(id: string): WaybackRef | undefined {
  const row = getDb().prepare('SELECT * FROM capture_archive_refs WHERE id = ?').get(id) as
    Record<string, unknown> | undefined
  return row ? rowToWaybackRef(row) : undefined
}

export function listWaybackRefs(captureId: string): WaybackRef[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM capture_archive_refs WHERE capture_id = ? ORDER BY snapshot_timestamp DESC'
    )
    .all(captureId) as Array<Record<string, unknown>>
  return rows.map(rowToWaybackRef)
}

/**
 * Every pinned reference in a case, newest snapshot first, each carrying the
 * timestamp of the capture it hangs off. One read for surfaces that show pins
 * across captures — the export dialog and the export itself — rather than one
 * query per capture.
 */
export function listWaybackRefsForCase(caseId: string): CaseWaybackRef[] {
  const rows = getDb()
    .prepare(
      `SELECT ar.*, c.timestamp AS capture_timestamp
       FROM capture_archive_refs ar
       JOIN captures c ON c.id = ar.capture_id
       WHERE c.case_id = ?
       ORDER BY ar.snapshot_timestamp DESC`
    )
    .all(caseId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    ...rowToWaybackRef(row),
    captureTimestamp: row.capture_timestamp as string
  }))
}

export function deleteWaybackRef(id: string): boolean {
  const result = getDb().prepare('DELETE FROM capture_archive_refs WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * The CDX HTTP status, or nothing. `status_code` is declared INTEGER, but SQLite
 * affinity stores a non-numeric string as TEXT, so a row written by a path that
 * never validated it — a Case Archive import, or the generic table editor
 * in Settings → Database — can carry arbitrary text under a column the rest of the
 * app reads as a number. Dropped rather than surfaced: a value that is not a
 * number is not an HTTP status, and every consumer already renders a reference
 * that has none (the CDX row may legitimately omit it).
 */
function toStatusCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function rowToWaybackRef(row: Record<string, unknown>): WaybackRef {
  return {
    id: row.id as string,
    captureId: row.capture_id as string,
    snapshotTimestamp: row.snapshot_timestamp as string,
    snapshotUrl: row.snapshot_url as string,
    originalUrl: row.original_url as string,
    digest: (row.digest as string) || undefined,
    statusCode: toStatusCode(row.status_code),
    mimeType: (row.mime_type as string) || undefined,
    checkedAt: row.checked_at as string,
    pinnedAt: row.pinned_at as string
  }
}

// --- Case-archive bulk ops (export/import of a .birdbrain package) ---

export function collectWaybackRefsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT ar.* FROM capture_archive_refs ar
       JOIN captures c ON c.id = ar.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]
}

export function importWaybackRefRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
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
