import { getDb } from '@main/services/db/core'
import type { Exhibit } from '@shared/types'

// The identity and numbering rows of the Exhibit model (ADR-0023). A Capture's
// Exhibit id IS its capture id, so nothing here mints an id for a Capture — the
// caller passes the capture's own.

interface ExhibitRow {
  id: string
  case_id: string
  kind: string
  origin: string
  exhibit_number: number
  name: string
  content_hash: string
  path: string | null
  size_bytes: number | null
  committed_at: string
  manifest_seq: number | null
}

function toExhibit(row: ExhibitRow): Exhibit {
  return {
    id: row.id,
    caseId: row.case_id,
    kind: row.kind,
    origin: row.origin,
    exhibitNumber: row.exhibit_number,
    name: row.name,
    contentHash: row.content_hash,
    path: row.path,
    sizeBytes: row.size_bytes,
    committedAt: row.committed_at,
    manifestSeq: row.manifest_seq
  }
}

export interface InsertExhibitParams {
  id: string
  caseId: string
  kind: string
  origin: string
  name: string
  contentHash: string
  path?: string | null
  sizeBytes?: number | null
  committedAt: string
  manifestSeq?: number | null
  // Assigned by nextExhibitNumber() when omitted. Passed explicitly only by the
  // backfill, which assigns a whole Case's numbers in one ordered pass.
  exhibitNumber?: number
}

// The next Exhibit Number for a Case.
//
// KNOWN GAP, reported with #1147 rather than papered over: this is MAX + 1, so
// deleting the highest-numbered Exhibit and committing another reuses its
// number, which X18 says must never happen. Closing it needs a per-Case
// high-water mark that survives deletion — a fourth table or a `cases` column,
// either of which is a storage surface this ticket did not enumerate and which
// the archive round trip would have to carry. The exposure today is bounded:
// nothing renders an Exhibit Number yet (`803b`/`803c`) and no export cites one
// (`803e`), so no citation can be made against a number before the counter
// lands.
export function nextExhibitNumber(caseId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(exhibit_number), 0) AS max FROM exhibits WHERE case_id = ?')
    .get(caseId) as { max: number }
  return row.max + 1
}

export function insertExhibit(params: InsertExhibitParams): Exhibit {
  const {
    id,
    caseId,
    kind,
    origin,
    name,
    contentHash,
    path = null,
    sizeBytes = null,
    committedAt,
    manifestSeq = null
  } = params
  const exhibitNumber = params.exhibitNumber ?? nextExhibitNumber(caseId)
  getDb()
    .prepare(
      `INSERT INTO exhibits (
         id, case_id, kind, origin, exhibit_number, name,
         content_hash, path, size_bytes, committed_at, manifest_seq
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      caseId,
      kind,
      origin,
      exhibitNumber,
      name,
      contentHash,
      path,
      sizeBytes,
      committedAt,
      manifestSeq
    )
  return getExhibit(id)!
}

export interface CaptureExhibitParams {
  id: string
  caseId: string
  title?: string | null
  url?: string | null
  hash: string
  path?: string | null
  sizeBytes?: number | null
  committedAt: string
  manifestSeq?: number | null
  method?: string | null
  exhibitNumber?: number
}

// The Exhibit row for a Capture, derived from the capture's own fields. One
// function, used by ingest, by the archive import and by the backfill, so the
// three cannot disagree about what a Capture's Exhibit looks like — the v34
// migration's SQL mirrors it and is drift-tested against it.
//
// `origin` is the capture method, defaulted to 'extension' exactly as the
// `captures.method` column is (CAPTURE_COLUMNS), and `name` is the title with
// the URL as the fallback: X35 requires a recorded display name and forbids
// deriving one from the storage path.
export function insertExhibitForCapture(params: CaptureExhibitParams): Exhibit {
  const { id, caseId, title, url, hash, committedAt } = params
  const name = title && title.length > 0 ? title : (url ?? '')
  return insertExhibit({
    id,
    caseId,
    kind: 'capture',
    origin: params.method ?? 'extension',
    name,
    contentHash: hash,
    path: params.path ?? null,
    sizeBytes: params.sizeBytes ?? null,
    committedAt,
    manifestSeq: params.manifestSeq ?? null,
    ...(params.exhibitNumber !== undefined ? { exhibitNumber: params.exhibitNumber } : {})
  })
}

export function getExhibit(id: string): Exhibit | undefined {
  const row = getDb().prepare('SELECT * FROM exhibits WHERE id = ?').get(id) as
    ExhibitRow | undefined
  return row ? toExhibit(row) : undefined
}

export function listExhibits(caseId: string): Exhibit[] {
  const rows = getDb()
    .prepare('SELECT * FROM exhibits WHERE case_id = ? ORDER BY exhibit_number')
    .all(caseId) as ExhibitRow[]
  return rows.map(toExhibit)
}

interface CaptureNumberingRow {
  id: string
  case_id: string
  title: string | null
  url: string | null
  hash: string
  mhtml_path: string | null
  html_path: string | null
  size_bytes: number | null
  created_at: string | null
  timestamp: string | null
  manifest_index: number | null
  method: string | null
}

// Gives every Capture in a Case that lacks an `exhibits` row one, numbered in
// the order X41 fixes: anchored Captures by Manifest index, then the legacy
// ones with no Manifest Entry by capture time, `id` breaking a tie so the
// assignment is deterministic. Returns how many rows were written.
//
// Shared by the archive import and the post-init backfill deliberately, and the
// v34 migration's SQL is the same expression: a Case must not come out of an
// import numbered differently from the Case it was exported from, and "a
// reference that changes between two exports of the same Case is worse than
// none" (X18). Insertion order is NOT the ordering — a duplicate Capture (#827)
// carries the source's page timestamp with a later Manifest index, so payload
// order and chain order genuinely differ.
export function backfillExhibitsForCaptures(caseId: string): number {
  const rows = getDb()
    .prepare(
      `SELECT c.* FROM captures c
         LEFT JOIN exhibits e ON e.id = c.id
        WHERE c.case_id = ? AND e.id IS NULL
        ORDER BY (c.manifest_index IS NULL), c.manifest_index, c.timestamp, c.id`
    )
    .all(caseId) as CaptureNumberingRow[]
  let next = nextExhibitNumber(caseId)
  for (const row of rows) {
    insertExhibitForCapture({
      id: row.id,
      caseId: row.case_id,
      title: row.title,
      url: row.url,
      hash: row.hash,
      path: row.mhtml_path ?? row.html_path,
      sizeBytes: row.size_bytes,
      committedAt: row.created_at ?? row.timestamp ?? new Date().toISOString(),
      manifestSeq: row.manifest_index,
      method: row.method,
      exhibitNumber: next
    })
    next += 1
  }
  return rows.length
}

// Deletes the Exhibit row for an id, cascading its tags and Derived Files.
// Returns whether a row was there. Called wherever a Capture row goes away:
// `exhibits` hangs off `cases`, not `captures`, so nothing cascades for it.
export function deleteExhibit(id: string): boolean {
  return getDb().prepare('DELETE FROM exhibits WHERE id = ?').run(id).changes > 0
}
