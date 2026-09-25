import { getDb, type ImportCtx } from '@main/services/db/core'
import { MEMBER_CODE_PATTERN } from '@shared/schemas'
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
  member_code: string | null
  author_installation_id: string | null
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
    manifestSeq: row.manifest_seq,
    memberCode: row.member_code,
    authorInstallationId: row.author_installation_id
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

// The next Exhibit Number this installation takes in a Case. Numbers are per
// member (decision 7), so a remote member's rows, which carry their author, do
// not advance the local sequence; NULL is this installation's.
//
// KNOWN GAP, reported with #1147 rather than papered over: this is MAX + 1, so
// deleting the highest-numbered Exhibit and committing another reuses its
// number, which X18 says must never happen. Closing it needs a per-Case
// high-water mark that survives deletion — a fourth table or a `cases` column,
// either of which is a storage surface this ticket did not enumerate and which
// the archive round trip would have to carry. Since #1148 the number a commit
// takes is written into a signed `exhibit` entry, so a reused number is now a
// reused number IN THE CHAIN, and since #1149 the screen renders it. The gap
// is no longer bounded and needs the high-water mark before a citation is
// made against a number.
export function nextExhibitNumber(caseId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(exhibit_number), 0) AS max FROM exhibits
        WHERE case_id = ? AND author_installation_id IS NULL`
    )
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
// v34 migration's SQL is the same expression, so one Case cannot end up
// numbered three ways by three code paths. Insertion order is NOT the ordering
// — a duplicate Capture (#827) carries the source's page timestamp with a later
// Manifest index, so payload order and chain order genuinely differ.
//
// A schema-6 archive carries `exhibits` rows (#1148, X30), so an import from
// one keeps the source's numbers and this runs as a no-op; an older archive
// still reaches this and is numbered fresh, which is the only numbering it
// ever had.
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

// --- Archive round trip (#1148, X30) ----------------------------------------

export function collectExhibitsForCase(caseId: string): Record<string, unknown>[] {
  return getDb()
    .prepare('SELECT * FROM exhibits WHERE case_id = ? ORDER BY exhibit_number')
    .all(caseId) as Record<string, unknown>[]
}

// Rows from a schema-6 archive, inserted with their numbers intact so a
// citation made against the source Case still names the same Exhibit here
// (X18). `id` is remapped (a Capture's Exhibit id follows its capture id), and
// `path` is re-rooted from the source Case directory to the new one, because
// the column is storage-root-relative and the Case directory is the new id.
export function importExhibitRows(rows: Record<string, unknown>[], ctx: ImportCtx): void {
  const insert = getDb().prepare(
    `INSERT INTO exhibits (
       id, case_id, kind, origin, exhibit_number, name,
       content_hash, path, size_bytes, committed_at, manifest_seq,
       member_code, author_installation_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const row of rows) {
    const oldId = row.id as string
    // Every citation surface prints the code, so a code the roster rule would
    // refuse is refused here too rather than stored for them to render.
    const memberCode = row.member_code ?? null
    if (
      memberCode !== null &&
      (typeof memberCode !== 'string' || !MEMBER_CODE_PATTERN.test(memberCode))
    ) {
      throw new Error(`Exhibit ${oldId} carries an invalid Member Code`)
    }
    const newId = ctx.mapId(oldId)
    const oldPath = row.path as string | null
    insert.run(
      newId,
      ctx.newCaseId,
      row.kind,
      row.origin,
      row.exhibit_number,
      row.name,
      row.content_hash,
      oldPath ? rerootPath(oldPath, ctx.newCaseId, oldId, newId) : null,
      row.size_bytes ?? null,
      row.committed_at,
      row.manifest_seq ?? null,
      // Pre-#1510 archives carry neither column; NULL is "this installation",
      // which is what an import from a single-member Case is.
      memberCode,
      row.author_installation_id ?? null
    )
  }
}

// `<oldCase>/<sub>/<oldId><ext>` -> `<newCase>/<sub>/<newId><ext>`. The file
// name carries the row id, so a remapped id renames the file too — the same
// rule the archive import applies to Capture artifacts.
export function rerootPath(path: string, newCaseId: string, oldId: string, newId: string): string {
  const parts = path.split('/')
  parts[0] = newCaseId
  const last = parts.length - 1
  if (parts[last].startsWith(oldId)) parts[last] = newId + parts[last].slice(oldId.length)
  return parts.join('/')
}
