import { v4 as uuid } from 'uuid'
import type { Note } from '@shared/types'
import type { CreateNoteParams, UpdateNoteParams } from '@shared/ipc'
import { getDb, type ImportCtx } from '@main/services/db/core'

export function listNotes(caseId: string): Note[] {
  const rows = getDb()
    .prepare('SELECT * FROM notes WHERE case_id = ? ORDER BY created_at DESC')
    .all(caseId) as Array<Record<string, unknown>>
  return rows.map(rowToNote)
}

export function getNote(id: string): Note | undefined {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToNote(row) : undefined
}

export function createNote(params: CreateNoteParams): Note {
  const id = uuid()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO notes (id, case_id, capture_id, title, body, source_url, screenshot_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.caseId,
      params.captureId ?? null,
      params.title ?? '',
      params.body ?? '',
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
  getDb()
    .prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(
      params.title !== undefined ? params.title : existing.title,
      params.body !== undefined ? params.body : existing.body,
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
    `INSERT INTO notes (id, case_id, capture_id, title, body, source_url, screenshot_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const n of rows) {
    insert.run(
      ctx.mapId(n.id as string),
      ctx.newCaseId,
      n.capture_id ? ctx.mapId(n.capture_id as string) : null,
      n.title ?? '',
      n.body ?? '',
      n.source_url ?? null,
      n.screenshot_path ?? null,
      n.created_at ?? null,
      n.updated_at ?? null
    )
  }
}
