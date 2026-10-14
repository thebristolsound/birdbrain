import type { ExtractedField } from '@main/services/search/fieldExtractor'
import { getDb } from '@main/services/db/core'

// The Case search field records (migration 38; docs/plans/2026-10-09-case-retrieval-
// first-slice.md, D1). A cache outside the Manifest (ADR-0044): nothing here writes a
// Manifest Entry, and no Case Archive collector reads these tables.

/** `no-source`: the Capture's stored page was not found, so nothing was built. */
export type FieldBuildOutcome = 'built' | 'partial' | 'no-source' | 'failed'

export interface ExhibitSearchBuild {
  exhibitId: string
  caseId: string
  contentHash: string
  /** The digest of the Extracted Text file the `text` fields index, or null with no file. */
  textHash: string | null
  extractor: string
  builtAt: string
  outcome: FieldBuildOutcome
  /** What the budgets refused, as JSON, when the outcome is `partial`. */
  skippedJson: string | null
}

/** A Capture's Exhibit and the URL its links resolve against. */
export interface FieldSource {
  exhibitId: string
  caseId: string
  url: string
  contentHash: string
}

// A Capture whose Exhibit row the backfill has not reached has nothing to key a
// build row to, so the inner join leaves it out until it does.
const CAPTURE_EXHIBITS_SQL = `
  SELECT c.id FROM captures c
    JOIN exhibits e ON e.id = c.id`

export function getFieldSource(exhibitId: string): FieldSource | undefined {
  return getDb()
    .prepare(
      `SELECT c.id AS exhibitId, c.case_id AS caseId, c.url, e.content_hash AS contentHash
         FROM captures c
         JOIN exhibits e ON e.id = c.id
        WHERE c.id = ?`
    )
    .get(exhibitId) as FieldSource | undefined
}

/**
 * The Case's Capture Exhibits with no build row, one an older extractor wrote, or one
 * whose stored page was not found.
 */
export function listExhibitsNeedingFields(caseId: string, extractor: string): string[] {
  const rows = getDb()
    .prepare(
      `${CAPTURE_EXHIBITS_SQL}
         LEFT JOIN exhibit_search_builds b ON b.exhibit_id = c.id
        WHERE c.case_id = ?
          AND (b.exhibit_id IS NULL OR b.extractor <> ? OR b.outcome = 'no-source')
        ORDER BY c.timestamp DESC`
    )
    .all(caseId, extractor) as Array<{ id: string }>
  return rows.map((row) => row.id)
}

export function listCaseCaptureExhibits(caseId: string): string[] {
  const rows = getDb()
    .prepare(`${CAPTURE_EXHIBITS_SQL} WHERE c.case_id = ? ORDER BY c.timestamp DESC`)
    .all(caseId) as Array<{ id: string }>
  return rows.map((row) => row.id)
}

export function listAllCaptureExhibits(): string[] {
  const rows = getDb()
    .prepare(`${CAPTURE_EXHIBITS_SQL} ORDER BY c.case_id, c.timestamp DESC`)
    .all() as Array<{ id: string }>
  return rows.map((row) => row.id)
}

export function getExhibitSearchBuild(exhibitId: string): ExhibitSearchBuild | undefined {
  return getDb()
    .prepare(
      `SELECT exhibit_id AS exhibitId, case_id AS caseId, content_hash AS contentHash,
              text_hash AS textHash, extractor, built_at AS builtAt, outcome,
              skipped_json AS skippedJson
         FROM exhibit_search_builds WHERE exhibit_id = ?`
    )
    .get(exhibitId) as ExhibitSearchBuild | undefined
}

// One transaction, so a search never sees an Exhibit's old fields beside its new
// build row. Deleting the build row takes its fields through the cascade.
export function replaceExhibitFields(build: ExhibitSearchBuild, fields: ExtractedField[]): void {
  const d = getDb()
  const insertBuild = d.prepare(
    `INSERT INTO exhibit_search_builds
       (exhibit_id, case_id, content_hash, text_hash, extractor, built_at, outcome, skipped_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertField = d.prepare(
    `INSERT INTO exhibit_search_fields
       (exhibit_id, case_id, field, value, norm, source, part, start_offset, end_offset)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  d.transaction(() => {
    d.prepare('DELETE FROM exhibit_search_builds WHERE exhibit_id = ?').run(build.exhibitId)
    insertBuild.run(
      build.exhibitId,
      build.caseId,
      build.contentHash,
      build.textHash,
      build.extractor,
      build.builtAt,
      build.outcome,
      build.skippedJson
    )
    for (const field of fields) {
      insertField.run(
        build.exhibitId,
        build.caseId,
        field.field,
        field.value,
        field.norm,
        field.source,
        field.part,
        field.startOffset,
        field.endOffset
      )
    }
  })()
}

// The triggers change the index one row at a time, removing the entries each old row
// had, so an index out of step with its table keeps stray entries. This reads the
// whole table again.
export function rebuildFieldIndex(): void {
  getDb().exec(
    "INSERT INTO exhibit_search_fields_fts(exhibit_search_fields_fts) VALUES ('rebuild')"
  )
}
