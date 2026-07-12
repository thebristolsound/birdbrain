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
import { getDb } from '@main/services/db/core'

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
