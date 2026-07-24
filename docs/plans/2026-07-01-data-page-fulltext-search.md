# Data Page Full-Text Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fast, substring full-text search to the Data page (`DataExplorer`), with a per-result "To selector" action.

**Architecture:** An FTS5 trigram index over `extracted_data(value, source_url)` (migration v17) backs a `searchExtractedData(caseId, query)` DB function, exposed through the standard `extractedData:search` IPC channel and a React Query option. `DataExplorer` swaps its three-column drill-down for a flat results list while a query is active; each result opens a small anchored `CreateSelectorPopover` to create a selector.

**Tech Stack:** Electron, better-sqlite3 (FTS5 trigram), typed IPC via contextBridge, React 19, TanStack Query, Tailwind v4, Vitest.

## Global Constraints

- Code style: no semicolons, single quotes, no trailing commas, 100-char width, 2-space indent, TypeScript strict, JSX transform (no React import).
- Prefer semantic theme tokens (`bg-canvas`, `text-text-muted`, `border-border`, `text-accent`) over raw colors.
- IPC channels follow `domain:action`; all renderer↔main traffic goes through typed channels in `src/shared/ipc.ts` and the `window.birdbrain` bridge.
- Tests run under the Electron runtime via `pnpm test` (Vitest, globals enabled).
- Never `git add .`/`-A`; stage files explicitly. No `Co-authored-by` trailers.

---

### Task 1: FTS5 trigram index + `searchExtractedData` (DB layer)

**Files:**
- Modify: `src/main/services/database.ts` (add migration `version < 22` block after the `version < 21` block ~line 450; bump `LATEST_SCHEMA_VERSION` from 21 to 22; add `ExtractedDataSearchResult` import from shared types; add `searchExtractedData` + a local `escapeLike` helper after `getExtractedItems` ~line 1463)
- Modify: `src/shared/types.ts` (add `ExtractedDataSearchResult` after `ExtractedDataItem` ~line 319)
- Test: `tests/main/services/database.test.ts` (add cases in the extracted-data `describe` block, and import `searchExtractedData`)

**Interfaces:**
- Consumes: existing `insertExtractedData(captureId, caseId, sourceUrl, items)`, `deleteExtractedDataForCapture(captureId)`.
- Produces: `searchExtractedData(caseId: string, query: string): ExtractedDataSearchResult[]` where `ExtractedDataSearchResult = { value: string; category: string; subcategory: string; pageCount: number; sourceUrls: string[] }`.

- [ ] **Step 1: Add the shared type**

In `src/shared/types.ts`, after the `ExtractedDataItem` interface:

```ts
export interface ExtractedDataSearchResult {
  value: string
  category: string
  subcategory: string
  pageCount: number
  sourceUrls: string[]
}
```

- [ ] **Step 2: Write the failing tests**

In `tests/main/services/database.test.ts`, add `searchExtractedData` to the imports from `../../../src/main/services/database`, then add inside the extracted-data `describe` block:

```ts
it('finds items by substring of value across categories', () => {
  insertExtractedData(captureId, caseId, 'https://example.com', [
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'foo@gmail.com' },
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'bar@yahoo.com' },
    { category: 'Tracking Code', subcategory: 'Google Analytics', value: 'gmail-ua-1' }
  ])

  const results = searchExtractedData(caseId, 'gmail')
  const values = results.map((r) => r.value).sort()
  expect(values).toEqual(['foo@gmail.com', 'gmail-ua-1'])
  const email = results.find((r) => r.value === 'foo@gmail.com')!
  expect(email.category).toBe('Infrastructure')
  expect(email.subcategory).toBe('Email Address')
  expect(email.pageCount).toBe(1)
})

it('finds items by substring of source url', () => {
  insertExtractedData(captureId, caseId, 'https://tracker.example.net/page', [
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'foo@gmail.com' }
  ])

  const results = searchExtractedData(caseId, 'tracker.example')
  expect(results.map((r) => r.value)).toContain('foo@gmail.com')
})

it('scopes search to the given case', () => {
  const otherCase = createCase({ name: 'Other' })
  const otherCap = insertCapture({
    caseId: otherCase.id,
    url: 'https://other.com',
    title: 'Other',
    hash: 'hash-other',
    timestamp: new Date().toISOString()
  })
  insertExtractedData(captureId, caseId, 'https://example.com', [
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'shared@gmail.com' }
  ])
  insertExtractedData(otherCap.id, otherCase.id, 'https://other.com', [
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'shared@gmail.com' }
  ])

  expect(searchExtractedData(caseId, 'gmail')).toHaveLength(1)
})

it('falls back to LIKE for queries shorter than 3 characters', () => {
  insertExtractedData(captureId, caseId, 'https://example.com', [
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'ab@x.com' }
  ])
  expect(searchExtractedData(caseId, 'ab').map((r) => r.value)).toEqual(['ab@x.com'])
})

it('returns [] for an empty query', () => {
  insertExtractedData(captureId, caseId, 'https://example.com', [
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'foo@gmail.com' }
  ])
  expect(searchExtractedData(caseId, '   ')).toEqual([])
})

it('aggregates page count and source urls across captures', () => {
  const cap2 = insertCapture({
    caseId,
    url: 'https://example.com/2',
    title: 'Page 2',
    hash: 'hash-2',
    timestamp: new Date().toISOString()
  })
  insertExtractedData(captureId, caseId, 'https://a.com', [
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'dup@gmail.com' }
  ])
  insertExtractedData(cap2.id, caseId, 'https://b.com', [
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'dup@gmail.com' }
  ])

  const [result] = searchExtractedData(caseId, 'dup@gmail')
  expect(result.pageCount).toBe(2)
  expect(result.sourceUrls).toEqual(['https://a.com', 'https://b.com'])
})
```

(The `extracted data` describe block's `beforeEach` already provides `caseId` and `captureId`; the helpers are `createCase({ name })` and `insertCapture({ caseId, url, title, hash, timestamp })`.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- tests/main/services/database.test.ts -t "searchExtractedData"`
Expected: FAIL — `searchExtractedData is not a function` (import) / assertions unmet.

- [ ] **Step 4: Add the migration (v17)**

In `src/main/services/database.ts`, immediately after the `if (version < 16) { ... }` block (before the function returns / `LATEST_SCHEMA_VERSION` handling), add:

```ts
  if (version < 22) {
    db.transaction(() => {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS extracted_data_fts USING fts5(
          value,
          source_url,
          content='extracted_data',
          content_rowid='rowid',
          tokenize='trigram'
        );

        CREATE TRIGGER IF NOT EXISTS extracted_data_ai AFTER INSERT ON extracted_data BEGIN
          INSERT INTO extracted_data_fts(rowid, value, source_url)
          VALUES (new.rowid, new.value, new.source_url);
        END;

        CREATE TRIGGER IF NOT EXISTS extracted_data_ad AFTER DELETE ON extracted_data BEGIN
          INSERT INTO extracted_data_fts(extracted_data_fts, rowid, value, source_url)
          VALUES ('delete', old.rowid, old.value, old.source_url);
        END;

        INSERT INTO extracted_data_fts(rowid, value, source_url)
        SELECT rowid, value, source_url FROM extracted_data;
      `)
      db.pragma('user_version = 22')
    })()
  }
```

Then bump the schema-version constant: change `LATEST_SCHEMA_VERSION` from `21` to `22`.

- [ ] **Step 5: Add `searchExtractedData` + `escapeLike`**

Import the type at the top of `database.ts` (add `ExtractedDataSearchResult` to the existing `@shared/types` import that already brings in `ExtractedDataItem`). After `getExtractedItems` (~line 1463) add:

```ts
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export function searchExtractedData(caseId: string, query: string): ExtractedDataSearchResult[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const db = getDb()
  const rows =
    trimmed.length >= 3
      ? db
          .prepare(
            `SELECT category, subcategory, value,
                    COUNT(DISTINCT capture_id) as page_count,
                    GROUP_CONCAT(source_url, '\n') as source_urls
             FROM (
               SELECT DISTINCT ed.category, ed.subcategory, ed.value, ed.capture_id, ed.source_url
               FROM extracted_data ed
               JOIN extracted_data_fts f ON f.rowid = ed.rowid
               WHERE extracted_data_fts MATCH ? AND ed.case_id = ?
             )
             GROUP BY category, subcategory, value
             ORDER BY category, subcategory, value
             LIMIT 500`
          )
          .all(`"${trimmed.replace(/"/g, '""')}"`, caseId)
      : db
          .prepare(
            `SELECT category, subcategory, value,
                    COUNT(DISTINCT capture_id) as page_count,
                    GROUP_CONCAT(source_url, '\n') as source_urls
             FROM (
               SELECT DISTINCT category, subcategory, value, capture_id, source_url
               FROM extracted_data
               WHERE case_id = ? AND (value LIKE ? ESCAPE '\\' OR source_url LIKE ? ESCAPE '\\')
             )
             GROUP BY category, subcategory, value
             ORDER BY category, subcategory, value
             LIMIT 500`
          )
          .all(caseId, `%${escapeLike(trimmed)}%`, `%${escapeLike(trimmed)}%`)

  return (rows as Array<{
    category: string
    subcategory: string
    value: string
    page_count: number
    source_urls: string | null
  }>).map((r) => ({
    value: r.value,
    category: r.category,
    subcategory: r.subcategory,
    pageCount: r.page_count,
    sourceUrls: r.source_urls ? r.source_urls.split('\n').sort() : []
  }))
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- tests/main/services/database.test.ts -t "searchExtractedData"`
Expected: PASS (all 6 new cases).

- [ ] **Step 7: Run the full DB test file (guards the migration)**

Run: `pnpm test -- tests/main/services/database.test.ts`
Expected: PASS — existing migration/schema-version tests still green with v17.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/database.ts src/shared/types.ts tests/main/services/database.test.ts
git commit -m "feat(data): add FTS5 trigram search over extracted_data"
```

---

### Task 2: IPC plumbing for `extractedData:search`

**Files:**
- Modify: `src/shared/ipc.ts` (add `EXTRACTED_DATA_SEARCH` after `EXTRACTED_DATA_COUNT` ~line 89)
- Modify: `src/main/ipcHandlers.ts` (register handler after the `EXTRACTED_DATA_COUNT` handler ~line 534)
- Modify: `src/preload/index.ts` (add `search` to the `extractedData` bridge ~line 331; ensure `ExtractedDataSearchResult` is imported)
- Modify: `src/renderer/env.d.ts` (add `search` to the `extractedData` interface ~line 183; ensure type import)
- Test: `tests/main/ipcHandlers.test.ts` (add a case for the new handler)

**Interfaces:**
- Consumes: `db.searchExtractedData(caseId, query)` from Task 1.
- Produces: IPC channel `'extractedData:search'`; bridge `window.birdbrain.extractedData.search(caseId: string, query: string): Promise<ExtractedDataSearchResult[]>`.

- [ ] **Step 1: Add the channel constant**

In `src/shared/ipc.ts`, after `EXTRACTED_DATA_COUNT: 'extractedData:count',`:

```ts
  EXTRACTED_DATA_SEARCH: 'extractedData:search',
```

- [ ] **Step 2: Write the failing handler test**

This test file runs against a real DB (`import * as db`, `createCase`, `insertCapture`, `invoke(channel, ...args)` helper). Add a test that seeds data and invokes the channel. Place it near the other capture/case tests, using the file's existing `caseId`/`captureId` fixtures if in scope, or seed inline:

```ts
it('extractedData:search returns matching indicators for a case', async () => {
  const c = db.createCase({ name: 'Search Case' })
  const cap = db.insertCapture({
    caseId: c.id,
    url: 'https://example.com',
    title: 'Cap',
    hash: 'hash-search',
    timestamp: new Date().toISOString()
  })
  db.insertExtractedData(cap.id, c.id, 'https://example.com', [
    { category: 'Infrastructure', subcategory: 'Email Address', value: 'foo@gmail.com' }
  ])

  const results = await invoke<db.ExtractedDataSearchResult[]>(
    IPC_CHANNELS.EXTRACTED_DATA_SEARCH,
    c.id,
    'gmail'
  )
  expect(results.map((r) => r.value)).toEqual(['foo@gmail.com'])
})
```

(Confirm `insertExtractedData` and `ExtractedDataSearchResult` are reachable via the `import * as db` namespace; both are exported from `@main/services/database` — the type is re-exported from shared types there, or reference it directly via `@shared/types`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- tests/main/ipcHandlers.test.ts -t "extractedData:search"`
Expected: FAIL — no handler registered for the channel.

- [ ] **Step 4: Register the handler**

In `src/main/ipcHandlers.ts`, after the `EXTRACTED_DATA_COUNT` handler:

```ts
  ipcMain.handle(IPC_CHANNELS.EXTRACTED_DATA_SEARCH, (_, caseId: string, query: string) =>
    db.searchExtractedData(caseId, query)
  )
```

- [ ] **Step 5: Add the preload bridge method**

In `src/preload/index.ts`, add `ExtractedDataSearchResult` to the shared-types import, then inside the `extractedData` object after `count`:

```ts
    search: (caseId: string, query: string): Promise<ExtractedDataSearchResult[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.EXTRACTED_DATA_SEARCH, caseId, query),
```

- [ ] **Step 6: Add the renderer bridge type**

In `src/renderer/env.d.ts`, ensure `ExtractedDataSearchResult` is imported alongside the other extracted-data types, then in the `extractedData` interface after `count(...)`:

```ts
    search(caseId: string, query: string): Promise<ExtractedDataSearchResult[]>
```

- [ ] **Step 7: Run handler test + typecheck**

Run: `pnpm test -- tests/main/ipcHandlers.test.ts -t "extractedData:search"`
Expected: PASS.
Run: `pnpm lint`
Expected: no new errors in the touched files.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/main/ipcHandlers.ts src/preload/index.ts src/renderer/env.d.ts tests/main/ipcHandlers.test.ts
git commit -m "feat(data): wire extractedData:search IPC channel"
```

---

### Task 3: React Query option `extractedDataSearchQueryOptions`

**Files:**
- Modify: `src/renderer/lib/queries.ts` (add key ~line 50 and query option in the `--- Extracted Data ---` section ~line 387)
- Test: `tests/renderer/lib/queries.test.ts` (add import + a case)

**Interfaces:**
- Consumes: `window.birdbrain.extractedData.search`.
- Produces: `queryKeys.extractedDataSearch(caseId, query)`; `extractedDataSearchQueryOptions(caseId: string, query: string)`.

- [ ] **Step 1: Write the failing test**

In `tests/renderer/lib/queries.test.ts`, add `extractedDataSearchQueryOptions` to the imports, then add:

```ts
it('extractedDataSearchQueryOptions is disabled for empty query and keyed by query', () => {
  const opts = extractedDataSearchQueryOptions('case-1', '')
  expect(opts.enabled).toBe(false)
  expect(queryKeys.extractedDataSearch('case-1', 'gmail')).toEqual([
    'extractedData',
    'search',
    'case-1',
    'gmail'
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/renderer/lib/queries.test.ts -t "extractedDataSearchQueryOptions"`
Expected: FAIL — export not found.

- [ ] **Step 3: Add the query key**

In `src/renderer/lib/queries.ts`, after the `extractedDataCount` key:

```ts
  extractedDataSearch: (caseId: string, query: string) =>
    ['extractedData', 'search', caseId, query] as const,
```

- [ ] **Step 4: Add the query option**

In the `--- Extracted Data ---` section, after `extractedDataCountQueryOptions`:

```ts
export const extractedDataSearchQueryOptions = (caseId: string, query: string) =>
  queryOptions({
    queryKey: queryKeys.extractedDataSearch(caseId, query),
    queryFn: () => window.birdbrain.extractedData.search(caseId, query),
    enabled: !!caseId && query.trim().length > 0
  })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- tests/renderer/lib/queries.test.ts -t "extractedDataSearchQueryOptions"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/queries.ts tests/renderer/lib/queries.test.ts
git commit -m "feat(data): add extractedDataSearchQueryOptions"
```

---

### Task 4: `CreateSelectorPopover` component

**Files:**
- Create: `src/renderer/components/selectors/CreateSelectorPopover.tsx`

**Interfaces:**
- Consumes: `useSelectorsMutations(caseId).create` (mutates with `{ caseId, pattern, label, isRegex: false }`); `Input`, `Label`, `Button` from `@renderer/components/ui`.
- Produces: `CreateSelectorPopover({ caseId, defaultValue, defaultLabel, onClose }: { caseId: string; defaultValue: string; defaultLabel: string; onClose: () => void })` — an absolutely-positioned popout the parent renders next to its trigger.

- [ ] **Step 1: Write the component**

Create `src/renderer/components/selectors/CreateSelectorPopover.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Input, Label } from '@renderer/components/ui'
import { useSelectorsMutations } from '@renderer/lib/queries'

interface CreateSelectorPopoverProps {
  caseId: string
  defaultValue: string
  defaultLabel: string
  onClose: () => void
}

export function CreateSelectorPopover({
  caseId,
  defaultValue,
  defaultLabel,
  onClose
}: CreateSelectorPopoverProps) {
  const [pattern, setPattern] = useState(defaultValue)
  const [label, setLabel] = useState(defaultLabel)
  const { create } = useSelectorsMutations(caseId)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  async function handleCreate() {
    if (!pattern.trim()) return
    await create.mutateAsync({
      caseId,
      pattern: pattern.trim(),
      isRegex: false,
      label: label.trim() || undefined
    })
    onClose()
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-border-strong bg-elevated p-3 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="space-y-3">
        <div>
          <Label className="text-xs font-medium">Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Selector label"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
        <div>
          <Label className="text-xs font-medium">Value</Label>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Selector value"
            className="font-mono"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!pattern.trim() || create.isPending}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            {create.isPending ? '...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

Note: confirm `Input` is exported from `@renderer/components/ui` (an `input.tsx` exists in that dir). If the barrel does not re-export it, import from `@renderer/components/ui/input` and add it to the barrel.

- [ ] **Step 2: Typecheck / lint the new file**

Run: `pnpm lint`
Expected: no errors for `CreateSelectorPopover.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/selectors/CreateSelectorPopover.tsx
git commit -m "feat(selectors): add CreateSelectorPopover quick-create popout"
```

---

### Task 5: `DataExplorer` search UI + results + selector action

**Files:**
- Modify: `src/renderer/components/dashboard/cases/DataExplorer.tsx`

**Interfaces:**
- Consumes: `extractedDataSearchQueryOptions` (Task 3), `CreateSelectorPopover` (Task 4), existing `ExtractedDataSearchResult` type.
- Produces: no new exports.

- [ ] **Step 1: Add search state + debounced query**

At the top of `DataExplorer`, add imports:

```tsx
import { useEffect } from 'react'
import { Search, Crosshair } from 'lucide-react'
import { extractedDataSearchQueryOptions } from '@renderer/lib/queries'
import { CreateSelectorPopover } from '@renderer/components/selectors/CreateSelectorPopover'
import { Input } from '@renderer/components/ui'
```

(Merge `useEffect` into the existing `react` import; merge `Search`/`Crosshair` into the existing `lucide-react` import; merge `extractedDataSearchQueryOptions` into the existing `@renderer/lib/queries` import; merge `Input` into the existing `@renderer/components/ui` import.)

Inside the component, add state and the debounced search query:

```tsx
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [popoverFor, setPopoverFor] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data: searchResults = [], isFetching: searching } = useQuery(
    extractedDataSearchQueryOptions(caseId, debouncedQuery)
  )

  const isSearching = debouncedQuery.length > 0
```

- [ ] **Step 2: Add the search input to the header**

In the header `<div>` (the flex row with the Database icon and Reprocess button), insert a search input between the count span and the Reprocess `Button`:

```tsx
        <div className="relative flex-1 max-w-xs">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search indicators..."
            className="pl-8"
          />
        </div>
```

Adjust the header container so the three items lay out sensibly (the search box takes the middle, `justify-between` already spaces the ends). Keep the Database/count group and Reprocess button as-is.

- [ ] **Step 3: Render the flat results list when searching**

Immediately after the header `</div>` and before the `categories.length === 0 ? (...)` block, branch on `isSearching`:

```tsx
      {isSearching ? (
        <div className="min-h-0 flex-1">
          {searching && searchResults.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              Searching…
            </div>
          ) : searchResults.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              No indicators match “{debouncedQuery}”.
            </div>
          ) : (
            <ScrollArea className="h-full">
              {searchResults.map((r) => (
                <div
                  key={`${r.category}|${r.subcategory}|${r.value}`}
                  className="group relative border-b border-border px-4 py-3 last:border-b-0 hover:bg-elevated"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-0.5 text-[11px] uppercase tracking-wide text-text-faint">
                        {r.category} · {r.subcategory}
                      </div>
                      <span className="break-all font-mono text-sm text-text-primary">
                        {r.value}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-text-muted">
                        {r.pageCount} page{r.pageCount !== 1 ? 's' : ''}
                      </span>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setPopoverFor((cur) =>
                              cur === `${r.category}|${r.subcategory}|${r.value}`
                                ? null
                                : `${r.category}|${r.subcategory}|${r.value}`
                            )
                          }
                          className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-xs text-text-muted hover:text-accent"
                          title="Create selector from this indicator"
                        >
                          <Crosshair size={12} strokeWidth={1.8} />
                          To selector
                        </button>
                        {popoverFor === `${r.category}|${r.subcategory}|${r.value}` && (
                          <CreateSelectorPopover
                            caseId={caseId}
                            defaultValue={r.value}
                            defaultLabel={r.subcategory}
                            onClose={() => setPopoverFor(null)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                  {r.sourceUrls.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5">
                      {r.sourceUrls.map((url) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => handleSourceUrlClick(url)}
                          className="flex items-center gap-1 truncate text-left text-xs text-accent hover:underline"
                          title={url}
                        >
                          <ExternalLink size={10} strokeWidth={1.8} className="shrink-0" />
                          <span className="truncate">{url}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </ScrollArea>
          )}
        </div>
      ) : categories.length === 0 ? (
```

The existing `categories.length === 0 ? (...) : (...)` becomes the else-branch of `isSearching`. Ensure the JSX still closes correctly (the outer expression is now `isSearching ? A : categories.length === 0 ? B : C`).

- [ ] **Step 4: Run the app and verify manually**

Run: `pnpm dev`
Verify: on a case with extracted data, the Data page shows a search box; typing ≥1 char switches to the flat list; results match substrings of value and source URL; "To selector" opens the popout prefilled with the value + subcategory; creating adds a selector (check the Selectors tab); clearing the box restores the three-column view.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no errors in `DataExplorer.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/dashboard/cases/DataExplorer.tsx
git commit -m "feat(data): add search box, flat results, and to-selector action"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 2: Lint whole project**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: success (typecheck across main/preload/renderer passes).

---

## Self-Review Notes

- **Spec coverage:** value+source_url search (Task 1 FTS over both columns); substring/trigram + <3 fallback (Task 1); flat results replacing columns (Task 5); to-selector editable popout (Tasks 4–5); IPC channel (Task 2); query option with empty-query gating (Task 3); result cap 500 + 250ms debounce (Tasks 1, 5); default label = subcategory (Tasks 4–5); tests (Tasks 1–3). All covered.
- **Verify before coding:** `LATEST_SCHEMA_VERSION` export name, `createCapture` param shape in the test file, `Input` barrel export, and the `ipcHandlers.test.ts` invocation helper name — each flagged inline in the relevant task.
