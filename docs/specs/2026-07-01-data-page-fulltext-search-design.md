# Data Page Full-Text Search — Design

**Date:** 2026-07-01
**Status:** Approved
**Scope:** ~10 files (1 migration, 5 IPC-layer files, 2 renderer components, 3 test files)

## Problem

The **Data** page (`DataExplorer.tsx`) is a three-column drill-down (Categories → Subcategories → Items) over the `extracted_data` table — extracted indicators such as emails, IPs, domains, and hashes. There is currently no search: finding a specific indicator requires clicking through columns. Users need a fast, responsive full-text search box that works at any dataset scale.

## Requirements

- Search across the indicator **value** and its **source URL**.
- **Substring** matching (typing `mail` finds `foo@gmail.com`, `mailer-daemon`, `10.mail.net`).
- Results shown as a **flat list** that replaces the three-column view while a query is active.
- Each result offers a **"To selector"** action that creates a selector in the current case, via a small editable popout (edit label + value before creating), consistent with existing selector UX.

## Data Layer (main process)

### Migration v17 — FTS5 trigram index

Current schema is at `user_version = 16` (adds `extracted_data`). Migration v17 adds a full-text index:

```sql
CREATE VIRTUAL TABLE extracted_data_fts USING fts5(
  value,
  source_url,
  content='extracted_data',
  content_rowid='rowid',
  tokenize='trigram'
);
```

The `trigram` tokenizer supports substring matching and is fast at any scale. `extracted_data` is a normal (rowid) table, so `content_rowid='rowid'` is valid.

Sync triggers mirror the existing `captures_fts` / `notes_fts` pattern. Extracted rows are immutable (insert-or-ignore on write, delete-by-capture on removal), so only INSERT and DELETE triggers are required — no UPDATE trigger:

```sql
CREATE TRIGGER extracted_data_ai AFTER INSERT ON extracted_data BEGIN
  INSERT INTO extracted_data_fts(rowid, value, source_url)
  VALUES (new.rowid, new.value, new.source_url);
END;

CREATE TRIGGER extracted_data_ad AFTER DELETE ON extracted_data BEGIN
  INSERT INTO extracted_data_fts(extracted_data_fts, rowid, value, source_url)
  VALUES ('delete', old.rowid, old.value, old.source_url);
END;
```

One-time backfill of existing rows:

```sql
INSERT INTO extracted_data_fts(rowid, value, source_url)
SELECT rowid, value, source_url FROM extracted_data;
```

All wrapped in a transaction, `user_version = 17`.

Note: the existing `INSERT OR IGNORE` path only fires the AFTER INSERT trigger when a row is actually inserted (ignored duplicates fire nothing), so the FTS stays consistent.

### `searchExtractedData(caseId, query): ExtractedDataSearchResult[]`

- Empty/whitespace query → `[]`.
- Query length **≥ 3**: join FTS to base table, substring match via trigram, scope by case:

  ```sql
  SELECT ed.category, ed.subcategory, ed.value, ed.source_url, ed.capture_id
  FROM extracted_data ed
  JOIN extracted_data_fts f ON f.rowid = ed.rowid
  WHERE extracted_data_fts MATCH ? AND ed.case_id = ?
  ```

  The MATCH argument is the user term wrapped as an FTS5 phrase (double-quoted, inner quotes escaped) so special characters are treated literally. FTS5 searches all indexed columns by default (value + source_url).

- Query length **< 3** (trigram minimum): fall back to a `LIKE '%q%' ESCAPE '\'` scan scoped by `case_id` over `value` and `source_url` (fast within a single case). `%`, `_`, `\` in the term are escaped.

- Results are grouped by `(category, subcategory, value)`, aggregating `pageCount` (distinct capture count) and `sourceUrls` (mirroring the existing items query), ordered by `category, subcategory, value`, and capped at **500** rows for responsiveness.

## IPC Plumbing

New `extractedData:search` channel across the standard layers:

- `src/shared/ipc.ts` — `EXTRACTED_DATA_SEARCH: 'extractedData:search'`.
- `src/shared/types.ts` — `ExtractedDataSearchResult { value: string; category: string; subcategory: string; pageCount: number; sourceUrls: string[] }`.
- `src/main/ipcHandlers.ts` — handler calling `searchExtractedData(caseId, query)`.
- `src/preload/index.ts` — `extractedData.search(caseId, query): Promise<ExtractedDataSearchResult[]>`.
- `src/renderer/env.d.ts` — matching bridge type.
- `src/renderer/lib/queries.ts` — `queryKeys.extractedDataSearch(caseId, query)` + `extractedDataSearchQueryOptions(caseId, query)` with `enabled: !!caseId && query.trim().length > 0`.

## Renderer UX — `DataExplorer.tsx`

- Add a debounced search input to the existing header (alongside the count and Reprocess button). Debounce **250 ms**, following the `SearchBar` pattern.
- While the query is non-empty, replace the three-column drill-down with a **flat results list**. Each row shows `[Category · Subcategory]` context, the mono-spaced `value`, the page count, and its source-URL links — reusing the existing item-row markup (including the `handleSourceUrlClick` external-open behavior).
- Empty query → the unchanged three-column view. Non-empty query with no matches → an empty state.

## "To Selector" Action + Editable Popout

- Each result row gets a **"To selector"** button using the `Crosshair` icon (consistent with `CreateSelectorCard`).
- Clicking opens a new **`CreateSelectorPopover`** component (`src/renderer/components/selectors/`) — a small anchored popout, not a full modal — with two prefilled, editable fields:
  - **Label** — defaults to the result's `subcategory`.
  - **Value / pattern** — defaults to the result's `value`.
- A **Create** button calls `useSelectorsMutations(caseId).create` with `{ caseId, pattern, label, isRegex: false }`, closes on success. Reuses the `Input` / `Label` / `Button` ui primitives. Closes on outside-click and Esc.

## Testing

- `tests/main/services/database.test.ts` — `searchExtractedData`: substring match on `value` and on `source_url`; case scoping; sub-3-char `LIKE` fallback; dedup/aggregation of `pageCount`/`sourceUrls`; empty-query returns `[]`.
- `tests/main/ipcHandlers.test.ts` — the `extractedData:search` handler.
- `tests/renderer/lib/queries.test.ts` — `extractedDataSearchQueryOptions` (query key, `enabled` gating).

## Decisions

- **Result cap:** 500 rows. **Debounce:** 250 ms. Both tunable.
- **Default selector label:** the result's subcategory; pattern is the literal value, `isRegex: false`.
- **No UPDATE trigger** on the FTS table — extracted rows are immutable by construction.
