import Database from 'better-sqlite3'
import { v4 as uuid } from 'uuid'
import type { Case, Capture, Tag, Entity } from '@shared/types'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams
} from '@shared/ipc'

let db: Database.Database

export function initDatabase(dbPath: string): Database.Database {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
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
  }

  if (version < 2) {
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
    .prepare('INSERT INTO cases (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, params.name, params.description ?? null, now, now)
  return getCase(id)!
}

export function updateCase(params: UpdateCaseParams): Case | undefined {
  const existing = getCase(params.id)
  if (!existing) return undefined
  const now = new Date().toISOString()
  getDb()
    .prepare('UPDATE cases SET name = ?, description = ?, archived = ?, updated_at = ? WHERE id = ?')
    .run(
      params.name ?? existing.name,
      params.description ?? existing.description ?? null,
      params.archived !== undefined ? (params.archived ? 1 : 0) : (existing.archived ? 1 : 0),
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

export function insertCapture(params: InsertCaptureParams): Capture {
  const id = uuid()
  const now = new Date().toISOString()
  const d = getDb()

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
    d.prepare('INSERT INTO captures_fts (rowid, title, url, content) VALUES (?, ?, ?, ?)').run(
      d.prepare('SELECT rowid FROM captures WHERE id = ?').get(id)?.rowid,
      params.title ?? '',
      params.url,
      params.textContent ?? ''
    )
  }

  // Touch the case's updated_at
  d.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(now, params.caseId)

  return getCapture(id)!
}

export function deleteCapture(id: string): boolean {
  const capture = getCapture(id)
  if (!capture) return false

  // Delete FTS entry
  const row = getDb().prepare('SELECT rowid FROM captures WHERE id = ?').get(id) as
    | { rowid: number }
    | undefined
  if (row) {
    getDb().prepare('DELETE FROM captures_fts WHERE rowid = ?').run(row.rowid)
  }

  const result = getDb().prepare('DELETE FROM captures WHERE id = ?').run(id)
  return result.changes > 0
}

export function getCaptureCount(caseId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM captures WHERE case_id = ?')
    .get(caseId) as { count: number }
  return row.count
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

// --- Entities ---

export function getEntitiesByCapture(captureId: string): Entity[] {
  const rows = getDb()
    .prepare('SELECT * FROM entities WHERE capture_id = ? ORDER BY type, value')
    .all(captureId) as Array<Record<string, unknown>>
  return rows.map(rowToEntity)
}

export function insertEntity(entity: Omit<Entity, 'id' | 'createdAt'>): Entity {
  const id = uuid()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      'INSERT INTO entities (id, capture_id, type, value, context, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(id, entity.captureId, entity.type, entity.value, entity.context ?? null, entity.confidence ?? null, now)
  return { id, ...entity, createdAt: now }
}

export function deleteEntitiesByCapture(captureId: string): number {
  const result = getDb().prepare('DELETE FROM entities WHERE capture_id = ?').run(captureId)
  return result.changes
}

// --- Case Analyses ---

export interface CaseAnalysis {
  id: string
  caseId: string
  modelUsed: string | null
  result: string
  tokenUsage: number | null
  createdAt: string
}

export function getCaseAnalysis(caseId: string): CaseAnalysis | undefined {
  const row = getDb()
    .prepare('SELECT * FROM case_analyses WHERE case_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(caseId) as Record<string, unknown> | undefined
  if (!row) return undefined
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    modelUsed: (row.model_used as string) || null,
    result: row.result as string,
    tokenUsage: (row.token_usage as number) || null,
    createdAt: row.created_at as string
  }
}

export function insertCaseAnalysis(params: {
  caseId: string
  modelUsed?: string
  result: string
  tokenUsage?: number
}): CaseAnalysis {
  const id = uuid()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      'INSERT INTO case_analyses (id, case_id, model_used, result, token_usage, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, params.caseId, params.modelUsed ?? null, params.result, params.tokenUsage ?? null, now)
  return getCaseAnalysis(params.caseId)!
}

// --- Row mappers ---

function rowToCase(row: Record<string, unknown>): Case {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || undefined,
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

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: row.id as string,
    captureId: row.capture_id as string,
    type: row.type as Entity['type'],
    value: row.value as string,
    context: (row.context as string) || undefined,
    confidence: (row.confidence as number) || undefined,
    createdAt: row.created_at as string
  }
}
