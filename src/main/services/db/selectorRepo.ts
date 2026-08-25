import { v4 as uuid } from 'uuid'
import type { Selector, ActiveCaseSelectors, SelectorMatchExportRow } from '@shared/types'
import { isSelectorOrigin } from '@shared/types'
import type { CreateSelectorParams, UpdateSelectorParams } from '@shared/ipc'
import { safeRegexTest } from '@main/services/safeRegex'
import { getDb, type ImportCtx } from '@main/services/db/core'

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
      `INSERT INTO selectors (id, case_id, pattern, is_regex, enabled, label, origin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.caseId,
      params.pattern,
      params.isRegex ? 1 : 0,
      // Written explicitly rather than left to the column default, so an
      // omitted `enabled` and an explicit `true` produce the same row (#391).
      params.enabled === false ? 0 : 1,
      params.label ?? null,
      originOrNull(params.origin),
      now
    )
  return getSelector(id)!
}

// A value outside the recorded set is stored as NULL rather than kept: an
// unrecognised origin renders nothing anyway, and a bad string in the column
// would read as a provenance claim nothing can interpret.
function originOrNull(origin: unknown): string | null {
  return isSelectorOrigin(origin) ? origin : null
}

export function bulkCreateSelectors(params: CreateSelectorParams[]): Selector[] {
  if (params.length === 0) return []
  const d = getDb()
  const now = new Date().toISOString()
  const insert = d.prepare(
    `INSERT INTO selectors (id, case_id, pattern, is_regex, label, origin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const ids: string[] = []
  const run = d.transaction(() => {
    for (const p of params) {
      const id = uuid()
      insert.run(
        id,
        p.caseId,
        p.pattern,
        p.isRegex ? 1 : 0,
        p.label ?? null,
        originOrNull(p.origin),
        now
      )
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

/**
 * Which of the `limit` most recent captures each selector in the case matched
 * (#400). Backs the Signals coverage strip, which needs per-selector membership
 * — `getCapturesMatchingSelectors` merges across selectors and
 * `getSelectorCoverage` is a case-wide scalar, so neither answers this.
 *
 * Bounded in SQL rather than in the renderer: the strip draws a fixed number of
 * cells, so the payload should be that size whether the case holds twenty
 * captures or twenty thousand. Selectors with no match among those captures are
 * absent from the result; the caller reads a missing key as an empty row.
 */
export function getSelectorCaptureMatrix(
  caseId: string,
  limit: number
): Record<string, string[]> {
  const rows = getDb()
    .prepare(
      `SELECT sm.selector_id, sm.capture_id
       FROM selector_matches sm
       JOIN selectors s ON sm.selector_id = s.id
       JOIN (
         SELECT id FROM captures WHERE case_id = ? ORDER BY timestamp DESC LIMIT ?
       ) recent ON recent.id = sm.capture_id
       WHERE s.case_id = ?`
    )
    .all(caseId, limit, caseId) as Array<{ selector_id: string; capture_id: string }>

  const matrix: Record<string, string[]> = {}
  for (const row of rows) {
    ;(matrix[row.selector_id] ??= []).push(row.capture_id)
  }
  return matrix
}

export function getSelectorCoverage(caseId: string): { matched: number; total: number } {
  // Inlined capture count: repos never import each other (was captureRepo.getCaptureCount)
  const totalRow = getDb()
    .prepare('SELECT COUNT(*) as count FROM captures WHERE case_id = ?')
    .get(caseId) as { count: number }
  const total = totalRow.count
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

/**
 * Match rows for a CSV export. Case-wide by default; pass `selectorId` to
 * scope it to one selector (#400), which the Signals rail's per-signal Export
 * CSV needs — without the filter that button's label would misstate what it
 * writes.
 */
export function getSelectorMatchesForExport(
  caseId: string,
  selectorId?: string
): SelectorMatchExportRow[] {
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
         AND (? IS NULL OR s.id = ?)
       ORDER BY s.pattern, c.timestamp DESC`
    )
    .all(caseId, caseId, selectorId ?? null, selectorId ?? null) as Array<{
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

function rowToSelector(row: Record<string, unknown>): Selector {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    pattern: row.pattern as string,
    isRegex: row.is_regex === 1,
    enabled: row.enabled === 1,
    label: (row.label as string) || undefined,
    // Checked, not cast: the column is plain TEXT and reachable from the
    // Database Admin hatch and from imported archives, so an unrecognised
    // value reads as absent rather than as a provenance claim.
    origin: isSelectorOrigin(row.origin) ? row.origin : undefined,
    createdAt: row.created_at as string
  }
}

// --- Archive bulk ops ---

export function collectSelectorsForCase(caseId: string): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM selectors WHERE case_id = ?').all(caseId) as Record<
    string,
    unknown
  >[]
}

export function collectSelectorMatchesForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare(
      `SELECT sm.* FROM selector_matches sm
       JOIN captures c ON c.id = sm.capture_id
       WHERE c.case_id = ?`
    )
    .all(caseId) as Record<string, unknown>[]
}

export function importSelectorRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT INTO selectors (id, case_id, pattern, is_regex, enabled, label, origin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const s of rows) {
    insert.run(
      ctx.mapId(s.id as string),
      ctx.newCaseId,
      s.pattern ?? null,
      s.is_regex ?? 0,
      s.enabled ?? 1,
      s.label ?? null,
      s.origin ?? null,
      s.created_at ?? null
    )
  }
}

export function importSelectorMatchRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    'INSERT INTO selector_matches (selector_id, capture_id) VALUES (?, ?)'
  )
  for (const sm of rows) {
    insert.run(ctx.mapId(sm.selector_id as string), ctx.mapId(sm.capture_id as string))
  }
}
