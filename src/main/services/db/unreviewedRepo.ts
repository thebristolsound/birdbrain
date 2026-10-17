import { getDb } from '@main/services/db/core'
import { exhibitCitationResolver } from '@main/services/db/caseMemberRepo'
import type {
  FieldHit,
  UnreviewedCapture,
  UnreviewedCaptures,
  UnreviewedGroup,
  UnreviewedRow
} from '@shared/types'

// The unreviewed view (docs/plans/2026-10-09-case-retrieval-first-slice.md, D8). A read
// only: it writes no row, and the field records it groups by are a cache outside the
// Manifest (ADR-0044).
//
// A committed Capture is a `captures` row of the Case with its `exhibits` row, joined as
// the field build joins them. It is unreviewed when no live Note of the Case names it,
// through `capture_id`, its anchor's `captureId` or a `capture` mention, and no
// `selector_matches` row covers it, whichever Selector wrote the row and whether or not
// that Selector is enabled.

const PREVIEW_LENGTH = 200

// The anchor is read by its `captureId` field, never by searching the JSON text, which
// would also find an id quoted in a text anchor's passage. A malformed anchor names
// nothing rather than failing the read.
const UNREVIEWED_SQL = `
  WITH named AS (
    SELECT capture_id AS id FROM notes
     WHERE case_id = @caseId AND deleted_at IS NULL AND capture_id IS NOT NULL
    UNION
    SELECT CASE WHEN json_valid(anchor_json) THEN json_extract(anchor_json, '$.captureId') END
      FROM notes
     WHERE case_id = @caseId AND deleted_at IS NULL AND anchor_json IS NOT NULL
    UNION
    SELECT r.target_id FROM note_references r JOIN notes n ON n.id = r.note_id
     WHERE n.case_id = @caseId AND n.deleted_at IS NULL AND r.target_type = 'capture'
  )
  SELECT c.id AS exhibitId, c.title, c.url, e.content_hash AS contentHash,
         e.exhibit_number AS exhibitNumber, e.member_code AS memberCode,
         e.author_installation_id AS authorInstallationId,
         b.content_hash AS builtContentHash, b.outcome
    FROM captures c
    JOIN exhibits e ON e.id = c.id
    LEFT JOIN exhibit_search_builds b ON b.exhibit_id = c.id
   WHERE c.case_id = @caseId
     AND c.id NOT IN (SELECT id FROM named WHERE id IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM selector_matches m WHERE m.capture_id = c.id)
   ORDER BY c.timestamp DESC, c.id`

// Records whose build row holds the Exhibit's current Content Hash, as field search
// requires before it returns a hit.
const RECORDS_SQL = `
  SELECT f.id AS fieldId, f.exhibit_id AS exhibitId, f.field, f.norm,
         substr(f.value, 1, @previewLength) AS preview, f.source, f.part,
         f.start_offset AS startOffset, f.end_offset AS endOffset, b.extractor
    FROM exhibit_search_fields f
    JOIN exhibit_search_builds b ON b.exhibit_id = f.exhibit_id
    JOIN exhibits e ON e.id = f.exhibit_id
   WHERE f.case_id = @caseId AND f.field IN ('header.from', 'header.reply-to', 'link.href')
     AND b.content_hash = e.content_hash
   ORDER BY f.id`

// Emails and accounts (D8), counted over every Capture of the Case as the Indicators
// view counts the pages a value appears on.
const RARE_SQL = `
  WITH counts AS (
    SELECT category, subcategory, value, COUNT(DISTINCT capture_id) AS caseCaptures
      FROM extracted_data
     WHERE case_id = @caseId
       AND (category = 'Accounts' OR (category = 'Infrastructure' AND subcategory = 'Email Address'))
     GROUP BY category, subcategory, value
    HAVING COUNT(DISTINCT capture_id) <= @rareLimit
  )
  SELECT d.category, d.subcategory, d.value, counts.caseCaptures, d.capture_id AS exhibitId
    FROM extracted_data d
    JOIN counts ON counts.category = d.category AND counts.subcategory = d.subcategory
               AND counts.value = d.value
   WHERE d.case_id = @caseId`

interface UnreviewedSqlRow {
  exhibitId: string
  title: string | null
  url: string
  contentHash: string
  exhibitNumber: number
  memberCode: string | null
  authorInstallationId: string | null
  builtContentHash: string | null
  outcome: string | null
}

interface RecordRow {
  fieldId: number
  exhibitId: string
  field: string
  norm: string
  preview: string
  source: 'html-part' | 'text'
  part: number | null
  startOffset: number
  endOffset: number
  extractor: string
}

interface RareRow {
  category: string
  subcategory: string
  value: string
  caseCaptures: number
  exhibitId: string
}

const HEADER_GROUPS: Record<string, UnreviewedGroup> = {
  'header.from': 'from',
  'header.reply-to': 'reply-to'
}

// The host as the URL parser gives it, `www.` kept. None for a value that does not parse
// or names no host, such as a `mailto:` link.
function linkHost(norm: string): string | null {
  try {
    return new URL(norm).hostname || null
  } catch {
    return null
  }
}

// UTF-8 byte order is code point order.
function byCodePoint(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

interface RowDraft {
  row: UnreviewedRow
  exhibits: Set<string>
}

/**
 * The Case's unreviewed Captures and the four groups of the unreviewed view. A Capture
 * whose field records are missing, failed, found no stored page, or were built from
 * another Content Hash is in no From, Reply-To or link host row and is counted in
 * `notCurrent`. Rows run from the fewest Captures to the most, then by key; Captures in a
 * row run newest first. `rareLimit` is the most Captures of the Case a rare identifier is
 * found in, a whole number of at least 1.
 */
export function listUnreviewedCaptures(caseId: string, rareLimit: number): UnreviewedCaptures {
  if (!Number.isInteger(rareLimit) || rareLimit < 1) {
    throw new RangeError(`rareLimit must be a whole number of at least 1, not ${rareLimit}`)
  }
  const d = getDb()
  const { count: captures } = d
    .prepare(
      'SELECT COUNT(*) AS count FROM captures c JOIN exhibits e ON e.id = c.id WHERE c.case_id = ?'
    )
    .get(caseId) as { count: number }
  const unreviewed = d.prepare(UNREVIEWED_SQL).all({ caseId }) as UnreviewedSqlRow[]

  const cite = exhibitCitationResolver(caseId, 'app')
  const order = new Map<string, number>()
  const byId = new Map<string, UnreviewedSqlRow>()
  const current = new Set<string>()
  let notCurrent = 0
  let partial = 0
  for (const [index, row] of unreviewed.entries()) {
    order.set(row.exhibitId, index)
    byId.set(row.exhibitId, row)
    const built =
      row.builtContentHash === row.contentHash &&
      (row.outcome === 'built' || row.outcome === 'partial')
    if (built) current.add(row.exhibitId)
    else notCurrent += 1
    if (built && row.outcome === 'partial') partial += 1
  }

  const groups: Record<UnreviewedGroup, Map<string, RowDraft>> = {
    from: new Map(),
    'reply-to': new Map(),
    'link-host': new Map(),
    rare: new Map()
  }
  const grouped = new Set<string>()
  const capture = (exhibitId: string, hit: FieldHit | null): UnreviewedCapture => {
    const row = byId.get(exhibitId)!
    return {
      exhibitId,
      exhibitCitation: cite(row),
      title: row.title || row.url,
      hit
    }
  }
  const add = (
    group: UnreviewedGroup,
    id: string,
    make: () => UnreviewedRow,
    exhibitId: string,
    hit: () => FieldHit | null
  ): void => {
    let draft = groups[group].get(id)
    if (!draft) {
      draft = { row: make(), exhibits: new Set() }
      groups[group].set(id, draft)
    }
    // The first record of a Capture under a row is the one it opens at.
    if (draft.exhibits.has(exhibitId)) return
    draft.exhibits.add(exhibitId)
    draft.row.captures.push(capture(exhibitId, hit()))
    grouped.add(exhibitId)
  }

  const records = (
    d.prepare(RECORDS_SQL).all({ caseId, previewLength: PREVIEW_LENGTH }) as RecordRow[]
  ).filter((record) => current.has(record.exhibitId))
  // FieldHit's `occurrences`: the Exhibit's records with the same field and search form.
  const occurrences = new Map<string, number>()
  const occurrenceKey = ({ exhibitId, field, norm }: RecordRow) => `${exhibitId}\0${field}\0${norm}`
  for (const record of records) {
    const key = occurrenceKey(record)
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
  }
  const toHit = (record: RecordRow): FieldHit => {
    const { fieldId, exhibitId, field, preview, norm, source, part, startOffset, endOffset } =
      record
    const row = byId.get(exhibitId)!
    return {
      fieldId,
      caseId,
      exhibitId,
      exhibitNumber: row.exhibitNumber,
      exhibitCitation: cite(row),
      contentHash: row.contentHash,
      title: row.title || row.url,
      field,
      preview,
      norm,
      occurrences: occurrences.get(occurrenceKey(record)) ?? 1,
      locator: { source, part, startOffset, endOffset, extractor: record.extractor }
    }
  }
  const keyedRow = (key: string) => (): UnreviewedRow => ({
    key,
    identifier: null,
    caseCaptures: null,
    captures: []
  })
  for (const record of records) {
    const group = HEADER_GROUPS[record.field]
    const key = group ? record.norm : linkHost(record.norm)
    if (key === null) continue
    add(group ?? 'link-host', key, keyedRow(key), record.exhibitId, () => toHit(record))
  }

  const rare = d.prepare(RARE_SQL).all({ caseId, rareLimit }) as RareRow[]
  for (const { category, subcategory, value, caseCaptures, exhibitId } of rare) {
    if (!byId.has(exhibitId)) continue
    add(
      'rare',
      `${category}\0${subcategory}\0${value}`,
      () => ({ key: value, identifier: { category, subcategory }, caseCaptures, captures: [] }),
      exhibitId,
      () => null
    )
  }

  const finish = (drafts: Map<string, RowDraft>): UnreviewedRow[] =>
    [...drafts.values()]
      .map(({ row }) => ({
        ...row,
        captures: [...row.captures].sort(
          (a, b) => order.get(a.exhibitId)! - order.get(b.exhibitId)!
        )
      }))
      .sort(
        (a, b) =>
          a.captures.length - b.captures.length ||
          byCodePoint(a.key, b.key) ||
          byCodePoint(a.identifier?.subcategory ?? '', b.identifier?.subcategory ?? '') ||
          byCodePoint(a.identifier?.category ?? '', b.identifier?.category ?? '')
      )

  return {
    captures,
    total: unreviewed.length,
    ungrouped: unreviewed.length - grouped.size,
    notCurrent,
    partial,
    rareLimit,
    groups: {
      from: finish(groups.from),
      'reply-to': finish(groups['reply-to']),
      'link-host': finish(groups['link-host']),
      rare: finish(groups.rare)
    }
  }
}
