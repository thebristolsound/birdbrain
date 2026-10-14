import type { ExtractedField } from '@main/services/search/fieldExtractor'
import { getDb } from '@main/services/db/core'
import { exhibitCitationResolver } from '@main/services/db/caseMemberRepo'
import type { FieldHit, FieldSearchResult } from '@shared/types'

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

const FIELD_HIT_LIMIT = 200
const PREVIEW_LENGTH = 200

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

interface FieldHitRow {
  fieldId: number
  exhibitId: string
  field: string
  preview: string
  norm: string
  source: 'html-part' | 'text'
  part: number | null
  startOffset: number
  endOffset: number
  occurrences: number
  extractor: string
  builtHash: string
  contentHash: string
  exhibitNumber: number
  memberCode: string | null
  authorInstallationId: string | null
  title: string
}

/**
 * The Case's field records whose search form holds the query, one for each Exhibit,
 * field and search form. Records whose build row records another Content Hash than the
 * Exhibit row's current one come back as unavailable, never as hits (ADR-0044). The
 * build copies that hash from the Exhibit row; it does not hash the files it reads.
 */
export function searchCaseFields(caseId: string, query: string): FieldSearchResult {
  const trimmed = query.trim()
  if (!trimmed) return { hits: [], unavailable: [], truncated: false }
  // The query is one phrase, so punctuation is matched as typed. A trigram index
  // cannot match under three characters, so a shorter query scans `norm`, as
  // searchExtractedData does.
  const [matched, term] =
    trimmed.length >= 3
      ? [
          `SELECT f.id, f.exhibit_id, f.field, f.norm
             FROM exhibit_search_fields_fts
             JOIN exhibit_search_fields f ON f.id = exhibit_search_fields_fts.rowid
            WHERE exhibit_search_fields_fts MATCH ? AND f.case_id = ?`,
          `"${trimmed.replace(/"/g, '""')}"`
        ]
      : [
          `SELECT id, exhibit_id, field, norm FROM exhibit_search_fields
            WHERE norm LIKE ? ESCAPE '\\' AND case_id = ?`,
          `%${escapeLike(trimmed)}%`
        ]
  const rows = getDb()
    .prepare(
      `WITH matched AS (${matched}),
            firsts AS (
              SELECT MIN(id) AS id, COUNT(*) AS occurrences
                FROM matched GROUP BY exhibit_id, field, norm
            )
       SELECT f.id AS fieldId, f.exhibit_id AS exhibitId, f.field,
              substr(f.value, 1, ?) AS preview, f.norm, f.source, f.part,
              f.start_offset AS startOffset, f.end_offset AS endOffset, firsts.occurrences,
              b.extractor, b.content_hash AS builtHash, e.content_hash AS contentHash,
              e.exhibit_number AS exhibitNumber, e.member_code AS memberCode,
              e.author_installation_id AS authorInstallationId, c.title
         FROM firsts
         JOIN exhibit_search_fields f ON f.id = firsts.id
         JOIN exhibit_search_builds b ON b.exhibit_id = f.exhibit_id
         JOIN exhibits e ON e.id = f.exhibit_id
         JOIN captures c ON c.id = f.exhibit_id
        ORDER BY c.timestamp DESC, f.id
        LIMIT ?`
    )
    .all(term, caseId, PREVIEW_LENGTH, FIELD_HIT_LIMIT + 1) as FieldHitRow[]
  const cite = exhibitCitationResolver(caseId, 'app')
  const hits: FieldHit[] = []
  const unavailable = new Map<string, string>()
  for (const row of rows.slice(0, FIELD_HIT_LIMIT)) {
    const exhibitCitation = cite(row)
    if (row.builtHash !== row.contentHash) {
      unavailable.set(row.exhibitId, exhibitCitation)
      continue
    }
    const { fieldId, exhibitId, field, preview, norm, occurrences, contentHash, title } = row
    const { source, part, startOffset, endOffset, extractor, exhibitNumber } = row
    hits.push({
      fieldId,
      caseId,
      exhibitId,
      exhibitNumber,
      exhibitCitation,
      contentHash,
      title,
      field,
      preview,
      norm,
      occurrences,
      locator: { source, part, startOffset, endOffset, extractor }
    })
  }
  return {
    hits,
    unavailable: [...unavailable].map(([exhibitId, exhibitCitation]) => ({
      exhibitId,
      exhibitCitation
    })),
    truncated: rows.length > FIELD_HIT_LIMIT
  }
}
