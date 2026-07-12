import { v4 as uuid } from 'uuid'
import type {
  ExtractedDataCategory,
  ExtractedDataSubcategory,
  ExtractedDataItem,
  ExtractedDataSearchResult
} from '@shared/types'
import type { ExtractedDatum } from '@main/services/dataExtractor'
import { getDb, type ImportCtx } from '@main/services/db/core'

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

// --- Archive bulk ops ---

export function collectExtractedDataForCase(caseId: string): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM extracted_data WHERE case_id = ?').all(caseId) as Record<
    string,
    unknown
  >[]
}

// extracted_data_fts is maintained by trigger.
export function importExtractedDataRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT INTO extracted_data (id, capture_id, case_id, category, subcategory, value, source_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const ed of rows) {
    insert.run(
      ctx.mapId(ed.id as string),
      ctx.mapId(ed.capture_id as string),
      ctx.newCaseId,
      ed.category ?? null,
      ed.subcategory ?? null,
      ed.value ?? null,
      ed.source_url ?? null,
      ed.created_at ?? null
    )
  }
}
