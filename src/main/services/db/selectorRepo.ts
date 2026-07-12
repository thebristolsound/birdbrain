import { v4 as uuid } from 'uuid'
import type { Selector, ActiveCaseSelectors, SelectorMatchExportRow } from '@shared/types'
import type { CreateSelectorParams, UpdateSelectorParams } from '@shared/ipc'
import { safeRegexTest } from '@main/services/safeRegex'
import { getDb } from '@main/services/db/core'

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
