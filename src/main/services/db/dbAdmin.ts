import { getDb } from '@main/services/db/core'
import { statSync, existsSync, readdirSync, unlinkSync, copyFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { getStorageRoot } from '@main/services/storage'
import {
  CASE_SUBDIRECTORIES,
  defaultCaptureStore,
  parseArtifactFilename,
  type CaptureStore
} from '@main/services/captureStore'
import { listSharedCaseIds } from '@main/services/db/caseRepo'
import { deleteExhibit } from '@main/services/db/exhibitRepo'
import {
  assertLiveReference,
  danglingReferences,
  deletedCaptureCase,
  removeCaptureDependents,
  removeCaseDependents,
  removeExhibitDependents
} from '@main/services/db/workingRowRepo'
import { buildCsv } from '@main/services/csvEscape'
import { parseNoteAnchor } from '@shared/noteAnchor'
import { assertAnchorInCase } from '@main/services/db/noteRepo'
import { assertMentionsInCase, rewriteReferencesForNote } from '@main/services/db/noteReferenceRepo'
import { extractNoteMentions, noteDocToText, parseNoteDoc, type NoteMention } from '@shared/noteDoc'
import type { DbStats, DbTableRowsParams, DbTableRowsResult, OrphanReport } from '@shared/ipc'

export const ALLOWED_TABLES = [
  'cases',
  'captures',
  'tags',
  'exhibit_tags',
  'selectors',
  'selector_matches',
  'capture_favorites',
  'notes'
] as const

type AllowedTable = (typeof ALLOWED_TABLES)[number]

function assertAllowedTable(table: string): asserts table is AllowedTable {
  if (!(ALLOWED_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Table "${table}" is not allowed`)
  }
}

// `exhibit_tags` has no declared primary key since migration 39: a row is
// identified by the unique index over (exhibit_id, tag_id,
// COALESCE(author_installation_id, '')). Those columns are its key here, and
// the author is matched through the same COALESCE, so the '' the Settings >
// Database view sends for a NULL key value names this installation's row.
const INDEX_KEYS: Partial<Record<AllowedTable, readonly string[]>> = {
  exhibit_tags: ['exhibit_id', 'tag_id', 'author_installation_id']
}

function keyPredicate(pk: Record<string, string>): { where: string; values: string[] } {
  const columns = Object.keys(pk)
  return {
    where: columns
      .map((k) => (k === 'author_installation_id' ? `COALESCE("${k}", '') = ?` : `"${k}" = ?`))
      .join(' AND '),
    values: columns.map((k) => pk[k])
  }
}

/**
 * Thrown for a create, update or delete on a row that belongs to a Shared
 * Case. Ruling 2 of 13 October 2026 on #1512: the escape hatch refuses these
 * rows rather than re-signing whatever was typed.
 */
export class SharedCaseRowError extends Error {
  constructor(table: string) {
    super(
      `This ${table} row belongs to a Shared Case. The Settings > Database table editor ` +
        'does not create, change or delete rows of a Shared Case.'
    )
    this.name = 'SharedCaseRowError'
  }
}

// Whether a row, as stored or as a write would leave it, belongs to a Shared
// Case. Every ALLOWED_TABLES entry needs one, so a table added to the editor
// fails to compile until it has a rule; `annotations`, `annotation_pins` and
// `note_tags` are not in ALLOWED_TABLES, so the editor reaches none of their
// rows. The `cases` rule reads the row itself, so a write that sets or clears
// `shared_at` is refused too. A tag has no case of its own: it belongs to
// every Case that reaches it through either relation, the rule
// `collectTagsForCase` exports by, except that the Exhibit relation is read
// through `exhibits` rather than `captures`, so a tag on a non-Capture Exhibit
// counts too. A tag application kept on a Capture deleted from a Shared Case
// reaches that Case through the deletion's record (#1877), so another
// member's kept row cannot be edited or deleted here either.
const SHARED_CASE_BY_ID = 'SELECT 1 FROM cases WHERE id = @case_id AND shared_at IS NOT NULL'
const SHARED_CAPTURE = `SELECT 1 FROM captures p JOIN cases c ON c.id = p.case_id
                         WHERE p.id = @capture_id AND c.shared_at IS NOT NULL`
const IN_SHARED_CASE: Record<AllowedTable, string> = {
  cases: 'SELECT 1 WHERE @shared_at IS NOT NULL',
  captures: SHARED_CASE_BY_ID,
  notes: SHARED_CASE_BY_ID,
  selectors: SHARED_CASE_BY_ID,
  capture_favorites: SHARED_CAPTURE,
  selector_matches: `${SHARED_CAPTURE}
                     UNION ALL
                     SELECT 1 FROM selectors s JOIN cases c ON c.id = s.case_id
                      WHERE s.id = @selector_id AND c.shared_at IS NOT NULL`,
  exhibit_tags: `SELECT 1 FROM exhibits e JOIN cases c ON c.id = e.case_id
                  WHERE e.id = @exhibit_id AND c.shared_at IS NOT NULL
                 UNION ALL
                 SELECT 1 FROM deleted_captures d JOIN cases c ON c.id = d.case_id
                  WHERE d.id = @exhibit_id AND c.shared_at IS NOT NULL`,
  tags: `SELECT 1 FROM exhibit_tags et
           JOIN exhibits e ON e.id = et.exhibit_id
           JOIN cases c ON c.id = e.case_id
          WHERE et.tag_id = @id AND c.shared_at IS NOT NULL
         UNION ALL
         SELECT 1 FROM exhibit_tags et
           JOIN deleted_captures d ON d.id = et.exhibit_id
           JOIN cases c ON c.id = d.case_id
          WHERE et.tag_id = @id AND c.shared_at IS NOT NULL
         UNION ALL
         SELECT 1 FROM note_tags nt
           JOIN notes n ON n.id = nt.note_id
           JOIN cases c ON c.id = n.case_id
          WHERE nt.tag_id = @id AND c.shared_at IS NOT NULL`
}

function assertNotSharedCaseRow(table: AllowedTable, ...rows: Array<Record<string, unknown>>) {
  const query = getDb().prepare(`${IN_SHARED_CASE[table]} LIMIT 1`)
  // Each query reads only the named parameters it declares; better-sqlite3
  // refuses an object missing one, so absent columns are passed as NULL.
  const params = (row: Record<string, unknown>) => ({
    id: row.id ?? null,
    case_id: row.case_id ?? null,
    capture_id: row.capture_id ?? null,
    exhibit_id: row.exhibit_id ?? null,
    selector_id: row.selector_id ?? null,
    shared_at: row.shared_at ?? null
  })
  for (const row of rows) {
    if (query.get(params(row)) !== undefined) throw new SharedCaseRowError(table)
  }
}

// notes.capture_id and exhibit_tags.exhibit_id have no foreign key since v41
// (#1877), so a write here that names a Capture or Exhibit must name one this
// database holds, as the key required.
function assertReferenceHeld(table: AllowedTable, row: Record<string, unknown>): void {
  if (table === 'notes' && 'capture_id' in row) {
    assertLiveReference(
      'notes',
      { capture_id: (row.capture_id as string | null) ?? null },
      'notes row'
    )
  }
  if (table === 'exhibit_tags' && 'exhibit_id' in row) {
    assertLiveReference(
      'exhibit_tags',
      { exhibit_id: (row.exhibit_id as string | null) ?? null },
      'exhibit_tags row'
    )
  }
}

export interface ColumnInfo {
  name: string
  type: string
  pk: boolean
}

export function getTableColumns(table: string): ColumnInfo[] {
  assertAllowedTable(table)
  const db = getDb()
  const rows = db.pragma(`table_info(${table})`) as Array<{
    name: string
    type: string
    pk: number
  }>
  const indexKey = INDEX_KEYS[table]
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    pk: r.pk > 0 || (indexKey?.includes(r.name) ?? false)
  }))
}

function assertValidColumns(table: string, data: Record<string, unknown>): void {
  const columns = getTableColumns(table)
  const validNames = new Set(columns.map((c) => c.name))
  for (const key of Object.keys(data)) {
    if (!validNames.has(key)) {
      throw new Error(`Column "${key}" does not exist on table "${table}"`)
    }
  }
}

/**
 * `pk` is taken verbatim from the IPC caller as `Record<string, string>` —
 * `assertValidColumns` only confirms its keys name real columns, not that
 * together they identify exactly one row. `updateRow`'s case/anchor
 * validation (below) checks a single looked-up row via `.get(...)`, but the
 * `UPDATE ... WHERE` it guards writes every row the predicate matches; a
 * non-PK predicate (e.g. `{ case_id: 'A' }`) would validate one arbitrary
 * row while writing to all of them, including rows the validation never
 * saw. Requiring `pk`'s keys to be exactly the table's declared PRIMARY KEY
 * column(s) is what makes "the row `pk` names" and "the rows the WHERE
 * clause matches" the same set, for both `updateRow` and `deleteRow`.
 */
function assertPkIdentifiesUniqueRow(table: string, pk: Record<string, string>): void {
  const pkColumnNames = getTableColumns(table)
    .filter((c) => c.pk)
    .map((c) => c.name)
    .sort()
  const suppliedNames = Object.keys(pk).sort()
  const isExactMatch =
    pkColumnNames.length > 0 &&
    pkColumnNames.length === suppliedNames.length &&
    pkColumnNames.every((name, i) => name === suppliedNames[i])
  if (!isExactMatch) {
    throw new Error(
      `pk for table "${table}" must supply exactly its primary key column(s) ` +
        `(${pkColumnNames.join(', ')}) to identify a single row`
    )
  }
}

/**
 * Validate an admin write and derive whatever the app derives from it.
 *
 * Returns the row to actually write, which may differ from the one submitted.
 *
 * Admin editing is a deliberate escape hatch, but a column holding structured
 * JSON is different in kind from a text field. `notes.anchor_json` is parsed on
 * every note read, so a malformed value here does not corrupt one row — it
 * takes out the whole notes surface. And `anchor_kind` is derived from that
 * payload everywhere else precisely so the two cannot disagree; the admin
 * surface must not be the one place that can pull them apart, since a stale
 * kind or a kind with no payload corrupts the counts and filters
 * `idx_notes_anchor_kind` exists to serve.
 *
 * So the hatch may clear an anchor, but it may not invent one this codebase
 * cannot read back, nor set the derived column by hand.
 *
 * It also may not create a cross-case anchor (#234): `assertAnchorInCase` is
 * the same check `createNote`/`updateNote`/`importNoteRows` run, so the admin
 * hatch — a genuine fourth write path, easy to forget — cannot be the one
 * place a structurally valid but cross-case anchor slips through.
 * `fallbackCaseId` is the row's CURRENT `case_id`, supplied by the caller for
 * an update whose payload does not itself touch that column. The inverse — a
 * payload that moves `case_id` without touching the structured columns — is
 * not this function's job to catch, because it never sees the row's stored
 * anchor or document; `updateRow` validates that case ahead of calling in,
 * against the existing `anchor_json` and `body_doc`.
 *
 * `body_doc` gets the same treatment (#389, maintainer ruling 2026-08-20):
 * `body` is derived from it everywhere else, and since Mentions the note's
 * rows in the references index are too. A `mentions` array in the result
 * means the write touches `body_doc` and the caller must rewrite the note's
 * references to exactly that list, in the same transaction as the write.
 */
function validatedRow(
  table: string,
  data: Record<string, unknown>,
  fallbackCaseId?: string
): { row: Record<string, unknown>; mentions?: NoteMention[] } {
  if (table !== 'notes') return { row: data }

  let row = data
  let mentions: NoteMention[] | undefined

  if ('body_doc' in row) {
    const value = row.body_doc
    if (value === null || value === undefined || value === '') {
      // Clearing the document leaves the note plain text — a valid state —
      // and clears the references derived from it (spike constraint 8). Any
      // `body` in the same payload is a plain-text write and passes through.
      row = { ...row, body_doc: null }
      mentions = []
    } else if (typeof value !== 'string') {
      throw new Error('notes.body_doc must be a string or NULL')
    } else {
      const doc = parseNoteDoc(value)
      // The document dictates `body`, overriding any submitted alongside it —
      // same rule as resolveBody in noteRepo, so the hatch cannot store a
      // body the document does not contain.
      row = { ...row, body: noteDocToText(doc), body_doc: JSON.stringify(doc) }
      mentions = extractNoteMentions(doc)
      const mentionCaseId = (row.case_id as string | undefined) ?? fallbackCaseId
      if (mentionCaseId) assertMentionsInCase(mentions, mentionCaseId)
    }
  }

  const writesJson = 'anchor_json' in row
  const writesKind = 'anchor_kind' in row

  if (writesKind && !writesJson) {
    throw new Error('notes.anchor_kind is derived from anchor_json; edit anchor_json instead')
  }
  if (!writesJson) return { row, mentions }

  const value = row.anchor_json
  if (value === null || value === undefined || value === '') {
    return { row: { ...row, anchor_json: null, anchor_kind: null }, mentions }
  }
  if (typeof value !== 'string') {
    throw new Error('notes.anchor_json must be a string or NULL')
  }
  const parsed = parseNoteAnchor(value)
  const caseId = (row.case_id as string | undefined) ?? fallbackCaseId
  // A create/update whose row we cannot resolve a case_id for skips this
  // check rather than blocking: for a create with no case_id the NOT NULL
  // column constraint below fails the write anyway, and there is nothing
  // this check adds ahead of that.
  if (caseId) assertAnchorInCase(parsed, caseId)
  return {
    row: { ...row, anchor_json: JSON.stringify(parsed), anchor_kind: parsed.kind },
    mentions
  }
}

export function getDbStats(dbPath: string): DbStats {
  const db = getDb()
  const schemaVersion = db.pragma('user_version', { simple: true }) as number

  let dbFileSize = 0
  let walFileSize = 0
  if (dbPath !== ':memory:') {
    try {
      dbFileSize = statSync(dbPath).size
    } catch {
      // file may not exist yet
    }
    try {
      walFileSize = statSync(dbPath + '-wal').size
    } catch {
      // WAL may not exist
    }
  }

  const tables: Array<{ name: string; rowCount: number }> = []
  for (const table of ALLOWED_TABLES) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get() as {
        count: number
      }
      tables.push({ name: table, rowCount: row.count })
    } catch {
      tables.push({ name: table, rowCount: 0 })
    }
  }

  return { schemaVersion, dbFileSize, walFileSize, tables }
}

export function getTableRows(params: DbTableRowsParams): DbTableRowsResult {
  assertAllowedTable(params.table)
  const db = getDb()
  const columns = getTableColumns(params.table)
  const offset = Number.isFinite(params.offset) ? Math.max(0, Math.floor(params.offset)) : 0
  const limit = Number.isFinite(params.limit)
    ? Math.min(500, Math.max(1, Math.floor(params.limit)))
    : 50
  const pkColumns = columns.filter((c) => c.pk).map((c) => `"${c.name}"`)
  const orderByClause = pkColumns.length > 0 ? pkColumns.join(', ') : 'rowid'

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM "${params.table}"`).get() as {
    count: number
  }
  const total = countRow.count

  const rows = db
    .prepare(`SELECT * FROM "${params.table}" ORDER BY ${orderByClause} LIMIT ? OFFSET ?`)
    .all(limit, offset) as Record<string, unknown>[]

  return { rows, total, columns }
}

export function createRow(table: string, data: Record<string, unknown>): Record<string, unknown> {
  assertAllowedTable(table)
  assertValidColumns(table, data)
  const { row, mentions } = validatedRow(table, data)
  assertNotSharedCaseRow(table, row)
  assertReferenceHeld(table, row)

  const db = getDb()
  const keys = Object.keys(row)
  const placeholders = keys.map(() => '?').join(', ')
  const values = keys.map((k) => row[k])

  // One transaction for the row and its references (#389): the index is
  // derived from body_doc and must never commit without it.
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${placeholders})`
    ).run(...values)

    // Return the inserted row by looking up the last rowid
    const lastRow = db
      .prepare(`SELECT * FROM "${table}" WHERE rowid = last_insert_rowid()`)
      .get() as Record<string, unknown> | undefined
    if (mentions && typeof lastRow?.id === 'string') {
      rewriteReferencesForNote(lastRow.id, mentions)
    }
    return lastRow
  })

  return write() ?? data
}

export function updateRow(
  table: string,
  pk: Record<string, string>,
  data: Record<string, unknown>
): boolean {
  assertAllowedTable(table)
  assertValidColumns(table, pk)
  assertValidColumns(table, data)
  assertPkIdentifiesUniqueRow(table, pk)

  const db = getDb()
  const { where: whereClauses, values: pkValues } = keyPredicate(pk)

  // Refused against the row as stored and as the write would leave it, so a
  // write can neither change a Shared Case's row nor move a row into one.
  const stored = db.prepare(`SELECT * FROM "${table}" WHERE ${whereClauses}`).get(...pkValues) as
    Record<string, unknown> | undefined
  if (stored) assertNotSharedCaseRow(table, stored, { ...stored, ...data })

  // An anchor or document edit that doesn't also touch case_id needs the
  // row's CURRENT case to validate against — look it up before writing.
  let fallbackCaseId: string | undefined
  if (table === 'notes' && ('anchor_json' in data || 'body_doc' in data) && !('case_id' in data)) {
    const existing = db
      .prepare(`SELECT case_id FROM "${table}" WHERE ${whereClauses}`)
      .get(...pkValues) as { case_id?: string } | undefined
    fallbackCaseId = existing?.case_id
  }

  // The inverse of the fallback above: a move that doesn't touch anchor_json
  // still carries the row's existing anchor with it. `validatedRow` only
  // checks when the payload itself writes anchor_json, so this is the one
  // place that guards a case_id-only move against landing a cross-case
  // anchor (#234) — validate the STORED anchor against the DESTINATION case
  // before the write proceeds.
  if (table === 'notes' && 'case_id' in data && !('anchor_json' in data)) {
    const existing = db
      .prepare(`SELECT anchor_json FROM "${table}" WHERE ${whereClauses}`)
      .get(...pkValues) as { anchor_json?: string | null } | undefined
    if (existing?.anchor_json) {
      assertAnchorInCase(parseNoteAnchor(existing.anchor_json), data.case_id as string)
    }
  }

  // Same guard for Mentions (#389): a case_id move that doesn't touch
  // body_doc carries the stored document's mentions with it — validate them
  // against the destination case so the move cannot land cross-case
  // references the write paths all reject.
  if (table === 'notes' && 'case_id' in data && !('body_doc' in data)) {
    const existing = db
      .prepare(`SELECT body_doc FROM "${table}" WHERE ${whereClauses}`)
      .get(...pkValues) as { body_doc?: string | null } | undefined
    if (existing?.body_doc) {
      let mentions: NoteMention[]
      try {
        mentions = extractNoteMentions(existing.body_doc)
      } catch (err) {
        // A stored document that no longer parses (a hatch write predating
        // #389, #662) refuses the move rather than carrying mentions nothing
        // can read into another case — but name the column that refused it,
        // or the operator reads a schema error about one they never touched.
        throw new Error(
          `notes.body_doc for this row does not parse, so its Mentions cannot be checked ` +
            `against the destination case: ${(err as Error).message}`,
          { cause: err }
        )
      }
      assertMentionsInCase(mentions, data.case_id as string)
    }
  }

  const { row, mentions } = validatedRow(table, data, fallbackCaseId)
  const dataKeys = Object.keys(row)
  if (dataKeys.length === 0) return false
  assertReferenceHeld(table, row)

  const setClauses = dataKeys.map((k) => `"${k}" = ?`).join(', ')
  const values = [...Object.values(row), ...pkValues]

  // One transaction for the row and its references (#389); pk names exactly
  // the table's primary key (asserted above), so for notes `pk.id` is the
  // note whose index rows the write must replace.
  const write = db.transaction(() => {
    const result = db
      .prepare(`UPDATE "${table}" SET ${setClauses} WHERE ${whereClauses}`)
      .run(...values)
    if (mentions && result.changes > 0) {
      rewriteReferencesForNote(pk.id, mentions)
    }
    return result
  })
  return write().changes > 0
}

export function deleteRow(table: string, pk: Record<string, string>): boolean {
  assertAllowedTable(table)
  assertValidColumns(table, pk)
  assertPkIdentifiesUniqueRow(table, pk)

  const db = getDb()
  const { where: whereClauses, values } = keyPredicate(pk)
  const stored = db.prepare(`SELECT * FROM "${table}" WHERE ${whereClauses}`).get(...values) as
    Record<string, unknown> | undefined
  // No row, nothing to delete. The dependents below are left alone too: the id
  // can name a Capture deleted from a Shared Case, whose kept rows stay (#1877).
  if (!stored) return false
  assertNotSharedCaseRow(table, stored)

  const run = db.transaction(() => {
    // What the keys cascaded before v41 (#1877). A Shared Case's rows were
    // refused above, so these are rows of a Case nobody shared.
    if (table === 'captures' && typeof pk.id === 'string') removeCaptureDependents(pk.id)
    if (table === 'cases' && typeof pk.id === 'string') removeCaseDependents([pk.id])
    return db.prepare(`DELETE FROM "${table}" WHERE ${whereClauses}`).run(...values)
  })

  const result = run()
  return result.changes > 0
}

// These PRAGMAs only inspect SQLite records. They do not verify capture files,
// signed manifests or timestamps, and never attempt repairs.
export function checkIntegrity(): { ok: boolean; issues: string[] } {
  const db = getDb()
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>
  const foreignKeys = db.pragma('foreign_key_check') as Array<{
    table: string
    rowid: number | null
    parent: string
    fkid: number
  }>
  const issues = integrity.map((row) => row.integrity_check).filter((message) => message !== 'ok')
  for (const violation of foreignKeys) {
    issues.push(
      `Foreign key violation in ${violation.table}, row ${violation.rowid ?? 'unknown'}, ` +
        `referencing ${violation.parent} (constraint ${violation.fkid}).`
    )
  }
  // No key checks these columns since v41 (#1877), so foreign_key_check cannot see them.
  for (const dangling of danglingReferences()) {
    issues.push(
      `Missing reference in ${dangling.table}, row ${dangling.rowid}, ` +
        `referencing ${dangling.parent}.`
    )
  }
  return { ok: integrity.length > 0 && issues.length === 0, issues }
}

export function vacuumDb(dbPath: string): { freedBytes: number } {
  const db = getDb()
  let sizeBefore = 0
  if (dbPath !== ':memory:') {
    try {
      sizeBefore = statSync(dbPath).size
    } catch {
      // ignore
    }
  }

  db.exec('VACUUM')
  db.pragma('optimize')

  let sizeAfter = 0
  if (dbPath !== ':memory:') {
    try {
      sizeAfter = statSync(dbPath).size
    } catch {
      // ignore
    }
  }

  return { freedBytes: Math.max(0, sizeBefore - sizeAfter) }
}

export function rebuildFts(store: Pick<CaptureStore, 'readArtifact'> = defaultCaptureStore): {
  rowsIndexed: number
  textsHealed: number
} {
  const db = getDb()
  // The .txt sidecars are the authoritative copy of Extracted Text; heal the
  // database copy from disk, then rebuild the derived indexes in one pass.
  const rows = db
    .prepare(
      'SELECT ct.capture_id AS captureId, c.case_id AS caseId FROM capture_texts ct JOIN captures c ON c.id = ct.capture_id'
    )
    .all() as Array<{ captureId: string; caseId: string }>
  // Only count a heal when the stored copy actually differed, so re-running
  // rebuild on an already-consistent DB reports textsHealed: 0.
  const update = db.prepare(
    'UPDATE capture_texts SET content = ? WHERE capture_id = ? AND content IS NOT ?'
  )
  let textsHealed = 0
  for (const row of rows) {
    const buf = store.readArtifact(row.caseId, row.captureId, 'txt')
    if (buf) {
      const content = buf.toString('utf-8')
      textsHealed += update.run(content, row.captureId, content).changes
    }
  }
  db.exec("INSERT INTO captures_fts(captures_fts) VALUES ('rebuild')")
  db.exec("INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')")
  const captureCount = db.prepare('SELECT COUNT(*) as count FROM captures').get() as {
    count: number
  }
  const noteCount = db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number }
  const rowsIndexed = captureCount.count + noteCount.count

  return { rowsIndexed, textsHealed }
}

export function purgeArchived(): { casesDeleted: number; capturesDeleted: number } {
  const db = getDb()

  const captureCountRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM captures
       WHERE case_id IN (SELECT id FROM cases WHERE archived = 1)`
    )
    .get() as { count: number }
  const capturesDeleted = captureCountRow.count

  const result = db.transaction(() => {
    const archived = db.prepare('SELECT id FROM cases WHERE archived = 1').all() as Array<{
      id: string
    }>
    removeCaseDependents(archived.map(({ id }) => id))
    return db.prepare('DELETE FROM cases WHERE archived = 1').run()
  })()

  return { casesDeleted: result.changes, capturesDeleted }
}

export function findOrphans(): OrphanReport {
  const db = getDb()
  const dbOrphans: OrphanReport['dbOrphans'] = []
  const fileOrphans: string[] = []

  let storageRoot: string
  try {
    storageRoot = getStorageRoot()
  } catch {
    return { dbOrphans, fileOrphans }
  }

  const captures = db
    .prepare(
      `SELECT p.id, p.case_id, p.html_path, p.screenshot_path, p.mhtml_path,
              c.shared_at IS NOT NULL AS shared
         FROM captures p LEFT JOIN cases c ON c.id = p.case_id`
    )
    .all() as Array<{
    id: string
    case_id: string
    html_path: string | null
    screenshot_path: string | null
    mhtml_path: string | null
    shared: number
  }>

  for (const cap of captures) {
    // A Shared Case's Captures are never orphans (maintainer ruling of 14
    // October 2026 on PR #1865). They stay in `captures` below, so their
    // files are not reported either.
    if (cap.shared) continue
    // A missing Transaction Record or PDF is never a reason to report a
    // Capture, since cleanOrphans deletes every Capture this reports;
    // verifySidecars reports the file `missing` instead (open question F of
    // docs/plans/2026-10-10-capture-engine-first-slice.md).
    const missing: string[] = []
    if (cap.html_path && !existsSync(join(storageRoot, cap.html_path))) {
      missing.push(cap.html_path)
    }
    if (cap.screenshot_path && !existsSync(join(storageRoot, cap.screenshot_path))) {
      missing.push(cap.screenshot_path)
    }
    if (cap.mhtml_path && !existsSync(join(storageRoot, cap.mhtml_path))) {
      missing.push(cap.mhtml_path)
    }
    if (missing.length > 0) {
      dbOrphans.push({
        table: 'captures',
        id: cap.id,
        caseId: cap.case_id,
        missingPaths: missing
      })
    }
  }

  if (existsSync(storageRoot)) {
    const captureIds = new Set(captures.map((c) => c.id))
    // A Shared Case's directory also holds other members' files, which the
    // sync session hash-checked against their entries on arrival (#1512) and
    // which no local row describes until #1811 writes one. Nothing in it is
    // an orphan, so the directory is not scanned.
    const sharedCaseIds = listSharedCaseIds()
    // Every storage-root-relative path the database claims for a non-Capture
    // Exhibit, a Derived File or a pooled file. The Capture directory is
    // matched by filename (`parseArtifactFilename`) because a Capture's
    // artifacts are named after its id; nothing else is, so the subdirectories
    // are matched by recorded path instead.
    const knownPaths = new Set(
      (
        db
          .prepare(
            `SELECT path FROM exhibits WHERE path IS NOT NULL
             UNION SELECT path FROM derived_files
             UNION SELECT path FROM staging_files`
          )
          .all() as Array<{ path: string }>
      ).map((row) => row.path)
    )
    const caseDirs = readdirSync(storageRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    for (const caseDir of caseDirs) {
      if (sharedCaseIds.has(caseDir)) continue
      const casePath = join(storageRoot, caseDir)
      for (const entry of readdirSync(casePath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          // Only the subdirectories the layout declares are scanned (X4,
          // ADR-0024). An unrecognised directory is left alone rather than
          // reported: `cleanOrphans` deletes what this reports, and guessing
          // that an unknown directory is ours is how an operator's own files
          // get deleted.
          if (!CASE_SUBDIRECTORIES.includes(entry.name)) continue
          const subPath = join(casePath, entry.name)
          for (const file of readdirSync(subPath)) {
            const rel = join(caseDir, entry.name, file)
            if (!knownPaths.has(rel)) fileOrphans.push(rel)
          }
          continue
        }
        const parsed = parseArtifactFilename(entry.name)
        if (!parsed) continue
        // A Derived File an archive import restored keeps the name its signed
        // entry gives it, so a renamed import's thumbnail carries the source's
        // Capture id, which may exist nowhere here (#1813). Its row claims it.
        const rel = join(caseDir, entry.name)
        if (!captureIds.has(parsed.captureId) && !knownPaths.has(rel)) {
          fileOrphans.push(rel)
        }
      }
    }
  }

  return { dbOrphans, fileOrphans }
}

export function cleanOrphans(report: OrphanReport): {
  dbRecordsRemoved: number
  filesRemoved: number
} {
  const db = getDb()
  let dbRecordsRemoved = 0
  let filesRemoved = 0
  const allowedOrphanTables = new Set(['captures'])
  // The report comes back from the renderer, so a Case shared since the scan,
  // or an edited report, is checked here as well as in findOrphans: a Shared
  // Case's Capture rows and every file under its directory are left alone.
  const inSharedCase = db.prepare(`${IN_SHARED_CASE.captures} LIMIT 1`)
  const sharedCaseIds = listSharedCaseIds()

  for (const orphan of report.dbOrphans) {
    if (!allowedOrphanTables.has(orphan.table)) {
      continue
    }
    const stored = db.prepare('SELECT case_id FROM captures WHERE id = ?').get(orphan.id) as
      { case_id: string } | undefined
    if (stored && inSharedCase.get({ case_id: stored.case_id }) !== undefined) continue
    // A Capture deleted from a Shared Case: the rows other members keep on it stay (#1877).
    if (deletedCaptureCase(orphan.id) !== undefined) continue
    const run = db.transaction(() => {
      // The Exhibit row goes with the Capture row: `exhibits` hangs off
      // `cases`, so nothing cascades to it, and a row left behind would list a
      // deleted Capture in the inventory. Called unconditionally because
      // `allowedOrphanTables` is `{'captures'}` and an Exhibit id IS its
      // Capture id — a second allowed table would have to make this per-table
      // rather than inherit it. The tag applications, annotations, pins and
      // note links go first, as the keys took them before v41 (#1877); a
      // Shared Case's Captures never reach here.
      removeExhibitDependents(orphan.id)
      removeCaptureDependents(orphan.id)
      deleteExhibit(orphan.id)
      return db.prepare(`DELETE FROM "${orphan.table}" WHERE id = ?`).run(orphan.id)
    })
    const result = run()
    dbRecordsRemoved += result.changes
  }

  let storageRoot: string
  try {
    storageRoot = getStorageRoot()
  } catch {
    return { dbRecordsRemoved, filesRemoved }
  }

  const resolvedRoot = resolve(storageRoot) + sep
  for (const relPath of report.fileOrphans) {
    const absPath = resolve(defaultCaptureStore.resolveAbsolute(relPath))
    if (!absPath.startsWith(resolvedRoot)) continue
    if (sharedCaseIds.has(absPath.slice(resolvedRoot.length).split(sep)[0])) continue
    if (existsSync(absPath)) {
      unlinkSync(absPath)
      filesRemoved++
    }
  }

  return { dbRecordsRemoved, filesRemoved }
}

export function exportTableData(table: string, format: 'csv' | 'json'): string {
  assertAllowedTable(table)
  const db = getDb()
  const columns = getTableColumns(table)
  const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]

  if (format === 'json') {
    return JSON.stringify(rows, null, 2)
  }

  const header = columns.map((c) => c.name)
  const csvRows = rows.map((row) =>
    columns.map((c) => {
      const val = row[c.name]
      return val === null || val === undefined ? '' : String(val)
    })
  )
  return buildCsv(header, csvRows)
}

export function backupDatabase(dbPath: string, destPath: string): void {
  const db = getDb()
  db.pragma('wal_checkpoint(TRUNCATE)')
  copyFileSync(dbPath, destPath)
}
