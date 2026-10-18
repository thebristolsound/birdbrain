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
import { getDb, syncColumnValues, withTransaction, type ImportCtx } from '@main/services/db/core'
import { UNDATED_TAG_CREATED_AT } from '@main/services/db/migrations'
import { isLiveLocalRow } from '@main/services/db/workingRowRepo'
import {
  allocateLocalVersion,
  deleteLocalRow,
  ensureLocalRow,
  signLocalRow
} from '@main/services/sharing/workingRows'

// The wire shape of a Tag is these three columns. `tags` also carries the
// Shared Case sync columns since v36 (#1510), which are storage and never
// part of what the renderer receives.
//
// Every reader skips tombstoned rows, and every write of this installation's
// own rows signs them (workingRows.ts, #1512): a tag or a tag application
// deleted in a Shared Case keeps its row so the deletion syncs, and is as
// gone to the app as one removed outright. Another member's tag is listed
// and applied like any other; only its author edits or deletes it.
const TAG_COLUMNS = 'id, name, color'

export function listTags(): Tag[] {
  return getDb()
    .prepare(`SELECT ${TAG_COLUMNS} FROM tags WHERE deleted_at IS NULL ORDER BY name`)
    .all() as Tag[]
}

export function getTag(id: string): Tag | undefined {
  return getDb()
    .prepare(`SELECT ${TAG_COLUMNS} FROM tags WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as Tag | undefined
}

export function createTag(params: CreateTagParams): Tag {
  return withTransaction(() => {
    // A tag this installation deleted in a Shared Case keeps its name on its
    // tombstone, and the per-author name index would refuse a second row with
    // it. Naming it again restores that tag, with the colour now asked for.
    const tombstone = getDb()
      .prepare(
        'SELECT id FROM tags WHERE author_installation_id IS NULL AND name = ? AND deleted_at IS NOT NULL'
      )
      .get(params.name) as { id: string } | undefined
    if (tombstone) {
      getDb()
        .prepare('UPDATE tags SET color = ? WHERE id = ?')
        .run(params.color ?? null, tombstone.id)
      signLocalRow('tags', { id: tombstone.id }, { deletedAt: null })
      return { id: tombstone.id, name: params.name, color: params.color }
    }
    const id = uuid()
    getDb()
      .prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(id, params.name, params.color ?? null, new Date().toISOString())
    signLocalRow('tags', { id })
    return { id, name: params.name, color: params.color }
  })
}

export function updateTag(params: UpdateTagParams): Tag | undefined {
  return withTransaction(() => {
    if (!isLiveLocalRow('tags', { id: params.id })) return undefined
    const existing = getTag(params.id)
    if (!existing) return undefined
    getDb()
      .prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?')
      .run(params.name ?? existing.name, params.color ?? existing.color ?? null, params.id)
    signLocalRow('tags', { id: params.id })
    return getTag(params.id)
  })
}

// This installation's applications of a tag that is still live, by Exhibit
// or by note.
function liveLocalApplications(table: 'exhibit_tags' | 'note_tags', tagId: string): string[] {
  const column = table === 'exhibit_tags' ? 'exhibit_id' : 'note_id'
  return (
    getDb()
      .prepare(
        `SELECT ${column} AS id FROM ${table}
          WHERE tag_id = ? AND author_installation_id IS NULL AND deleted_at IS NULL`
      )
      .all(tagId) as Array<{ id: string }>
  ).map((row) => row.id)
}

// Removes this installation's tag, and its own applications of it first:
// what the foreign keys cascade on a removed row, written out so each
// application is tombstoned where its Case is shared.
export function deleteTag(id: string): boolean {
  return withTransaction(() => {
    if (!isLiveLocalRow('tags', { id })) return false
    for (const exhibitId of liveLocalApplications('exhibit_tags', id)) {
      deleteLocalRow('exhibit_tags', { exhibit_id: exhibitId, tag_id: id })
    }
    for (const noteId of liveLocalApplications('note_tags', id)) {
      deleteLocalRow('note_tags', { note_id: noteId, tag_id: id })
    }
    return deleteLocalRow('tags', { id })
  })
}

function insertCaptureTag(captureId: string, tagId: string): void {
  getDb()
    .prepare('INSERT INTO exhibit_tags (exhibit_id, tag_id) VALUES (?, ?)')
    .run(captureId, tagId)
}

export function addTagToCapture(params: CaptureTagParams): void {
  const { captureId, tagId } = params
  ensureLocalRow('exhibit_tags', { exhibit_id: captureId, tag_id: tagId }, () =>
    insertCaptureTag(captureId, tagId)
  )
}

// Batch counterpart of addTagToCapture (#394): one transaction, so
// re-tagging is a no-op and a mid-list failure applies nothing. The batch
// shares one version. Returns the ids applied (every given id carries the
// tag afterwards), not the rows that were newly inserted.
export function addTagToCaptures(captureIds: string[], tagId: string): number {
  if (captureIds.length === 0) return 0
  return withTransaction(() => {
    const version = allocateLocalVersion()
    for (const id of captureIds) {
      ensureLocalRow(
        'exhibit_tags',
        { exhibit_id: id, tag_id: tagId },
        () => insertCaptureTag(id, tagId),
        version
      )
    }
    return captureIds.length
  })
}

/**
 * Batch untag (#665), the counterpart `addTagToCaptures` has lacked since
 * #394. One transaction, so a mid-list failure removes nothing.
 *
 * Returns the ids the tag no longer holds, deliberately the same reading as
 * `addTagToCaptures` above rather than `changes`: both answer "how many of the
 * ids you named are now in the state you asked for", so an id that never
 * carried the tag counts, exactly as re-tagging an already-tagged id counts.
 *
 * Removes only this installation's capture links. `note_tags` rows and the
 * tag row itself are untouched — untagging a selection is not deleting a tag.
 */
export function removeTagFromCaptures(captureIds: string[], tagId: string): number {
  if (captureIds.length === 0) return 0
  return withTransaction(() => {
    for (const id of captureIds) deleteLocalRow('exhibit_tags', { exhibit_id: id, tag_id: tagId })
    return captureIds.length
  })
}

/**
 * How many of these captures carry each tag (#665). Backs the batch picker's
 * none/partial/all indicator, which otherwise needs one `getTagsForCapture`
 * per selected row — 500 reads for a full selection.
 *
 * Scoped by capture id rather than by case, unlike
 * `getTagUsageCountsForCase`: the selection is a subset of one case and the
 * indicator has to reflect that subset, not the case. A tag no selected
 * capture carries is absent rather than present-and-zero, so a caller reads a
 * missing key as none.
 */
export function getTagCountsForCaptures(captureIds: string[]): Record<string, number> {
  if (captureIds.length === 0) return {}
  const unique = [...new Set(captureIds)]
  const placeholders = unique.map(() => '?').join(',')
  const rows = getDb()
    .prepare(
      `SELECT tag_id, COUNT(DISTINCT exhibit_id) as count
       FROM exhibit_tags
       WHERE exhibit_id IN (${placeholders}) AND deleted_at IS NULL
       GROUP BY tag_id`
    )
    .all(...unique) as Array<{ tag_id: string; count: number }>

  const counts: Record<string, number> = {}
  for (const row of rows) {
    counts[row.tag_id] = row.count
  }
  return counts
}

/**
 * Merge one tag into another (#828): re-point this installation's
 * exhibit_tags and note_tags rows from source to target, then delete the
 * source, in one transaction. Only this installation's rows move, because
 * only their author can sign the rows that result (#1512): another member's
 * applications of the source stay theirs, and another member's tag cannot be
 * the source at all. Both tags must already exist, so the per-author name
 * index is never in play and no write precedes the lookups (#811).
 *
 * The self-merge guard is load-bearing, not defensive: without it the
 * re-point would no-op and the delete would destroy the tag and every link
 * it holds.
 *
 * note_references rows citing the source are deliberately left to dangle:
 * that index is derived from note body docs, which still cite the source id,
 * and a Mention of a merged-away tag resolves as a broken reference at read
 * time — the same outcome deleteTag already produces.
 *
 * Returns undefined when either tag is missing, the source is not this
 * installation's, or source === target.
 */
export function mergeTags(params: MergeTagsParams): MergeTagsResult | undefined {
  const { sourceId, targetId } = params
  if (sourceId === targetId) return undefined
  return withTransaction((): MergeTagsResult | undefined => {
    if (!isLiveLocalRow('tags', { id: sourceId })) return undefined
    const source = getTag(sourceId)
    const target = getTag(targetId)
    if (!source || !target) return undefined
    const version = allocateLocalVersion()
    for (const exhibitId of liveLocalApplications('exhibit_tags', sourceId)) {
      ensureLocalRow(
        'exhibit_tags',
        { exhibit_id: exhibitId, tag_id: targetId },
        () => insertCaptureTag(exhibitId, targetId),
        version
      )
      deleteLocalRow('exhibit_tags', { exhibit_id: exhibitId, tag_id: sourceId })
    }
    for (const noteId of liveLocalApplications('note_tags', sourceId)) {
      ensureLocalRow(
        'note_tags',
        { note_id: noteId, tag_id: targetId },
        () => insertNoteTag(noteId, targetId),
        version
      )
      deleteLocalRow('note_tags', { note_id: noteId, tag_id: sourceId })
    }
    deleteLocalRow('tags', { id: sourceId })
    const count = (table: string): number =>
      (
        getDb()
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tag_id = ? AND deleted_at IS NULL`)
          .get(targetId) as { n: number }
      ).n
    return { target, captureLinks: count('exhibit_tags'), noteLinks: count('note_tags') }
  })
}

export function removeTagFromCapture(params: CaptureTagParams): void {
  deleteLocalRow('exhibit_tags', { exhibit_id: params.captureId, tag_id: params.tagId })
}

/**
 * Create-or-reuse by name (#391, ruling R15). `tags.name` is unique per author
 * and `createTag` is a bare INSERT of a local tag, so a caller that names an
 * existing local tag gets a constraint failure rather than the tag it asked
 * for (#811). Both lookups read this installation's tags only, the ones
 * `createTag` would collide with.
 *
 * The exact-name lookup runs before the case-insensitive one for the reason
 * PR #835's review gave for the extension path: `Evidence` and `evidence` can
 * both exist, and the insensitive query could return either — attaching a tag
 * with a different identity and colour than the one the operator named.
 *
 * `color` applies to the create branch only (#665, for the batch picker's
 * colour swatch). A reuse never repaints the tag it found: the operator asked
 * for a tag by that name, not for that tag to change everywhere it is already
 * applied.
 */
export function findOrCreateTagByName(name: string, color?: string): Tag {
  const exactId = findTagIdByNameExact(name)
  const foundId = exactId ?? findTagIdByNameInsensitive(name)
  const found = foundId ? getTag(foundId) : undefined
  return found ?? createTag({ name, color })
}

function insertNoteTag(noteId: string, tagId: string): void {
  getDb().prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tagId)
}

// Note-level tags (#391). Applying a tag a note already carries is a no-op,
// not an error the operator has to read.
export function addTagToNote(params: NoteTagParams): void {
  const { noteId, tagId } = params
  ensureLocalRow('note_tags', { note_id: noteId, tag_id: tagId }, () =>
    insertNoteTag(noteId, tagId)
  )
}

export function removeTagFromNote(params: NoteTagParams): void {
  deleteLocalRow('note_tags', { note_id: params.noteId, tag_id: params.tagId })
}

export function getTagsForNote(noteId: string): Tag[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT t.id, t.name, t.color FROM tags t
       JOIN note_tags nt ON t.id = nt.tag_id
       WHERE nt.note_id = ? AND nt.deleted_at IS NULL AND t.deleted_at IS NULL
       ORDER BY t.name`
    )
    .all(noteId) as Tag[]
}

export function getTagsForCapture(captureId: string): Tag[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT t.id, t.name, t.color FROM tags t
       JOIN exhibit_tags ct ON t.id = ct.tag_id
       WHERE ct.exhibit_id = ? AND ct.deleted_at IS NULL AND t.deleted_at IS NULL
       ORDER BY t.name`
    )
    .all(captureId) as Tag[]
}

export function getTagCountForCase(caseId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT ct.tag_id) as count
       FROM exhibit_tags ct
       JOIN captures c ON ct.exhibit_id = c.id
       WHERE c.case_id = ? AND ct.deleted_at IS NULL`
    )
    .get(caseId) as { count: number } | undefined
  return row?.count ?? 0
}

export function getTagUsageCountsForCase(caseId: string): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT ct.tag_id, COUNT(DISTINCT ct.exhibit_id) as count
       FROM exhibit_tags ct
       JOIN captures c ON ct.exhibit_id = c.id
       WHERE c.case_id = ? AND ct.deleted_at IS NULL
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
      `SELECT DISTINCT ct.tag_id, ct.exhibit_id
       FROM exhibit_tags ct
       JOIN (
         SELECT id FROM captures WHERE case_id = ? ORDER BY timestamp DESC LIMIT ?
       ) recent ON recent.id = ct.exhibit_id
       WHERE ct.deleted_at IS NULL`
    )
    .all(caseId, limit) as Array<{ tag_id: string; exhibit_id: string }>

  const matrix: Record<string, string[]> = {}
  for (const row of rows) {
    ;(matrix[row.tag_id] ??= []).push(row.exhibit_id)
  }
  return matrix
}

/**
 * Every capture in the case carrying ANY of the given tags (#918). Backs the
 * capture list's tag filter, which is multi-select: picking a second tag widens
 * the result, matching `getCapturesMatchingSelectors` and the selector filter
 * it mirrors.
 *
 * Deliberately unbounded, unlike `getTagCaptureMatrix` above. That query's
 * LIMIT exists so the Signals coverage strip stays a fixed size; a filter
 * inheriting it would answer "which captures carry this tag" with only the
 * recent ones and give the operator no sign it had dropped the rest.
 *
 * The join onto `captures` is load-bearing: tags are app-global, so without it
 * a tag also applied in another case would drag that case's captures in.
 *
 * Ordered newest-first with the id as a tiebreak, so the same case and tag set
 * always produce the same sequence rather than whatever the join emits.
 */
export function getCapturesWithAnyTag(caseId: string, tagIds: string[]): string[] {
  if (tagIds.length === 0) return []

  const placeholders = tagIds.map(() => '?').join(',')
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT ct.exhibit_id, c.timestamp
       FROM exhibit_tags ct
       JOIN captures c ON c.id = ct.exhibit_id
       WHERE c.case_id = ? AND ct.tag_id IN (${placeholders}) AND ct.deleted_at IS NULL
       ORDER BY c.timestamp DESC, ct.exhibit_id`
    )
    .all(caseId, ...tagIds) as Array<{ exhibit_id: string }>

  return rows.map((r) => r.exhibit_id)
}

// --- Archive bulk ops ---

// Every tag the case reaches, by either relation, tombstones included: an
// archive is the replica as stored. The note_tags half is not optional
// (#391): a tag carried only by a note would otherwise be absent from
// data.json while note_tags cited it, so the import would either fail its
// foreign key or bind the note to whatever local tag already held that id.
export function collectTagsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT t.* FROM tags t
       JOIN exhibit_tags ct ON ct.tag_id = t.id
       JOIN captures c ON c.id = ct.exhibit_id
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
      // Aliased back to `capture_id` on purpose: the .birdbrain payload's
      // `captureTags` rows keep the key they have always had, so the storage
      // rename (v34) did not move CASE_ARCHIVE_SCHEMA_VERSION. The author and
      // sync columns joined the row at archive schema 9.
      `SELECT ct.exhibit_id AS capture_id, ct.tag_id, ct.author_installation_id, ct.version,
              ct.deleted_at, ct.row_signature
       FROM exhibit_tags ct
       JOIN captures c ON c.id = ct.exhibit_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]
}

/**
 * Deletes any of `tagIds` that no Exhibit and no Note still carries.
 *
 * For the demonstration case's cleanup path (#405). Tags are global: deleting
 * a case cascades its `exhibit_tags` and `note_tags` links but leaves the tag
 * rows themselves in every picker. The remaining links are counted rather than
 * the ids taken on trust, because the archive import merges tags by name — the
 * demo's tag may BE one the operator already had, or one they have since put
 * on their own evidence. Returns how many rows were removed.
 */
export function deleteUnusedTags(tagIds: string[]): number {
  if (tagIds.length === 0) return 0
  const db = getDb()
  const stillUsed = db.prepare(
    `SELECT 1 FROM exhibit_tags WHERE tag_id = ?
     UNION ALL
     SELECT 1 FROM note_tags WHERE tag_id = ?
     LIMIT 1`
  )
  const remove = db.prepare('DELETE FROM tags WHERE id = ?')
  let removed = 0
  for (const id of tagIds) {
    if (stillUsed.get(id, id) !== undefined) continue
    removed += remove.run(id).changes
  }
  return removed
}

// `author` is an installation id, or null for this installation. Each author's
// names are unique on their own (migration 39), so a lookup reads one author's
// live tags; the predicate is the one `idx_tags_author_name` indexes.
export function findTagIdByNameExact(
  name: string,
  author: string | null = null
): string | undefined {
  const hit = getDb()
    .prepare(
      `SELECT id FROM tags
        WHERE COALESCE(author_installation_id, '') = ? AND name = ? AND deleted_at IS NULL`
    )
    .get(author ?? '', name) as { id: string } | undefined
  return hit?.id
}

export function findTagIdByNameInsensitive(
  name: string,
  author: string | null = null
): string | undefined {
  const hit = getDb()
    .prepare(
      `SELECT id FROM tags
        WHERE COALESCE(author_installation_id, '') = ? AND lower(name) = lower(?)
          AND deleted_at IS NULL`
    )
    .get(author ?? '', name) as { id: string } | undefined
  return hit?.id
}

export function tagIdExists(id: string): boolean {
  return getDb().prepare('SELECT 1 FROM tags WHERE id = ?').get(id) !== undefined
}

// Rows arrive with their FINAL ids — merge-by-name policy is caseArchive's.
// An archive written before Case Archive schema 9 has no `created_at`.
export function importTagRows(rows: Record<string, unknown>[]): void {
  const insert = getDb().prepare(
    `INSERT INTO tags (
       id, name, color, author_installation_id, version, deleted_at, row_signature, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const tag of rows) {
    insert.run(
      tag.id as string,
      tag.name ?? null,
      tag.color ?? null,
      ...syncColumnValues(tag),
      tag.created_at ?? UNDATED_TAG_CREATED_AT
    )
  }
}

// Reads `capture_id` because that is the key every .birdbrain payload carries
// (see collectCaptureTagsForCase); writes `exhibit_id`, which is the same id.
// Must run AFTER importCaptureRows: exhibit_tags has a foreign key onto
// `exhibits`, and the imported Capture's Exhibit row is written there.
export function importCaptureTagRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO exhibit_tags (
       exhibit_id, tag_id, author_installation_id, version, deleted_at, row_signature
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const ct of rows) {
    insert.run(
      ctx.mapId(ct.capture_id as string),
      ctx.mapTag(ct.tag_id as string),
      ...syncColumnValues(ct)
    )
  }
}

// Must run AFTER importNoteRows: note_tags has a foreign key onto notes and
// `foreign_keys = ON` is set for every connection.
export function importNoteTagRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO note_tags (
       note_id, tag_id, author_installation_id, version, deleted_at, row_signature
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const nt of rows) {
    insert.run(
      ctx.mapId(nt.note_id as string),
      ctx.mapTag(nt.tag_id as string),
      ...syncColumnValues(nt)
    )
  }
}
