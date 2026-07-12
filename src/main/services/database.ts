import { v4 as uuid } from 'uuid'
import type {
  Case,
  Capture,
  CaptureFormat,
  CaptureMethod,
  ConsentSuppression,
  HashVerification,
  Tag,
  Selector,
  ActiveCaseSelectors,
  Note,
  SelectorMatchExportRow,
  ExtractedDataCategory,
  ExtractedDataSubcategory,
  ExtractedDataItem,
  ExtractedDataSearchResult,
  TrustedTime,
  TlsCertChainResult,
  ArchiveRef,
  WaybackSnapshot
} from '@shared/types'
import { TlsCertChainResultSchema } from '@shared/schemas'
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
import type { ExtractedDatum } from '@main/services/dataExtractor'
import { safeRegexTest } from '@main/services/safeRegex'

import { getDb } from '@main/services/db/core'

export {
  initDatabase,
  getDb,
  closeDatabase,
  LATEST_SCHEMA_VERSION,
  withTransaction
} from '@main/services/db/core'

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
  const d = getDb()
  const run = d.transaction(() => {
    return d.prepare('DELETE FROM cases WHERE id = ?').run(id)
  })
  const result = run()
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
  format?: 'html' | 'mhtml'
  mhtmlPath?: string
  screenshotHash?: string
  textHash?: string
  // JSON-serialized corroboration-only TLS cert chain (#123).
  tlsCertChain?: string
  sizeBytes?: number
  manifestIndex?: number
  prevHash?: string
  entryHash?: string
  toolVersion?: string
  extensionVersion?: string
  browserVersion?: string
  userAgent?: string
  httpStatus?: number
  operatorId?: string
  operatorName?: string
  method?: CaptureMethod
  supersedesCaptureId?: string
  consentSuppression?: ConsentSuppression
}

export const insertCapture = function (params: InsertCaptureParams & { id?: string }): Capture {
  const id = params.id || uuid()
  const now = new Date().toISOString()
  const d = getDb()

  const run = d.transaction(() => {
    d.prepare(
      `INSERT INTO captures (
         id, case_id, url, title, html_path, screenshot_path, hash, timestamp, headers, created_at,
         format, mhtml_path, screenshot_hash, text_hash, tls_cert_chain, size_bytes, manifest_index, prev_hash, entry_hash,
         tool_version, extension_version, browser_version, user_agent, http_status,
         operator_id, operator_name, method, supersedes_capture_id, consent_suppression
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      now,
      params.format ?? 'html',
      params.mhtmlPath ?? null,
      params.screenshotHash ?? null,
      params.textHash ?? null,
      params.tlsCertChain ?? null,
      params.sizeBytes ?? null,
      params.manifestIndex ?? null,
      params.prevHash ?? null,
      params.entryHash ?? null,
      params.toolVersion ?? null,
      params.extensionVersion ?? null,
      params.browserVersion ?? null,
      params.userAgent ?? null,
      params.httpStatus ?? null,
      params.operatorId ?? null,
      params.operatorName ?? null,
      params.method ?? 'extension',
      params.supersedesCaptureId ?? null,
      params.consentSuppression ?? null
    )

    // Every capture gets a capture_texts row; triggers keep captures_fts in sync
    d.prepare(
      'INSERT INTO capture_texts (capture_id, title, url, content) VALUES (?, ?, ?, ?)'
    ).run(id, params.title ?? '', params.url ?? '', params.textContent ?? '')

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
    return d.prepare('DELETE FROM captures WHERE id = ?').run(id)
  })

  const result = run()
  return result.changes > 0
}

export function updateCaptureHash(captureId: string, hash: string): void {
  getDb().prepare('UPDATE captures SET hash = ? WHERE id = ?').run(hash, captureId)
}

export function setCaptureVerification(
  captureId: string,
  result: { status: HashVerification['status']; computedHash: string; verifiedAt: string }
): void {
  getDb()
    .prepare(
      'UPDATE captures SET last_verified_at = ?, last_verified_hash = ?, last_verified_status = ? WHERE id = ?'
    )
    .run(result.verifiedAt, result.computedHash || null, result.status, captureId)
}

// Updates the trusted-time mirror column for a capture (#120). The manifest is
// authoritative; this column is a rebuildable cache that drives the retry queue.
export function setCaptureTrustedTime(captureId: string, status: TrustedTime): void {
  getDb().prepare('UPDATE captures SET trusted_time_status = ? WHERE id = ?').run(status, captureId)
}

// The retry-worker queue: captures still awaiting a trusted timestamp. Returns
// the minimum the worker needs to re-stamp (capture id, case, content hash).
export function listPendingTimestampCaptures(): Array<{
  id: string
  caseId: string
  hash: string
}> {
  const rows = getDb()
    .prepare(
      "SELECT id, case_id, hash FROM captures WHERE trusted_time_status = 'pending' ORDER BY created_at ASC"
    )
    .all() as Array<{ id: string; case_id: string; hash: string }>
  return rows.map((r) => ({ id: r.id, caseId: r.case_id, hash: r.hash }))
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
       JOIN capture_texts t ON t.capture_id = c.id
       JOIN captures_fts fts ON fts.rowid = t.id
       WHERE captures_fts MATCH ?
       ORDER BY rank`
    )
    .all(query) as Array<Record<string, unknown>>
  return rows.map(rowToCapture)
}

export function getCaptureTextContent(captureId: string): string | null {
  const row = getDb()
    .prepare('SELECT content FROM capture_texts WHERE capture_id = ?')
    .get(captureId) as { content: string } | undefined
  return row?.content || null
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

export function clearSelectorMatches(selectorId: string): void {
  getDb().prepare('DELETE FROM selector_matches WHERE selector_id = ?').run(selectorId)
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

// Single source of truth for "does this selector hit this text". Never throws:
// the regex path delegates to safeRegexTest (which catches invalid patterns and
// timeouts and returns false); the substring path is plain JS.
function selectorMatchesText(selector: Selector, text: string): boolean {
  if (selector.isRegex) {
    return safeRegexTest(selector.pattern, 'gi', text)
  }
  return text.toLowerCase().includes(selector.pattern.toLowerCase())
}

/**
 * @internal - Used only by selectorLifecycle.runActiveSelectorsForCapture.
 * Renderer code must go through the lifecycle, not this function.
 */
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
      if (selectorMatchesText(sel, textContent)) {
        insertStmt.run(sel.id, captureId)
      }
    }
  })

  run()
}

/**
 * @internal - Used by selectorLifecycle.scheduleRetroactiveMatch and by
 * database tests that need to seed selector_matches rows. Renderer code
 * must go through the lifecycle, not this function.
 */
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
      if (selectorMatchesText(sel, text)) {
        insertStmt.run(selectorId, captureId)
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

export function getSelectorMatchesForExport(caseId: string): SelectorMatchExportRow[] {
  const rows = getDb()
    .prepare(
      `SELECT s.pattern as selectorPattern,
              s.label as selectorLabel,
              s.is_regex as isRegex,
              c.url as captureUrl,
              c.title as captureTitle,
              c.timestamp as captureTimestamp
       FROM selector_matches sm
       JOIN selectors s ON sm.selector_id = s.id
       JOIN captures c ON sm.capture_id = c.id
       WHERE s.case_id = ?
         AND c.case_id = ?
       ORDER BY s.pattern, c.timestamp DESC`
    )
    .all(caseId, caseId) as Array<{
    selectorPattern: string
    selectorLabel: string | null
    isRegex: number
    captureUrl: string
    captureTitle: string | null
    captureTimestamp: string
  }>
  return rows.map((r) => ({
    selectorPattern: r.selectorPattern,
    selectorLabel: r.selectorLabel,
    isRegex: r.isRegex === 1,
    captureUrl: r.captureUrl,
    captureTitle: r.captureTitle,
    captureTimestamp: r.captureTimestamp
  }))
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

// Safely parses the JSON-serialized corroboration-only TLS cert chain (#123)
// from its DB column. Returns undefined for NULL/legacy rows or any malformed
// value so a hand-edited or corrupt cell can never crash row mapping.
function parseTlsCertChain(value: unknown): TlsCertChainResult | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  const result = TlsCertChainResultSchema.safeParse(parsed)
  return result.success ? result.data : undefined
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
    createdAt: row.created_at as string,
    format: ((row.format as string) || 'html') as CaptureFormat,
    method: ((row.method as string) || 'extension') as CaptureMethod,
    supersedesCaptureId: (row.supersedes_capture_id as string) || undefined,
    consentSuppression: (row.consent_suppression as ConsentSuppression) || undefined,
    mhtmlPath: (row.mhtml_path as string) || undefined,
    screenshotHash: (row.screenshot_hash as string) || undefined,
    textHash: (row.text_hash as string) || undefined,
    tlsCertChain: parseTlsCertChain(row.tls_cert_chain),
    sizeBytes: (row.size_bytes as number) ?? undefined,
    manifestIndex: (row.manifest_index as number) ?? undefined,
    prevHash: (row.prev_hash as string) || undefined,
    entryHash: (row.entry_hash as string) || undefined,
    toolVersion: (row.tool_version as string) || undefined,
    extensionVersion: (row.extension_version as string) || undefined,
    browserVersion: (row.browser_version as string) || undefined,
    userAgent: (row.user_agent as string) || undefined,
    httpStatus: (row.http_status as number) ?? undefined,
    operatorId: (row.operator_id as string) || undefined,
    operatorName: (row.operator_name as string) || undefined,
    lastVerifiedAt: (row.last_verified_at as string) || undefined,
    lastVerifiedHash: (row.last_verified_hash as string) || undefined,
    lastVerifiedStatus: (row.last_verified_status as HashVerification['status']) || undefined,
    trustedTimeStatus: (row.trusted_time_status as TrustedTime) || undefined
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

// --- Archive refs (Wayback corroboration) ---

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

// --- Extracted Data ---

export function insertExtractedData(
  captureId: string,
  caseId: string,
  sourceUrl: string,
  data: ExtractedDatum[]
): void {
  if (data.length === 0) return
  const d = getDb()
  const now = new Date().toISOString()
  const insert = d.prepare(
    `INSERT OR IGNORE INTO extracted_data
       (id, capture_id, case_id, category, subcategory, value, source_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const run = d.transaction(() => {
    for (const item of data) {
      insert.run(
        uuid(),
        captureId,
        caseId,
        item.category,
        item.subcategory,
        item.value,
        sourceUrl,
        now
      )
    }
  })
  run()
}

export function getExtractedCategories(caseId: string): ExtractedDataCategory[] {
  const rows = getDb()
    .prepare(
      `SELECT category, COUNT(*) as count
       FROM extracted_data
       WHERE case_id = ?
       GROUP BY category
       ORDER BY category`
    )
    .all(caseId) as Array<{ category: string; count: number }>
  return rows.map((r) => ({ category: r.category, count: r.count }))
}

export function getExtractedSubcategories(
  caseId: string,
  category: string
): ExtractedDataSubcategory[] {
  const rows = getDb()
    .prepare(
      `SELECT subcategory, COUNT(*) as count
       FROM extracted_data
       WHERE case_id = ? AND category = ?
       GROUP BY subcategory
       ORDER BY subcategory`
    )
    .all(caseId, category) as Array<{ subcategory: string; count: number }>
  return rows.map((r) => ({ subcategory: r.subcategory, count: r.count }))
}

export function getExtractedItems(
  caseId: string,
  category: string,
  subcategory: string
): ExtractedDataItem[] {
  const rows = getDb()
    .prepare(
      `SELECT value,
              COUNT(DISTINCT capture_id) as page_count,
              GROUP_CONCAT(source_url, '\n') as source_urls
       FROM (
         SELECT DISTINCT value, capture_id, source_url
         FROM extracted_data
         WHERE case_id = ? AND category = ? AND subcategory = ?
       )
       GROUP BY value
       ORDER BY page_count DESC, value`
    )
    .all(caseId, category, subcategory) as Array<{
    value: string
    page_count: number
    source_urls: string | null
  }>
  return rows.map((r) => ({
    value: r.value,
    pageCount: r.page_count,
    sourceUrls: r.source_urls ? r.source_urls.split('\n').sort() : []
  }))
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export function searchExtractedData(caseId: string, query: string): ExtractedDataSearchResult[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const db = getDb()
  const rows =
    trimmed.length >= 3
      ? db
          .prepare(
            `SELECT category, subcategory, value,
                    COUNT(DISTINCT capture_id) as page_count,
                    GROUP_CONCAT(source_url, '\n') as source_urls
             FROM (
               SELECT DISTINCT ed.category, ed.subcategory, ed.value, ed.capture_id, ed.source_url
               FROM extracted_data ed
               JOIN extracted_data_fts f ON f.rowid = ed.rowid
               WHERE extracted_data_fts MATCH ? AND ed.case_id = ?
             )
             GROUP BY category, subcategory, value
             ORDER BY category, subcategory, value
             LIMIT 500`
          )
          .all(`"${trimmed.replace(/"/g, '""')}"`, caseId)
      : db
          .prepare(
            `SELECT category, subcategory, value,
                    COUNT(DISTINCT capture_id) as page_count,
                    GROUP_CONCAT(source_url, '\n') as source_urls
             FROM (
               SELECT DISTINCT category, subcategory, value, capture_id, source_url
               FROM extracted_data
               WHERE case_id = ? AND (value LIKE ? ESCAPE '\\' OR source_url LIKE ? ESCAPE '\\')
             )
             GROUP BY category, subcategory, value
             ORDER BY category, subcategory, value
             LIMIT 500`
          )
          .all(caseId, `%${escapeLike(trimmed)}%`, `%${escapeLike(trimmed)}%`)

  return (
    rows as Array<{
      category: string
      subcategory: string
      value: string
      page_count: number
      source_urls: string | null
    }>
  ).map((r) => ({
    value: r.value,
    category: r.category,
    subcategory: r.subcategory,
    pageCount: r.page_count,
    sourceUrls: r.source_urls ? Array.from(new Set(r.source_urls.split('\n'))).sort() : []
  }))
}

export function getExtractedDataCountForCase(caseId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM extracted_data WHERE case_id = ?')
    .get(caseId) as { count: number }
  return row.count
}

export function deleteExtractedDataForCapture(captureId: string): void {
  getDb().prepare('DELETE FROM extracted_data WHERE capture_id = ?').run(captureId)
}
