import { v4 as uuid } from 'uuid'
import type { Tag } from '@shared/types'
import type {
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  NoteTagParams,
  MergeTagsParams,
  MergeTagsResult
} from '@shared/ipc'
import { getDb, type ImportCtx } from '@main/services/db/core'

export function listTags(): Tag[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY name').all() as Tag[]
}

export function getTag(id: string): Tag | undefined {
  return getDb().prepare('SELECT * FROM tags WHERE id = ?').get(id) as Tag | undefined
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

// Batch counterpart of addTagToCapture (#394): INSERT OR IGNORE per id in one
// transaction, so re-tagging is a no-op and a mid-list failure applies nothing.
// Returns the ids applied (every given id carries the tag afterwards), not the
// rows that were newly inserted.
export function addTagToCaptures(captureIds: string[], tagId: string): number {
  if (captureIds.length === 0) return 0
  const d = getDb()
  const run = d.transaction(() => {
    const insert = d.prepare(
      'INSERT OR IGNORE INTO capture_tags (capture_id, tag_id) VALUES (?, ?)'
    )
    for (const id of captureIds) insert.run(id, tagId)
    return captureIds.length
  })
  return run()
}

/**
 * Merge one tag into another (#828): re-point every capture_tags and note_tags
 * row from source to target, then delete the source, in one transaction.
 * INSERT OR IGNORE carries the re-point past rows whose capture or note
 * already holds the target — the join tables' primary keys make a plain UPDATE
 * fail on exactly those — and deleting the source afterwards lets ON DELETE
 * CASCADE clear the duplicate rows the IGNORE skipped. Never a
 * create-then-copy shape (#811): both tags must already exist, so the UNIQUE
 * name constraint is never in play and no write precedes the lookups.
 *
 * The self-merge guard is load-bearing, not defensive: without it the inserts
 * would no-op and the delete would destroy the tag and every link it holds.
 *
 * note_references rows citing the source are deliberately left to dangle:
 * that index is derived from note body docs, which still cite the source id,
 * and a Mention of a merged-away tag resolves as a broken reference at read
 * time — the same outcome deleteTag already produces.
 *
 * Returns undefined when either tag is missing or source === target.
 */
export function mergeTags(params: MergeTagsParams): MergeTagsResult | undefined {
  const { sourceId, targetId } = params
  if (sourceId === targetId) return undefined
  const d = getDb()
  const run = d.transaction((): MergeTagsResult | undefined => {
    const source = d.prepare('SELECT * FROM tags WHERE id = ?').get(sourceId) as Tag | undefined
    const target = d.prepare('SELECT * FROM tags WHERE id = ?').get(targetId) as Tag | undefined
    if (!source || !target) return undefined
    d.prepare(
      `INSERT OR IGNORE INTO capture_tags (capture_id, tag_id)
       SELECT capture_id, ? FROM capture_tags WHERE tag_id = ?`
    ).run(targetId, sourceId)
    d.prepare(
      `INSERT OR IGNORE INTO note_tags (note_id, tag_id)
       SELECT note_id, ? FROM note_tags WHERE tag_id = ?`
    ).run(targetId, sourceId)
    d.prepare('DELETE FROM tags WHERE id = ?').run(sourceId)
    const count = (table: string): number =>
      (d.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tag_id = ?`).get(targetId) as {
        n: number
      }).n
    return { target, captureLinks: count('capture_tags'), noteLinks: count('note_tags') }
  })
  return run()
}

export function removeTagFromCapture(params: CaptureTagParams): void {
  getDb()
    .prepare('DELETE FROM capture_tags WHERE capture_id = ? AND tag_id = ?')
    .run(params.captureId, params.tagId)
}

/**
 * Create-or-reuse by name (#391, ruling R15). `tags.name` is NOT NULL UNIQUE
 * and `createTag` is a bare INSERT, so a caller that names an existing tag
 * gets a constraint failure rather than the tag it asked for (#811).
 *
 * The exact-name lookup runs before the case-insensitive one for the reason
 * PR #835's review gave for the extension path: `Evidence` and `evidence` can
 * both exist, and the insensitive query could return either — attaching a tag
 * with a different identity and colour than the one the operator named.
 */
export function findOrCreateTagByName(name: string): Tag {
  const exactId = findTagIdByNameExact(name)
  const foundId = exactId ?? findTagIdByNameInsensitive(name)
  const found = foundId ? getTag(foundId) : undefined
  return found ?? createTag({ name })
}

// Note-level tags (#391). INSERT OR IGNORE for the same reason
// addTagToCapture uses it: applying a tag a note already carries is a no-op,
// not an error the operator has to read.
export function addTagToNote(params: NoteTagParams): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)')
    .run(params.noteId, params.tagId)
}

export function removeTagFromNote(params: NoteTagParams): void {
  getDb()
    .prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?')
    .run(params.noteId, params.tagId)
}

export function getTagsForNote(noteId: string): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t
       JOIN note_tags nt ON t.id = nt.tag_id
       WHERE nt.note_id = ?
       ORDER BY t.name`
    )
    .all(noteId) as Tag[]
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

/**
 * Which of the `limit` most recent captures in the case carry each tag (#400).
 * The tag half of the Signals coverage strip; `getTagUsageCountsForCase` gives
 * counts only. Bounded in SQL for the same reason as the selector matrix, and
 * a tag with no capture among those is absent rather than present-and-empty.
 */
export function getTagCaptureMatrix(caseId: string, limit: number): Record<string, string[]> {
  const rows = getDb()
    .prepare(
      `SELECT ct.tag_id, ct.capture_id
       FROM capture_tags ct
       JOIN (
         SELECT id FROM captures WHERE case_id = ? ORDER BY timestamp DESC LIMIT ?
       ) recent ON recent.id = ct.capture_id`
    )
    .all(caseId, limit) as Array<{ tag_id: string; capture_id: string }>

  const matrix: Record<string, string[]> = {}
  for (const row of rows) {
    ;(matrix[row.tag_id] ??= []).push(row.capture_id)
  }
  return matrix
}

// --- Archive bulk ops ---

// Every tag the case reaches, by either relation. The note_tags half is not
// optional (#391): a tag carried only by a note would otherwise be absent from
// data.json while note_tags cited it, so the import would either fail its
// foreign key or bind the note to whatever local tag already held that id.
export function collectTagsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT t.* FROM tags t
       JOIN capture_tags ct ON ct.tag_id = t.id
       JOIN captures c ON c.id = ct.capture_id
       WHERE c.case_id = ?
       UNION
       SELECT DISTINCT t.* FROM tags t
       JOIN note_tags nt ON nt.tag_id = t.id
       JOIN notes n ON n.id = nt.note_id
       WHERE n.case_id = ?`
    )
    .all(caseId, caseId) as Record<string, unknown>[]
}

export function collectNoteTagsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT nt.* FROM note_tags nt
       JOIN notes n ON n.id = nt.note_id
       WHERE n.case_id = ?`
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

export function findTagIdByNameExact(name: string): string | undefined {
  const hit = getDb().prepare('SELECT id FROM tags WHERE name = ?').get(name) as
    | { id: string }
    | undefined
  return hit?.id
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

// Must run AFTER importNoteRows: note_tags has a foreign key onto notes and
// `foreign_keys = ON` is set for every connection.
export function importNoteTagRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)')
  for (const nt of rows) {
    insert.run(ctx.mapId(nt.note_id as string), ctx.mapTag(nt.tag_id as string))
  }
}
