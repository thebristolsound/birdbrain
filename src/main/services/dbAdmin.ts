import { getDb } from '@main/services/database'
import { statSync, existsSync, readdirSync, unlinkSync, copyFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { getStorageRoot } from '@main/services/storage'
import { buildCsv } from '@main/services/csvEscape'
import type { DbStats, DbTableRowsParams, DbTableRowsResult, OrphanReport } from '@shared/ipc'

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
  assertValidColumns(table, pk)
  assertValidColumns(table, data)
  const dataKeys = Object.keys(data)
  if (dataKeys.length === 0) return false

  const db = getDb()
  const setClauses = dataKeys.map((k) => `"${k}" = ?`).join(', ')
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
  assertValidColumns(table, pk)

  const db = getDb()
  const whereClauses = Object.keys(pk)
    .map((k) => `"${k}" = ?`)
    .join(' AND ')
  const values = Object.values(pk)

  const run = db.transaction(() => {
    // Clean up FTS entries before deleting captures or cases (CASCADE)
    if (table === 'captures') {
      db.prepare(
        `DELETE FROM captures_fts WHERE rowid IN (
          SELECT rowid FROM captures WHERE ${whereClauses}
        )`
      ).run(...values)
    } else if (table === 'cases') {
      db.prepare(
        `DELETE FROM captures_fts WHERE rowid IN (
          SELECT rowid FROM captures WHERE case_id IN (
            SELECT id FROM cases WHERE ${whereClauses}
          )
        )`
      ).run(...values)
    }

    return db.prepare(`DELETE FROM "${table}" WHERE ${whereClauses}`).run(...values)
  })

  const result = run()
  return result.changes > 0
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

export function rebuildFts(): { rowsIndexed: number } {
  const db = getDb()
  db.exec("INSERT INTO captures_fts(captures_fts) VALUES ('rebuild')")
  db.exec("INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')")
  const captureCount = db.prepare('SELECT COUNT(*) as count FROM captures').get() as {
    count: number
  }
  const noteCount = db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number }
  const rowsIndexed = captureCount.count + noteCount.count

  return { rowsIndexed }
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

  db.prepare(
    `DELETE FROM captures_fts WHERE rowid IN (
      SELECT c.rowid FROM captures c
      JOIN cases cs ON c.case_id = cs.id
      WHERE cs.archived = 1
    )`
  ).run()

  const result = db.prepare('DELETE FROM cases WHERE archived = 1').run()

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
    .prepare('SELECT id, case_id, html_path, screenshot_path, mhtml_path FROM captures')
    .all() as Array<{
    id: string
    case_id: string
    html_path: string | null
    screenshot_path: string | null
    mhtml_path: string | null
  }>

  for (const cap of captures) {
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
    const caseDirs = readdirSync(storageRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    for (const caseDir of caseDirs) {
      const casePath = join(storageRoot, caseDir)
      const files = readdirSync(casePath)
      for (const file of files) {
        const match = file.match(/^(.+)\.(html|png|txt|mhtml|jpg)$/)
        if (!match) continue
        let captureId = match[1]
        captureId = captureId.replace(/_thumb$/, '')
        if (!captureIds.has(captureId)) {
          fileOrphans.push(join(caseDir, file))
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

  for (const orphan of report.dbOrphans) {
    if (!allowedOrphanTables.has(orphan.table)) {
      continue
    }
    const run = db.transaction(() => {
      // Clean up FTS entries before deleting the capture row
      if (orphan.table === 'captures') {
        db.prepare(
          'DELETE FROM captures_fts WHERE rowid IN (SELECT rowid FROM captures WHERE id = ?)'
        ).run(orphan.id)
      }
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
    const absPath = resolve(join(storageRoot, relPath))
    if (!absPath.startsWith(resolvedRoot)) continue
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
