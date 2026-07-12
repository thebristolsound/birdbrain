import { v4 as uuid } from 'uuid'
import type { Tag } from '@shared/types'
import type { CreateTagParams, UpdateTagParams, CaptureTagParams } from '@shared/ipc'
import { getDb, type ImportCtx } from '@main/services/db/core'

export function listTags(): Tag[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY name').all() as Tag[]
}

export function createTag(params: CreateTagParams): Tag {
  const id = uuid()
  getDb()
    .prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)')
    .run(id, params.name, params.color ?? null)
  return { id, name: params.name, color: params.color }
}

export function updateTag(params: UpdateTagParams): Tag | undefined {
  const existing = getDb().prepare('SELECT * FROM tags WHERE id = ?').get(params.id) as
    | Tag
    | undefined
  if (!existing) return undefined
  getDb()
    .prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?')
    .run(params.name ?? existing.name, params.color ?? existing.color ?? null, params.id)
  return getDb().prepare('SELECT * FROM tags WHERE id = ?').get(params.id) as Tag
}

export function deleteTag(id: string): boolean {
  const result = getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
  return result.changes > 0
}

export function addTagToCapture(params: CaptureTagParams): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO capture_tags (capture_id, tag_id) VALUES (?, ?)')
    .run(params.captureId, params.tagId)
}

export function removeTagFromCapture(params: CaptureTagParams): void {
  getDb()
    .prepare('DELETE FROM capture_tags WHERE capture_id = ? AND tag_id = ?')
    .run(params.captureId, params.tagId)
}

export function getTagsForCapture(captureId: string): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t
       JOIN capture_tags ct ON t.id = ct.tag_id
       WHERE ct.capture_id = ?
       ORDER BY t.name`
    )
    .all(captureId) as Tag[]
}

export function getTagCountForCase(caseId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT ct.tag_id) as count
       FROM capture_tags ct
       JOIN captures c ON ct.capture_id = c.id
       WHERE c.case_id = ?`
    )
    .get(caseId) as { count: number } | undefined
  return row?.count ?? 0
}

export function getTagUsageCountsForCase(caseId: string): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT ct.tag_id, COUNT(*) as count
       FROM capture_tags ct
       JOIN captures c ON ct.capture_id = c.id
       WHERE c.case_id = ?
       GROUP BY ct.tag_id`
    )
    .all(caseId) as Array<{ tag_id: string; count: number }>
  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.tag_id] = row.count
  }
  return result
}

// --- Archive bulk ops ---

export function collectTagsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT t.* FROM tags t
       JOIN capture_tags ct ON ct.tag_id = t.id
       JOIN captures c ON c.id = ct.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]
}

export function collectCaptureTagsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT ct.* FROM capture_tags ct
       JOIN captures c ON c.id = ct.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]
}

export function findTagIdByNameInsensitive(name: string): string | undefined {
  const hit = getDb().prepare('SELECT id FROM tags WHERE lower(name) = lower(?)').get(name) as
    | { id: string }
    | undefined
  return hit?.id
}

export function tagIdExists(id: string): boolean {
  return getDb().prepare('SELECT 1 FROM tags WHERE id = ?').get(id) !== undefined
}

// Rows arrive with their FINAL ids — merge-by-name policy is caseArchive's.
export function importTagRows(rows: Record<string, unknown>[]): void {
  const insert = getDb().prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)')
  for (const tag of rows) {
    insert.run(tag.id as string, tag.name ?? null, tag.color ?? null)
  }
}

export function importCaptureTagRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    'INSERT OR IGNORE INTO capture_tags (capture_id, tag_id) VALUES (?, ?)'
  )
  for (const ct of rows) {
    insert.run(ctx.mapId(ct.capture_id as string), ctx.mapTag(ct.tag_id as string))
  }
}
