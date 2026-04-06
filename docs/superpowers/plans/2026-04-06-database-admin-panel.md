# Database Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app database admin panel as a new "Database" tab in Settings, providing stats, full CRUD table browsing, and maintenance utilities (vacuum, FTS rebuild, orphan cleanup, backup/restore, table export).

**Architecture:** New `dbAdmin.ts` main-process service exposes all DB admin operations. New IPC channels under `db:*` domain wire the service to the renderer through the existing preload bridge pattern. A `DatabaseAdmin.tsx` component with three sub-tabs (Stats, Tables, Utilities) renders inside the existing `SettingsView` sidebar.

**Tech Stack:** Electron IPC, better-sqlite3, React 19, Tailwind v4, lucide-react, vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/main/services/dbAdmin.ts` | Create | All DB admin logic: stats, generic CRUD, vacuum, FTS rebuild, orphan scan/clean, backup, restore, table export |
| `src/shared/ipc.ts` | Modify | Add `db:*` IPC channel constants and payload types (`DbStats`, `OrphanReport`, `DbTableRowsParams`, etc.) |
| `src/main/ipcHandlers.ts` | Modify | Register `db:*` handlers delegating to `dbAdmin.ts` |
| `src/preload/index.ts` | Modify | Expose `window.birdbrain.db.*` methods |
| `src/renderer/env.d.ts` | Modify | Add `db` namespace to `BirdbrainAPI` type |
| `src/renderer/components/settings/SettingsView.tsx` | Modify | Add "Database" tab entry |
| `src/renderer/components/settings/DatabaseAdmin.tsx` | Create | Container with sub-tab navigation |
| `src/renderer/components/settings/db/DbStats.tsx` | Create | Stats dashboard |
| `src/renderer/components/settings/db/DbTables.tsx` | Create | Paginated table browser with inline edit/delete |
| `src/renderer/components/settings/db/DbUtilities.tsx` | Create | Maintenance utility cards |
| `src/renderer/components/settings/db/RowEditModal.tsx` | Create | Modal for creating/editing rows |
| `src/renderer/components/settings/db/ConfirmDialog.tsx` | Create | Reusable confirmation dialog |
| `tests/main/services/dbAdmin.test.ts` | Create | Unit tests for dbAdmin service |

---

### Task 1: IPC Channel Definitions and Shared Types

**Files:**
- Modify: `src/shared/ipc.ts`

- [ ] **Step 1: Add DB admin types to `src/shared/ipc.ts`**

Add these types after the existing `BulkCreateSelectorsParams` interface (around line 149):

```typescript
// --- Database Admin ---

export interface DbStats {
  schemaVersion: number
  dbFileSize: number
  walFileSize: number
  tables: Array<{ name: string; rowCount: number }>
}

export interface DbTableRowsParams {
  table: string
  offset: number
  limit: number
}

export interface DbTableRowsResult {
  rows: Record<string, unknown>[]
  total: number
  columns: Array<{ name: string; type: string; pk: boolean }>
}

export interface DbRowIdentifier {
  table: string
  pk: Record<string, string>
}

export interface DbCreateRowParams {
  table: string
  data: Record<string, unknown>
}

export interface DbUpdateRowParams {
  table: string
  pk: Record<string, string>
  data: Record<string, unknown>
}

export interface DbExportTableParams {
  table: string
  format: 'csv' | 'json'
}

export interface OrphanReport {
  dbOrphans: Array<{
    table: string
    id: string
    caseId: string
    missingPaths: string[]
  }>
  fileOrphans: string[]
}
```

- [ ] **Step 2: Add IPC channel constants**

Add to the `IPC_CHANNELS` object (before the closing `} as const`):

```typescript
  // Database Admin
  DB_STATS: 'db:stats',
  DB_TABLE_ROWS: 'db:tableRows',
  DB_CREATE_ROW: 'db:createRow',
  DB_UPDATE_ROW: 'db:updateRow',
  DB_DELETE_ROW: 'db:deleteRow',
  DB_VACUUM: 'db:vacuum',
  DB_REBUILD_FTS: 'db:rebuildFts',
  DB_PURGE_ARCHIVED: 'db:purgeArchived',
  DB_FIND_ORPHANS: 'db:findOrphans',
  DB_CLEAN_ORPHANS: 'db:cleanOrphans',
  DB_BACKUP: 'db:backup',
  DB_RESTORE: 'db:restore',
  DB_EXPORT_TABLE: 'db:exportTable',
```

- [ ] **Step 3: Commit**

```
feat(db-admin): add IPC channel definitions and shared types
```

---

### Task 2: dbAdmin Service — Stats, CRUD, Table Info

**Files:**
- Create: `src/main/services/dbAdmin.ts`
- Test: `tests/main/services/dbAdmin.test.ts`

- [ ] **Step 1: Write failing tests for stats and table info**

Create `tests/main/services/dbAdmin.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, createCase, getDb } from '@main/services/database'
import { getDbStats, getTableRows, getTableColumns, ALLOWED_TABLES } from '@main/services/dbAdmin'

describe('dbAdmin', () => {
  beforeEach(() => {
    initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
  })

  describe('getDbStats', () => {
    it('returns schema version and table row counts', () => {
      createCase({ name: 'Test' })
      const stats = getDbStats(':memory:')
      expect(stats.schemaVersion).toBeGreaterThanOrEqual(12)
      expect(stats.tables.length).toBeGreaterThan(0)
      const casesTable = stats.tables.find((t) => t.name === 'cases')
      expect(casesTable).toBeDefined()
      expect(casesTable!.rowCount).toBe(1)
    })
  })

  describe('getTableColumns', () => {
    it('returns column info for a valid table', () => {
      const cols = getTableColumns('cases')
      expect(cols.length).toBeGreaterThan(0)
      const idCol = cols.find((c) => c.name === 'id')
      expect(idCol).toBeDefined()
      expect(idCol!.pk).toBe(true)
    })

    it('throws for an invalid table name', () => {
      expect(() => getTableColumns('evil_table')).toThrow('not allowed')
    })
  })

  describe('getTableRows', () => {
    it('returns paginated rows', () => {
      createCase({ name: 'A' })
      createCase({ name: 'B' })
      createCase({ name: 'C' })
      const result = getTableRows({ table: 'cases', offset: 0, limit: 2 })
      expect(result.rows).toHaveLength(2)
      expect(result.total).toBe(3)
      expect(result.columns.length).toBeGreaterThan(0)
    })

    it('respects offset', () => {
      createCase({ name: 'A' })
      createCase({ name: 'B' })
      createCase({ name: 'C' })
      const result = getTableRows({ table: 'cases', offset: 2, limit: 10 })
      expect(result.rows).toHaveLength(1)
      expect(result.total).toBe(3)
    })

    it('throws for an invalid table name', () => {
      expect(() => getTableRows({ table: 'nope', offset: 0, limit: 10 })).toThrow('not allowed')
    })
  })

  describe('ALLOWED_TABLES', () => {
    it('includes all expected tables', () => {
      expect(ALLOWED_TABLES).toContain('cases')
      expect(ALLOWED_TABLES).toContain('captures')
      expect(ALLOWED_TABLES).toContain('tags')
      expect(ALLOWED_TABLES).toContain('notes')
      expect(ALLOWED_TABLES).toContain('captures_fts')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/main/services/dbAdmin.test.ts`
Expected: FAIL — module `@main/services/dbAdmin` not found

- [ ] **Step 3: Implement the service**

Create `src/main/services/dbAdmin.ts`:

```typescript
import { getDb } from '@main/services/database'
import { statSync } from 'fs'
import type {
  DbStats,
  DbTableRowsParams,
  DbTableRowsResult
} from '@shared/ipc'

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/dbAdmin.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
feat(db-admin): add dbAdmin service with stats, CRUD, and table info
```

---

### Task 3: dbAdmin Service — CRUD Tests

**Files:**
- Modify: `tests/main/services/dbAdmin.test.ts`

- [ ] **Step 1: Write tests for createRow, updateRow, deleteRow**

Append to the test file inside the outer `describe('dbAdmin', ...)` block. Also update the imports at the top:

```typescript
import {
  getDbStats,
  getTableRows,
  getTableColumns,
  ALLOWED_TABLES,
  createRow,
  updateRow,
  deleteRow
} from '@main/services/dbAdmin'
```

New test blocks:

```typescript
  describe('createRow', () => {
    it('inserts a row and returns it', () => {
      const row = createRow('tags', { id: 'tag-1', name: 'Evidence', color: '#ff0000' })
      expect(row).toMatchObject({ id: 'tag-1', name: 'Evidence', color: '#ff0000' })
    })

    it('throws for FTS tables', () => {
      expect(() => createRow('captures_fts', { title: 'x' })).toThrow('FTS virtual tables')
    })

    it('throws for invalid column names', () => {
      expect(() => createRow('tags', { id: 'x', name: 'x', evil: 'yes' })).toThrow(
        'does not exist'
      )
    })
  })

  describe('updateRow', () => {
    it('updates a row by primary key', () => {
      createRow('tags', { id: 'tag-1', name: 'Old', color: '#000' })
      const result = updateRow('tags', { id: 'tag-1' }, { name: 'New' })
      expect(result).toBe(true)
      const rows = getTableRows({ table: 'tags', offset: 0, limit: 10 })
      expect(rows.rows[0]).toMatchObject({ name: 'New' })
    })

    it('returns false for non-existent row', () => {
      const result = updateRow('tags', { id: 'nope' }, { name: 'x' })
      expect(result).toBe(false)
    })
  })

  describe('deleteRow', () => {
    it('deletes a row by primary key', () => {
      createRow('tags', { id: 'tag-1', name: 'Test' })
      const result = deleteRow('tags', { id: 'tag-1' })
      expect(result).toBe(true)
      const rows = getTableRows({ table: 'tags', offset: 0, limit: 10 })
      expect(rows.rows).toHaveLength(0)
    })

    it('returns false for non-existent row', () => {
      const result = deleteRow('tags', { id: 'nope' })
      expect(result).toBe(false)
    })

    it('throws for FTS tables', () => {
      expect(() => deleteRow('captures_fts', { rowid: '1' })).toThrow('FTS virtual tables')
    })
  })
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/dbAdmin.test.ts`
Expected: All tests PASS (implementation already done in Task 2)

- [ ] **Step 3: Commit**

```
test(db-admin): add CRUD unit tests for dbAdmin service
```

---

### Task 4: dbAdmin Service — Utilities (Vacuum, FTS Rebuild, Purge Archived)

**Files:**
- Modify: `src/main/services/dbAdmin.ts`
- Modify: `tests/main/services/dbAdmin.test.ts`

- [ ] **Step 1: Write failing tests for vacuum, rebuildFts, purgeArchived**

Update imports in the test file:

```typescript
import {
  getDbStats,
  getTableRows,
  getTableColumns,
  ALLOWED_TABLES,
  createRow,
  updateRow,
  deleteRow,
  vacuumDb,
  rebuildFts,
  purgeArchived
} from '@main/services/dbAdmin'
```

Append test blocks:

```typescript
  describe('vacuum', () => {
    it('runs without error and returns a result', () => {
      const result = vacuumDb(':memory:')
      expect(result).toHaveProperty('freedBytes')
      expect(typeof result.freedBytes).toBe('number')
    })
  })

  describe('rebuildFts', () => {
    it('rebuilds FTS indexes and returns row count', () => {
      const c = createCase({ name: 'Test' })
      const { insertCapture } = require('@main/services/database')
      insertCapture({
        caseId: c.id,
        url: 'https://example.com',
        title: 'Example',
        hash: 'abc123',
        timestamp: new Date().toISOString(),
        textContent: 'hello world'
      })
      const result = rebuildFts()
      expect(result.rowsIndexed).toBeGreaterThanOrEqual(1)
    })
  })

  describe('purgeArchived', () => {
    it('deletes archived cases and returns counts', () => {
      const active = createCase({ name: 'Active' })
      const archived = createCase({ name: 'Archived' })
      const { updateCase, listCases } = require('@main/services/database')
      updateCase({ id: archived.id, archived: true })

      const result = purgeArchived()
      expect(result.casesDeleted).toBe(1)
      const remaining = listCases()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(active.id)
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/main/services/dbAdmin.test.ts`
Expected: FAIL — `vacuumDb`, `rebuildFts`, `purgeArchived` not exported

- [ ] **Step 3: Implement vacuum, rebuildFts, and purgeArchived**

Append to `src/main/services/dbAdmin.ts`:

```typescript
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
  let rowsIndexed = 0

  // Rebuild captures_fts
  db.exec('DELETE FROM captures_fts')
  const captures = db
    .prepare('SELECT rowid, title, url FROM captures')
    .all() as Array<{ rowid: number; title: string; url: string }>
  const insertCaptureFts = db.prepare(
    'INSERT INTO captures_fts (rowid, title, url, content) VALUES (?, ?, ?, ?)'
  )
  for (const row of captures) {
    insertCaptureFts.run(row.rowid, row.title ?? '', row.url, '')
    rowsIndexed++
  }

  // Rebuild notes_fts
  db.exec('DELETE FROM notes_fts')
  const notes = db
    .prepare('SELECT rowid, title, body FROM notes')
    .all() as Array<{ rowid: number; title: string; body: string }>
  const insertNoteFts = db.prepare(
    'INSERT INTO notes_fts (rowid, title, body) VALUES (?, ?, ?)'
  )
  for (const row of notes) {
    insertNoteFts.run(row.rowid, row.title ?? '', row.body ?? '')
    rowsIndexed++
  }

  return { rowsIndexed }
}

export function purgeArchived(): { casesDeleted: number; capturesDeleted: number } {
  const db = getDb()

  // Count captures in archived cases before deletion
  const captureCountRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM captures
       WHERE case_id IN (SELECT id FROM cases WHERE archived = 1)`
    )
    .get() as { count: number }
  const capturesDeleted = captureCountRow.count

  // Clean up FTS entries for captures in archived cases
  db.prepare(
    `DELETE FROM captures_fts WHERE rowid IN (
      SELECT c.rowid FROM captures c
      JOIN cases cs ON c.case_id = cs.id
      WHERE cs.archived = 1
    )`
  ).run()

  // Delete archived cases (CASCADE handles captures, tags, etc.)
  const result = db.prepare('DELETE FROM cases WHERE archived = 1').run()

  return { casesDeleted: result.changes, capturesDeleted }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/dbAdmin.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
feat(db-admin): add vacuum, FTS rebuild, and purge archived utilities
```

---

### Task 5: dbAdmin Service — Orphan Detection, Backup, Table Export

**Files:**
- Modify: `src/main/services/dbAdmin.ts`
- Modify: `tests/main/services/dbAdmin.test.ts`

- [ ] **Step 1: Write failing tests for findOrphans and exportTableData**

Update imports in the test file:

```typescript
import {
  getDbStats,
  getTableRows,
  getTableColumns,
  ALLOWED_TABLES,
  createRow,
  updateRow,
  deleteRow,
  vacuumDb,
  rebuildFts,
  purgeArchived,
  findOrphans,
  exportTableData
} from '@main/services/dbAdmin'
```

Append test blocks:

```typescript
  describe('findOrphans', () => {
    it('returns empty report when no orphans exist', () => {
      const result = findOrphans(':memory:')
      expect(result.dbOrphans).toHaveLength(0)
      expect(result.fileOrphans).toHaveLength(0)
    })
  })

  describe('exportTableData', () => {
    it('exports table as CSV string', () => {
      createRow('tags', { id: 'tag-1', name: 'Urgent', color: '#ff0000' })
      createRow('tags', { id: 'tag-2', name: 'Review', color: null })
      const csv = exportTableData('tags', 'csv')
      expect(csv).toContain('id,name,color')
      expect(csv).toContain('tag-1')
      expect(csv).toContain('Urgent')
    })

    it('exports table as JSON string', () => {
      createRow('tags', { id: 'tag-1', name: 'Urgent', color: '#ff0000' })
      const json = exportTableData('tags', 'json')
      const parsed = JSON.parse(json)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe('Urgent')
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/main/services/dbAdmin.test.ts`
Expected: FAIL — `findOrphans`, `exportTableData` not exported

- [ ] **Step 3: Implement findOrphans, cleanOrphans, exportTableData, backupDatabase**

Add at the top of `src/main/services/dbAdmin.ts` (merge with existing imports):

```typescript
import { existsSync, readdirSync, unlinkSync, copyFileSync } from 'fs'
import { join } from 'path'
import { getStorageRoot } from '@main/services/storage'
import { buildCsv } from '@main/services/csvEscape'
import type { OrphanReport } from '@shared/ipc'
```

Append to the file:

```typescript
export function findOrphans(dbPath: string): OrphanReport {
  const db = getDb()
  const dbOrphans: OrphanReport['dbOrphans'] = []
  const fileOrphans: string[] = []

  let storageRoot: string
  try {
    storageRoot = getStorageRoot()
  } catch {
    // Storage not initialized (e.g. in tests)
    return { dbOrphans, fileOrphans }
  }

  // Check captures for missing files
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

  // Check disk for files with no DB record
  if (existsSync(storageRoot)) {
    const captureIds = new Set(captures.map((c) => c.id))
    const caseDirs = readdirSync(storageRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    for (const caseDir of caseDirs) {
      const casePath = join(storageRoot, caseDir)
      const files = readdirSync(casePath)
      for (const file of files) {
        // Extract capture ID from filename (e.g. "abc-123.html" -> "abc-123")
        const match = file.match(/^(.+)\.(html|png|txt|mhtml|jpg)$/)
        if (!match) continue
        let captureId = match[1]
        // Strip _thumb suffix for thumbnail files
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

  // Remove DB orphan records
  for (const orphan of report.dbOrphans) {
    const result = db
      .prepare(`DELETE FROM "${orphan.table}" WHERE id = ?`)
      .run(orphan.id)
    dbRecordsRemoved += result.changes
  }

  // Remove orphaned files from disk
  let storageRoot: string
  try {
    storageRoot = getStorageRoot()
  } catch {
    return { dbRecordsRemoved, filesRemoved }
  }

  for (const relPath of report.fileOrphans) {
    const absPath = join(storageRoot, relPath)
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

  // CSV
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
  // Force a WAL checkpoint so the main file is up-to-date
  db.pragma('wal_checkpoint(TRUNCATE)')
  copyFileSync(dbPath, destPath)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/dbAdmin.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
feat(db-admin): add orphan detection, table export, and backup utilities
```

---

### Task 6: IPC Handlers and Preload Bridge

**Files:**
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`

- [ ] **Step 1: Register IPC handlers in `src/main/ipcHandlers.ts`**

Add these imports at the top:

```typescript
import * as dbAdmin from '@main/services/dbAdmin'
import type {
  DbTableRowsParams,
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  OrphanReport
} from '@shared/ipc'
```

Add these handler registrations at the end of `registerIpcHandlers()` (before the closing `}`):

```typescript
  // Database Admin
  ipcMain.handle(IPC_CHANNELS.DB_STATS, () => {
    try {
      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
      const dbPath = join(userDataPath, 'birdbrain.db')
      return ipcResult(dbAdmin.getDbStats(dbPath))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_TABLE_ROWS, (_, params: DbTableRowsParams) => {
    try {
      return ipcResult(dbAdmin.getTableRows(params))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_CREATE_ROW, (_, params: DbCreateRowParams) => {
    try {
      return ipcResult(dbAdmin.createRow(params.table, params.data))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_UPDATE_ROW, (_, params: DbUpdateRowParams) => {
    try {
      return ipcResult(dbAdmin.updateRow(params.table, params.pk, params.data))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_ROW, (_, params: DbRowIdentifier) => {
    try {
      return ipcResult(dbAdmin.deleteRow(params.table, params.pk))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_VACUUM, () => {
    try {
      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
      const dbPath = join(userDataPath, 'birdbrain.db')
      return ipcResult(dbAdmin.vacuumDb(dbPath))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_REBUILD_FTS, () => {
    try {
      return ipcResult(dbAdmin.rebuildFts())
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_PURGE_ARCHIVED, () => {
    try {
      return ipcResult(dbAdmin.purgeArchived())
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_FIND_ORPHANS, () => {
    try {
      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
      const dbPath = join(userDataPath, 'birdbrain.db')
      return ipcResult(dbAdmin.findOrphans(dbPath))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_CLEAN_ORPHANS, (_, report: OrphanReport) => {
    try {
      return ipcResult(dbAdmin.cleanOrphans(report))
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_BACKUP, async () => {
    try {
      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
      const dbPath = join(userDataPath, 'birdbrain.db')
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: 'birdbrain-backup.db',
        filters: [{ name: 'SQLite Database', extensions: ['db'] }]
      })
      if (canceled || !filePath) return ipcResult(null)
      dbAdmin.backupDatabase(dbPath, filePath)
      return ipcResult({ path: filePath })
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_RESTORE, async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'SQLite Database', extensions: ['db'] }],
        properties: ['openFile']
      })
      if (canceled || filePaths.length === 0) return ipcResult({ restored: false })

      const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
      const dbPath = join(userDataPath, 'birdbrain.db')
      const { closeDatabase, initDatabase } = await import('@main/services/database')
      const { copyFileSync } = await import('fs')

      closeDatabase()
      copyFileSync(filePaths[0], dbPath)
      initDatabase(dbPath)

      return ipcResult({ restored: true })
    } catch (err) {
      return ipcError(err)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DB_EXPORT_TABLE, async (_, params: DbExportTableParams) => {
    try {
      const content = dbAdmin.exportTableData(params.table, params.format)
      const ext = params.format === 'csv' ? 'csv' : 'json'
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${params.table}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })
      if (canceled || !filePath) return ipcResult(null)
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, content, 'utf-8')
      return ipcResult({ path: filePath })
    } catch (err) {
      return ipcError(err)
    }
  })
```

- [ ] **Step 2: Add preload bridge methods in `src/preload/index.ts`**

Add these imports at the top:

```typescript
import type {
  DbTableRowsParams,
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  DbStats,
  DbTableRowsResult,
  OrphanReport
} from '@shared/ipc'
```

Add the `db` namespace inside the `birdbrain` object (after the `export` block, before the event listeners):

```typescript
  db: {
    stats: (): Promise<DbStats> =>
      unwrapIpc<DbStats>(ipcRenderer.invoke(IPC_CHANNELS.DB_STATS)),
    tableRows: (params: DbTableRowsParams): Promise<DbTableRowsResult> =>
      unwrapIpc<DbTableRowsResult>(ipcRenderer.invoke(IPC_CHANNELS.DB_TABLE_ROWS, params)),
    createRow: (params: DbCreateRowParams): Promise<Record<string, unknown>> =>
      unwrapIpc<Record<string, unknown>>(ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_ROW, params)),
    updateRow: (params: DbUpdateRowParams): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_ROW, params)),
    deleteRow: (params: DbRowIdentifier): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_ROW, params)),
    vacuum: (): Promise<{ freedBytes: number }> =>
      unwrapIpc<{ freedBytes: number }>(ipcRenderer.invoke(IPC_CHANNELS.DB_VACUUM)),
    rebuildFts: (): Promise<{ rowsIndexed: number }> =>
      unwrapIpc<{ rowsIndexed: number }>(ipcRenderer.invoke(IPC_CHANNELS.DB_REBUILD_FTS)),
    purgeArchived: (): Promise<{ casesDeleted: number; capturesDeleted: number }> =>
      unwrapIpc<{ casesDeleted: number; capturesDeleted: number }>(
        ipcRenderer.invoke(IPC_CHANNELS.DB_PURGE_ARCHIVED)
      ),
    findOrphans: (): Promise<OrphanReport> =>
      unwrapIpc<OrphanReport>(ipcRenderer.invoke(IPC_CHANNELS.DB_FIND_ORPHANS)),
    cleanOrphans: (
      report: OrphanReport
    ): Promise<{ dbRecordsRemoved: number; filesRemoved: number }> =>
      unwrapIpc<{ dbRecordsRemoved: number; filesRemoved: number }>(
        ipcRenderer.invoke(IPC_CHANNELS.DB_CLEAN_ORPHANS, report)
      ),
    backup: (): Promise<{ path: string } | null> =>
      unwrapIpc<{ path: string } | null>(ipcRenderer.invoke(IPC_CHANNELS.DB_BACKUP)),
    restore: (): Promise<{ restored: boolean }> =>
      unwrapIpc<{ restored: boolean }>(ipcRenderer.invoke(IPC_CHANNELS.DB_RESTORE)),
    exportTable: (params: DbExportTableParams): Promise<{ path: string } | null> =>
      unwrapIpc<{ path: string } | null>(
        ipcRenderer.invoke(IPC_CHANNELS.DB_EXPORT_TABLE, params)
      )
  },
```

- [ ] **Step 3: Update `src/renderer/env.d.ts` with the `db` namespace**

Add these imports at the top of the file (merge with existing `@shared/ipc` imports):

```typescript
import type {
  DbStats,
  DbTableRowsParams,
  DbTableRowsResult,
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  OrphanReport
} from '@shared/ipc'
```

Add inside the `BirdbrainAPI` interface (after the `export` block):

```typescript
  db: {
    stats(): Promise<DbStats>
    tableRows(params: DbTableRowsParams): Promise<DbTableRowsResult>
    createRow(params: DbCreateRowParams): Promise<Record<string, unknown>>
    updateRow(params: DbUpdateRowParams): Promise<boolean>
    deleteRow(params: DbRowIdentifier): Promise<boolean>
    vacuum(): Promise<{ freedBytes: number }>
    rebuildFts(): Promise<{ rowsIndexed: number }>
    purgeArchived(): Promise<{ casesDeleted: number; capturesDeleted: number }>
    findOrphans(): Promise<OrphanReport>
    cleanOrphans(
      report: OrphanReport
    ): Promise<{ dbRecordsRemoved: number; filesRemoved: number }>
    backup(): Promise<{ path: string } | null>
    restore(): Promise<{ restored: boolean }>
    exportTable(params: DbExportTableParams): Promise<{ path: string } | null>
  }
```

- [ ] **Step 4: Commit**

```
feat(db-admin): register IPC handlers and preload bridge for db admin
```

---

### Task 7: ConfirmDialog Component

**Files:**
- Create: `src/renderer/components/settings/db/ConfirmDialog.tsx`

- [ ] **Step 1: Create the ConfirmDialog component**

Create `src/renderer/components/settings/db/ConfirmDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl border border-border bg-canvas p-6 shadow-xl">
        <h3 className="mb-2 text-lg font-semibold text-text-primary">{title}</h3>
        <p className="mb-6 text-sm text-text-muted whitespace-pre-line">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:bg-elevated"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```
feat(db-admin): add ConfirmDialog component
```

---

### Task 8: RowEditModal Component

**Files:**
- Create: `src/renderer/components/settings/db/RowEditModal.tsx`

- [ ] **Step 1: Create the RowEditModal component**

Create `src/renderer/components/settings/db/RowEditModal.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { v4 as uuid } from 'uuid'
import { X } from 'lucide-react'

interface ColumnInfo {
  name: string
  type: string
  pk: boolean
}

interface RowEditModalProps {
  open: boolean
  mode: 'create' | 'edit'
  table: string
  columns: ColumnInfo[]
  initialData?: Record<string, unknown>
  onSave: (data: Record<string, unknown>) => void
  onClose: () => void
}

export function RowEditModal({
  open,
  mode,
  table,
  columns,
  initialData,
  onSave,
  onClose
}: RowEditModalProps) {
  const [formData, setFormData] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    const data: Record<string, string> = {}
    for (const col of columns) {
      if (mode === 'edit' && initialData) {
        data[col.name] = initialData[col.name] != null ? String(initialData[col.name]) : ''
      } else if (mode === 'create' && col.pk && col.name === 'id') {
        data[col.name] = uuid()
      } else {
        data[col.name] = ''
      }
    }
    setFormData(data)
  }, [open, mode, columns, initialData])

  if (!open) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed: Record<string, unknown> = {}
    for (const col of columns) {
      const val = formData[col.name]
      if (val === '') {
        parsed[col.name] = null
      } else if (col.type.includes('INT') || col.type === 'REAL') {
        parsed[col.name] = Number(val)
      } else {
        parsed[col.name] = val
      }
    }
    onSave(parsed)
  }

  function inputType(col: ColumnInfo): string {
    if (col.type.includes('INT') || col.type === 'REAL') return 'number'
    return 'text'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-canvas p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">
            {mode === 'create' ? 'Create Row' : 'Edit Row'} &mdash; {table}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {columns.map((col) => (
            <div key={col.name}>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                {col.name}
                {col.pk && (
                  <span className="ml-1 text-[10px] text-accent font-bold">PK</span>
                )}
                <span className="ml-1 text-[10px] text-text-faint">{col.type}</span>
              </label>
              <input
                type={inputType(col)}
                value={formData[col.name] ?? ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, [col.name]: e.target.value }))
                }
                readOnly={mode === 'edit' && col.pk}
                step={col.type === 'REAL' ? 'any' : undefined}
                className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent ${
                  mode === 'edit' && col.pk
                    ? 'bg-elevated text-text-muted cursor-not-allowed'
                    : ''
                }`}
              />
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:bg-elevated"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```
feat(db-admin): add RowEditModal component
```

---

### Task 9: DbStats Sub-Tab Component

**Files:**
- Create: `src/renderer/components/settings/db/DbStats.tsx`

- [ ] **Step 1: Create the DbStats component**

Create `src/renderer/components/settings/db/DbStats.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import type { DbStats as DbStatsType } from '@shared/ipc'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function DbStats() {
  const [stats, setStats] = useState<DbStatsType | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchStats() {
    setLoading(true)
    setError(null)
    try {
      const data = await window.birdbrain.db.stats()
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  if (error) {
    return <div className="rounded-lg bg-red-900/20 p-4 text-sm text-red-400">{error}</div>
  }

  if (!stats) {
    return <div className="text-sm text-text-muted">Loading stats...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Database Statistics</h3>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-elevated disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-elevated p-3">
          <div className="text-[11px] text-text-muted">Schema Version</div>
          <div className="text-lg font-semibold text-text-primary">v{stats.schemaVersion}</div>
        </div>
        <div className="rounded-lg border border-border bg-elevated p-3">
          <div className="text-[11px] text-text-muted">DB File Size</div>
          <div className="text-lg font-semibold text-text-primary">
            {formatBytes(stats.dbFileSize)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-elevated p-3">
          <div className="text-[11px] text-text-muted">WAL Size</div>
          <div className="text-lg font-semibold text-text-primary">
            {formatBytes(stats.walFileSize)}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">Table</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-text-muted">Rows</th>
            </tr>
          </thead>
          <tbody>
            {stats.tables.map((t) => (
              <tr key={t.name} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 font-mono text-xs text-text-primary">{t.name}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-text-muted">
                  {t.rowCount.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```
feat(db-admin): add DbStats sub-tab component
```

---

### Task 10: DbTables Sub-Tab Component

**Files:**
- Create: `src/renderer/components/settings/db/DbTables.tsx`

- [ ] **Step 1: Create the DbTables component**

Create `src/renderer/components/settings/db/DbTables.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { Pencil, Trash2, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import type { DbTableRowsResult } from '@shared/ipc'
import { RowEditModal } from './RowEditModal'
import { ConfirmDialog } from './ConfirmDialog'

const TABLES = [
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

const FTS_TABLES = new Set(['captures_fts', 'notes_fts'])
const PAGE_SIZE = 50

export function DbTables() {
  const [selectedTable, setSelectedTable] = useState<string>('cases')
  const [data, setData] = useState<DbTableRowsResult | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [editModal, setEditModal] = useState<{
    open: boolean
    mode: 'create' | 'edit'
    row?: Record<string, unknown>
  }>({ open: false, mode: 'create' })

  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean
    pk: Record<string, string>
  }>({ open: false, pk: {} })

  const isFts = FTS_TABLES.has(selectedTable)

  async function fetchRows() {
    setLoading(true)
    setError(null)
    try {
      const result = await window.birdbrain.db.tableRows({
        table: selectedTable,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rows')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(0)
  }, [selectedTable])

  useEffect(() => {
    fetchRows()
  }, [selectedTable, page])

  function getPk(row: Record<string, unknown>): Record<string, string> {
    if (!data) return {}
    const pkCols = data.columns.filter((c) => c.pk)
    const pk: Record<string, string> = {}
    for (const col of pkCols) {
      pk[col.name] = String(row[col.name] ?? '')
    }
    return pk
  }

  async function handleSave(rowData: Record<string, unknown>) {
    try {
      if (editModal.mode === 'create') {
        await window.birdbrain.db.createRow({ table: selectedTable, data: rowData })
      } else {
        const pk = getPk(editModal.row!)
        // Only send changed fields (exclude PK columns)
        const changedData: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rowData)) {
          const pkCols = data?.columns.filter((c) => c.pk).map((c) => c.name) ?? []
          if (!pkCols.includes(key)) {
            changedData[key] = value
          }
        }
        await window.birdbrain.db.updateRow({ table: selectedTable, pk, data: changedData })
      }
      setEditModal({ open: false, mode: 'create' })
      fetchRows()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function handleDelete() {
    try {
      await window.birdbrain.db.deleteRow({ table: selectedTable, pk: deleteConfirm.pk })
      setDeleteConfirm({ open: false, pk: {} })
      fetchRows()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-text-muted">Table</label>
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
          >
            {TABLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {data && (
            <span className="text-xs text-text-faint">
              {data.total.toLocaleString()} row{data.total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {!isFts && (
          <button
            onClick={() => setEditModal({ open: true, mode: 'create' })}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
          >
            <Plus size={12} />
            Create
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/20 p-3 text-sm text-red-400">{error}</div>
      )}

      {loading && !data && <div className="text-sm text-text-muted">Loading...</div>}

      {data && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-elevated">
                  {data.columns.map((col) => (
                    <th
                      key={col.name}
                      className="whitespace-nowrap px-3 py-2 text-left font-medium text-text-muted"
                    >
                      {col.name}
                      {col.pk && <span className="ml-1 text-[9px] text-accent">PK</span>}
                    </th>
                  ))}
                  {!isFts && <th className="w-20 px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-b-0 hover:bg-elevated/50"
                  >
                    {data.columns.map((col) => (
                      <td
                        key={col.name}
                        className="max-w-[200px] truncate whitespace-nowrap px-3 py-1.5 font-mono text-text-primary"
                        title={row[col.name] != null ? String(row[col.name]) : ''}
                      >
                        {row[col.name] != null ? (
                          String(row[col.name])
                        ) : (
                          <span className="text-text-faint">null</span>
                        )}
                      </td>
                    ))}
                    {!isFts && (
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditModal({ open: true, mode: 'edit', row })}
                            className="rounded p-1 text-text-muted hover:bg-elevated hover:text-accent"
                            title="Edit"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ open: true, pk: getPk(row) })}
                            className="rounded p-1 text-text-muted hover:bg-elevated hover:text-red-400"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={data.columns.length + (isFts ? 0 : 1)}
                      className="px-3 py-6 text-center text-text-faint"
                    >
                      No rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-text-faint">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-border p-1.5 text-text-muted hover:bg-elevated disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-lg border border-border p-1.5 text-text-muted hover:bg-elevated disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      {data && (
        <RowEditModal
          open={editModal.open}
          mode={editModal.mode}
          table={selectedTable}
          columns={data.columns}
          initialData={editModal.row}
          onSave={handleSave}
          onClose={() => setEditModal({ open: false, mode: 'create' })}
        />
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        title="Delete Row"
        message={`Permanently delete this row from "${selectedTable}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm({ open: false, pk: {} })}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```
feat(db-admin): add DbTables sub-tab with paginated browser and CRUD
```

---

### Task 11: DbUtilities Sub-Tab Component

**Files:**
- Create: `src/renderer/components/settings/db/DbUtilities.tsx`

- [ ] **Step 1: Create the DbUtilities component**

Create `src/renderer/components/settings/db/DbUtilities.tsx`:

```tsx
import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import type { OrphanReport } from '@shared/ipc'

const EXPORT_TABLES = [
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

interface UtilityResult {
  message: string
  type: 'success' | 'error'
}

export function DbUtilities() {
  const [loading, setLoading] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, UtilityResult>>({})
  const [confirm, setConfirm] = useState<{
    open: boolean
    key: string
    title: string
    message: string
    action: () => Promise<void>
  }>({ open: false, key: '', title: '', message: '', action: async () => {} })

  // Orphan state
  const [orphanReport, setOrphanReport] = useState<OrphanReport | null>(null)

  // Export state
  const [exportTable, setExportTable] = useState('cases')
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv')

  function setResult(key: string, result: UtilityResult) {
    setResults((prev) => ({ ...prev, [key]: result }))
  }

  async function handleVacuum() {
    setLoading('vacuum')
    try {
      const result = await window.birdbrain.db.vacuum()
      setResult('vacuum', {
        message: `Vacuum complete. Freed ${formatBytes(result.freedBytes)}.`,
        type: 'success'
      })
    } catch (err) {
      setResult('vacuum', {
        message: err instanceof Error ? err.message : 'Vacuum failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleRebuildFts() {
    setLoading('fts')
    try {
      const result = await window.birdbrain.db.rebuildFts()
      setResult('fts', {
        message: `Rebuilt FTS indexes. ${result.rowsIndexed} rows indexed.`,
        type: 'success'
      })
    } catch (err) {
      setResult('fts', {
        message: err instanceof Error ? err.message : 'FTS rebuild failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handlePurge() {
    setLoading('purge')
    try {
      const result = await window.birdbrain.db.purgeArchived()
      setResult('purge', {
        message: `Purged ${result.casesDeleted} case(s) and ${result.capturesDeleted} capture(s).`,
        type: 'success'
      })
    } catch (err) {
      setResult('purge', {
        message: err instanceof Error ? err.message : 'Purge failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleScanOrphans() {
    setLoading('orphans')
    try {
      const report = await window.birdbrain.db.findOrphans()
      setOrphanReport(report)
      const total = report.dbOrphans.length + report.fileOrphans.length
      setResult('orphans', {
        message:
          total === 0
            ? 'No orphans found.'
            : `Found ${report.dbOrphans.length} DB orphan(s) and ${report.fileOrphans.length} file orphan(s).`,
        type: total === 0 ? 'success' : 'error'
      })
    } catch (err) {
      setResult('orphans', {
        message: err instanceof Error ? err.message : 'Scan failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleCleanOrphans() {
    if (!orphanReport) return
    setLoading('orphans-clean')
    try {
      const result = await window.birdbrain.db.cleanOrphans(orphanReport)
      setOrphanReport(null)
      setResult('orphans', {
        message: `Cleaned ${result.dbRecordsRemoved} DB record(s) and ${result.filesRemoved} file(s).`,
        type: 'success'
      })
    } catch (err) {
      setResult('orphans', {
        message: err instanceof Error ? err.message : 'Clean failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleBackup() {
    setLoading('backup')
    try {
      const result = await window.birdbrain.db.backup()
      if (result) {
        setResult('backup', {
          message: `Backup saved to ${result.path}`,
          type: 'success'
        })
      } else {
        setResult('backup', { message: 'Backup cancelled.', type: 'success' })
      }
    } catch (err) {
      setResult('backup', {
        message: err instanceof Error ? err.message : 'Backup failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleRestore() {
    setLoading('restore')
    try {
      const result = await window.birdbrain.db.restore()
      if (result.restored) {
        setResult('restore', {
          message: 'Database restored. Please restart the app for full effect.',
          type: 'success'
        })
      } else {
        setResult('restore', { message: 'Restore cancelled.', type: 'success' })
      }
    } catch (err) {
      setResult('restore', {
        message: err instanceof Error ? err.message : 'Restore failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleExport() {
    setLoading('export')
    try {
      const result = await window.birdbrain.db.exportTable({
        table: exportTable,
        format: exportFormat
      })
      if (result) {
        setResult('export', {
          message: `Exported to ${result.path}`,
          type: 'success'
        })
      } else {
        setResult('export', { message: 'Export cancelled.', type: 'success' })
      }
    } catch (err) {
      setResult('export', {
        message: err instanceof Error ? err.message : 'Export failed',
        type: 'error'
      })
    } finally {
      setLoading(null)
    }
  }

  function UtilCard({
    id,
    title,
    description,
    children
  }: {
    id: string
    title: string
    description: string
    children: React.ReactNode
  }) {
    const result = results[id]
    return (
      <div className="rounded-lg border border-border p-4">
        <div className="mb-1 text-sm font-semibold text-text-primary">{title}</div>
        <p className="mb-3 text-xs text-text-muted">{description}</p>
        <div className="flex items-center gap-3">{children}</div>
        {result && (
          <div
            className={`mt-2 text-xs ${
              result.type === 'success' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {result.message}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <UtilCard
        id="vacuum"
        title="Vacuum & Optimize"
        description="Reclaim unused space and optimize query performance."
      >
        <button
          onClick={handleVacuum}
          disabled={loading !== null}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-elevated disabled:opacity-50"
        >
          {loading === 'vacuum' ? 'Running...' : 'Run Vacuum'}
        </button>
      </UtilCard>

      <UtilCard
        id="fts"
        title="Rebuild FTS Indexes"
        description="Drop and rebuild full-text search indexes for captures and notes."
      >
        <button
          onClick={handleRebuildFts}
          disabled={loading !== null}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-elevated disabled:opacity-50"
        >
          {loading === 'fts' ? 'Rebuilding...' : 'Rebuild'}
        </button>
      </UtilCard>

      <UtilCard
        id="purge"
        title="Purge Archived Cases"
        description="Permanently delete all archived cases and their captures from the database."
      >
        <button
          onClick={() =>
            setConfirm({
              open: true,
              key: 'purge',
              title: 'Purge Archived Cases',
              message:
                'This will permanently delete ALL archived cases, their captures, tags, selectors, and notes. This cannot be undone.',
              action: handlePurge
            })
          }
          disabled={loading !== null}
          className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50"
        >
          Purge
        </button>
      </UtilCard>

      <UtilCard
        id="orphans"
        title="Find & Clean Orphans"
        description="Scan for DB records with missing files and files with no DB record."
      >
        <button
          onClick={handleScanOrphans}
          disabled={loading !== null}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-elevated disabled:opacity-50"
        >
          {loading === 'orphans' ? 'Scanning...' : 'Scan'}
        </button>
        {orphanReport &&
          (orphanReport.dbOrphans.length > 0 || orphanReport.fileOrphans.length > 0) && (
            <button
              onClick={() =>
                setConfirm({
                  open: true,
                  key: 'orphans-clean',
                  title: 'Clean Orphans',
                  message: `This will remove ${orphanReport.dbOrphans.length} orphaned DB record(s) and ${orphanReport.fileOrphans.length} orphaned file(s). This cannot be undone.`,
                  action: handleCleanOrphans
                })
              }
              disabled={loading !== null}
              className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50"
            >
              {loading === 'orphans-clean' ? 'Cleaning...' : 'Clean'}
            </button>
          )}
      </UtilCard>

      <UtilCard
        id="backup"
        title="Backup Database"
        description="Copy the database file to a location of your choice."
      >
        <button
          onClick={handleBackup}
          disabled={loading !== null}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-elevated disabled:opacity-50"
        >
          {loading === 'backup' ? 'Saving...' : 'Create Backup'}
        </button>
      </UtilCard>

      <UtilCard
        id="restore"
        title="Restore Database"
        description="Replace the current database with a backup file. Requires app restart."
      >
        <button
          onClick={() =>
            setConfirm({
              open: true,
              key: 'restore',
              title: 'Restore Database',
              message:
                'This will replace your current database with the selected backup file. All current data will be lost. The app will need to be restarted.',
              action: handleRestore
            })
          }
          disabled={loading !== null}
          className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50"
        >
          Restore from File
        </button>
      </UtilCard>

      <UtilCard
        id="export"
        title="Export Table"
        description="Export a table's contents to CSV or JSON."
      >
        <select
          value={exportTable}
          onChange={(e) => setExportTable(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none"
        >
          {EXPORT_TABLES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={exportFormat}
          onChange={(e) => setExportFormat(e.target.value as 'csv' | 'json')}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none"
        >
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
        <button
          onClick={handleExport}
          disabled={loading !== null}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-elevated disabled:opacity-50"
        >
          {loading === 'export' ? 'Exporting...' : 'Export'}
        </button>
      </UtilCard>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.key === 'restore' ? 'Restore' : 'Delete'}
        onConfirm={async () => {
          setConfirm((c) => ({ ...c, open: false }))
          await confirm.action()
        }}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```
feat(db-admin): add DbUtilities sub-tab with all maintenance operations
```

---

### Task 12: DatabaseAdmin Container and SettingsView Integration

**Files:**
- Create: `src/renderer/components/settings/DatabaseAdmin.tsx`
- Modify: `src/renderer/components/settings/SettingsView.tsx`

- [ ] **Step 1: Create DatabaseAdmin container**

Create `src/renderer/components/settings/DatabaseAdmin.tsx`:

```tsx
import { useState } from 'react'
import { DbStats } from './db/DbStats'
import { DbTables } from './db/DbTables'
import { DbUtilities } from './db/DbUtilities'

type DbSubTab = 'stats' | 'tables' | 'utilities'

const subTabs: { id: DbSubTab; label: string }[] = [
  { id: 'stats', label: 'Stats' },
  { id: 'tables', label: 'Tables' },
  { id: 'utilities', label: 'Utilities' }
]

export function DatabaseAdmin() {
  const [activeTab, setActiveTab] = useState<DbSubTab>('stats')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {subTabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div>
        {activeTab === 'stats' && <DbStats />}
        {activeTab === 'tables' && <DbTables />}
        {activeTab === 'utilities' && <DbUtilities />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add Database tab to SettingsView**

In `src/renderer/components/settings/SettingsView.tsx`:

Replace the existing lucide-react import line:

```typescript
import { Key, Camera, HardDrive, Palette, Info, UserCircle, Database } from 'lucide-react'
```

Add the import for `DatabaseAdmin`:

```typescript
import { DatabaseAdmin } from './DatabaseAdmin'
```

Update the `SettingsTab` type:

```typescript
type SettingsTab = 'ai' | 'capture' | 'storage' | 'appearance' | 'operator' | 'database' | 'about'
```

Update the `settingsTabs` array (insert database between operator and about):

```typescript
const settingsTabs: { id: SettingsTab; label: string; icon: typeof Key }[] = [
  { id: 'ai', label: 'API Keys', icon: Key },
  { id: 'capture', label: 'Capture', icon: Camera },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'operator', label: 'Operator', icon: UserCircle },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'about', label: 'About', icon: Info }
]
```

Add the case in `renderContent()`:

```typescript
      case 'database':
        return <DatabaseAdmin />
```

- [ ] **Step 3: Run lint to verify no TypeScript errors**

Run: `pnpm lint`
Expected: No errors (warnings OK)

- [ ] **Step 4: Commit**

```
feat(db-admin): wire DatabaseAdmin into Settings with sub-tab navigation
```

---

### Task 13: Smoke Test and Final Verification

- [ ] **Step 1: Run all unit tests**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: Clean or only pre-existing warnings

- [ ] **Step 3: Build the app**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`

1. Navigate to Settings
2. Click "Database" tab in the sidebar — should see sub-tab navigation (Stats | Tables | Utilities)
3. **Stats tab:** verify schema version, file sizes, and table row counts display
4. **Tables tab:** select "cases" from dropdown, verify rows display with edit/delete buttons, try pagination
5. **Tables tab:** select "captures_fts" — verify edit/delete/create buttons are hidden
6. **Utilities tab:** click "Run Vacuum" — verify it completes with a message
7. **Utilities tab:** click "Create Backup" — verify save dialog appears

- [ ] **Step 5: Commit any fixes if needed**

```
fix(db-admin): address smoke test issues
```

(Skip this step if no fixes needed.)
