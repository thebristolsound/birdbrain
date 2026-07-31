import { v4 as uuid } from 'uuid'
import type {
  Capture,
  CaptureFormat,
  CaptureMethod,
  ConsentSuppression,
  HashVerification,
  TrustedTime,
  TlsCertChainResult
} from '@shared/types'
import { TlsCertChainResultSchema } from '@shared/schemas'
import { getDb, type ImportCtx } from '@main/services/db/core'

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

// The single declaration of the captures row shape: every column in schema
// order, with the DDL default where the DDL declares one. Drift-tested against
// PRAGMA table_info; feeds insertCapture and the archive bulk import.
export const CAPTURE_COLUMNS: ReadonlyArray<{ column: string; default: unknown }> = [
  { column: 'id', default: null },
  { column: 'case_id', default: null },
  { column: 'url', default: null },
  { column: 'title', default: null },
  { column: 'html_path', default: null },
  { column: 'screenshot_path', default: null },
  { column: 'hash', default: null },
  { column: 'timestamp', default: null },
  { column: 'headers', default: null },
  { column: 'created_at', default: null },
  { column: 'format', default: 'html' },
  { column: 'mhtml_path', default: null },
  { column: 'size_bytes', default: null },
  { column: 'manifest_index', default: null },
  { column: 'prev_hash', default: null },
  { column: 'entry_hash', default: null },
  { column: 'tool_version', default: null },
  { column: 'extension_version', default: null },
  { column: 'browser_version', default: null },
  { column: 'user_agent', default: null },
  { column: 'http_status', default: null },
  { column: 'operator_id', default: null },
  { column: 'operator_name', default: null },
  { column: 'last_verified_at', default: null },
  { column: 'last_verified_hash', default: null },
  { column: 'last_verified_status', default: null },
  { column: 'trusted_time_status', default: null },
  { column: 'screenshot_hash', default: null },
  { column: 'text_hash', default: null },
  { column: 'tls_cert_chain', default: null },
  { column: 'method', default: 'extension' },
  { column: 'supersedes_capture_id', default: null },
  { column: 'consent_suppression', default: null }
]

const CAPTURE_INSERT_SQL = `INSERT INTO captures (${CAPTURE_COLUMNS.map((c) => c.column).join(
  ', '
)}) VALUES (${CAPTURE_COLUMNS.map(() => '?').join(', ')})`

export const insertCapture = function (params: InsertCaptureParams & { id?: string }): Capture {
  const id = params.id || uuid()
  const now = new Date().toISOString()
  const d = getDb()

  const row: Record<string, unknown> = {
    id,
    case_id: params.caseId,
    url: params.url,
    title: params.title,
    html_path: params.htmlPath ?? null,
    screenshot_path: params.screenshotPath ?? null,
    hash: params.hash,
    timestamp: params.timestamp,
    headers: params.headers ?? null,
    created_at: now,
    format: params.format ?? null,
    mhtml_path: params.mhtmlPath ?? null,
    size_bytes: params.sizeBytes ?? null,
    manifest_index: params.manifestIndex ?? null,
    prev_hash: params.prevHash ?? null,
    entry_hash: params.entryHash ?? null,
    tool_version: params.toolVersion ?? null,
    extension_version: params.extensionVersion ?? null,
    browser_version: params.browserVersion ?? null,
    user_agent: params.userAgent ?? null,
    http_status: params.httpStatus ?? null,
    operator_id: params.operatorId ?? null,
    operator_name: params.operatorName ?? null,
    last_verified_at: null,
    last_verified_hash: null,
    last_verified_status: null,
    trusted_time_status: null,
    screenshot_hash: params.screenshotHash ?? null,
    text_hash: params.textHash ?? null,
    tls_cert_chain: params.tlsCertChain ?? null,
    method: params.method ?? null,
    supersedes_capture_id: params.supersedesCaptureId ?? null,
    consent_suppression: params.consentSuppression ?? null
  }

  const run = d.transaction(() => {
    d.prepare(CAPTURE_INSERT_SQL).run(
      ...CAPTURE_COLUMNS.map((c) => row[c.column] ?? c.default ?? null)
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

// --- Search ---

export function searchCaptures(query: string, caseId?: string): Capture[] {
  const rows = getDb()
    .prepare(
      `SELECT c.* FROM captures c
       JOIN capture_texts t ON t.capture_id = c.id
       JOIN captures_fts fts ON fts.rowid = t.id
       WHERE captures_fts MATCH ?${caseId ? ' AND c.case_id = ?' : ''}
       ORDER BY rank`
    )
    .all(...(caseId ? [query, caseId] : [query])) as Array<Record<string, unknown>>
  return rows.map(rowToCapture)
}

export function getCaptureTextContent(captureId: string): string | null {
  const row = getDb()
    .prepare('SELECT content FROM capture_texts WHERE capture_id = ?')
    .get(captureId) as { content: string } | undefined
  return row?.content || null
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

// --- Archive bulk ops ---

export function collectCapturesForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare('SELECT * FROM captures WHERE case_id = ? ORDER BY timestamp')
    .all(caseId) as Record<string, unknown>[]
}

export function collectCaptureFavoritesForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT cf.* FROM capture_favorites cf
       JOIN captures c ON c.id = cf.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]
}

// Rows come from a (possibly old-epoch) archive: missing keys fall back to the
// drift-tested CAPTURE_COLUMNS defaults. id/case_id/supersedes_capture_id are
// remapped; every capture gets a capture_texts row via ctx.getText.
export function importCaptureRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const d = getDb()
  const insertCap = d.prepare(CAPTURE_INSERT_SQL)
  const insertText = d.prepare(
    'INSERT INTO capture_texts (capture_id, title, url, content) VALUES (?, ?, ?, ?)'
  )
  for (const cap of rows) {
    const newId = ctx.mapId(cap.id as string)
    insertCap.run(
      ...CAPTURE_COLUMNS.map((c) => {
        if (c.column === 'id') return newId
        if (c.column === 'case_id') return ctx.newCaseId
        if (c.column === 'supersedes_capture_id') {
          return cap.supersedes_capture_id ? ctx.mapId(cap.supersedes_capture_id as string) : null
        }
        return cap[c.column] ?? c.default ?? null
      })
    )
    insertText.run(
      newId,
      (cap.title as string) ?? '',
      (cap.url as string) ?? '',
      ctx.getText(cap.id as string, newId)
    )
  }
}

export function importCaptureFavoriteRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    'INSERT INTO capture_favorites (capture_id, created_at) VALUES (?, ?)'
  )
  for (const f of rows) {
    insert.run(ctx.mapId(f.capture_id as string), f.created_at ?? null)
  }
}
