import { getDb, withTransaction } from '@main/services/db/core'
import { rewriteReferencesForNote } from '@main/services/db/noteReferenceRepo'
import { extractNoteMentions, type NoteMention } from '@shared/noteDoc'
import { parseNoteAnchor } from '@shared/noteAnchor'

// The SQL of the working layer as sync sees it (#1512, docs/specs/2026-09-19-
// collaborative-cases-design.md "Working-layer rows"): six tables whose rows
// each belong to one author installation, carry a per-author version, a
// tombstone and the author's signature. This module reads and writes those
// four columns and the content columns the signature covers; what to sign,
// and whether a signature verifies, is decided in
// `@main/services/sharing/workingRows`. NULL in `author_installation_id` is
// this installation, as every row was before v36.

export const SYNCED_TABLES = [
  'notes',
  'tags',
  'exhibit_tags',
  'note_tags',
  'annotations',
  'annotation_pins'
] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

export function isSyncedTable(table: string): table is SyncedTable {
  return (SYNCED_TABLES as readonly string[]).includes(table)
}

export type RowFields = Record<string, string | number | null>

// The columns that name one author's row.
export type RowKey = Record<string, string>

export interface StoredRow {
  table: SyncedTable
  // NULL is this installation.
  author: string | null
  version: number
  deletedAt: string | null
  signature: string | null
  // The content columns, in the table's column order.
  fields: RowFields
}

interface TableSpec {
  key: readonly string[]
  // The content columns the author signs. Everything but the four sync
  // columns, so a row's meaning cannot be changed without its signature
  // failing.
  columns: readonly string[]
  // The Case ids a row belongs to, over named parameters from its key. A tag
  // belongs to every Case that reaches it through either relation, the rule
  // `collectTagsForCase` exports by.
  caseIds: string
  // The rows of a Case: a join and predicate over alias `t` and `@case_id`.
  inCase: string
  // Where the one Case a row belongs to is read from: a column of the row,
  // the `case_id` of the row a column references, or nowhere (a tag belongs
  // to Cases through its applications).
  caseOf: { column: string } | { via: 'exhibits' | 'notes' | 'captures'; column: string } | null
  // The Capture or Exhibit a column names, which no foreign key checks since v41 (#1877):
  // the writers check it (referenceOf), and a deleted Capture of a Shared Case is resolved
  // through `deleted_captures`.
  references: { column: string; parent: 'captures' | 'exhibits' } | null
}

// A Capture or Exhibit that was deleted from a Shared Case, by id, read in place of the row
// that is gone: the Case another member's kept row on it still belongs to.
const DELETED = (id: string): string => `SELECT case_id FROM deleted_captures WHERE id = ${id}`

// A row on a Capture of the Case: a live one, or one deleted from it (#1877).
const ON_CAPTURE_IN_CASE = `EXISTS (SELECT 1 FROM captures c
                                      WHERE c.id = t.capture_id AND c.case_id = @case_id)
                             OR EXISTS (SELECT 1 FROM deleted_captures d
                                         WHERE d.id = t.capture_id AND d.case_id = @case_id)`

const SPECS: Record<SyncedTable, TableSpec> = {
  notes: {
    key: ['id'],
    columns: [
      'id',
      'case_id',
      'capture_id',
      'title',
      'body',
      'body_doc',
      'anchor_kind',
      'anchor_json',
      'source_url',
      'screenshot_path',
      'created_at',
      'updated_at'
    ],
    caseIds: 'SELECT case_id FROM notes WHERE id = @id',
    inCase: 't.case_id = @case_id',
    caseOf: { column: 'case_id' },
    references: { column: 'capture_id', parent: 'captures' }
  },
  tags: {
    key: ['id'],
    columns: ['id', 'name', 'color', 'created_at'],
    caseIds: `SELECT e.case_id FROM exhibit_tags et JOIN exhibits e ON e.id = et.exhibit_id
               WHERE et.tag_id = @id
              UNION
              SELECT d.case_id FROM exhibit_tags et JOIN deleted_captures d ON d.id = et.exhibit_id
               WHERE et.tag_id = @id
              UNION
              SELECT n.case_id FROM note_tags nt JOIN notes n ON n.id = nt.note_id
               WHERE nt.tag_id = @id`,
    // An application kept on a deleted Capture still reaches its Case, so the tag it names
    // travels with it and the receiver's tag_id key is met.
    inCase: `EXISTS (SELECT 1 FROM exhibit_tags et JOIN exhibits e ON e.id = et.exhibit_id
                      WHERE et.tag_id = t.id AND e.case_id = @case_id)
             OR EXISTS (SELECT 1 FROM exhibit_tags et
                          JOIN deleted_captures d ON d.id = et.exhibit_id
                         WHERE et.tag_id = t.id AND d.case_id = @case_id)
             OR EXISTS (SELECT 1 FROM note_tags nt JOIN notes n ON n.id = nt.note_id
                         WHERE nt.tag_id = t.id AND n.case_id = @case_id)`,
    caseOf: null,
    references: null
  },
  exhibit_tags: {
    key: ['exhibit_id', 'tag_id'],
    columns: ['exhibit_id', 'tag_id'],
    caseIds: `SELECT case_id FROM exhibits WHERE id = @exhibit_id
              UNION ${DELETED('@exhibit_id')}`,
    inCase: `EXISTS (SELECT 1 FROM exhibits e WHERE e.id = t.exhibit_id AND e.case_id = @case_id)
             OR EXISTS (SELECT 1 FROM deleted_captures d
                         WHERE d.id = t.exhibit_id AND d.case_id = @case_id)`,
    caseOf: { via: 'exhibits', column: 'exhibit_id' },
    references: { column: 'exhibit_id', parent: 'exhibits' }
  },
  note_tags: {
    key: ['note_id', 'tag_id'],
    columns: ['note_id', 'tag_id'],
    caseIds: 'SELECT case_id FROM notes WHERE id = @note_id',
    inCase: 'EXISTS (SELECT 1 FROM notes n WHERE n.id = t.note_id AND n.case_id = @case_id)',
    caseOf: { via: 'notes', column: 'note_id' },
    references: null
  },
  annotations: {
    key: ['capture_id'],
    columns: [
      'capture_id',
      'schema_version',
      'shapes_json',
      'image_width',
      'image_height',
      'updated_at',
      'updated_by'
    ],
    caseIds: `SELECT case_id FROM captures WHERE id = @capture_id
              UNION ${DELETED('@capture_id')}`,
    inCase: ON_CAPTURE_IN_CASE,
    caseOf: { via: 'captures', column: 'capture_id' },
    references: { column: 'capture_id', parent: 'captures' }
  },
  annotation_pins: {
    key: ['id'],
    columns: ['id', 'capture_id', 'number', 'body', 'created_at', 'updated_at'],
    caseIds: `SELECT c.case_id FROM annotation_pins p JOIN captures c ON c.id = p.capture_id
               WHERE p.id = @id
              UNION
              SELECT d.case_id FROM annotation_pins p JOIN deleted_captures d ON d.id = p.capture_id
               WHERE p.id = @id`,
    inCase: ON_CAPTURE_IN_CASE,
    caseOf: { via: 'captures', column: 'capture_id' },
    references: { column: 'capture_id', parent: 'captures' }
  }
}

export function signedColumns(table: SyncedTable): readonly string[] {
  return SPECS[table].columns
}

// The Cases of the rows a note's content columns reference and this database
// holds: its Capture column, and the Capture and selector its anchor names. A
// Capture deleted from a Shared Case is held through its record (#1877).
// The receiving side of `assertAnchorInCase` (noteRepo.ts), which refuses a
// local note whose anchor names a row of another Case. Throws when the
// anchor does not parse, as a local write does.
export function noteReferencedCases(fields: RowFields): string[] {
  const refs: Array<{ table: 'captures' | 'selectors'; id: string | number | null }> = [
    { table: 'captures', id: fields.capture_id }
  ]
  if (fields.anchor_json !== null) {
    const anchor = parseNoteAnchor(String(fields.anchor_json))
    refs.push({ table: 'captures', id: anchor.captureId })
    if (anchor.kind === 'finding' && anchor.finding === 'selectorMatch') {
      refs.push({ table: 'selectors', id: anchor.selectorId })
    }
  }
  return refs.flatMap(({ table, id }) => {
    if (id === null) return []
    const row = (
      table === 'captures'
        ? getDb().prepare(`${CASE_OF_CAPTURE} LIMIT 1`).get(id, id)
        : getDb().prepare(`SELECT case_id FROM ${table} WHERE id = ?`).get(id)
    ) as { case_id: string } | undefined
    return row ? [row.case_id] : []
  })
}

const CASE_OF_CAPTURE = `SELECT case_id FROM captures WHERE id = ?
                          UNION ALL ${DELETED('?')}`

// The Case a row with these content columns belongs to, as this database
// reads it: null for a table whose rows belong to no one Case, undefined
// when the row the columns reference is not held here. A Capture or Exhibit
// deleted from a Shared Case is read from its record, so a row kept on it
// still names the Case its author signed (#1877). An id is never both held
// and recorded: deleteCapture records it as the row goes, and the evidence
// step and the archive import refuse or remap a recorded id.
export function caseOfRow(table: SyncedTable, fields: RowFields): string | null | undefined {
  const { caseOf } = SPECS[table]
  if (caseOf === null) return null
  if (!('via' in caseOf)) return String(fields[caseOf.column])
  const id = fields[caseOf.column]
  const row = (
    caseOf.via === 'notes'
      ? getDb().prepare('SELECT case_id FROM notes WHERE id = ?').get(id)
      : getDb()
          .prepare(
            `SELECT case_id FROM ${caseOf.via} WHERE id = ? UNION ALL ${DELETED('?')} LIMIT 1`
          )
          .get(id, id)
  ) as { case_id: string } | undefined
  return row?.case_id
}

// --- References to a Capture or Exhibit, checked in code since v41 (#1877) ---

// The Case a Capture or Exhibit deleted from a Shared Case belonged to, or undefined when
// this database holds no record of its deletion.
export function deletedCaptureCase(id: string): string | undefined {
  const row = getDb().prepare(DELETED('?')).get(id) as { case_id: string } | undefined
  return row?.case_id
}

// Records that a Capture of a Shared Case was deleted, in the transaction that deletes it.
// The id is still held then, so a record already there means the invariant above is broken,
// and the insert's primary key refuses it.
export function recordDeletedCapture(id: string, caseId: string): void {
  getDb().prepare('INSERT INTO deleted_captures (id, case_id) VALUES (?, ?)').run(id, caseId)
}

// Records a deletion read from a chain (receivedEvidence.ts), for a Capture this database
// never held or deleted before migration 41: `chainAuthor` is the member whose chain it was
// read from, null for this installation's own. A record already there is kept, and no record
// is ever removed except with its Case.
export function recordChainDeletion(id: string, caseId: string, chainAuthor: string | null): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO deleted_captures (id, case_id, chain_author) VALUES (?, ?, ?)')
    .run(id, caseId, chainAuthor)
}

export type ReferenceState = 'live' | 'recorded' | 'missing'

export interface Reference {
  // 'Capture' or 'Exhibit', for the messages that name it.
  noun: string
  id: string
  state: ReferenceState
}

// The Capture or Exhibit a row with these content columns names, and whether this database
// holds it, records it as deleted, or neither; null when the table names none or the column
// is NULL.
export function referenceOf(table: SyncedTable, fields: RowFields): Reference | null {
  const { references } = SPECS[table]
  if (references === null) return null
  const value = fields[references.column]
  if (value === null || value === undefined) return null
  const id = String(value)
  const noun = references.parent === 'captures' ? 'Capture' : 'Exhibit'
  if (getDb().prepare(`SELECT 1 FROM ${references.parent} WHERE id = ?`).get(id) !== undefined) {
    return { noun, id, state: 'live' }
  }
  return { noun, id, state: deletedCaptureCase(id) === undefined ? 'missing' : 'recorded' }
}

// Every annotation layer, pin and tag application whose Capture or Exhibit this database
// neither holds nor records as deleted: what foreign_key_check reported for those columns
// before v41 (#1877). Notes are left out: a note's link may name a Capture this database never
// held, as an imported note's link to a deleted Capture does.
export function danglingReferences(): Array<{ table: SyncedTable; rowid: number; parent: string }> {
  const db = getDb()
  return (['annotations', 'annotation_pins', 'exhibit_tags'] as const).flatMap((table) => {
    const { column, parent } = SPECS[table].references!
    const rows = db
      .prepare(
        `SELECT t.rowid AS rowid FROM ${table} t
          WHERE NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = t.${column})
            AND NOT EXISTS (SELECT 1 FROM deleted_captures d WHERE d.id = t.${column})
          ORDER BY t.rowid`
      )
      .all() as Array<{ rowid: number }>
    return rows.map(({ rowid }) => ({ table, rowid, parent }))
  })
}

// The error a dropped key raised, with the code the IPC layer maps to "Referenced record
// does not exist" (ipcWrap.ts), so a writer refused here reads as it did before v41.
export function referenceError(detail: string): Error {
  return Object.assign(new Error(`FOREIGN KEY constraint failed: ${detail}`), {
    code: 'SQLITE_CONSTRAINT_FOREIGNKEY'
  })
}

// Throws unless the Capture or Exhibit the row names, if any, is held here.
export function assertLiveReference(table: SyncedTable, fields: RowFields, what: string): void {
  const reference = referenceOf(table, fields)
  if (reference !== null && reference.state !== 'live') {
    throw referenceError(
      `${what} names ${reference.noun} ${reference.id}, which this copy does not hold`
    )
  }
}

// A note of a Case nobody shared that links a Capture of another Case (Settings > Database can
// move one) loses the link when that Capture goes, as SET NULL cleared it before v41. A note of
// a Shared Case keeps its link as signed, whichever Case the Capture was in.
const UNSHARED_NOTE = 'case_id IN (SELECT id FROM cases WHERE shared_at IS NULL)'

export function clearUnsharedNoteLinks(id: string): void {
  getDb()
    .prepare(`UPDATE notes SET capture_id = NULL WHERE capture_id = ? AND ${UNSHARED_NOTE}`)
    .run(id)
}

// What the dropped keys did when a Capture or Exhibit of a Case nobody shared goes, written
// out: every author's annotation layer, pins and tag applications on it are removed and the
// link of every note of a Case nobody shared is cleared. Rows from another author reach such
// a Case only through an archive import. The note update fires the notes triggers as SET NULL
// did, and re-signs nothing.
export function removeExhibitDependents(id: string): void {
  getDb().prepare('DELETE FROM exhibit_tags WHERE exhibit_id = ?').run(id)
}

export function removeCaptureDependents(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM annotations WHERE capture_id = ?').run(id)
  db.prepare('DELETE FROM annotation_pins WHERE capture_id = ?').run(id)
  clearUnsharedNoteLinks(id)
}

// Before whole Cases are deleted: the annotation layers, pins and tag applications on their
// Captures, Exhibits and deleted Captures, every author's, and the links to their Captures
// from notes of other Cases nobody shared. Nothing cascades to them from `cases` since v41;
// the Cases' own notes and records still go by their own case_id keys.
export function removeCaseDependents(caseIds: string[]): void {
  if (caseIds.length === 0) return
  const db = getDb()
  const ids = JSON.stringify(caseIds)
  const inCases = 'case_id IN (SELECT value FROM json_each(@ids))'
  const deleted = `SELECT id FROM deleted_captures WHERE ${inCases}`
  db.prepare(
    `UPDATE notes SET capture_id = NULL
      WHERE capture_id IN (SELECT id FROM captures WHERE ${inCases})
        AND NOT ${inCases} AND ${UNSHARED_NOTE}`
  ).run({ ids })
  for (const table of ['annotations', 'annotation_pins']) {
    db.prepare(
      `DELETE FROM ${table}
        WHERE capture_id IN (SELECT id FROM captures WHERE ${inCases} UNION ${deleted})`
    ).run({ ids })
  }
  db.prepare(
    `DELETE FROM exhibit_tags
      WHERE exhibit_id IN (SELECT id FROM exhibits WHERE ${inCases} UNION ${deleted})`
  ).run({ ids })
}

// This installation's rows on a Capture, live and tombstoned: its annotation layer, its pins
// and its tag applications. Removed in place of tombstones on a Capture no other member can
// hold (settleRowsOnDeletedCapture); every other author's rows and every note are left.
export function removeOwnRowsOnCapture(id: string): void {
  const db = getDb()
  const own = 'author_installation_id IS NULL'
  db.prepare(`DELETE FROM annotations WHERE capture_id = ? AND ${own}`).run(id)
  db.prepare(`DELETE FROM annotation_pins WHERE capture_id = ? AND ${own}`).run(id)
  db.prepare(`DELETE FROM exhibit_tags WHERE exhibit_id = ? AND ${own}`).run(id)
}

// This installation's live rows on a Capture: its annotation layer, its pins and its tag
// applications. Notes are not among them: a note keeps its link to a deleted Capture.
export function ownLiveRowsOnCapture(id: string): Array<{ table: SyncedTable; key: RowKey }> {
  const db = getDb()
  const live = 'author_installation_id IS NULL AND deleted_at IS NULL'
  const layers = db
    .prepare(`SELECT capture_id FROM annotations WHERE capture_id = ? AND ${live}`)
    .all(id) as Array<{ capture_id: string }>
  const pins = db
    .prepare(`SELECT id FROM annotation_pins WHERE capture_id = ? AND ${live} ORDER BY rowid`)
    .all(id) as Array<{ id: string }>
  const tags = db
    .prepare(`SELECT tag_id FROM exhibit_tags WHERE exhibit_id = ? AND ${live} ORDER BY rowid`)
    .all(id) as Array<{ tag_id: string }>
  return [
    ...layers.map(() => ({ table: 'annotations' as const, key: { capture_id: id } })),
    ...pins.map((pin) => ({ table: 'annotation_pins' as const, key: { id: pin.id } })),
    ...tags.map((tag) => ({
      table: 'exhibit_tags' as const,
      key: { exhibit_id: id, tag_id: tag.tag_id }
    }))
  ]
}

export function isSharedCaseId(caseId: string): boolean {
  return (
    getDb().prepare('SELECT 1 FROM cases WHERE id = ? AND shared_at IS NOT NULL').get(caseId) !==
    undefined
  )
}

// `author` NULL matches this installation's rows. The predicate the per-author
// unique indexes are built on.
const AUTHOR_MATCH = "COALESCE(t.author_installation_id, '') = COALESCE(@author, '')"

function keyPredicate(table: SyncedTable): string {
  return SPECS[table].key.map((column) => `t.${column} = @${column}`).join(' AND ')
}

function toStoredRow(table: SyncedTable, raw: Record<string, unknown>): StoredRow {
  const fields: RowFields = {}
  for (const column of SPECS[table].columns) {
    fields[column] = (raw[column] as string | number | null | undefined) ?? null
  }
  return {
    table,
    author: (raw.author_installation_id as string | null) ?? null,
    version: raw.version as number,
    deletedAt: (raw.deleted_at as string | null) ?? null,
    signature: (raw.row_signature as string | null) ?? null,
    fields
  }
}

// One author's row by key, tombstoned or not; undefined when absent.
export function readRow(
  table: SyncedTable,
  key: RowKey,
  author: string | null
): StoredRow | undefined {
  const raw = getDb()
    .prepare(`SELECT t.* FROM ${table} t WHERE ${keyPredicate(table)} AND ${AUTHOR_MATCH}`)
    .get({ ...key, author }) as Record<string, unknown> | undefined
  return raw ? toStoredRow(table, raw) : undefined
}

// Whether this installation holds a live (not tombstoned) row under `key`.
export function isLiveLocalRow(table: SyncedTable, key: RowKey): boolean {
  const row = readRow(table, key, null)
  return row !== undefined && row.deletedAt === null
}

// Whether a row belongs to a Shared Case, by the Cases its key reaches.
export function isInSharedCase(table: SyncedTable, key: RowKey): boolean {
  return (
    getDb()
      .prepare(
        `SELECT 1 FROM cases WHERE shared_at IS NOT NULL
           AND id IN (${SPECS[table].caseIds}) LIMIT 1`
      )
      .get(key) !== undefined
  )
}

// Writes the sync columns of this installation's row under `key`.
export function writeRowSync(
  table: SyncedTable,
  key: RowKey,
  sync: { version: number; deletedAt: string | null; signature: string }
): void {
  const predicate = SPECS[table].key.map((column) => `${column} = @${column}`).join(' AND ')
  getDb()
    .prepare(
      `UPDATE ${table} SET version = @version, deleted_at = @deletedAt, row_signature = @signature
        WHERE ${predicate} AND author_installation_id IS NULL`
    )
    .run({ ...key, ...sync })
}

export function hardDeleteLocalRow(table: SyncedTable, key: RowKey): boolean {
  const predicate = SPECS[table].key.map((column) => `${column} = @${column}`).join(' AND ')
  return (
    getDb()
      .prepare(`DELETE FROM ${table} WHERE ${predicate} AND author_installation_id IS NULL`)
      .run(key).changes > 0
  )
}

// The highest version this installation has given any of its rows, or 0.
export function maxLocalVersion(): number {
  const union = SYNCED_TABLES.map(
    (table) => `SELECT MAX(version) AS v FROM ${table} WHERE author_installation_id IS NULL`
  ).join(' UNION ALL ')
  const row = getDb().prepare(`SELECT COALESCE(MAX(v), 0) AS v FROM (${union})`).get() as {
    v: number
  }
  return row.v
}

// The tables a `rows` answer offers whatever the peer's cursor says. A tag
// belongs to a Case through its applications, which any member writes at
// any time, so the version the tag's author gave it says nothing about
// whether a peer has seen it in this Case: a tag created at version 1 and
// applied here after a peer's cursor passed 1 would never be offered, and
// every application of it would fail its foreign key on that peer for good.
// Tags are few and the receiver skips the ones it holds at that version.
// For the same reason a tag's version never moves a cursor: the cursor is
// read from the cursor-bound tables alone, here and in `cursorAfter`
// (workingRows.ts).
export const CURSOR_FREE_TABLES: ReadonlySet<string> = new Set<SyncedTable>(['tags'])

const CURSOR_BOUND_TABLES = SYNCED_TABLES.filter((table) => !CURSOR_FREE_TABLES.has(table))

// The highest version of `author`'s cursor-bound rows this replica holds in
// a Case, or 0: the cursor a `rows` request carries. Read from the rows
// themselves, so a database restore moves it back with them.
export function maxAuthorVersionInCase(caseId: string, author: string): number {
  const union = CURSOR_BOUND_TABLES.map(
    (table) =>
      `SELECT MAX(t.version) AS v FROM ${table} t
        WHERE t.author_installation_id = @author AND (${SPECS[table].inCase})`
  ).join(' UNION ALL ')
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(v), 0) AS v FROM (${union})`)
    .get({ case_id: caseId, author }) as { v: number }
  return row.v
}

// The most rows of one cursor-bound table a page reads. The query stops at
// it, so the work of answering a page is bounded whatever the backlog; the
// page is then cut from what the tables offer (`offerPage`, workingRows.ts).
export const ROWS_PAGE_LIMIT = 500

// What one table offers a page: rows in version order, and whether every row
// of the table above the cursor is among them. When not, the table holds
// more above the last version here, and that version is complete.
export interface TableOffer<T = StoredRow> {
  rows: T[]
  complete: boolean
}

// Cuts what one bounded query fetched (`limit` + 1 rows in version order) to
// whole version groups. A page must end on a version boundary, because the
// cursor it moves to names everything at or below it as seen: a group the
// fetch split would leave its remainder behind for good. A trailing group
// the fetch may have split is dropped; when the fetch holds one group only,
// the whole group is read instead, however long, so a batch written in one
// action (`addTagToCaptures`, `mergeTags`) travels whole.
export function completeOffer<T extends { version: number }>(
  fetched: T[],
  limit: number,
  wholeGroup: (version: number) => T[]
): TableOffer<T> {
  if (fetched.length <= limit) return { rows: fetched, complete: true }
  const beyond = fetched[limit].version
  const whole = fetched.filter((row) => row.version < beyond)
  return { rows: whole.length > 0 ? whole : wholeGroup(beyond), complete: false }
}

// What one page of `author`'s rows in a Case may draw on, by table: every
// signed row of a cursor-free table that the Case reaches, and the lowest
// whole version groups above `sinceVersion` of each other table, at most
// `limit` rows unless one group is longer. `author` NULL is this
// installation's rows.
export function rowsOfAuthorByTable(
  caseId: string,
  author: string | null,
  sinceVersion: number,
  limit = ROWS_PAGE_LIMIT
): Map<SyncedTable, TableOffer> {
  const byTable = new Map<SyncedTable, TableOffer>()
  for (const table of SYNCED_TABLES) {
    const select = (predicate: string, tail: string): StoredRow[] =>
      (
        getDb()
          .prepare(
            `SELECT t.* FROM ${table} t
              WHERE ${AUTHOR_MATCH} AND t.row_signature IS NOT NULL
                AND (${SPECS[table].inCase}) ${predicate}
              ORDER BY t.version ${tail}`
          )
          .all({ case_id: caseId, author, since: sinceVersion, fetch: limit + 1 }) as Record<
          string,
          unknown
        >[]
      ).map((r) => toStoredRow(table, r))
    if (CURSOR_FREE_TABLES.has(table)) {
      byTable.set(table, { rows: select('', ''), complete: true })
      continue
    }
    const fetched = select('AND t.version > @since', 'LIMIT @fetch')
    byTable.set(
      table,
      completeOffer(fetched, limit, (version) =>
        (
          getDb()
            .prepare(
              `SELECT t.* FROM ${table} t
                WHERE ${AUTHOR_MATCH} AND t.row_signature IS NOT NULL
                  AND (${SPECS[table].inCase}) AND t.version = @version`
            )
            .all({ case_id: caseId, author, version }) as Record<string, unknown>[]
        ).map((r) => toStoredRow(table, r))
      )
    )
  }
  return byTable
}

// The same rows flattened, oldest version first.
export function rowsOfAuthorSince(
  caseId: string,
  author: string | null,
  sinceVersion: number,
  limit = ROWS_PAGE_LIMIT
): StoredRow[] {
  return [...rowsOfAuthorByTable(caseId, author, sinceVersion, limit).values()]
    .flatMap((offer) => offer.rows)
    .sort((a, b) => a.version - b.version)
}

export interface ApplyOutcome {
  applied: number
  // Rows at or below the version already stored for them.
  skipped: number
}

// A row of another author, checked by the caller: its signature verified
// under a roster member's key and its fields are exactly the table's columns.
export interface RemoteRow extends StoredRow {
  author: string
  signature: string
}

function conflictTarget(table: SyncedTable): string {
  const { key } = SPECS[table]
  // The id-keyed tables conflict on the id alone; the rest on the per-author
  // unique index.
  return key.length === 1 && key[0] === 'id'
    ? 'id'
    : `${key.join(', ')}, COALESCE(author_installation_id, '')`
}

// Applies every row a session received, every author's and every page's, in
// one transaction with foreign keys deferred to its commit (the design's
// "Working-layer rows" rule, ruling of 2026-10-15): a row may arrive before
// the tag or note it references, from a later page or another author, and
// those keys are checked once, at commit. A row's Capture or Exhibit has no
// key since v41 (#1877) and is checked here as each row lands: it must be
// held, or recorded as deleted from a Shared Case, and otherwise the batch
// throws as the deferred key did. Captures and Exhibits arrive only in the
// evidence step, which commits before any row is asked for, so checking at
// once is checking at commit. The rows are sorted by version across every
// author, those at one version keeping the order they arrived in, and each
// lands only above the version already stored for it. A row keyed by id that
// another author already holds is refused, so a peer cannot overwrite this
// installation's note by sending one with its id. A batch whose references
// are not satisfied at commit throws, and nothing of it lands; the next
// session asks from the same cursors.
export function applyRows(rows: RemoteRow[]): ApplyOutcome {
  return withTransaction(() => {
    getDb().pragma('defer_foreign_keys = ON')
    let applied = 0
    let skipped = 0
    for (const row of [...rows].sort((a, b) => a.version - b.version)) {
      const { table, author } = row
      const key: RowKey = {}
      for (const column of SPECS[table].key) key[column] = String(row.fields[column])
      const existing = readRow(table, key, author)
      if (existing && existing.version >= row.version) {
        skipped += 1
        continue
      }
      if (!existing && conflictTarget(table) === 'id') {
        const holder = getDb()
          .prepare(`SELECT author_installation_id FROM ${table} WHERE id = ?`)
          .get(key.id) as { author_installation_id: string | null } | undefined
        if (holder) {
          throw new Error(
            `${table} row ${key.id} of ${author} collides with a row of ${holder.author_installation_id ?? 'this installation'}`
          )
        }
      }
      const reference = referenceOf(table, row.fields)
      if (reference?.state === 'missing') {
        throw referenceError(
          `${table} row of ${author} at version ${row.version} names ${reference.noun} ` +
            `${reference.id}, which this copy neither holds nor records as deleted`
        )
      }
      const columns = [...SPECS[table].columns]
      const names = [...columns, 'author_installation_id', 'version', 'deleted_at', 'row_signature']
      const updates = names.map((name) => `${name} = excluded.${name}`).join(', ')
      getDb()
        .prepare(
          `INSERT INTO ${table} (${names.join(', ')})
             VALUES (${names.map((name) => `@${name}`).join(', ')})
           ON CONFLICT (${conflictTarget(table)}) DO UPDATE SET ${updates}`
        )
        .run({
          ...row.fields,
          author_installation_id: author,
          version: row.version,
          deleted_at: row.deletedAt,
          row_signature: row.signature
        })
      if (table === 'notes') {
        // The references index is derived from body_doc on every note write
        // (noteReferenceRepo); a received note is one.
        rewriteReferencesForNote(key.id, row.deletedAt === null ? mentionsOf(row.fields) : [])
      }
      applied += 1
    }
    return { applied, skipped }
  })
}

// The Mentions a received note's document carries, or none when the document
// does not parse: a document another installation wrote is not re-validated
// here, and an unreadable one simply indexes nothing.
function mentionsOf(fields: RowFields): NoteMention[] {
  const bodyDoc = fields.body_doc
  if (typeof bodyDoc !== 'string') return []
  try {
    return extractNoteMentions(bodyDoc)
  } catch {
    return []
  }
}
