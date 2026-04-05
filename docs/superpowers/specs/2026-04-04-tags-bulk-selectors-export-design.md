# Tags Panel, Bulk Selector Add, and Export Selector Matches

**Issue:** [#42](https://github.com/thebristolsound/birdbrain/issues/42)
**Date:** 2026-04-04

## Summary

Three related case-workspace improvements delivered together, bringing Birdbrain closer to feature parity with Hunchly 2's tag/selector workflows:

1. **Tags Tab** — wire up the orphaned `TagManager` component as a first-class tab in the case workspace, adding per-tag usage counts.
2. **Bulk Selector Add** — let investigators paste or upload many selectors at once with live dedup preview and transactional insert.
3. **Export Selector Matches** — CSV export of every selector-capture match pair for a case, via native save dialog.

All three touch the case workspace's selector/tag surface and share overlapping query-invalidation concerns, so they ship as one bundle.

## Motivation

- `TagManager` is fully functional but unreachable from the UI — users have no way to create, browse, or delete tags without going through an individual capture.
- Investigations commonly arrive with dozens of known indicators (emails, domains, phone numbers) that are tedious to add one at a time.
- Selector-match data is the core artifact of an investigation's indicator work, but there is no way to export it for reports or downstream analysis.

---

## Part 1 — Tags Tab

### User-facing behaviour

- A new **Tags** tab appears in the case workspace alongside Overview, Captures, Selectors, Notes.
- Badge shows the count of **distinct tags used in this case** (reuses existing `tags:countForCase`).
- Clicking the tab navigates to `/cases/$caseId/tags`.
- Page shows:
  - An inline tag creation form (name input + color swatch picker + Add button) — refactored from the existing `TagManager` modal.
  - A table of all tags with columns: color swatch, name, usage count (how many captures in this case use the tag), delete action.
- Creating/deleting a tag updates the table and the badge count in real time.

### Architecture

**Route:** `/cases/$caseId/tags` registered in `src/renderer/routes/__root.tsx` as a child of `caseRoute`.

**New component:** `src/renderer/components/tags/TagsOverview.tsx`
- Renders `TagManager` inline (no modal overlay).
- Below it, renders a tag list table using the new usage-count query.

**Refactor:** `src/renderer/components/tags/TagManager.tsx`
- `onClose?: () => void` becomes optional.
- When `onClose` is omitted, the component renders inline (just the `neu-card` contents, no `fixed inset-0` overlay, no Done button).
- When `onClose` is present, existing modal behaviour is preserved (backward-compatible).

**New DB query:** `getTagUsageCountsForCase(caseId: string): Record<string, number>` in `src/main/services/database.ts`
```sql
SELECT ct.tag_id, COUNT(*) as usage_count
FROM capture_tags ct
JOIN captures c ON ct.capture_id = c.id
WHERE c.case_id = ?
GROUP BY ct.tag_id
```

**New IPC channel:** `TAGS_USAGE_COUNTS_FOR_CASE: 'tags:usageCountsForCase'`
- Handler in `src/main/ipcHandlers.ts` wraps the DB query, returns `Record<string, number>`.
- Preload binding in `src/preload/index.ts` under `window.birdbrain.tags.usageCountsForCase(caseId)`.

**Query layer:** `src/renderer/lib/queries.ts`
- Add `queryKeys.tagUsageCounts(caseId)`.
- Add `tagUsageCountsForCaseQueryOptions(caseId)` query options.
- Invalidate this key whenever tags are created/deleted or when `capture_tags` changes.

**Tab integration** in `src/renderer/components/cases/CaseWorkspace.tsx`:
- Extend `CaseTab` type with `'tags'`.
- Add `{ id: 'tags', label: 'Tags', icon: Tag }` to the `tabs` array.
- Add case to `tabPath()`: returns `/cases/$caseId/tags`.
- Add `isTags = matchRoute({ to: '/cases/$caseId/tags', fuzzy: true }) !== false` and include it in `isTabActive` logic.
- Badge count: reuse existing `tagCountForCaseQueryOptions(caseId)` (returns distinct-tag count).

### Acceptance criteria

- Tags tab is reachable from every case workspace with a count badge showing distinct tags used in the case.
- Users can create a new tag with name + color from the page.
- Users can delete any tag from the page (existing `tags:delete` cascades `capture_tags` rows).
- Per-tag usage counts are visible and update after tag-on-capture changes.
- `TagManager`'s existing tag-on-capture modal call sites (if any are added later) still work.
- No regression in existing `TagBadge` or add/remove-tags-on-capture flows.

---

## Part 2 — Bulk Selector Add

### User-facing behaviour

- A "**+ Bulk Add**" button sits in the Selectors tab header area next to the existing "Create New Selector" toggle.
- Clicking it opens a modal dialog with:
  - A large textarea for pasting patterns (one per line).
  - A file picker that accepts `.txt` and `.csv` and appends file contents to the textarea on select.
  - A "Treat all as regex" toggle (default off).
  - An optional label-prefix field.
  - A **live preview**: "N new, M duplicates skipped, K blank lines skipped".
  - A "Create All" button (disabled when N = 0).
- Submitting inserts all new selectors in one DB transaction, then runs selector-matching against existing captures for each new selector (same path as single-create).
- After creation, the selector table refreshes and new selectors appear with their initial match counts.

### Architecture

**New DB function:** `bulkCreateSelectors(params: CreateSelectorParams[]): Selector[]` in `src/main/services/database.ts`
- Wraps inserts in a single `db.transaction(() => { ... })` for atomicity and performance.
- Returns all created selector rows in input order.
- Skips any input whose `(caseId, pattern, isRegex)` combination collides with an existing selector (return that selector's existing row — or just skip; see below).

**Dedup strategy:** Deduplication happens in the renderer's live preview against already-existing selectors (fetched via the existing `selectors:list` query). Backend `bulkCreateSelectors` trusts the input and inserts everything; a unique constraint on `(case_id, pattern, is_regex)` is **not** added (avoid schema migration for this PR — renderer-side dedup is sufficient for the UX goal).

**New IPC channel:** `SELECTORS_BULK_CREATE: 'selectors:bulkCreate'`
- Param type: `BulkCreateSelectorsParams { caseId: string; selectors: Array<{ pattern: string; isRegex: boolean; label?: string }> }`.
- Handler calls `db.bulkCreateSelectors()` then, for each created selector, runs `db.matchSelectorAgainstCaptures(selector.id, captureTexts)` — reusing the existing retroactive-match loop from the `SELECTORS_CREATE` handler. The loop to fetch `captureTexts` runs once per bulk call, not once per selector.
- Returns `Selector[]` (the created rows).

**New component:** `src/renderer/components/selectors/BulkAddSelectorsModal.tsx`
- Controlled modal (renderer state in `SelectorsOverview`).
- Parsing: split textarea on newlines, trim each line, drop blanks, dedupe against each other (case-sensitive for regex, case-insensitive match for text).
- Live preview recomputes on every textarea change (useMemo on parsed lines + existing selectors).
- File input uses `FileReader.readAsText()` and appends to textarea with a leading newline if non-empty.
- On submit: calls `window.birdbrain.selectors.bulkCreate()`, then invalidates `selectors(caseId)`, `selectorMatchCounts(caseId)`, `selectorCoverage(caseId)`.

**UI entry:** add a "+ Bulk Add" button in `SelectorsOverview.tsx` next to the existing create-form toggle area. A `showBulkAddModal` piece of local state controls the modal.

### Acceptance criteria

- Bulk Add button is visible in the Selectors tab header.
- Modal opens with textarea, file picker, regex toggle, label prefix, live preview, Create All button.
- File upload (`.txt` or `.csv`) appends contents to textarea.
- Blank lines are trimmed and skipped.
- Duplicate patterns within the paste are skipped.
- Patterns that already exist as selectors for the case are skipped with a count shown.
- All new selectors are created in one DB transaction.
- Selector-matching runs against existing captures for all new selectors.
- Table refreshes and shows new selectors with their match counts.
- Create All button is disabled when zero new selectors would be created.

---

## Part 3 — Export Selector Matches (CSV)

### User-facing behaviour

- An "**Export Matches**" button appears in the Selectors tab header (disabled when the case has zero selector matches).
- Clicking it opens a native save dialog with a default filename derived from the case name: `{caseName}_selector_matches.csv`.
- Confirming writes a CSV file with columns: Selector Pattern, Selector Label, Type (text/regex), Capture URL, Capture Title, Capture Timestamp.
- If the user cancels the save dialog, nothing happens (no error).

### Architecture

**New DB query:** `getSelectorMatchesForExport(caseId: string)` in `src/main/services/database.ts`

Returns:
```ts
Array<{
  selectorPattern: string
  selectorLabel: string | null
  isRegex: boolean
  captureUrl: string
  captureTitle: string | null
  captureTimestamp: string
}>
```

SQL:
```sql
SELECT s.pattern as selectorPattern,
       s.label as selectorLabel,
       s.is_regex as isRegex,
       c.url as captureUrl,
       c.title as captureTitle,
       c.timestamp as captureTimestamp
FROM selector_matches sm
JOIN selectors s ON sm.selector_id = s.id
JOIN captures c ON sm.capture_id = c.id
WHERE s.case_id = ?
ORDER BY s.pattern, c.timestamp DESC
```

**New IPC channel:** `SELECTORS_EXPORT_MATCHES: 'selectors:exportMatches'`
- Param: `caseId: string`.
- Handler:
  1. Loads the case row to get the case name (for default filename).
  2. Calls `db.getSelectorMatchesForExport(caseId)`.
  3. Builds a CSV string with RFC 4180 escaping (wrap fields containing `,`, `"`, or newlines in double quotes; escape inner `"` as `""`).
  4. Calls `dialog.showSaveDialog()` with `defaultPath: '{caseName-safe}_selector_matches.csv'`.
  5. If user confirms, writes the file via `fs.writeFileSync` and returns `{ exported: true, path }`.
  6. If user cancels, returns `{ exported: false }`.

**UI entry:** add an "Export Matches" button in `SelectorsOverview.tsx` header area. Button is disabled when `Object.values(matchCounts).reduce((a, b) => a + b, 0) === 0`.

### Acceptance criteria

- Export Matches button is visible in the Selectors tab header.
- Button is disabled when the case has zero selector matches.
- Clicking it opens a native save dialog with sensible default filename.
- The exported CSV contains all selector-to-capture match pairs for the case.
- CSV includes: selector pattern, label, type (text/regex), capture URL, title, timestamp.
- CSV opens cleanly in Excel and Google Sheets (RFC 4180 compliant).
- Cancelling the save dialog is a silent no-op.

---

## Cross-Cutting Concerns

### Shared types (`src/shared/ipc.ts`)

Add to `IPC_CHANNELS`:
```ts
TAGS_USAGE_COUNTS_FOR_CASE: 'tags:usageCountsForCase',
SELECTORS_BULK_CREATE: 'selectors:bulkCreate',
SELECTORS_EXPORT_MATCHES: 'selectors:exportMatches',
```

Add param type:
```ts
export interface BulkCreateSelectorsParams {
  caseId: string
  selectors: Array<{ pattern: string; isRegex: boolean; label?: string }>
}
```

### Preload bridge (`src/preload/index.ts`)

Add to existing `tags` namespace: `usageCountsForCase(caseId)`.
Add to existing `selectors` namespace: `bulkCreate(params)`, `exportMatches(caseId)`.

### Query layer (`src/renderer/lib/queries.ts`)

- New key: `queryKeys.tagUsageCounts(caseId)`.
- New query options: `tagUsageCountsForCaseQueryOptions(caseId)`.
- Bulk-create mutation invalidates: `selectors(caseId)`, `selectorMatchCounts(caseId)`, `selectorCoverage(caseId)`.
- Export-matches is not a query — it's a direct preload call from a button handler.

### Out of scope

- No new unique constraint on selectors (dedup happens in the renderer).
- No CSV upload parsing beyond appending file content to the textarea.
- No batch-level label editing beyond the single prefix field.
- No UI for re-running selector matching independent of bulk create.
- No export format other than CSV (JSON/JSONL could come later).
- No new tag-picker UI for the tags page (the page is just the inline manager + usage count table).

## Testing strategy

- **DB tests** (`tests/main/services/database.test.ts`):
  - `getTagUsageCountsForCase` returns expected counts after seeding tags + capture_tags.
  - `bulkCreateSelectors` inserts all rows in one transaction and returns them in order.
  - `getSelectorMatchesForExport` returns joined rows for a case scoped correctly.
- **E2E** (`e2e/`):
  - New `e2e/tags.spec.ts`: navigate to Tags tab, create a tag, verify usage count updates after tagging a capture.
  - Extend existing selectors e2e: open Bulk Add modal, paste 3 patterns, verify 3 selectors appear in the table.
  - Skip CSV export e2e (native save dialog is painful to drive); test the CSV-generation logic as a unit test on the pure function.
- **Unit tests:** extract CSV escaping into a pure helper and test RFC 4180 edge cases (commas, quotes, newlines in fields).

## Risks

- **Selector matching runtime**: `matchSelectorAgainstCaptures` is called once per new selector inside the bulk-create handler. For large cases with many captures and many new selectors, this could be slow (O(selectors × captures)). Mitigation: load capture texts once, reuse across the loop.
- **TagManager refactor**: making `onClose` optional could drift if future code assumes it's always present. Mitigation: check for existing call sites (currently none) before merge.
- **CSV generation**: naive CSV generation can break on special characters. Mitigation: pull CSV escaping into a pure function with focused unit tests.
