import Database from 'better-sqlite3'
import { v4 as uuid } from 'uuid'
import type { Case, Capture, Tag, Selector, ActiveCaseSelectors, Note } from '@shared/types'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams
} from '@shared/ipc'
import { safeRegexTest } from '@main/services/safeRegex'

let db: Database.Database

export function initDatabase(dbPath: string): Database.Database {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
  }
}

function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number

  if (version < 1) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS captures (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT,
          html_path TEXT,
          screenshot_path TEXT,
          hash TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          headers TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT
        );

        CREATE TABLE IF NOT EXISTS capture_tags (
          capture_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          PRIMARY KEY (capture_id, tag_id),
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
          title,
          url,
          content
        );

        CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY,
          capture_id TEXT NOT NULL,
          type TEXT NOT NULL,
          value TEXT NOT NULL,
          context TEXT,
          confidence REAL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );
      `)
      db.pragma('user_version = 1')
    })()
  }

  if (version < 2) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS case_analyses (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          model_used TEXT,
          result TEXT NOT NULL,
          token_usage INTEGER,
          created_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
      `)
      db.pragma('user_version = 2')
    })()
  }

  if (version < 3) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS selectors (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          pattern TEXT NOT NULL,
          is_regex INTEGER DEFAULT 0,
          enabled INTEGER DEFAULT 1,
          label TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_selectors_case_id ON selectors(case_id);
      `)
      db.pragma('user_version = 3')
    })()
  }

  if (version < 4) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE entities ADD COLUMN source TEXT NOT NULL DEFAULT 'ai';
        CREATE INDEX IF NOT EXISTS idx_entities_capture_source ON entities(capture_id, source);
      `)
      db.pragma('user_version = 4')
    })()
  }

  if (version < 5) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS selector_matches (
          selector_id TEXT NOT NULL,
          capture_id TEXT NOT NULL,
          PRIMARY KEY (selector_id, capture_id),
          FOREIGN KEY (selector_id) REFERENCES selectors(id) ON DELETE CASCADE,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_selector_matches_capture ON selector_matches(capture_id);
      `)
      db.pragma('user_version = 5')
    })()
  }

  if (version < 6) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE cases ADD COLUMN type TEXT DEFAULT 'custom';
      `)
      db.pragma('user_version = 6')
    })()
  }

  if (version < 7) {
    db.transaction(() => {
      db.exec(`
        DROP INDEX IF EXISTS idx_entities_capture_source;
        DROP TABLE IF EXISTS entities;
        DROP TABLE IF EXISTS case_analyses;
      `)
      db.pragma('user_version = 7')
    })()
  }

  if (version < 8) {
    db.transaction(() => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_captures_case_id ON captures(case_id);
        CREATE INDEX IF NOT EXISTS idx_capture_tags_tag_id ON capture_tags(tag_id);
      `)
      db.pragma('user_version = 8')
    })()
  }

  if (version < 9) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS capture_favorites (
          capture_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_capture_favorites_created ON capture_favorites(created_at DESC);
      `)
      db.pragma('user_version = 9')
    })()
  }

  if (version < 10) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          capture_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          source_url TEXT,
          screenshot_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_case_id ON notes(case_id);
        CREATE INDEX IF NOT EXISTS idx_notes_capture_id ON notes(capture_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          title,
          body,
          content=notes,
          content_rowid=rowid
        );

        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
          INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
        END;
      `)
      db.pragma('user_version = 10')
    })()
  }
}

// --- Cases ---

export function listCases(): Case[] {
  const rows = getDb()
    .prepare('SELECT * FROM cases WHERE archived = 0 ORDER BY updated_at DESC, rowid DESC')
    .all() as Array<Record<string, unknown>>
  return rows.map(rowToCase)
}

export function getCase(id: string): Case | undefined {
  const row = getDb().prepare('SELECT * FROM cases WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToCase(row) : undefined
}

export function createCase(params: CreateCaseParams): Case {
  const id = uuid()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      'INSERT INTO cases (id, name, description, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, params.name, params.description ?? null, params.type ?? 'custom', now, now)
  return getCase(id)!
}

export function updateCase(params: UpdateCaseParams): Case | undefined {
  const existing = getCase(params.id)
  if (!existing) return undefined
  const now = new Date().toISOString()
  getDb()
    .prepare(
      'UPDATE cases SET name = ?, description = ?, archived = ?, updated_at = ? WHERE id = ?'
    )
    .run(
      params.name ?? existing.name,
      params.description ?? existing.description ?? null,
      params.archived !== undefined ? (params.archived ? 1 : 0) : existing.archived ? 1 : 0,
      now,
      params.id
    )
  return getCase(params.id)
}

export function deleteCase(id: string): boolean {
  const result = getDb().prepare('DELETE FROM cases WHERE id = ?').run(id)
  return result.changes > 0
}

// --- Captures ---

export function listCaptures(caseId: string): Capture[] {
  const rows = getDb()
    .prepare('SELECT * FROM captures WHERE case_id = ? ORDER BY timestamp DESC')
    .all(caseId) as Array<Record<string, unknown>>
  return rows.map(rowToCapture)
}

export function getCapture(id: string): Capture | undefined {
  const row = getDb().prepare('SELECT * FROM captures WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToCapture(row) : undefined
}

export interface InsertCaptureParams {
  caseId: string
  url: string
  title: string
  hash: string
  timestamp: string
  htmlPath?: string
  screenshotPath?: string
  headers?: string
  textContent?: string
}

export const insertCapture = function (params: InsertCaptureParams & { id?: string }): Capture {
  const id = params.id || uuid()
  const now = new Date().toISOString()
  const d = getDb()

  const run = d.transaction(() => {
    d.prepare(
      `INSERT INTO captures (id, case_id, url, title, html_path, screenshot_path, hash, timestamp, headers, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.caseId,
      params.url,
      params.title,
      params.htmlPath ?? null,
      params.screenshotPath ?? null,
      params.hash,
      params.timestamp,
      params.headers ?? null,
      now
    )

    // Insert into FTS index
    if (params.textContent || params.title || params.url) {
      const row = d.prepare('SELECT rowid FROM captures WHERE id = ?').get(id) as
        | { rowid: number }
        | undefined
      if (!row) throw new Error(`Failed to retrieve rowid for capture ${id}`)
      d.prepare('INSERT INTO captures_fts (rowid, title, url, content) VALUES (?, ?, ?, ?)').run(
        row.rowid,
        params.title ?? '',
        params.url,
        params.textContent ?? ''
      )
    }

    // Touch the case's updated_at
    d.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, params.caseId)
  })

  run()
  return getCapture(id)!
}

export function deleteCapture(id: string): boolean {
  const d = getDb()
  const capture = getCapture(id)
  if (!capture) return false

  const run = d.transaction(() => {
    // Delete FTS entry
    const row = d.prepare('SELECT rowid FROM captures WHERE id = ?').get(id) as
      | { rowid: number }
      | undefined
    if (row) {
      d.prepare('DELETE FROM captures_fts WHERE rowid = ?').run(row.rowid)
    }

    return d.prepare('DELETE FROM captures WHERE id = ?').run(id)
  })

  const result = run()
  return result.changes > 0
}

export function updateCaptureHash(captureId: string, hash: string): void {
  getDb().prepare('UPDATE captures SET hash = ? WHERE id = ?').run(hash, captureId)
}

export function getCaptureCount(caseId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM captures WHERE case_id = ?')
    .get(caseId) as { count: number }
  return row.count
}

export function getCaptureCountsByCase(): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT case_id, COUNT(*) as count FROM captures GROUP BY case_id')
    .all() as Array<{ case_id: string; count: number }>
  const counts: Record<string, number> = {}
  for (const row of rows) {
    counts[row.case_id] = row.count
  }
  return counts
}

// --- Tags ---

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

// --- Search ---

export function searchCaptures(query: string): Capture[] {
  const rows = getDb()
    .prepare(
      `SELECT c.* FROM captures c
       JOIN captures_fts fts ON c.rowid = fts.rowid
       WHERE captures_fts MATCH ?
       ORDER BY rank`
    )
    .all(query) as Array<Record<string, unknown>>
  return rows.map(rowToCapture)
}

// --- Selectors ---

export function listSelectors(caseId: string): Selector[] {
  const rows = getDb()
    .prepare('SELECT * FROM selectors WHERE case_id = ? ORDER BY created_at DESC')
    .all(caseId) as Array<Record<string, unknown>>
  return rows.map(rowToSelector)
}

export function getSelector(id: string): Selector | undefined {
  const row = getDb().prepare('SELECT * FROM selectors WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToSelector(row) : undefined
}

export function createSelector(params: CreateSelectorParams): Selector {
  const id = uuid()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      'INSERT INTO selectors (id, case_id, pattern, is_regex, label, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, params.caseId, params.pattern, params.isRegex ? 1 : 0, params.label ?? null, now)
  return getSelector(id)!
}

export function bulkCreateSelectors(params: CreateSelectorParams[]): Selector[] {
  if (params.length === 0) return []
  const d = getDb()
  const now = new Date().toISOString()
  const insert = d.prepare(
    'INSERT INTO selectors (id, case_id, pattern, is_regex, label, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const ids: string[] = []
  const run = d.transaction(() => {
    for (const p of params) {
      const id = uuid()
      insert.run(id, p.caseId, p.pattern, p.isRegex ? 1 : 0, p.label ?? null, now)
      ids.push(id)
    }
  })
  run()
  return ids.map((id) => getSelector(id)!)
}

export function updateSelector(params: UpdateSelectorParams): Selector | undefined {
  const existing = getSelector(params.id)
  if (!existing) return undefined
  getDb()
    .prepare('UPDATE selectors SET pattern = ?, is_regex = ?, enabled = ?, label = ? WHERE id = ?')
    .run(
      params.pattern ?? existing.pattern,
      params.isRegex !== undefined ? (params.isRegex ? 1 : 0) : existing.isRegex ? 1 : 0,
      params.enabled !== undefined ? (params.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
      params.label !== undefined ? params.label : (existing.label ?? null),
      params.id
    )
  return getSelector(params.id)
}

export function deleteSelector(id: string): boolean {
  const result = getDb().prepare('DELETE FROM selectors WHERE id = ?').run(id)
  return result.changes > 0
}

export function listActiveSelectors(caseId?: string): ActiveCaseSelectors[] {
  let rows: Array<Record<string, unknown>>
  if (caseId) {
    rows = getDb()
      .prepare(
        `SELECT s.*, c.name as case_name FROM selectors s
         JOIN cases c ON s.case_id = c.id
         WHERE s.case_id = ? AND s.enabled = 1 AND c.archived = 0
         ORDER BY s.created_at DESC`
      )
      .all(caseId) as Array<Record<string, unknown>>
  } else {
    rows = getDb()
      .prepare(
        `SELECT s.*, c.name as case_name FROM selectors s
         JOIN cases c ON s.case_id = c.id
         WHERE s.enabled = 1 AND c.archived = 0
         ORDER BY c.name, s.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>
  }

  const grouped = new Map<string, ActiveCaseSelectors>()
  for (const row of rows) {
    const id = row.case_id as string
    if (!grouped.has(id)) {
      grouped.set(id, {
        caseId: id,
        caseName: row.case_name as string,
        selectors: []
      })
    }
    grouped.get(id)!.selectors.push(rowToSelector(row))
  }
  return Array.from(grouped.values())
}

// --- Selector Matches ---

export function matchSelectorsForCapture(
  captureId: string,
  caseId: string,
  textContent: string
): void {
  const selectors = listSelectors(caseId)
  const d = getDb()
  const insertStmt = d.prepare(
    'INSERT OR IGNORE INTO selector_matches (selector_id, capture_id) VALUES (?, ?)'
  )

  const run = d.transaction(() => {
    for (const sel of selectors) {
      if (!sel.enabled) continue
      try {
        let matched = false
        if (sel.isRegex) {
          matched = safeRegexTest(sel.pattern, 'gi', textContent)
        } else {
          matched = textContent.toLowerCase().includes(sel.pattern.toLowerCase())
        }
        if (matched) {
          insertStmt.run(sel.id, captureId)
        }
      } catch {
        // Invalid regex — skip
      }
    }
  })

  run()
}

export function matchSelectorAgainstCaptures(
  selectorId: string,
  captureTexts: Array<{ captureId: string; text: string }>
): void {
  const sel = getSelector(selectorId)
  if (!sel) return

  const d = getDb()
  const insertStmt = d.prepare(
    'INSERT OR IGNORE INTO selector_matches (selector_id, capture_id) VALUES (?, ?)'
  )

  const run = d.transaction(() => {
    for (const { captureId, text } of captureTexts) {
      try {
        let matched = false
        if (sel.isRegex) {
          matched = safeRegexTest(sel.pattern, 'gi', text)
        } else {
          matched = text.toLowerCase().includes(sel.pattern.toLowerCase())
        }
        if (matched) {
          insertStmt.run(selectorId, captureId)
        }
      } catch {
        // Invalid regex — skip
      }
    }
  })

  run()
}

export function getSelectorMatchCounts(caseId: string): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT sm.selector_id, COUNT(*) as count
       FROM selector_matches sm
       JOIN selectors s ON sm.selector_id = s.id
       WHERE s.case_id = ?
       GROUP BY sm.selector_id`
    )
    .all(caseId) as Array<{ selector_id: string; count: number }>

  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.selector_id] = row.count
  }
  return result
}

export function getCapturesMatchingSelectors(caseId: string, selectorIds: string[]): string[] {
  if (selectorIds.length === 0) return []

  const placeholders = selectorIds.map(() => '?').join(',')
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT sm.capture_id
       FROM selector_matches sm
       JOIN selectors s ON sm.selector_id = s.id
       WHERE s.case_id = ? AND sm.selector_id IN (${placeholders})`
    )
    .all(caseId, ...selectorIds) as Array<{ capture_id: string }>

  return rows.map((r) => r.capture_id)
}

export function getSelectorCoverage(caseId: string): { matched: number; total: number } {
  const total = getCaptureCount(caseId)
  if (total === 0) return { matched: 0, total: 0 }
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT sm.capture_id) as matched
       FROM selector_matches sm
       JOIN captures c ON sm.capture_id = c.id
       WHERE c.case_id = ?`
    )
    .get(caseId) as { matched: number } | undefined
  return { matched: row?.matched ?? 0, total }
}

export function getCaptureMatchingSelectors(captureId: string): Selector[] {
  const rows = getDb()
    .prepare(
      `SELECT s.*
       FROM selectors s
       JOIN selector_matches sm ON s.id = sm.selector_id
       WHERE sm.capture_id = ?
       ORDER BY s.created_at DESC`
    )
    .all(captureId) as Array<Record<string, unknown>>

  return rows.map(rowToSelector)
}

// --- Favorites ---

export function toggleFavorite(captureId: string): boolean {
  const existing = getDb()
    .prepare('SELECT 1 FROM capture_favorites WHERE capture_id = ?')
    .get(captureId)

  if (existing) {
    getDb().prepare('DELETE FROM capture_favorites WHERE capture_id = ?').run(captureId)
    return false
  } else {
    const now = new Date().toISOString()
    getDb()
      .prepare('INSERT INTO capture_favorites (capture_id, created_at) VALUES (?, ?)')
      .run(captureId, now)
    return true
  }
}

export function isFavorite(captureId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM capture_favorites WHERE capture_id = ?').get(captureId)
  return !!row
}

export function listFavorites(caseId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT cf.capture_id
       FROM capture_favorites cf
       JOIN captures c ON cf.capture_id = c.id
       WHERE c.case_id = ?
       ORDER BY cf.created_at DESC`
    )
    .all(caseId) as Array<{ capture_id: string }>

  return rows.map((r) => r.capture_id)
}

// --- Row mappers ---

function rowToCase(row: Record<string, unknown>): Case {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || undefined,
    type: (row.type as Case['type']) || 'custom',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    archived: row.archived === 1
  }
}

function rowToCapture(row: Record<string, unknown>): Capture {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    url: row.url as string,
    title: row.title as string,
    htmlPath: (row.html_path as string) || undefined,
    screenshotPath: (row.screenshot_path as string) || undefined,
    hash: row.hash as string,
    timestamp: row.timestamp as string,
    headers: (row.headers as string) || undefined,
    createdAt: row.created_at as string
  }
}

function rowToSelector(row: Record<string, unknown>): Selector {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    pattern: row.pattern as string,
    isRegex: row.is_regex === 1,
    enabled: row.enabled === 1,
    label: (row.label as string) || undefined,
    createdAt: row.created_at as string
  }
}

// --- Notes ---

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
