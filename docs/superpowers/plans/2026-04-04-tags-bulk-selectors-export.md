# Tags Panel, Bulk Selector Add, and Export Selector Matches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three related case-workspace improvements as one bundle — a Tags tab surfacing the orphaned `TagManager` with per-tag usage counts, a Bulk Selector Add modal with live dedup preview, and CSV export of all selector-capture match pairs for a case.

**Architecture:** Three new backend DB queries (`getTagUsageCountsForCase`, `bulkCreateSelectors`, `getSelectorMatchesForExport`) + three new IPC channels. A pure CSV-escaping helper is extracted into its own module with focused unit tests. Frontend adds a new `/cases/$caseId/tags` route with inline `TagManager` (refactored so `onClose` is optional) plus a per-tag usage-count table, a `BulkAddSelectorsModal` with renderer-side dedup against the existing selectors query, and an "Export Matches" button that invokes Electron's native save dialog via IPC. No schema migration — deduplication happens in the renderer. Follows the existing Notes/Selectors architectural patterns exactly.

**Tech Stack:** better-sqlite3 (WAL), Electron IPC + `dialog.showSaveDialog`, React 19, TanStack Query v5, TanStack Router, Tailwind v4, lucide-react, vitest, Playwright.

---

## File Structure

### Files to create

- `src/main/services/csvEscape.ts` — pure RFC 4180 CSV escaping helper
- `src/renderer/components/tags/TagsOverview.tsx` — Tags tab page (inline `TagManager` + usage-count table)
- `src/renderer/components/selectors/BulkAddSelectorsModal.tsx` — bulk-add modal with live preview
- `tests/main/services/csvEscape.test.ts` — unit tests for the CSV helper
- `e2e/tags.spec.ts` — Playwright E2E for Tags tab

### Files to modify

- `src/main/services/database.ts` — add `getTagUsageCountsForCase`, `bulkCreateSelectors`, `getSelectorMatchesForExport` + row type + `SelectorMatchExportRow` type
- `src/main/ipcHandlers.ts` — register 3 new handlers; export matches handler uses `dialog.showSaveDialog` + `fs.writeFileSync`
- `src/shared/ipc.ts` — add 3 channels + `BulkCreateSelectorsParams` type
- `src/shared/types.ts` — add `SelectorMatchExportRow` type
- `src/preload/index.ts` — add 3 new preload bindings
- `src/renderer/env.d.ts` — extend `BirdbrainAPI` with the 3 new methods + import `SelectorMatchExportRow`
- `src/renderer/lib/queries.ts` — add `tagUsageCounts` key + query options + `useSelectorsBulkMutation` invalidations
- `src/renderer/routes/__root.tsx` — register `tagsRoute`
- `src/renderer/components/cases/CaseWorkspace.tsx` — add Tags tab to `CaseTab` union, tabs array, `tabPath`, `isTabActive`
- `src/renderer/components/tags/TagManager.tsx` — make `onClose` optional, support inline mode
- `src/renderer/components/selectors/SelectorsOverview.tsx` — add Bulk Add + Export Matches buttons to header area
- `tests/main/services/database.test.ts` — tests for the 3 new DB functions

---

## Task 1: Pure CSV-escaping helper + tests

**Files:**
- Create: `src/main/services/csvEscape.ts`
- Create: `tests/main/services/csvEscape.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/main/services/csvEscape.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { escapeCsvField, buildCsv } from '@main/services/csvEscape'

describe('escapeCsvField', () => {
  it('returns plain values unchanged', () => {
    expect(escapeCsvField('hello')).toBe('hello')
    expect(escapeCsvField('no-special-chars')).toBe('no-special-chars')
  })

  it('wraps values containing commas in double quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"')
  })

  it('wraps values containing double quotes and escapes inner quotes as ""', () => {
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""')
  })

  it('wraps values containing newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('renders null and undefined as empty string', () => {
    expect(escapeCsvField(null)).toBe('')
    expect(escapeCsvField(undefined)).toBe('')
  })

  it('stringifies numbers and booleans', () => {
    expect(escapeCsvField(42)).toBe('42')
    expect(escapeCsvField(true)).toBe('true')
    expect(escapeCsvField(false)).toBe('false')
  })
})

describe('buildCsv', () => {
  it('joins a header row and data rows with CRLF line endings', () => {
    const csv = buildCsv(
      ['name', 'age'],
      [
        ['alice', 30],
        ['bob', 25]
      ]
    )
    expect(csv).toBe('name,age\r\nalice,30\r\nbob,25\r\n')
  })

  it('escapes fields with special characters in both header and rows', () => {
    const csv = buildCsv(
      ['comma,col', 'quote"col'],
      [['a,b', 'he said "hi"']]
    )
    expect(csv).toBe('"comma,col","quote""col"\r\n"a,b","he said ""hi"""\r\n')
  })

  it('produces header-only output when rows is empty', () => {
    expect(buildCsv(['a', 'b'], [])).toBe('a,b\r\n')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/main/services/csvEscape.test.ts`
Expected: FAIL with "Cannot find module '@main/services/csvEscape'"

- [ ] **Step 3: Implement the helper**

Create `src/main/services/csvEscape.ts`:

```typescript
// RFC 4180 CSV escaping.
// Values that contain a comma, double quote, CR, or LF are wrapped in double quotes,
// and any inner double quotes are escaped by doubling them.

export type CsvValue = string | number | boolean | null | undefined

export function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  const str = typeof value === 'string' ? value : String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function buildCsv(header: string[], rows: CsvValue[][]): string {
  const lines: string[] = []
  lines.push(header.map(escapeCsvField).join(','))
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','))
  }
  // RFC 4180 recommends CRLF line endings; trailing CRLF matches Excel export convention.
  return lines.join('\r\n') + '\r\n'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/main/services/csvEscape.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/csvEscape.ts tests/main/services/csvEscape.test.ts
git commit -m "feat: add pure CSV escaping helper with RFC 4180 tests"
```

---

## Task 2: DB query — `getTagUsageCountsForCase`

**Files:**
- Modify: `src/main/services/database.ts` — add after `getTagCountForCase` (line 479)
- Test: `tests/main/services/database.test.ts` — add to the `case metrics` describe block

- [ ] **Step 1: Write the failing test**

In `tests/main/services/database.test.ts`, add a new import near the top for `getTagUsageCountsForCase`. Append this test inside the `describe('case metrics', ...)` block (after the `returns 0 for case with no tags` test, around line 346):

```typescript
it('returns per-tag usage counts scoped to a case', () => {
  const caseA = createCase({ name: 'Case A' })
  const caseB = createCase({ name: 'Case B' })

  const capA1 = insertCapture({
    caseId: caseA.id,
    url: 'https://a1.com',
    title: 'A1',
    hash: 'ha1',
    timestamp: new Date().toISOString()
  })
  const capA2 = insertCapture({
    caseId: caseA.id,
    url: 'https://a2.com',
    title: 'A2',
    hash: 'ha2',
    timestamp: new Date().toISOString()
  })
  const capB1 = insertCapture({
    caseId: caseB.id,
    url: 'https://b1.com',
    title: 'B1',
    hash: 'hb1',
    timestamp: new Date().toISOString()
  })

  const tagRed = createTag({ name: 'red' })
  const tagBlue = createTag({ name: 'blue' })

  addTagToCapture({ captureId: capA1.id, tagId: tagRed.id })
  addTagToCapture({ captureId: capA2.id, tagId: tagRed.id })
  addTagToCapture({ captureId: capA1.id, tagId: tagBlue.id })
  addTagToCapture({ captureId: capB1.id, tagId: tagRed.id })

  const counts = getTagUsageCountsForCase(caseA.id)
  expect(counts[tagRed.id]).toBe(2)
  expect(counts[tagBlue.id]).toBe(1)
  // caseB's usage should not leak into caseA's counts
  expect(Object.keys(counts)).toHaveLength(2)
})

it('returns empty object when case has no tagged captures', () => {
  const c = createCase({ name: 'No Tags' })
  expect(getTagUsageCountsForCase(c.id)).toEqual({})
})
```

Also add `getTagUsageCountsForCase` to the import list at the top of the file (alongside `getTagCountForCase`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/main/services/database.test.ts -t "returns per-tag usage counts"`
Expected: FAIL with "getTagUsageCountsForCase is not a function" (or similar import error).

- [ ] **Step 3: Implement the DB function**

In `src/main/services/database.ts`, add this function immediately after `getTagCountForCase` (around line 479):

```typescript
export function getTagUsageCountsForCase(caseId: string): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT ct.tag_id, COUNT(*) as count
       FROM capture_tags ct
       JOIN captures c ON ct.capture_id = c.id
       WHERE c.case_id = ?
       GROUP BY ct.tag_id`
    )
    .all(caseId) as Array<{ tag_id: string; count: number }>
  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.tag_id] = row.count
  }
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/main/services/database.test.ts -t "per-tag usage counts"`
Expected: PASS for both new tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "feat: add getTagUsageCountsForCase DB query"
```

---

## Task 3: DB function — `bulkCreateSelectors`

**Files:**
- Modify: `src/main/services/database.ts` — add after `createSelector` (around line 520)
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write the failing test**

Add `bulkCreateSelectors` to the imports at the top of `tests/main/services/database.test.ts`. Then append a new `describe` block after `describe('listActiveSelectors', ...)` (around line 409, before the notes schema block):

```typescript
describe('bulkCreateSelectors', () => {
  it('inserts all selectors in one transaction and returns them in input order', () => {
    const c = createCase({ name: 'Bulk Case' })
    const created = bulkCreateSelectors([
      { caseId: c.id, pattern: 'alpha', isRegex: false, label: 'A' },
      { caseId: c.id, pattern: 'beta', isRegex: true },
      { caseId: c.id, pattern: 'gamma', isRegex: false, label: 'C' }
    ])
    expect(created).toHaveLength(3)
    expect(created[0].pattern).toBe('alpha')
    expect(created[0].label).toBe('A')
    expect(created[1].pattern).toBe('beta')
    expect(created[1].isRegex).toBe(true)
    expect(created[2].pattern).toBe('gamma')

    const listed = listSelectors(c.id)
    expect(listed).toHaveLength(3)
  })

  it('returns empty array when given no input', () => {
    const result = bulkCreateSelectors([])
    expect(result).toEqual([])
  })

  it('rolls back all inserts if any insert fails', () => {
    const c = createCase({ name: 'Rollback Case' })
    // The second insert references a non-existent case_id, violating the foreign key.
    expect(() =>
      bulkCreateSelectors([
        { caseId: c.id, pattern: 'ok' },
        { caseId: 'does-not-exist', pattern: 'bad' }
      ])
    ).toThrow()
    // Transaction should have rolled back — no selectors inserted for the valid case either.
    expect(listSelectors(c.id)).toHaveLength(0)
  })
})
```

Also add `listSelectors` to the imports if not already present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/main/services/database.test.ts -t "bulkCreateSelectors"`
Expected: FAIL with "bulkCreateSelectors is not a function".

- [ ] **Step 3: Implement the DB function**

In `src/main/services/database.ts`, add this function immediately after `createSelector` (around line 520):

```typescript
export function bulkCreateSelectors(params: CreateSelectorParams[]): Selector[] {
  if (params.length === 0) return []
  const d = getDb()
  const now = new Date().toISOString()
  const insert = d.prepare(
    'INSERT INTO selectors (id, case_id, pattern, is_regex, label, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const ids: string[] = []
  const run = d.transaction(() => {
    for (const p of params) {
      const id = uuid()
      insert.run(id, p.caseId, p.pattern, p.isRegex ? 1 : 0, p.label ?? null, now)
      ids.push(id)
    }
  })
  run()
  return ids.map((id) => getSelector(id)!)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/main/services/database.test.ts -t "bulkCreateSelectors"`
Expected: PASS — all 3 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "feat: add bulkCreateSelectors with transactional insert"
```

---

## Task 4: DB query — `getSelectorMatchesForExport`

**Files:**
- Modify: `src/main/services/database.ts` — add after `getSelectorCoverage` (around line 693)
- Modify: `src/shared/types.ts` — add `SelectorMatchExportRow` type
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Add the shared type**

In `src/shared/types.ts`, add this type after the existing `ActiveCaseSelectors` interface (around line 101):

```typescript
export interface SelectorMatchExportRow {
  selectorPattern: string
  selectorLabel: string | null
  isRegex: boolean
  captureUrl: string
  captureTitle: string | null
  captureTimestamp: string
}
```

- [ ] **Step 2: Write the failing test**

Add `getSelectorMatchesForExport` to the imports in `tests/main/services/database.test.ts`. Append a new `describe` block after the `bulkCreateSelectors` block:

```typescript
describe('getSelectorMatchesForExport', () => {
  it('returns joined selector+capture rows scoped to one case', () => {
    const c = createCase({ name: 'Export Case' })
    const other = createCase({ name: 'Other Case' })

    const cap1 = insertCapture({
      caseId: c.id,
      url: 'https://example.com/a',
      title: 'Page A',
      hash: 'h1',
      timestamp: '2026-01-01T00:00:00.000Z'
    })
    const cap2 = insertCapture({
      caseId: c.id,
      url: 'https://example.com/b',
      title: 'Page B',
      hash: 'h2',
      timestamp: '2026-01-02T00:00:00.000Z'
    })
    const otherCap = insertCapture({
      caseId: other.id,
      url: 'https://other.com',
      title: 'Other',
      hash: 'oh1',
      timestamp: '2026-01-03T00:00:00.000Z'
    })

    const sel = createSelector({
      caseId: c.id,
      pattern: 'example',
      isRegex: false,
      label: 'Example matcher'
    })
    const otherSel = createSelector({ caseId: other.id, pattern: 'other' })

    matchSelectorAgainstCaptures(sel.id, [
      { captureId: cap1.id, text: 'example content' },
      { captureId: cap2.id, text: 'another example here' }
    ])
    matchSelectorAgainstCaptures(otherSel.id, [{ captureId: otherCap.id, text: 'other' }])

    const rows = getSelectorMatchesForExport(c.id)
    expect(rows).toHaveLength(2)
    // Ordered by s.pattern, then c.timestamp DESC
    expect(rows[0].selectorPattern).toBe('example')
    expect(rows[0].selectorLabel).toBe('Example matcher')
    expect(rows[0].isRegex).toBe(false)
    expect(rows[0].captureUrl).toBe('https://example.com/b')
    expect(rows[0].captureTitle).toBe('Page B')
    expect(rows[0].captureTimestamp).toBe('2026-01-02T00:00:00.000Z')
    expect(rows[1].captureUrl).toBe('https://example.com/a')
    // Other case's match must not leak in.
    expect(rows.find((r) => r.captureUrl === 'https://other.com')).toBeUndefined()
  })

  it('returns empty array when case has no matches', () => {
    const c = createCase({ name: 'No Matches' })
    expect(getSelectorMatchesForExport(c.id)).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test tests/main/services/database.test.ts -t "getSelectorMatchesForExport"`
Expected: FAIL with "getSelectorMatchesForExport is not a function".

- [ ] **Step 4: Implement the DB function**

In `src/main/services/database.ts`, first add `SelectorMatchExportRow` to the type import at the top:

```typescript
import type { Case, Capture, Tag, Selector, ActiveCaseSelectors, Note, SelectorMatchExportRow } from '@shared/types'
```

Then add this function immediately after `getSelectorCoverage` (around line 693):

```typescript
export function getSelectorMatchesForExport(caseId: string): SelectorMatchExportRow[] {
  const rows = getDb()
    .prepare(
      `SELECT s.pattern as selectorPattern,
              s.label as selectorLabel,
              s.is_regex as isRegex,
              c.url as captureUrl,
              c.title as captureTitle,
              c.timestamp as captureTimestamp
       FROM selector_matches sm
       JOIN selectors s ON sm.selector_id = s.id
       JOIN captures c ON sm.capture_id = c.id
       WHERE s.case_id = ?
       ORDER BY s.pattern, c.timestamp DESC`
    )
    .all(caseId) as Array<{
    selectorPattern: string
    selectorLabel: string | null
    isRegex: number
    captureUrl: string
    captureTitle: string | null
    captureTimestamp: string
  }>
  return rows.map((r) => ({
    selectorPattern: r.selectorPattern,
    selectorLabel: r.selectorLabel,
    isRegex: r.isRegex === 1,
    captureUrl: r.captureUrl,
    captureTitle: r.captureTitle,
    captureTimestamp: r.captureTimestamp
  }))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/main/services/database.test.ts -t "getSelectorMatchesForExport"`
Expected: PASS — both new tests green.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/database.ts src/shared/types.ts tests/main/services/database.test.ts
git commit -m "feat: add getSelectorMatchesForExport DB query and shared row type"
```

---

## Task 5: IPC channels + preload bindings + env types

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`

- [ ] **Step 1: Add the new IPC channels and `BulkCreateSelectorsParams` type**

In `src/shared/ipc.ts`:

1. Inside `IPC_CHANNELS`, add these three entries:
   - Under `// Tags`, add `TAGS_USAGE_COUNTS_FOR_CASE: 'tags:usageCountsForCase',` after the `TAGS_COUNT_FOR_CASE` line.
   - Under `// Selectors`, add `SELECTORS_BULK_CREATE: 'selectors:bulkCreate',` and `SELECTORS_EXPORT_MATCHES: 'selectors:exportMatches',` after the `SELECTORS_COVERAGE` line.

2. At the end of the file, add the new param type:

```typescript
export interface BulkCreateSelectorsParams {
  caseId: string
  selectors: Array<{ pattern: string; isRegex: boolean; label?: string }>
}
```

- [ ] **Step 2: Register the tags usage-counts handler**

In `src/main/ipcHandlers.ts`, add this line directly after the existing `TAGS_COUNT_FOR_CASE` handler (around line 222):

```typescript
ipcMain.handle(IPC_CHANNELS.TAGS_USAGE_COUNTS_FOR_CASE, (_, caseId: string) =>
  db.getTagUsageCountsForCase(caseId)
)
```

- [ ] **Step 3: Register the bulk-create selectors handler**

In `src/main/ipcHandlers.ts`, first add `BulkCreateSelectorsParams` to the type import:

```typescript
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams,
  BulkCreateSelectorsParams
} from '@shared/ipc'
```

Then add this handler immediately after `SELECTORS_CREATE` (around line 246):

```typescript
ipcMain.handle(IPC_CHANNELS.SELECTORS_BULK_CREATE, (_, params: BulkCreateSelectorsParams) => {
  try {
    const created = db.bulkCreateSelectors(
      params.selectors.map((s) => ({
        caseId: params.caseId,
        pattern: s.pattern,
        isRegex: s.isRegex,
        label: s.label
      }))
    )
    // Load capture texts once and reuse across all new selectors (O(N+M) not O(N*M)).
    if (created.length > 0) {
      const captures = db.listCaptures(params.caseId)
      const captureTexts: Array<{ captureId: string; text: string }> = []
      for (const cap of captures) {
        const buffer = storage.readCaptureFile(params.caseId, cap.id, 'txt')
        if (buffer) {
          captureTexts.push({ captureId: cap.id, text: buffer.toString('utf-8') })
        }
      }
      if (captureTexts.length > 0) {
        for (const sel of created) {
          db.matchSelectorAgainstCaptures(sel.id, captureTexts)
        }
      }
    }
    return ipcResult(created)
  } catch (err) {
    return ipcError(err)
  }
})
```

- [ ] **Step 4: Register the export-matches handler**

In `src/main/ipcHandlers.ts`, add this handler immediately after `SELECTORS_COVERAGE` (around line 275):

```typescript
ipcMain.handle(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, async (_, caseId: string) => {
  try {
    const caseRow = db.getCase(caseId)
    if (!caseRow) return ipcResult({ exported: false })
    const rows = db.getSelectorMatchesForExport(caseId)
    const { buildCsv } = await import('@main/services/csvEscape')
    const csv = buildCsv(
      ['Selector Pattern', 'Selector Label', 'Type', 'Capture URL', 'Capture Title', 'Capture Timestamp'],
      rows.map((r) => [
        r.selectorPattern,
        r.selectorLabel ?? '',
        r.isRegex ? 'regex' : 'text',
        r.captureUrl,
        r.captureTitle ?? '',
        r.captureTimestamp
      ])
    )
    const safeName = caseRow.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'case'
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `${safeName}_selector_matches.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return ipcResult({ exported: false })
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, csv, 'utf-8')
    return ipcResult({ exported: true, path: filePath })
  } catch (err) {
    return ipcError(err)
  }
})
```

- [ ] **Step 5: Add preload bindings**

In `src/preload/index.ts`, add `BulkCreateSelectorsParams` to the imports:

```typescript
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams,
  BulkCreateSelectorsParams
} from '@shared/ipc'
```

Then add `Selector` imports are already present. Add the tags method inside the existing `tags` namespace (after `countForCase`):

```typescript
usageCountsForCase: (caseId: string): Promise<Record<string, number>> =>
  ipcRenderer.invoke(IPC_CHANNELS.TAGS_USAGE_COUNTS_FOR_CASE, caseId)
```

Add to the existing `selectors` namespace (after `coverage`):

```typescript
bulkCreate: (params: BulkCreateSelectorsParams): Promise<Selector[]> =>
  unwrapIpc<Selector[]>(ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_BULK_CREATE, params)),
exportMatches: (caseId: string): Promise<{ exported: boolean; path?: string }> =>
  unwrapIpc<{ exported: boolean; path?: string }>(
    ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, caseId)
  )
```

- [ ] **Step 6: Extend `BirdbrainAPI` in `env.d.ts`**

In `src/renderer/env.d.ts`, add `BulkCreateSelectorsParams` to the ipc imports:

```typescript
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams,
  BulkCreateSelectorsParams
} from '@shared/ipc'
```

In the `tags` namespace of `BirdbrainAPI`, add:

```typescript
usageCountsForCase(caseId: string): Promise<Record<string, number>>
```

In the `selectors` namespace of `BirdbrainAPI`, add:

```typescript
bulkCreate(params: BulkCreateSelectorsParams): Promise<Selector[]>
exportMatches(caseId: string): Promise<{ exported: boolean; path?: string }>
```

- [ ] **Step 7: Verify typecheck passes**

Run: `pnpm lint`
Expected: PASS — no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/main/ipcHandlers.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat: add IPC channels for tag usage counts, bulk selector create, and export matches"
```

---

## Task 6: Query layer — keys, options, and bulk-create mutation

**Files:**
- Modify: `src/renderer/lib/queries.ts`

- [ ] **Step 1: Add query key and options for tag usage counts**

In `src/renderer/lib/queries.ts`, add a new entry to `queryKeys` (inside the object, after `tagCountForCase`):

```typescript
tagUsageCounts: (caseId: string) => ['tags', 'usageCounts', caseId] as const,
```

Then add the query options factory right after `tagCountForCaseQueryOptions` (around line 116):

```typescript
export const tagUsageCountsForCaseQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.tagUsageCounts(caseId),
    queryFn: () => window.birdbrain.tags.usageCountsForCase(caseId),
    enabled: !!caseId
  })
```

- [ ] **Step 2: Invalidate `tagUsageCounts` on tag create/delete/add-remove**

Update `useTagsMutations` in `src/renderer/lib/queries.ts`. The current mutations only invalidate `tags` / `tagsForCapture`. Change them to also invalidate all `tagUsageCounts` query keys (since we don't know which case the user is viewing).

Replace the existing `useTagsMutations` function body with:

```typescript
export function useTagsMutations() {
  const queryClient = useQueryClient()

  const invalidateAllUsageCounts = () =>
    queryClient.invalidateQueries({
      predicate: (q) => {
        const key = q.queryKey
        return Array.isArray(key) && key[0] === 'tags' && key[1] === 'usageCounts'
      }
    })

  const invalidateAllCaseCounts = () =>
    queryClient.invalidateQueries({
      predicate: (q) => {
        const key = q.queryKey
        return Array.isArray(key) && key[0] === 'tags' && key[1] === 'caseCount'
      }
    })

  const create = useMutation({
    mutationFn: (params: CreateTagParams) => window.birdbrain.tags.create(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags })
  })

  const update = useMutation({
    mutationFn: (params: UpdateTagParams) => window.birdbrain.tags.update(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags })
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.tags.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tags })
      invalidateAllUsageCounts()
      invalidateAllCaseCounts()
    }
  })

  const addToCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.addToCapture({ captureId, tagId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
      invalidateAllUsageCounts()
      invalidateAllCaseCounts()
    }
  })

  const removeFromCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.removeFromCapture({ captureId, tagId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
      invalidateAllUsageCounts()
      invalidateAllCaseCounts()
    }
  })

  return { create, update, remove, addToCapture, removeFromCapture }
}
```

- [ ] **Step 3: Add `bulkCreate` to `useSelectorsMutations`**

In `src/renderer/lib/queries.ts`, first add `BulkCreateSelectorsParams` to the `@shared/ipc` imports at the top:

```typescript
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams,
  BulkCreateSelectorsParams
} from '@shared/ipc'
```

Add a `bulkCreate` mutation inside `useSelectorsMutations` (alongside `create`, `update`, `remove`). Replace the existing return statement and add the mutation:

```typescript
const bulkCreate = useMutation({
  mutationFn: (params: BulkCreateSelectorsParams) => window.birdbrain.selectors.bulkCreate(params),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorCoverage(caseId) })
  }
})

return { create, update, remove, bulkCreate }
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm lint`
Expected: PASS — no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/queries.ts
git commit -m "feat: add tag usage-count query and bulk selector create mutation"
```

---

## Task 7: Refactor `TagManager` — make `onClose` optional

**Files:**
- Modify: `src/renderer/components/tags/TagManager.tsx`

- [ ] **Step 1: Make `onClose` optional and support inline rendering**

Replace the full contents of `src/renderer/components/tags/TagManager.tsx` with:

```typescript
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tagsQueryOptions, useTagsMutations } from '@renderer/lib/queries'

const TAG_COLORS = [
  '#f59e0b',
  '#ef4444',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#f97316'
]

interface TagManagerProps {
  onClose?: () => void
}

export function TagManager({ onClose }: TagManagerProps) {
  const { data: tags = [] } = useQuery(tagsQueryOptions)
  const { create, remove } = useTagsMutations()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[0])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await create.mutateAsync({ name: newName.trim(), color: newColor })
    setNewName('')
  }

  const body = (
    <>
      <h2 className="mb-4 text-lg font-semibold text-text-primary">Manage Tags</h2>

      {/* Create new tag */}
      <div className="mb-4 flex items-center gap-2">
        <input
          data-testid="tag-name-input"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          className="flex-1 rounded border border-border-strong bg-elevated px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
          placeholder="New tag name..."
        />
        <div className="flex gap-1">
          {TAG_COLORS.map((c) => (
            <button
              data-testid="tag-color-swatch"
              key={c}
              onClick={() => setNewColor(c)}
              className={`h-5 w-5 rounded-full ${newColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-card' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <button
          data-testid="tag-add-btn"
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="rounded bg-accent px-2 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* Existing tags */}
      <div data-testid="tag-manager" className="max-h-48 space-y-1 overflow-y-auto">
        {tags.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-elevated"
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: tag.color || '#f59e0b' }}
            />
            <span className="flex-1 text-sm text-text-secondary">{tag.name}</span>
            <button
              data-testid="tag-delete-btn"
              onClick={() => remove.mutate(tag.id)}
              className="text-xs text-text-faint hover:text-red-400"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {onClose && (
        <div className="mt-4 flex justify-end">
          <button
            data-testid="tag-done-btn"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
          >
            Done
          </button>
        </div>
      )}
    </>
  )

  // Modal mode — overlay with click-to-close backdrop.
  if (onClose) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={onClose}
      >
        <div className="neu-card w-96 rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      </div>
    )
  }

  // Inline mode — card contents only, no overlay.
  return <div className="neu-card rounded-2xl p-6">{body}</div>
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/tags/TagManager.tsx
git commit -m "refactor: make TagManager onClose optional to support inline rendering"
```

---

## Task 8: `TagsOverview` component — usage-count table

**Files:**
- Create: `src/renderer/components/tags/TagsOverview.tsx`

- [ ] **Step 1: Create the TagsOverview component**

Create `src/renderer/components/tags/TagsOverview.tsx`:

```typescript
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { tagsQueryOptions, tagUsageCountsForCaseQueryOptions } from '@renderer/lib/queries'
import { TagManager } from './TagManager'

export function TagsOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/tags' })
  const { data: tags = [], isLoading } = useQuery(tagsQueryOptions)
  const { data: usageCounts = {} } = useQuery(tagUsageCountsForCaseQueryOptions(caseId))

  if (isLoading) {
    return <div className="text-text-muted">Loading tags...</div>
  }

  // Sort tags by usage in this case (desc), then by name.
  const sorted = [...tags].sort((a, b) => {
    const countDiff = (usageCounts[b.id] ?? 0) - (usageCounts[a.id] ?? 0)
    if (countDiff !== 0) return countDiff
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6 pb-16">
      <TagManager />

      <div data-testid="tags-usage-table" className="neu-card rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-sm font-semibold text-text-primary">Tag Usage in This Case</h3>
          <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-accent">
            {sorted.filter((t) => (usageCounts[t.id] ?? 0) > 0).length}
          </span>
        </div>
        {sorted.length === 0 ? (
          <p className="px-5 py-4 text-sm text-text-muted">No tags yet. Create one above to get started.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wider text-text-muted">
                <th className="w-12 px-4 py-2 font-medium">Color</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="w-32 px-4 py-2 font-medium text-right">Usage in Case</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((tag) => (
                <tr
                  key={tag.id}
                  data-testid="tag-usage-row"
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-4 py-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: tag.color || '#f59e0b' }}
                    />
                  </td>
                  <td className="px-4 py-2 text-text-primary">{tag.name}</td>
                  <td
                    data-testid={`tag-usage-count-${tag.name}`}
                    className="px-4 py-2 text-right font-mono text-text-secondary"
                  >
                    {usageCounts[tag.id] ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/tags/TagsOverview.tsx
git commit -m "feat: add TagsOverview page with per-tag usage counts"
```

---

## Task 9: Register Tags route + wire into CaseWorkspace tabs

**Files:**
- Modify: `src/renderer/routes/__root.tsx`
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx`

- [ ] **Step 1: Register the `/cases/$caseId/tags` route**

In `src/renderer/routes/__root.tsx`:

1. Add the import:

```typescript
import { TagsOverview } from '@renderer/components/tags/TagsOverview'
```

2. Add the route definition after the `notesRoute` block (around line 88):

```typescript
// Tags tab
const tagsRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/tags',
  component: TagsOverview
})
```

3. Add `tagsRoute` to the `caseRoute.addChildren([...])` array:

```typescript
caseRoute.addChildren([caseIndexRoute, capturesRoute, selectorsRoute, notesRoute, tagsRoute])
```

- [ ] **Step 2: Add Tags tab to CaseWorkspace**

In `src/renderer/components/cases/CaseWorkspace.tsx`:

1. Update the imports to add `Tag` icon and `tagCountForCaseQueryOptions`:

```typescript
import { LayoutDashboard, Layers, Crosshair, StickyNote, Tag } from 'lucide-react'
```

```typescript
import {
  casesQueryOptions,
  capturesQueryOptions,
  noteCountQueryOptions,
  tagCountForCaseQueryOptions
} from '@renderer/lib/queries'
```

2. Extend the `CaseTab` union:

```typescript
type CaseTab = 'overview' | 'captures' | 'selectors' | 'notes' | 'tags'
```

3. Add the Tags entry to the `tabs` array (after Notes):

```typescript
const tabs: { id: CaseTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'captures', label: 'Captures', icon: Layers },
  { id: 'selectors', label: 'Selectors', icon: Crosshair },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'tags', label: 'Tags', icon: Tag }
]
```

4. Extend `tabPath`:

```typescript
function tabPath(tab: CaseTab): string {
  switch (tab) {
    case 'overview':
      return '/cases/$caseId'
    case 'captures':
      return '/cases/$caseId/captures'
    case 'selectors':
      return '/cases/$caseId/selectors'
    case 'notes':
      return '/cases/$caseId/notes'
    case 'tags':
      return '/cases/$caseId/tags'
  }
}
```

5. Inside `CaseWorkspace()`, add the tag count query alongside the existing ones:

```typescript
const { data: tagCount = 0 } = useQuery(tagCountForCaseQueryOptions(caseId))
```

6. Add `isTags` to the route-matching block and update `isTabActive`:

```typescript
const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
const isSelectors = matchRoute({ to: '/cases/$caseId/selectors', fuzzy: true }) !== false
const isNotes = matchRoute({ to: '/cases/$caseId/notes', fuzzy: true }) !== false
const isTags = matchRoute({ to: '/cases/$caseId/tags', fuzzy: true }) !== false

function isTabActive(tab: CaseTab): boolean {
  if (tab === 'overview') return !isCaptures && !isSelectors && !isNotes && !isTags
  if (tab === 'captures') return isCaptures
  if (tab === 'selectors') return isSelectors
  if (tab === 'notes') return isNotes
  return isTags
}
```

7. Extend the badge-count lookup inside the `tabs.map(...)` JSX block:

```typescript
const badgeCount =
  tab.id === 'captures'
    ? captures.length
    : tab.id === 'notes'
      ? noteCount
      : tab.id === 'tags'
        ? tagCount
        : null
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/routes/__root.tsx src/renderer/components/cases/CaseWorkspace.tsx
git commit -m "feat: wire Tags tab into CaseWorkspace with distinct-tag badge"
```

---

## Task 10: `BulkAddSelectorsModal` component

**Files:**
- Create: `src/renderer/components/selectors/BulkAddSelectorsModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `src/renderer/components/selectors/BulkAddSelectorsModal.tsx`:

```typescript
import { useMemo, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import type { Selector } from '@shared/types'
import { useSelectorsMutations } from '@renderer/lib/queries'

interface BulkAddSelectorsModalProps {
  caseId: string
  existingSelectors: Selector[]
  onClose: () => void
  onCreated: (created: Selector[]) => void
}

interface ParseResult {
  unique: string[]
  blankCount: number
  withinPasteDuplicates: number
  existingDuplicates: number
}

function parseInput(
  raw: string,
  existingSelectors: Selector[],
  isRegex: boolean
): ParseResult {
  const lines = raw.split(/\r?\n/)
  let blankCount = 0
  const seen = new Set<string>()
  const unique: string[] = []
  let withinPasteDuplicates = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      blankCount++
      continue
    }
    // Regex patterns are case-sensitive; text patterns dedupe case-insensitively.
    const key = isRegex ? trimmed : trimmed.toLowerCase()
    if (seen.has(key)) {
      withinPasteDuplicates++
      continue
    }
    seen.add(key)
    unique.push(trimmed)
  }

  // Now check against existing selectors (match on pattern + isRegex).
  const existingKeys = new Set(
    existingSelectors
      .filter((s) => s.isRegex === isRegex)
      .map((s) => (isRegex ? s.pattern : s.pattern.toLowerCase()))
  )

  const newPatterns: string[] = []
  let existingDuplicates = 0
  for (const pattern of unique) {
    const key = isRegex ? pattern : pattern.toLowerCase()
    if (existingKeys.has(key)) {
      existingDuplicates++
    } else {
      newPatterns.push(pattern)
    }
  }

  return {
    unique: newPatterns,
    blankCount,
    withinPasteDuplicates,
    existingDuplicates
  }
}

export function BulkAddSelectorsModal({
  caseId,
  existingSelectors,
  onClose,
  onCreated
}: BulkAddSelectorsModalProps) {
  const [text, setText] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [labelPrefix, setLabelPrefix] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { bulkCreate } = useSelectorsMutations(caseId)

  const parsed = useMemo(
    () => parseInput(text, existingSelectors, isRegex),
    [text, existingSelectors, isRegex]
  )

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const contents = await file.text()
    setText((prev) => (prev.trim() ? `${prev}\n${contents}` : contents))
    // Reset the input so selecting the same file again still fires change.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit() {
    if (parsed.unique.length === 0) return
    setSubmitting(true)
    try {
      const selectors = parsed.unique.map((pattern, i) => ({
        pattern,
        isRegex,
        label: labelPrefix.trim() ? `${labelPrefix.trim()} ${i + 1}` : undefined
      }))
      const created = await bulkCreate.mutateAsync({ caseId, selectors })
      onCreated(created)
      onClose()
    } catch (err) {
      console.error('Bulk create failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        data-testid="bulk-add-modal"
        className="neu-card w-[32rem] max-w-[90vw] rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Bulk Add Selectors</h2>
            <p className="text-xs text-text-muted">One pattern per line. Blank lines are ignored.</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-faint hover:bg-elevated hover:text-text-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          data-testid="bulk-add-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={'alice@example.com\nbob@example.com\n555-867-5309'}
          className="mb-3 w-full rounded-lg border border-border-strong bg-canvas px-3 py-2 font-mono text-xs text-text-primary placeholder-text-faint focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/25"
        />

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-secondary hover:bg-elevated">
            <Upload className="h-3.5 w-3.5" />
            Upload .txt / .csv
            <input
              ref={fileInputRef}
              data-testid="bulk-add-file"
              type="file"
              accept=".txt,.csv"
              onChange={handleFilePick}
              className="hidden"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              data-testid="bulk-add-regex-toggle"
              type="checkbox"
              checked={isRegex}
              onChange={(e) => setIsRegex(e.target.checked)}
            />
            Treat all as regex
          </label>

          <input
            data-testid="bulk-add-label-prefix"
            type="text"
            value={labelPrefix}
            onChange={(e) => setLabelPrefix(e.target.value)}
            placeholder="Label prefix (optional)"
            className="flex-1 min-w-[8rem] rounded-lg border border-border-strong bg-canvas px-3 py-1.5 text-xs text-text-primary placeholder-text-faint focus:border-accent/40 focus:outline-none"
          />
        </div>

        <div
          data-testid="bulk-add-preview"
          className="mb-4 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
        >
          <span data-testid="bulk-add-new-count" className="font-semibold text-accent">
            {parsed.unique.length}
          </span>{' '}
          new,{' '}
          <span data-testid="bulk-add-dup-count">
            {parsed.withinPasteDuplicates + parsed.existingDuplicates}
          </span>{' '}
          duplicates skipped,{' '}
          <span data-testid="bulk-add-blank-count">{parsed.blankCount}</span> blank lines skipped
          {parsed.existingDuplicates > 0 && (
            <span className="ml-1 text-text-muted">
              ({parsed.existingDuplicates} already exist in this case)
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            data-testid="bulk-add-submit"
            onClick={handleSubmit}
            disabled={parsed.unique.length === 0 || submitting}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? 'Creating...' : `Create All (${parsed.unique.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/selectors/BulkAddSelectorsModal.tsx
git commit -m "feat: add BulkAddSelectorsModal with live dedup preview"
```

---

## Task 11: Wire Bulk Add + Export Matches into `SelectorsOverview`

**Files:**
- Modify: `src/renderer/components/selectors/SelectorsOverview.tsx`

- [ ] **Step 1: Add Bulk Add and Export Matches buttons to the header**

Replace the contents of `src/renderer/components/selectors/SelectorsOverview.tsx` with:

```typescript
import { useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ListPlus } from 'lucide-react'
import { useAppStore } from '@renderer/stores/appStore'
import {
  selectorsQueryOptions,
  selectorMatchCountsQueryOptions,
  capturesQueryOptions,
  queryKeys
} from '@renderer/lib/queries'
import { CreateSelectorCard } from './CreateSelectorCard'
import { SelectorTable } from './SelectorTable'
import { SelectorFilterFooter } from './SelectorFilterFooter'
import { BulkAddSelectorsModal } from './BulkAddSelectorsModal'

export function SelectorsOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/selectors' })
  const queryClient = useQueryClient()
  const filteredCaptureIds = useAppStore((s) => s.filteredCaptureIds)
  const { data: selectors = [], isLoading } = useQuery(selectorsQueryOptions(caseId))
  const { data: matchCounts = {} } = useQuery(selectorMatchCountsQueryOptions(caseId))
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showBulkAddModal, setShowBulkAddModal] = useState(false)
  const [exporting, setExporting] = useState(false)

  const totalMatches = useMemo(
    () => Object.values(matchCounts).reduce((a, b) => a + b, 0),
    [matchCounts]
  )

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
  }

  async function handleExportMatches() {
    setExporting(true)
    try {
      await window.birdbrain.selectors.exportMatches(caseId)
    } catch (err) {
      console.error('Export matches failed:', err)
    } finally {
      setExporting(false)
    }
  }

  if (isLoading) {
    return <div className="text-text-muted">Loading selectors...</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6 pb-16">
      <div className="flex items-center justify-end gap-2">
        <button
          data-testid="bulk-add-btn"
          onClick={() => setShowBulkAddModal(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-elevated"
        >
          <ListPlus className="h-3.5 w-3.5" />
          Bulk Add
        </button>
        <button
          data-testid="export-matches-btn"
          onClick={handleExportMatches}
          disabled={totalMatches === 0 || exporting}
          className="flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-elevated disabled:opacity-40"
          title={totalMatches === 0 ? 'No selector matches to export' : 'Export all matches to CSV'}
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Exporting...' : 'Export Matches'}
        </button>
      </div>

      <CreateSelectorCard
        isOpen={showCreateForm}
        onToggle={() => setShowCreateForm((v) => !v)}
        onCreated={() => {
          setShowCreateForm(false)
          handleRefresh()
        }}
        caseId={caseId}
      />

      {selectors.length === 0 ? (
        <p className="text-sm text-text-muted">
          No selectors found. Create one to start matching captures.
        </p>
      ) : (
        <SelectorTable
          selectors={selectors}
          matchCounts={matchCounts}
          onRefresh={handleRefresh}
          caseId={caseId}
        />
      )}

      <SelectorFilterFooter
        selectors={selectors}
        totalCaptures={captures.length}
        filteredCount={filteredCaptureIds?.length ?? captures.length}
      />

      {showBulkAddModal && (
        <BulkAddSelectorsModal
          caseId={caseId}
          existingSelectors={selectors}
          onClose={() => setShowBulkAddModal(false)}
          onCreated={() => handleRefresh()}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/selectors/SelectorsOverview.tsx
git commit -m "feat: add Bulk Add and Export Matches buttons to selectors header"
```

---

## Task 12: E2E test — Tags tab navigation and usage counts

**Files:**
- Create: `e2e/tags.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `e2e/tags.spec.ts`:

```typescript
import { test, expect } from './fixtures/electronApp'

test.describe('Tags tab', () => {
  test('navigate to Tags tab, create and delete tags, see usage table', async ({ page }) => {
    // Create a case via the dashboard wizard.
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Tags E2E Case')
    await page.click('[data-testid="case-create-btn"]')
    await expect(page.getByRole('heading', { name: 'Tags E2E Case' })).toBeVisible()

    // Click the Tags tab (added as a new first-class tab).
    await page.getByRole('link', { name: 'Tags' }).click()

    // Tab badge should exist and start at 0 (no tags used in this case yet).
    await expect(page.getByTestId('tab-badge-tags')).toHaveText('0')

    // Create a tag from the inline manager.
    await page.getByTestId('tag-name-input').fill('important')
    await page.getByTestId('tag-add-btn').click()

    // The tag list inside TagManager should show the tag.
    await expect(page.getByTestId('tag-manager')).toContainText('important')

    // The usage table should list the tag with 0 usage in this case.
    await expect(page.getByTestId('tags-usage-table')).toContainText('important')
    await expect(page.getByTestId('tag-usage-count-important')).toHaveText('0')

    // Badge remains 0 because no capture in this case is tagged.
    await expect(page.getByTestId('tab-badge-tags')).toHaveText('0')

    // Create a second tag and confirm it also appears in the usage table.
    await page.getByTestId('tag-name-input').fill('reviewed')
    await page.getByTestId('tag-add-btn').click()
    await expect(page.getByTestId('tag-usage-count-reviewed')).toHaveText('0')

    // Delete the first tag via the manager's delete button (first row in the manager list).
    await page.getByTestId('tag-delete-btn').first().click()
    // Wait for the deleted tag to leave the usage table.
    await expect(page.getByTestId('tags-usage-table')).not.toContainText('important')
  })
})
```

- [ ] **Step 2: Build and run the E2E test**

Run: `pnpm build && pnpm test:e2e e2e/tags.spec.ts`
Expected: PASS — the test navigates to the Tags tab, creates/deletes tags, and validates the usage table.

- [ ] **Step 3: Commit**

```bash
git add e2e/tags.spec.ts
git commit -m "test: add E2E test for Tags tab navigation and usage counts"
```

---

## Task 13: E2E test — Bulk Add selectors

**Files:**
- Create: `e2e/bulk-selectors.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `e2e/bulk-selectors.spec.ts`:

```typescript
import { test, expect } from './fixtures/electronApp'

test.describe('Bulk Add Selectors', () => {
  test('open modal, paste 3 patterns, verify 3 new selectors created', async ({ page }) => {
    // Create a case.
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Bulk Selectors E2E')
    await page.click('[data-testid="case-create-btn"]')
    await expect(page.getByRole('heading', { name: 'Bulk Selectors E2E' })).toBeVisible()

    // Navigate to the Selectors tab.
    await page.getByRole('link', { name: 'Selectors' }).click()

    // Open Bulk Add modal.
    await page.getByTestId('bulk-add-btn').click()
    await expect(page.getByTestId('bulk-add-modal')).toBeVisible()

    // Paste 3 patterns plus a blank line plus a duplicate.
    await page.getByTestId('bulk-add-textarea').fill('alpha\nbeta\n\ngamma\nalpha\n')

    // Live preview: 3 new, 1 duplicate, 1 blank.
    await expect(page.getByTestId('bulk-add-new-count')).toHaveText('3')
    await expect(page.getByTestId('bulk-add-dup-count')).toHaveText('1')
    await expect(page.getByTestId('bulk-add-blank-count')).toHaveText('1')

    // Submit.
    await page.getByTestId('bulk-add-submit').click()

    // Modal closes, table shows the 3 new selectors.
    await expect(page.getByTestId('bulk-add-modal')).not.toBeVisible()
    await expect(page.getByText('alpha')).toBeVisible()
    await expect(page.getByText('beta')).toBeVisible()
    await expect(page.getByText('gamma')).toBeVisible()

    // Re-open modal and paste one already-existing pattern: preview should show 0 new, 1 dup.
    await page.getByTestId('bulk-add-btn').click()
    await page.getByTestId('bulk-add-textarea').fill('alpha')
    await expect(page.getByTestId('bulk-add-new-count')).toHaveText('0')
    await expect(page.getByTestId('bulk-add-dup-count')).toHaveText('1')
    // Create All is disabled.
    await expect(page.getByTestId('bulk-add-submit')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Build and run the E2E test**

Run: `pnpm build && pnpm test:e2e e2e/bulk-selectors.spec.ts`
Expected: PASS — the modal opens, preview updates live, and 3 selectors appear.

- [ ] **Step 3: Commit**

```bash
git add e2e/bulk-selectors.spec.ts
git commit -m "test: add E2E test for Bulk Add selectors flow"
```

---

## Task 14: Full test sweep + final verification

**Files:** n/a

- [ ] **Step 1: Run the full vitest suite**

Run: `pnpm test`
Expected: PASS — all existing tests plus the new DB + CSV escape tests.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS — no ESLint errors.

- [ ] **Step 3: Run format check**

Run: `pnpm format`
Expected: Prettier exits cleanly (any reformatting is committed as part of this step).

- [ ] **Step 4: Build the app**

Run: `pnpm build`
Expected: electron-vite build completes successfully.

- [ ] **Step 5: Run the full E2E suite**

Run: `pnpm test:e2e`
Expected: PASS — all specs including the two new ones (`e2e/tags.spec.ts`, `e2e/bulk-selectors.spec.ts`).

- [ ] **Step 6: Manual smoke test**

Run: `pnpm dev`
Expected:
- Create a case.
- Navigate to Tags tab: badge shows 0, create 2 tags, they appear in the usage table.
- Navigate to Selectors tab: Bulk Add and Export Matches buttons are visible. Export Matches is disabled (no matches yet).
- Open Bulk Add, paste 3 patterns, confirm live preview updates, submit — 3 selectors appear in the table.
- After a capture arrives and matches a selector, Export Matches becomes enabled. Clicking it opens a native save dialog with `{caseName}_selector_matches.csv` as default filename.

- [ ] **Step 7: Final commit (if any formatting changes)**

```bash
git add -A
git diff --cached --stat
# If there are changes:
git commit -m "chore: apply prettier formatting after feature bundle"
# If no changes, skip this step.
```

---

## Self-Review Checklist

This checklist was applied after writing the plan:

**Spec coverage:**
- Part 1 (Tags Tab) — Tasks 2, 5, 6, 7, 8, 9, 12 ✓
- Part 2 (Bulk Selector Add) — Tasks 3, 5, 6, 10, 11, 13 ✓
- Part 3 (Export Selector Matches) — Tasks 1, 4, 5, 11 ✓ (CSV unit tests replace the skipped native-save-dialog E2E per spec testing strategy)
- Cross-cutting (IPC channels, preload, env.d.ts, query layer) — Task 5, 6 ✓
- Risk mitigation (capture texts loaded once in bulk) — Task 5 Step 3 loop structure ✓
- Risk mitigation (TagManager optional `onClose`) — Task 7 ✓
- Risk mitigation (CSV generation pure + tested) — Task 1 ✓

**Type consistency:**
- `SelectorMatchExportRow` (Task 4, shared/types.ts) matches the handler CSV mapping in Task 5 Step 4 ✓
- `BulkCreateSelectorsParams` (Task 5) used consistently in preload, env.d.ts, queries.ts, modal component ✓
- `queryKeys.tagUsageCounts` key used in `tagUsageCountsForCaseQueryOptions` and the invalidation predicate ✓
- `{ exported: boolean; path?: string }` return shape for `exportMatches` consistent across main handler, preload, env.d.ts, and renderer caller ✓

**Placeholder scan:** No TBD/TODO/placeholder phrases; all code is concrete.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-04-tags-bulk-selectors-export.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
