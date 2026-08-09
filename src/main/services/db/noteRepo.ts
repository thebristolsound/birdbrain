import { v4 as uuid } from 'uuid'
import type { Note } from '@shared/types'
import type { CreateNoteParams, UpdateNoteParams } from '@shared/ipc'
import { getDb, type ImportCtx } from '@main/services/db/core'
import { noteDocToText, parseNoteDoc } from '@shared/noteDoc'
import {
  parseNoteAnchor,
  remapAnchorIds,
  type NoteAnchor,
  type NoteAnchorKind
} from '@shared/noteAnchor'

// Thrown when an anchor's embedded ids resolve to a row that exists, but in a
// different case (#234). A distinct class from parseNoteAnchor's structural
// errors so a caller at the IPC boundary can translate it into a specific
// IpcFailure rather than a generic rejected promise.
export class AnchorCaseMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnchorCaseMismatchError'
  }
}

/**
 * A note belongs to exactly one case (#234, design doc open question 1,
 * answered): every id an anchor embeds must name a row in the note's own
 * case. `collectCaseData` packages only the note's own case, so a cross-case
 * anchor has always exported dangling; enforcing here makes the data match
 * the assumption export has silently made all along.
 *
 * Only an EXISTING target in the wrong case is rejected. A target that does
 * not exist at all is not this function's concern: a note surviving its
 * anchored capture's deletion is `resolveTextAnchor`'s documented
 * `capture-missing` outcome, a state this feature deliberately preserves, not
 * a violation of the case rule. Rejecting on non-existence would also make
 * ordering load-bearing in the archive importer in exactly the way #234
 * warns against.
 */
export function assertAnchorInCase(anchor: NoteAnchor, caseId: string): void {
  const capture = getDb()
    .prepare('SELECT case_id FROM captures WHERE id = ?')
    .get(anchor.captureId) as { case_id: string } | undefined
  if (capture && capture.case_id !== caseId) {
    throw new AnchorCaseMismatchError(
      `Anchor references capture ${anchor.captureId}, which belongs to a different case`
    )
  }
  if (anchor.kind === 'finding' && anchor.finding === 'selectorMatch') {
    const selector = getDb()
      .prepare('SELECT case_id FROM selectors WHERE id = ?')
      .get(anchor.selectorId) as { case_id: string } | undefined
    if (selector && selector.case_id !== caseId) {
      throw new AnchorCaseMismatchError(
        `Anchor references selector ${anchor.selectorId}, which belongs to a different case`
      )
    }
  }
}

/**
 * Resolve the two anchor columns from a serialized payload.
 *
 * `anchor_kind` is derived from the validated anchor rather than accepted
 * separately, so the column and the payload cannot describe different things.
 * An archive that supplies a contradictory `anchor_kind` is overruled by what
 * its own anchor actually says.
 *
 * Only `undefined` and `null` mean "no anchor". An empty string is a malformed
 * payload, not an absent one, and is rejected rather than quietly unanchoring
 * the note — a falsy guard here would let a renderer clear an anchor by sending
 * a broken one, which is the coercion this module exists to prevent.
 *
 * `checkCase` defaults to on. The one caller that turns it off is `updateNote`
 * re-serializing an anchor the caller did NOT touch: re-validating case
 * membership there would let an unrelated edit (e.g. a title fix) start
 * rejecting a note whose anchor already violated the rule before #234 existed
 * — exactly the "not destroyed by ... a read [or an unrelated write]"
 * guarantee the rule's own acceptance criteria require.
 */
function resolveAnchor(
  anchor: string | null | undefined,
  caseId: string,
  opts: { mapId?: (id: string) => string; checkCase?: boolean } = {}
): {
  kind: NoteAnchorKind | null
  json: string | null
} {
  if (anchor === undefined || anchor === null) return { kind: null, json: null }
  const parsed = parseNoteAnchor(anchor)
  const remapped = opts.mapId ? remapAnchorIds(parsed, opts.mapId) : parsed
  // Case membership is checked against the REMAPPED ids: an archive import's
  // mapId already moved captureId/selectorId onto their local-DB identities
  // by this point, so validating the pre-remap ids would check the wrong row.
  if (opts.checkCase !== false) assertAnchorInCase(remapped, caseId)
  return { kind: remapped.kind, json: JSON.stringify(remapped) }
}

/**
 * Resolve the two body columns from what the caller supplied.
 *
 * A `bodyDoc` wins and dictates `body`: the searchable text is derived here,
 * from the stored document, so no renderer can put text into the index that
 * the note does not contain. A `body` on its own is a plain-text write and
 * clears `body_doc` — the note becomes what was actually written, rather than
 * keeping a rich document the plain text no longer matches.
 */
function resolveBody(params: { body?: string; bodyDoc?: string }): {
  body: string
  bodyDoc: string | null
} {
  if (params.bodyDoc !== undefined) {
    const doc = parseNoteDoc(params.bodyDoc)
    return { body: noteDocToText(doc), bodyDoc: JSON.stringify(doc) }
  }
  return { body: params.body ?? '', bodyDoc: null }
}

export function listNotes(caseId: string): Note[] {
  const rows = getDb()
    .prepare('SELECT * FROM notes WHERE case_id = ? ORDER BY created_at DESC')
    .all(caseId) as Array<Record<string, unknown>>
  return rows.map(rowToNote)
}

export function getNote(id: string): Note | undefined {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as
    Record<string, unknown> | undefined
  return row ? rowToNote(row) : undefined
}

export function createNote(params: CreateNoteParams): Note {
  const id = uuid()
  const now = new Date().toISOString()
  const { body, bodyDoc } = resolveBody(params)
  const anchor = resolveAnchor(params.anchor, params.caseId)
  getDb()
    .prepare(
      `INSERT INTO notes (id, case_id, capture_id, title, body, body_doc, anchor_kind, anchor_json, source_url, screenshot_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.caseId,
      params.captureId ?? null,
      params.title ?? '',
      body,
      bodyDoc,
      anchor.kind,
      anchor.json,
      params.sourceUrl ?? null,
      params.screenshotPath ?? null,
      now,
      now
    )
  return getNote(id)!
}

export function updateNote(params: UpdateNoteParams): Note | undefined {
  const existing = getNote(params.id)
  if (!existing) return undefined
  const now = new Date().toISOString()
  // A body-less update (title only) must leave both columns as they are,
  // rather than resolving an absent body to the empty string.
  const touchesBody = params.body !== undefined || params.bodyDoc !== undefined
  const resolved = touchesBody
    ? resolveBody(params)
    : { body: existing.body, bodyDoc: existing.bodyDoc ?? null }
  // An absent `anchor` leaves the stored one in place; an explicit null clears
  // it. Re-serializing the existing anchor rather than reading the raw column
  // keeps the two paths on one code path.
  const anchor =
    params.anchor !== undefined
      ? resolveAnchor(params.anchor, existing.caseId)
      : resolveAnchor(existing.anchor ? JSON.stringify(existing.anchor) : null, existing.caseId, {
          checkCase: false
        })
  getDb()
    .prepare(
      `UPDATE notes SET title = ?, body = ?, body_doc = ?, anchor_kind = ?, anchor_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      params.title !== undefined ? params.title : existing.title,
      resolved.body,
      resolved.bodyDoc,
      anchor.kind,
      anchor.json,
      now,
      params.id
    )
  return getNote(params.id)
}

export function deleteNote(id: string): boolean {
  const result = getDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
  return result.changes > 0
}

export function getNoteCount(caseId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM notes WHERE case_id = ?')
    .get(caseId) as { count: number }
  return row.count
}

export function searchNotes(caseId: string, query: string): Note[] {
  if (!query.trim()) return []
  const rows = getDb()
    .prepare(
      `SELECT n.* FROM notes n
       JOIN notes_fts ON notes_fts.rowid = n.rowid
       WHERE notes_fts MATCH ? AND n.case_id = ?
       ORDER BY rank`
    )
    .all(query, caseId) as Array<Record<string, unknown>>
  return rows.map(rowToNote)
}

function rowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    captureId: (row.capture_id as string) || undefined,
    title: row.title as string,
    body: row.body as string,
    bodyDoc: (row.body_doc as string) || undefined,
    // Parsed without re-validating because every write path -- the two here,
    // archive import, and Database Admin -- runs the value through
    // parseNoteAnchor first. That is an invariant maintained by those callers,
    // not one this function can check, so a new write path must uphold it.
    anchor: row.anchor_json ? JSON.parse(row.anchor_json as string) : undefined,
    sourceUrl: (row.source_url as string) || undefined,
    screenshotPath: (row.screenshot_path as string) || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

// --- Archive bulk ops ---

export function collectNotesForCase(caseId: string): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM notes WHERE case_id = ?').all(caseId) as Record<
    string,
    unknown
  >[]
}

export function importNoteRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT INTO notes (id, case_id, capture_id, title, body, body_doc, anchor_kind, anchor_json, source_url, screenshot_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const n of rows) {
    // An archive is a file from outside this installation, so its `body` is no
    // more trustworthy than a renderer's: resolve both columns the same way
    // createNote does rather than copying them across independently. A note
    // whose rich body and indexed text disagree is exactly what the derivation
    // exists to prevent, and an import is the one path that could make it
    // permanent. Rows written by an older Birdbrain have no body_doc key at
    // all and stay plain text. The whole import runs in one transaction, so a
    // body that fails validation fails the import rather than half-landing it.
    const { body, bodyDoc } = resolveBody({
      body: (n.body as string) ?? '',
      bodyDoc: (n.body_doc as string) ?? undefined
    })
    // The archive's anchor_kind column is ignored in favour of the kind the
    // anchor itself declares, so the two cannot land in the database
    // disagreeing. A pre-v27 archive has no anchor at all and imports loose.
    // Ids embedded in the anchor go through the same remap as the capture_id
    // column below — an anchor left pointing at a pre-import id would cite
    // whatever already holds that id in this installation.
    const anchor = resolveAnchor((n.anchor_json as string) ?? null, ctx.newCaseId, {
      mapId: ctx.mapId
    })
    insert.run(
      ctx.mapId(n.id as string),
      ctx.newCaseId,
      n.capture_id ? ctx.mapId(n.capture_id as string) : null,
      n.title ?? '',
      body,
      bodyDoc,
      anchor.kind,
      anchor.json,
      n.source_url ?? null,
      n.screenshot_path ?? null,
      n.created_at ?? null,
      n.updated_at ?? null
    )
  }
}
