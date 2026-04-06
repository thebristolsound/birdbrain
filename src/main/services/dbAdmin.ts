import { getDb } from '@main/services/database'
import { statSync } from 'fs'
import type { DbStats, DbTableRowsParams, DbTableRowsResult } from '@shared/ipc'

export const ALLOWED_TABLES = [
  'cases',
  'captures',
  'tags',
  'capture_tags',
  'selectors',
  'selector_matches',
  'capture_favorites',
  'notes',
  'captures_fts',
  'notes_fts'
] as const

type AllowedTable = (typeof ALLOWED_TABLES)[number]

const FTS_TABLES: ReadonlySet<string> = new Set(['captures_fts', 'notes_fts'])

function assertAllowedTable(table: string): asserts table is AllowedTable {
  if (!(ALLOWED_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Table "${table}" is not allowed`)
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
  return rows.map((r) => ({ name: r.name, type: r.type, pk: r.pk > 0 }))
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

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM "${params.table}"`).get() as {
    count: number
  }
  const total = countRow.count

  const rows = db
    .prepare(`SELECT * FROM "${params.table}" LIMIT ? OFFSET ?`)
    .all(params.limit, params.offset) as Record<string, unknown>[]

  return { rows, total, columns }
}

export function createRow(
  table: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  assertAllowedTable(table)
  if (FTS_TABLES.has(table)) throw new Error('Cannot insert into FTS virtual tables directly')
  assertValidColumns(table, data)

  const db = getDb()
  const keys = Object.keys(data)
  const placeholders = keys.map(() => '?').join(', ')
  const values = keys.map((k) => data[k])

  db.prepare(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${placeholders})`
  ).run(...values)

  // Return the inserted row by looking up the last rowid
  const lastRow = db.prepare(`SELECT * FROM "${table}" WHERE rowid = last_insert_rowid()`).get()
  return (lastRow as Record<string, unknown>) ?? data
}

export function updateRow(
  table: string,
  pk: Record<string, string>,
  data: Record<string, unknown>
): boolean {
  assertAllowedTable(table)
  if (FTS_TABLES.has(table)) throw new Error('Cannot update FTS virtual tables directly')
  assertValidColumns(table, data)

  const db = getDb()
  const setClauses = Object.keys(data)
    .map((k) => `"${k}" = ?`)
    .join(', ')
  const whereClauses = Object.keys(pk)
    .map((k) => `"${k}" = ?`)
    .join(' AND ')
  const values = [...Object.values(data), ...Object.values(pk)]

  const result = db
    .prepare(`UPDATE "${table}" SET ${setClauses} WHERE ${whereClauses}`)
    .run(...values)
  return result.changes > 0
}

export function deleteRow(table: string, pk: Record<string, string>): boolean {
  assertAllowedTable(table)
  if (FTS_TABLES.has(table)) throw new Error('Cannot delete from FTS virtual tables directly')

  const db = getDb()
  const whereClauses = Object.keys(pk)
    .map((k) => `"${k}" = ?`)
    .join(' AND ')
  const values = Object.values(pk)

  const result = db.prepare(`DELETE FROM "${table}" WHERE ${whereClauses}`).run(...values)
  return result.changes > 0
}
