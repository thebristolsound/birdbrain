import { randomUUID } from 'crypto'
import { getDb, type ImportCtx } from '@main/services/db/core'

// The plain storage layer under the investigation records (ADR-0042; engine
// plan E5): an insert and a list for the app and its tests, and the collect and
// import pair a Case Archive uses. No rule lives here. Which row is a head, and
// the few edits an author may make to their own row (E2), belong to the
// services built on top (CI-D1, CI-D2), and the run status writes to CI-R.

export interface TableSpec {
  table: string
  columns: readonly string[]
  // Columns that hold another record's id, which an import remaps with the row
  // ids. `replaces`, a JSON list of ids, is remapped id by id as well.
  references: readonly string[]
  // A row's Case: its own `case_id`, or that of the run it belongs to.
  scope: 'case' | 'run'
  // The ten tables that sync in a Shared Case (E2). An imported row with no
  // author is stamped with the archive's source installation (ruling 62).
  synced: boolean
}

// The four columns migration 36 gave the working-layer tables, in that order.
export const SYNC_COLUMNS = ['author_installation_id', 'version', 'deleted_at', 'row_signature']

// Those columns on a stored row. A null author is this installation.
export interface SyncColumns {
  authorInstallationId: string | null
  version: number
  deletedAt: string | null
  rowSignature: string | null
}

// An insert names the columns it sets; the rest take the DDL's defaults. `Required`
// lists the NOT NULL columns with no default.
export type Insert<Row, Required extends keyof Row> = Pick<Row, Required> &
  Partial<Omit<Row, Required>>

export interface RowStore<Row> {
  insert: (fields: object) => Row
  // By Case, or by run for the run child tables, in insertion order.
  list: (scopeId: string) => Row[]
  collect: (caseId: string) => Record<string, unknown>[]
  importRows: (
    rows: Record<string, unknown>[],
    ctx: ImportCtx,
    sourceInstallationId: string
  ) => void
}

const toColumn = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toKey = (column: string): string =>
  column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

function idList(value: unknown, table: string): string[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : (value ?? [])
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new Error(`${table}.replaces is not a list of ids`)
  }
  return parsed as string[]
}

function scopeWhere(spec: TableSpec): string {
  return spec.scope === 'case'
    ? 'case_id = ?'
    : 'run_id IN (SELECT id FROM investigation_runs WHERE case_id = ?)'
}

export function rowStore<Row>(spec: TableSpec): RowStore<Row> {
  const { table, columns } = spec
  const fromDb = (raw: Record<string, unknown>): Row => {
    const row: Record<string, unknown> = {}
    for (const column of columns) {
      row[toKey(column)] = column === 'replaces' ? idList(raw[column], table) : raw[column]
    }
    return row as Row
  }

  return {
    insert(fields) {
      const row: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue
        const column = toColumn(key)
        if (!columns.includes(column)) throw new Error(`${table} has no column ${column}`)
        row[column] = column === 'replaces' ? JSON.stringify(idList(value, table)) : value
      }
      if (columns.includes('id') && row.id === undefined) row.id = randomUUID()
      const names = Object.keys(row)
      const { lastInsertRowid } = getDb()
        .prepare(
          `INSERT INTO ${table} (${names.join(', ')})
           VALUES (${names.map((name) => `@${name}`).join(', ')})`
        )
        .run(row)
      return fromDb(
        getDb().prepare(`SELECT * FROM ${table} WHERE rowid = ?`).get(lastInsertRowid) as Record<
          string,
          unknown
        >
      )
    },

    list(scopeId) {
      const column = spec.scope === 'case' ? 'case_id' : 'run_id'
      const rows = getDb()
        .prepare(`SELECT * FROM ${table} WHERE ${column} = ? ORDER BY rowid`)
        .all(scopeId) as Record<string, unknown>[]
      return rows.map(fromDb)
    },

    // Raw rows, as every archive collector returns them. `persona_id` names a
    // Persona, which is installation-wide and travels in no archive (E5).
    collect(caseId) {
      const rows = getDb()
        .prepare(`SELECT * FROM ${table} WHERE ${scopeWhere(spec)} ORDER BY rowid`)
        .all(caseId) as Record<string, unknown>[]
      return columns.includes('persona_id')
        ? rows.map((row) => ({ ...row, persona_id: null }))
        : rows
    },

    importRows(rows, ctx, sourceInstallationId) {
      if (rows.length === 0) return
      const insert = getDb().prepare(
        `INSERT INTO ${table} (${columns.join(', ')})
         VALUES (${columns.map((column) => `@${column}`).join(', ')})`
      )
      const remap = (value: unknown): unknown =>
        typeof value === 'string' ? ctx.mapId(value) : (value ?? null)
      for (const source of rows) {
        const row: Record<string, unknown> = {}
        for (const column of columns) row[column] = source[column] ?? null
        if (columns.includes('id')) row.id = remap(row.id)
        for (const column of spec.references) row[column] = remap(row[column])
        if (spec.scope === 'case') row.case_id = ctx.newCaseId
        if (columns.includes('replaces')) {
          row.replaces = JSON.stringify(idList(source.replaces, table).map(ctx.mapId))
        }
        if (columns.includes('persona_id')) row.persona_id = null
        if (spec.synced) {
          row.author_installation_id = row.author_installation_id ?? sourceInstallationId
          row.version = row.version ?? 0
        }
        insert.run(row)
      }
    }
  }
}
