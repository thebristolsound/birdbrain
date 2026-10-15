import { getDb, withTransaction } from '@main/services/db/core'
import { rewriteReferencesForNote } from '@main/services/db/noteReferenceRepo'
import { extractNoteMentions, type NoteMention } from '@shared/noteDoc'

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
}

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
    inCase: 't.case_id = @case_id'
  },
  tags: {
    key: ['id'],
    columns: ['id', 'name', 'color', 'created_at'],
    caseIds: `SELECT e.case_id FROM exhibit_tags et JOIN exhibits e ON e.id = et.exhibit_id
               WHERE et.tag_id = @id
              UNION
              SELECT n.case_id FROM note_tags nt JOIN notes n ON n.id = nt.note_id
               WHERE nt.tag_id = @id`,
    inCase: `EXISTS (SELECT 1 FROM exhibit_tags et JOIN exhibits e ON e.id = et.exhibit_id
                      WHERE et.tag_id = t.id AND e.case_id = @case_id)
             OR EXISTS (SELECT 1 FROM note_tags nt JOIN notes n ON n.id = nt.note_id
                         WHERE nt.tag_id = t.id AND n.case_id = @case_id)`
  },
  exhibit_tags: {
    key: ['exhibit_id', 'tag_id'],
    columns: ['exhibit_id', 'tag_id'],
    caseIds: 'SELECT case_id FROM exhibits WHERE id = @exhibit_id',
    inCase: 'EXISTS (SELECT 1 FROM exhibits e WHERE e.id = t.exhibit_id AND e.case_id = @case_id)'
  },
  note_tags: {
    key: ['note_id', 'tag_id'],
    columns: ['note_id', 'tag_id'],
    caseIds: 'SELECT case_id FROM notes WHERE id = @note_id',
    inCase: 'EXISTS (SELECT 1 FROM notes n WHERE n.id = t.note_id AND n.case_id = @case_id)'
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
    caseIds: 'SELECT case_id FROM captures WHERE id = @capture_id',
    inCase: 'EXISTS (SELECT 1 FROM captures c WHERE c.id = t.capture_id AND c.case_id = @case_id)'
  },
  annotation_pins: {
    key: ['id'],
    columns: ['id', 'capture_id', 'number', 'body', 'created_at', 'updated_at'],
    caseIds: `SELECT c.case_id FROM annotation_pins p JOIN captures c ON c.id = p.capture_id
               WHERE p.id = @id`,
    inCase: 'EXISTS (SELECT 1 FROM captures c WHERE c.id = t.capture_id AND c.case_id = @case_id)'
  }
}

export function signedColumns(table: SyncedTable): readonly string[] {
  return SPECS[table].columns
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

// The highest version of `author`'s rows this replica holds in a Case, or 0:
// the cursor a `rows` request carries. Read from the rows themselves, so a
// database restore moves it back with them.
export function maxAuthorVersionInCase(caseId: string, author: string): number {
  const union = SYNCED_TABLES.map(
    (table) =>
      `SELECT MAX(t.version) AS v FROM ${table} t
        WHERE t.author_installation_id = @author AND (${SPECS[table].inCase})`
  ).join(' UNION ALL ')
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(v), 0) AS v FROM (${union})`)
    .get({ case_id: caseId, author }) as { v: number }
  return row.v
}

// The tables a `rows` answer offers whatever the peer's cursor says. A tag
// belongs to a Case through its applications, which any member writes at
// any time, so the version the tag's author gave it says nothing about
// whether a peer has seen it in this Case: a tag created at version 1 and
// applied here after a peer's cursor passed 1 would never be offered, and
// every application of it would fail its foreign key on that peer for good.
// Tags are few and the receiver skips the ones it holds at that version.
export const CURSOR_FREE_TABLES: ReadonlySet<string> = new Set<SyncedTable>(['tags'])

// The most rows of one cursor-bound table a page reads. The query stops at
// it, so the work of answering a page is bounded whatever the backlog; the
// page is then cut from what the tables offer (`offerPage`, workingRows.ts).
export const ROWS_PAGE_LIMIT = 500

// What one page of `author`'s rows in a Case may draw on, by table: every
// signed row of a cursor-free table that the Case reaches, and the `limit`
// lowest versions above `sinceVersion` of each other table. `author` NULL is
// this installation's rows.
export function rowsOfAuthorByTable(
  caseId: string,
  author: string | null,
  sinceVersion: number,
  limit = ROWS_PAGE_LIMIT
): Map<SyncedTable, StoredRow[]> {
  const byTable = new Map<SyncedTable, StoredRow[]>()
  for (const table of SYNCED_TABLES) {
    const cursorFree = CURSOR_FREE_TABLES.has(table)
    const raw = getDb()
      .prepare(
        `SELECT t.* FROM ${table} t
          WHERE ${AUTHOR_MATCH} ${cursorFree ? '' : 'AND t.version > @since'}
            AND t.row_signature IS NOT NULL AND (${SPECS[table].inCase})
          ORDER BY t.version ${cursorFree ? '' : 'LIMIT @limit'}`
      )
      .all({ case_id: caseId, author, since: sinceVersion, limit }) as Record<string, unknown>[]
    byTable.set(
      table,
      raw.map((r) => toStoredRow(table, r))
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
    .flat()
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

// Applies one author's rows in one transaction with foreign keys deferred to
// its commit, so a row can arrive before the row it references within the
// same batch. Each row lands only above the version already stored for it. A
// row keyed by id that another author already holds is refused, so a peer
// cannot overwrite this installation's note by sending one with its id. A
// batch whose references are not satisfied at commit throws, and nothing of
// it lands; the next session retries it.
export function applyAuthorRows(rows: RemoteRow[]): ApplyOutcome {
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
