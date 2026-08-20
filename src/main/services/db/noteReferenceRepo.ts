import { getDb, withTransaction } from '@main/services/db/core'
import { extractNoteMentions, type MentionTargetType, type NoteMention } from '@shared/noteDoc'
import type { NoteBacklink, NoteBacklinkCount, NoteReference } from '@shared/types'

// Thrown when a Mention's target exists but in a different case. A distinct
// class from parseNoteDoc's structural errors so a caller at the IPC boundary
// can translate it into a specific IpcFailure, mirroring
// AnchorCaseMismatchError (#234).
export class MentionCaseMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MentionCaseMismatchError'
  }
}

// The case-scoped target tables. Tags are deliberately absent: `tags` has no
// case_id — a tag is global and attaches to captures through capture_tags —
// so any tag id is accepted, existing or not (maintainer ruling 2026-08-20 on
// #389, spike constraint 3). The alternative reading of "in this case" would
// make an ordinary tag removal invalidate a previously valid Mention on the
// next save.
const CASE_SCOPED_TARGET_TABLES = {
  capture: 'captures',
  selector: 'selectors',
  note: 'notes'
} as const

/**
 * Reject any Mention whose target exists in a different case. Batched per
 * target type (spike constraint 4): one json_each membership statement per
 * type per save, not one round trip per mention.
 *
 * Only an EXISTING target in the wrong case is rejected, same as anchors
 * (#234): a target that does not exist at all is a legitimate dangling
 * reference and resolves as broken at read time. Rejecting on non-existence
 * would also make row ordering load-bearing in the archive importer.
 */
export function assertMentionsInCase(mentions: NoteMention[], caseId: string): void {
  for (const [targetType, table] of Object.entries(CASE_SCOPED_TARGET_TABLES)) {
    const ids = [
      ...new Set(mentions.filter((m) => m.targetType === targetType).map((m) => m.targetId))
    ]
    if (ids.length === 0) continue
    const offender = getDb()
      .prepare(
        `SELECT id FROM ${table}
         WHERE id IN (SELECT value FROM json_each(?)) AND case_id != ?
         LIMIT 1`
      )
      .get(JSON.stringify(ids), caseId) as { id: string } | undefined
    if (offender) {
      throw new MentionCaseMismatchError(
        `Mention references ${targetType} ${offender.id}, which belongs to a different case`
      )
    }
  }
}

/**
 * Replace a note's rows in the references index. Runs on every note-body
 * write, inside the caller's transaction — the index is derived state and
 * must commit or roll back with the body it was derived from.
 */
export function rewriteReferencesForNote(noteId: string, mentions: NoteMention[]): void {
  const db = getDb()
  db.prepare('DELETE FROM note_references WHERE note_id = ?').run(noteId)
  if (mentions.length === 0) return
  const insert = db.prepare(
    'INSERT INTO note_references (note_id, ord, target_type, target_id) VALUES (?, ?, ?, ?)'
  )
  mentions.forEach((mention, ord) => insert.run(noteId, ord, mention.targetType, mention.targetId))
}

/**
 * A note's outgoing references in document order, each resolved at read time
 * (spike constraint 5): no FK pins the target, so existence — and the
 * target's CURRENT display name — are computed per read. A deleted target
 * comes back as resolved: false with a null label, never silently dropped.
 */
export function referencesForNote(noteId: string): NoteReference[] {
  const rows = getDb()
    .prepare(
      `SELECT r.note_id AS noteId, r.ord AS ord,
              r.target_type AS targetType, r.target_id AS targetId,
              CASE r.target_type
                WHEN 'capture' THEN (SELECT c.title FROM captures c WHERE c.id = r.target_id)
                WHEN 'selector' THEN
                  (SELECT COALESCE(NULLIF(s.label, ''), s.pattern) FROM selectors s
                   WHERE s.id = r.target_id)
                WHEN 'tag' THEN (SELECT t.name FROM tags t WHERE t.id = r.target_id)
                WHEN 'note' THEN (SELECT n.title FROM notes n WHERE n.id = r.target_id)
              END AS label,
              CASE r.target_type
                WHEN 'capture' THEN EXISTS (SELECT 1 FROM captures c WHERE c.id = r.target_id)
                WHEN 'selector' THEN EXISTS (SELECT 1 FROM selectors s WHERE s.id = r.target_id)
                WHEN 'tag' THEN EXISTS (SELECT 1 FROM tags t WHERE t.id = r.target_id)
                WHEN 'note' THEN EXISTS (SELECT 1 FROM notes n WHERE n.id = r.target_id)
              END AS resolved
       FROM note_references r
       WHERE r.note_id = ?
       ORDER BY r.ord`
    )
    .all(noteId) as Array<{
    noteId: string
    ord: number
    targetType: MentionTargetType
    targetId: string
    label: string | null
    resolved: number
  }>
  return rows.map((row) => ({ ...row, label: row.label ?? null, resolved: row.resolved === 1 }))
}

/**
 * Every note in the case that mentions the target, one row per note (spike
 * constraint 6: the index is grouped by note_id for backlink reads). Case
 * scope comes from the referring note's case — the index itself carries none.
 */
export function backlinksForTarget(params: {
  caseId: string
  targetType: MentionTargetType
  targetId: string
}): NoteBacklink[] {
  return getDb()
    .prepare(
      `SELECT n.id AS noteId, n.title AS noteTitle, COUNT(*) AS mentionCount,
              substr(n.body, 1, 240) AS snippet, n.updated_at AS updatedAt
       FROM note_references r
       JOIN notes n ON n.id = r.note_id
       WHERE n.case_id = ? AND r.target_type = ? AND r.target_id = ?
       GROUP BY r.note_id
       ORDER BY n.updated_at DESC`
    )
    .all(params.caseId, params.targetType, params.targetId) as NoteBacklink[]
}

/**
 * The whole-case aggregate the Overview backlink map needs (#402, spike
 * constraint 9): one query for every mentioned target, instead of one
 * backlink query per target.
 */
export function backlinkCountsForCase(caseId: string): NoteBacklinkCount[] {
  return getDb()
    .prepare(
      `SELECT r.target_type AS targetType, r.target_id AS targetId,
              COUNT(DISTINCT r.note_id) AS noteCount, COUNT(*) AS mentionCount
       FROM note_references r
       JOIN notes n ON n.id = r.note_id
       WHERE n.case_id = ?
       GROUP BY r.target_type, r.target_id`
    )
    .all(caseId) as NoteBacklinkCount[]
}

/**
 * Re-derive the whole index for a case from stored body_doc rows — the
 * repair seam spike constraint 7 requires: the index is derived state and
 * must always be reconstructible from the documents. Returns the number of
 * reference rows written.
 *
 * All of it or none of it: a drifted body_doc that no longer parses (#662) is
 * exactly what this seam is for, and throwing halfway through would leave the
 * scanned notes rebuilt and the rest stale — worse than the index it
 * replaced. The transaction nests, so an outer caller still gets one unit.
 */
export function rebuildForCase(caseId: string): number {
  return withTransaction(() => {
    const rows = getDb()
      .prepare('SELECT id, body_doc FROM notes WHERE case_id = ?')
      .all(caseId) as Array<{ id: string; body_doc: string | null }>
    let written = 0
    for (const row of rows) {
      const mentions = row.body_doc ? extractNoteMentions(row.body_doc) : []
      rewriteReferencesForNote(row.id, mentions)
      written += mentions.length
    }
    return written
  })
}
