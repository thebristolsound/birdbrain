# Database Admin Panel

**Date:** 2026-04-06
**Status:** Approved

## Overview

An in-app database administration panel, added as a new "Database" tab in the existing Settings view. Provides full CRUD for all tables, a stats dashboard, and maintenance utilities — no raw SQL, no separate window.

## Approach

**Tab-based panel under Settings (Approach B).** A `DatabaseAdmin` component renders three internal sub-tabs (Stats, Tables, Utilities) inside the Settings sidebar. This follows the existing pattern where each Settings tab is its own focused component.

## Architecture

### New files

| File | Purpose |
|---|---|
| `src/main/services/dbAdmin.ts` | Main-process service: stats, CRUD, vacuum, FTS rebuild, orphan scan, backup/restore, table export |
| `src/renderer/components/settings/DatabaseAdmin.tsx` | Container with sub-tab navigation (Stats, Tables, Utilities) |
| `src/renderer/components/settings/db/DbStats.tsx` | Stats dashboard sub-tab |
| `src/renderer/components/settings/db/DbTables.tsx` | Table browser sub-tab with paginated rows |
| `src/renderer/components/settings/db/DbUtilities.tsx` | Maintenance utilities sub-tab |
| `src/renderer/components/settings/db/RowEditModal.tsx` | Modal for editing or creating a row |
| `src/renderer/components/settings/db/ConfirmDialog.tsx` | Reusable confirmation dialog for destructive operations |

### Modified files

| File | Change |
|---|---|
| `src/shared/ipc.ts` | Add `db:*` IPC channel constants and payload types |
| `src/main/ipcHandlers.ts` | Register `db:*` handlers delegating to `dbAdmin.ts` |
| `src/preload/index.ts` | Expose `window.birdbrain.db.*` methods |
| `src/renderer/components/settings/SettingsView.tsx` | Add "Database" tab to sidebar (between Operator and About) |

## IPC Channels

All new channels live under the `db:` domain prefix.

### Read operations

| Channel | Params | Returns | Description |
|---|---|---|---|
| `db:stats` | none | `DbStats` | File size, WAL size, schema version, per-table row counts |
| `db:tableRows` | `{ table: string, offset: number, limit: number }` | `{ rows: Record<string, unknown>[], total: number }` | Paginated rows for a table |
| `db:findOrphans` | none | `OrphanReport` | Scan for orphaned DB records and orphaned disk files |

### Write operations

| Channel | Params | Returns | Description |
|---|---|---|---|
| `db:createRow` | `{ table: string, data: Record<string, unknown> }` | `Record<string, unknown>` | Insert a row |
| `db:updateRow` | `{ table: string, pk: Record<string, string>, data: Record<string, unknown> }` | `boolean` | Update columns by primary key |
| `db:deleteRow` | `{ table: string, pk: Record<string, string> }` | `boolean` | Delete by primary key |

### Utility operations

| Channel | Params | Returns | Description |
|---|---|---|---|
| `db:vacuum` | none | `{ freedBytes: number }` | VACUUM + PRAGMA optimize |
| `db:rebuildFts` | none | `{ rowsIndexed: number }` | Drop and rebuild captures_fts + notes_fts |
| `db:purgeArchived` | none | `{ casesDeleted: number, capturesDeleted: number }` | Delete all archived cases + capture files |
| `db:cleanOrphans` | `OrphanReport` | `{ dbRecordsRemoved: number, filesRemoved: number }` | Delete orphans identified by findOrphans |
| `db:backup` | none | `{ path: string } \| null` | Copy DB + WAL/SHM to user-chosen path (save dialog) |
| `db:restore` | none | `{ restored: boolean }` | Replace DB from user-chosen file (open dialog), prompt restart |
| `db:exportTable` | `{ table: string, format: 'csv' \| 'json' }` | `{ path: string } \| null` | Dump table to file (save dialog) |

### Security: table name allowlist

All channels that accept a `table` parameter validate against a hardcoded allowlist in `dbAdmin.ts`:

```typescript
const ALLOWED_TABLES = [
  'cases', 'captures', 'tags', 'capture_tags',
  'selectors', 'selector_matches', 'capture_favorites',
  'notes', 'captures_fts', 'notes_fts'
] as const
```

Any request with a table name not in this list is rejected. This prevents SQL injection through the table name parameter.

### Security: column name validation

For `db:createRow` and `db:updateRow`, column names in the `data` object are validated against the actual column names returned by `PRAGMA table_info(table)`. Unknown column names are rejected.

## Types

```typescript
interface DbStats {
  schemaVersion: number
  dbFileSize: number       // bytes
  walFileSize: number      // bytes
  tables: Array<{
    name: string
    rowCount: number
  }>
}

interface OrphanReport {
  dbOrphans: Array<{       // DB records whose files are missing
    table: string
    id: string
    caseId: string
    missingPaths: string[]
  }>
  fileOrphans: string[]    // Paths on disk with no DB record
}
```

## UI Design

### Settings sidebar addition

Add a "Database" entry to the `settingsTabs` array in `SettingsView.tsx`, using the `Database` icon from lucide-react, positioned between "Operator" and "About".

```typescript
type SettingsTab = 'ai' | 'capture' | 'storage' | 'appearance' | 'operator' | 'database' | 'about'
```

### Sub-tab navigation

`DatabaseAdmin.tsx` renders a horizontal tab strip at the top (Stats | Tables | Utilities) with the active sub-tab's component below. Uses the same styling patterns as the rest of Settings — `neu-card`, `text-text-primary`, `bg-elevated`, etc.

### Stats sub-tab

A card grid displaying:

- **Schema version** — single value display
- **DB file size** + **WAL file size** — formatted as human-readable (KB/MB)
- **Table row counts** — compact table with two columns: table name, count

Includes a refresh button. Data fetched via `db:stats` on mount and on refresh.

### Tables sub-tab

- **Table selector** — dropdown of all tables from the allowlist
- **Row browser** — HTML table showing all columns for the selected table, 50 rows per page
- **Pagination controls** — previous/next buttons, current page / total pages display
- **Per-row actions:**
  - Edit button (pencil icon) — opens `RowEditModal` pre-populated with row data
  - Delete button (trash icon) — opens `ConfirmDialog`, then calls `db:deleteRow`
- **Create button** — top-right, opens `RowEditModal` with empty fields
- FTS virtual tables (`captures_fts`, `notes_fts`) are displayed read-only: no edit, delete, or create buttons

### RowEditModal

- Renders a form field for each column in the table
- Field types inferred from SQLite column types (TEXT -> text input, INTEGER -> number input, REAL -> number input with step)
- Primary key fields are read-only when editing, auto-generated (UUID) when creating for `id` columns
- Foreign key fields show the raw value as a text input (no fancy selector — this is a power-user tool)
- Cancel and Save buttons

### Utilities sub-tab

A vertical list of operation cards. Each card has:

- **Title** and **description** of the operation
- **Action button** (styled consistently with the app's button patterns)
- **Result area** — shows outcome after the operation completes (freed bytes, rows indexed, counts, file path, etc.)

Operations:

1. **Vacuum & Optimize** — button "Run Vacuum". Shows DB size before/after and freed bytes.
2. **Rebuild FTS Indexes** — button "Rebuild". Shows number of rows re-indexed.
3. **Purge Archived Cases** — button "Purge". Confirmation dialog lists the number of archived cases that will be deleted. Shows cases/captures deleted.
4. **Find & Clean Orphans** — two buttons: "Scan" then "Clean". Scan shows the orphan report inline. Clean is only enabled after a scan, with a confirmation dialog.
5. **Backup Database** — button "Create Backup". Opens save dialog, shows the backup path on success.
6. **Restore Database** — button "Restore from File". Opens file dialog, confirms replacement, shows restart prompt on success.
7. **Export Table** — dropdown for table + format (CSV/JSON), button "Export". Opens save dialog, shows path on success.

All destructive operations (Purge, Clean Orphans, Restore) use `ConfirmDialog` with a specific warning message describing what will be permanently deleted or replaced.

## Error Handling

- All IPC handlers use the existing `ipcResult`/`ipcError` pattern from `ipcHandlers.ts`
- The preload bridge uses the existing `unwrapIpc` helper to throw on errors
- UI components show errors in a red banner within the active sub-tab (not a global toast)
- Backup and restore operations that involve file dialogs return `null` if the user cancels

## Testing

- **Unit tests** for `dbAdmin.ts` — stats retrieval, CRUD operations against a test DB, vacuum, FTS rebuild, orphan detection, table export
- **No E2E tests** for this feature — it's an admin/power-user tool behind Settings, not part of core workflows
