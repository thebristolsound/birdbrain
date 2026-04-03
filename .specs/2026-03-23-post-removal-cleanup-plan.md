# Post-Removal Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the entity extraction removal — drop orphaned DB tables, remove dead types/settings/CSS, replace broken metrics with live ones, and implement the three missing CaptureViewer action buttons.

**Architecture:** Bottom-up: database migration → type cleanup → settings cleanup → UI cleanup → new functionality. All changes stay on the existing `feat/remove-sidebar-and-entity-extraction-clean` branch as a single cohesive PR.

**Tech Stack:** Electron, React 19, TypeScript, SQLite (better-sqlite3), Vitest, Zustand, Tailwind v4

**Spec:** `.specs/2026-03-23-post-removal-cleanup-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/main/services/database.ts` | Modify | Migration v7, add `getTagCountForCase` + `getSelectorCoverage` queries |
| `src/shared/types.ts` | Modify | Remove `Entity`, `EntityType`, entity settings fields, `'extraction_done'` |
| `src/main/services/settings.ts` | Modify | Remove entity defaults from `DEFAULT_SETTINGS`, remove `EntityType` import |
| `src/main/services/captureServer.ts` | Modify | Remove `'extraction_done'` event emission |
| `src/shared/ipc.ts` | Modify | Add 4 new channels: download, openExternal, tagCountForCase, selectorCoverage |
| `src/main/ipcHandlers.ts` | Modify | Register new handlers, enhance delete to clean up files |
| `src/preload/index.ts` | Modify | Expose new IPC methods |
| `src/renderer/env.d.ts` | Modify | Update `BirdbrainAPI` type |
| `src/renderer/components/cases/CaseOverview.tsx` | Modify | Replace entity stat + AI coverage with Tags + Selector Coverage |
| `src/renderer/components/captures/CaptureViewer.tsx` | Modify | Wire up download, open external, delete action buttons |
| `src/renderer/components/dashboard/CaseCard.tsx` | Modify | Remove `entityCount` prop |
| `src/renderer/components/dashboard/RecentCases.tsx` | Modify | Remove `entityCount={0}` |
| `src/renderer/components/dashboard/QuickStartGuide.tsx` | Modify | Replace entity text with current features |
| `src/renderer/components/settings/EntityExtractionConfig.tsx` | Delete | Orphaned component |
| `src/renderer/components/settings/SettingsView.tsx` | Modify | Remove entities tab |
| `src/renderer/components/settings/AIConfig.tsx` | Modify | Stub with "Coming Soon" |
| `src/renderer/components/export/ExportDialog.tsx` | Modify | Remove PDF toggle |
| `src/renderer/components/status/CaptureHealth.tsx` | Modify | Remove `'extraction_done'` handler |
| `src/renderer/styles/globals.css` | Modify | Remove dead entity graph CSS |
| `src/renderer/stores/appStore.ts` | No change | Already clean (`CaseTab` has no `'entities'`) |
| `tests/main/services/database.test.ts` | Modify | Add migration v7 + metrics tests |
| `tests/main/services/settings.test.ts` | Modify | Remove entity settings assertions |
| `tests/renderer/stores/appStore.test.ts` | Modify | Fix invalid `'entities'` tab references |
| `CLAUDE.md` | Modify | Reflect current codebase |

### Existing utilities to reuse

- `storage.deleteCaptureFiles(caseId, captureId)` — `src/main/services/storage.ts:85` — deletes html/png/txt files
- `storage.readCaptureFile(caseId, captureId, type)` — `src/main/services/storage.ts:75` — reads capture file as Buffer
- `db.getCaptureCount(caseId)` — `src/main/services/database.ts:318` — counts captures for a case
- `db.getCapture(id)` — `src/main/services/database.ts:231` — fetches capture with `caseId`

---

### Task 1: Database Migration v7

**Files:**
- Modify: `src/main/services/database.ts:162-170` (after v6 migration)
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write failing test for migration v7**

In `tests/main/services/database.test.ts`, add `getDb` to the import from `@main/services/database` (line 2), then add:

```typescript
describe('migration v7 - drop entity tables', () => {
  it('drops entities and case_analyses tables', () => {
    const tables = getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entities', 'case_analyses')"
      )
      .all()
    expect(tables).toHaveLength(0)
  })

  it('sets user_version to 7', () => {
    const version = getDb().pragma('user_version', { simple: true })
    expect(version).toBe(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/main/services/database.test.ts`
Expected: FAIL — tables still exist, version is 6

- [ ] **Step 3: Implement migration v7**

In `src/main/services/database.ts`, after the `if (version < 6)` block (line 169), add:

```typescript
if (version < 7) {
  db.transaction(() => {
    db.exec(`
      DROP INDEX IF EXISTS idx_entities_capture_source;
      DROP TABLE IF EXISTS entities;
      DROP TABLE IF EXISTS case_analyses;
    `)
    db.pragma('user_version = 7')
  })()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/main/services/database.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "Add database migration v7 to drop orphaned entity tables"
```

---

### Task 2: Add getTagCountForCase Query

**Files:**
- Modify: `src/main/services/database.ts` (after `getTagsForCapture` at ~line 376)
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/main/services/database.test.ts`:

```typescript
describe('case metrics', () => {
  it('counts distinct tags for a case', () => {
    const c = createCase({ name: 'Tag Count Test' })
    const cap1 = insertCapture({
      caseId: c.id,
      url: 'https://a.com',
      title: 'A',
      hash: 'h1',
      timestamp: new Date().toISOString()
    })
    const cap2 = insertCapture({
      caseId: c.id,
      url: 'https://b.com',
      title: 'B',
      hash: 'h2',
      timestamp: new Date().toISOString()
    })
    const tag1 = createTag({ name: 'important' })
    const tag2 = createTag({ name: 'reviewed' })
    addTagToCapture({ captureId: cap1.id, tagId: tag1.id })
    addTagToCapture({ captureId: cap1.id, tagId: tag2.id })
    addTagToCapture({ captureId: cap2.id, tagId: tag1.id })

    expect(getTagCountForCase(c.id)).toBe(2)
  })

  it('returns 0 for case with no tags', () => {
    const c = createCase({ name: 'No Tags' })
    expect(getTagCountForCase(c.id)).toBe(0)
  })
})
```

Import `getTagCountForCase` in the imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/main/services/database.test.ts`
Expected: FAIL — function not found

- [ ] **Step 3: Implement**

In `src/main/services/database.ts`, after `getTagsForCapture`:

```typescript
export function getTagCountForCase(caseId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT ct.tag_id) as count
       FROM capture_tags ct
       JOIN captures c ON ct.capture_id = c.id
       WHERE c.case_id = ?`
    )
    .get(caseId) as { count: number } | undefined
  return row?.count ?? 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/main/services/database.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "Add getTagCountForCase query for case overview metrics"
```

---

### Task 3: Add getSelectorCoverage Query

**Files:**
- Modify: `src/main/services/database.ts` (after `getTagCountForCase`)
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write failing test**

Add inside the `case metrics` describe block:

```typescript
it('computes selector coverage', () => {
  const c = createCase({ name: 'Coverage Test' })
  const cap1 = insertCapture({
    caseId: c.id,
    url: 'https://a.com',
    title: 'A',
    hash: 'cov1',
    timestamp: new Date().toISOString()
  })
  insertCapture({
    caseId: c.id,
    url: 'https://b.com',
    title: 'B',
    hash: 'cov2',
    timestamp: new Date().toISOString()
  })
  const sel = createSelector({ caseId: c.id, pattern: 'a\\.com', label: 'test' })
  matchSelectorAgainstCaptures(sel.id, [
    { captureId: cap1.id, text: 'visit https://a.com today' }
  ])

  const cov = getSelectorCoverage(c.id)
  expect(cov.total).toBe(2)
  expect(cov.matched).toBe(1)
})

it('returns zero coverage for empty case', () => {
  const c = createCase({ name: 'Empty' })
  const cov = getSelectorCoverage(c.id)
  expect(cov).toEqual({ matched: 0, total: 0 })
})
```

Import `getSelectorCoverage`, `createSelector`, `matchSelectorAgainstCaptures`.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement**

```typescript
export function getSelectorCoverage(caseId: string): { matched: number; total: number } {
  const total = getCaptureCount(caseId)
  if (total === 0) return { matched: 0, total: 0 }
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT sm.capture_id) as matched
       FROM selector_matches sm
       JOIN captures c ON sm.capture_id = c.id
       WHERE c.case_id = ?`
    )
    .get(caseId) as { matched: number } | undefined
  return { matched: row?.matched ?? 0, total }
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "Add getSelectorCoverage query for case overview metrics"
```

---

### Task 4: Type Cleanup — Remove Entity Types and Settings Fields

**Files:**
- Modify: `src/shared/types.ts`
- Test: `tests/shared/captureTypes.test.ts` (verify no breakage)

- [ ] **Step 1: Remove from `src/shared/types.ts`**

Delete:
- `Entity` interface (lines 37-46)
- `EntityType` type (lines 120-131)
- From `BirdbrainSettings`: `autoExtractEntities`, `enabledEntityTypes`, `minEntityConfidence` (lines 51-53), `sidebarWidth` (line 61)
- `'extraction_done'` from `CaptureEvent.type` union (line 136) — becomes `'received' | 'stored' | 'failed' | 'skipped'`

Resulting `BirdbrainSettings`:
```typescript
export interface BirdbrainSettings {
  openRouterApiKey: string | null
  defaultModel: string
  captureScreenshots: boolean
  captureHtml: boolean
  dedupeWindowSeconds: number
  ignoredUrlPatterns: string[]
  storagePath: string
  maxStorageMb: number | null
  theme: 'dark' | 'light'
  autoCaptureMode: AutoCaptureMode
}
```

- [ ] **Step 2: Verify existing type tests pass**

Run: `pnpm test -- tests/shared/captureTypes.test.ts`
Expected: PASS (test uses `type: 'stored'`, not `'extraction_done'`)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "Remove Entity, EntityType, entity settings fields, and extraction_done from types"
```

---

### Task 5: Settings Service Cleanup

**Files:**
- Modify: `src/main/services/settings.ts`
- Modify: `tests/main/services/settings.test.ts`

- [ ] **Step 1: Update settings test**

In `tests/main/services/settings.test.ts`, remove:
- Any assertion on `autoExtractEntities`
- Any usage of entity settings fields in `updateSettings()` calls

- [ ] **Step 2: Update settings service**

In `src/main/services/settings.ts`:
- Line 3: Change `import type { BirdbrainSettings, EntityType } from '@shared/types'` to `import type { BirdbrainSettings } from '@shared/types'`
- Remove from `DEFAULT_SETTINGS`: `autoExtractEntities`, `enabledEntityTypes`, `minEntityConfidence`, `sidebarWidth`

Resulting `DEFAULT_SETTINGS`:
```typescript
const DEFAULT_SETTINGS: BirdbrainSettings = {
  openRouterApiKey: null,
  defaultModel: 'anthropic/claude-sonnet-4',
  captureScreenshots: true,
  captureHtml: true,
  dedupeWindowSeconds: 60,
  ignoredUrlPatterns: [],
  storagePath: '',
  maxStorageMb: null,
  theme: 'dark',
  autoCaptureMode: 'notify'
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/main/services/settings.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/settings.ts tests/main/services/settings.test.ts
git commit -m "Remove entity defaults from settings service"
```

---

### Task 6: Capture Server Cleanup — Remove extraction_done

**Files:**
- Modify: `src/main/services/captureServer.ts:93-100`

- [ ] **Step 1: Remove extraction_done emission**

In `schedulePostCaptureWork` (around line 78), delete the `emitCaptureEvent({ type: 'extraction_done', ... })` block (lines 93-99). The function should only do selector matching after this.

- [ ] **Step 2: Run capture server tests**

Run: `pnpm test -- tests/main/services/captureServer.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/services/captureServer.ts
git commit -m "Remove extraction_done event emission from capture server"
```

---

### Task 7: CaptureHealth Cleanup

**Files:**
- Modify: `src/renderer/components/status/CaptureHealth.tsx:16-17`

- [ ] **Step 1: Remove extraction_done case**

- Delete the `case 'extraction_done':` and `return <Zap ...>` lines
- Remove `Zap` from the lucide-react import (line 2) if only used here

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/status/CaptureHealth.tsx
git commit -m "Remove extraction_done handling from CaptureHealth"
```

---

### Task 8: Dashboard Cleanup — CaseCard, RecentCases, QuickStartGuide

**Files:**
- Modify: `src/renderer/components/dashboard/CaseCard.tsx`
- Modify: `src/renderer/components/dashboard/RecentCases.tsx`
- Modify: `src/renderer/components/dashboard/QuickStartGuide.tsx`

- [ ] **Step 1: Clean CaseCard**

In `CaseCard.tsx`:
- Remove `Fingerprint` from lucide-react import
- Remove `entityCount: number` from `CaseCardProps` interface (line 51)
- Remove `entityCount` from destructured props
- Remove the entity stat display block (lines ~163-166)

- [ ] **Step 2: Clean RecentCases**

In `RecentCases.tsx`:
- Remove `entityCount={0}` from `<CaseCard>` usage (line 49)

- [ ] **Step 3: Update QuickStartGuide**

In `QuickStartGuide.tsx`:
- Replace the "Analyze Entities" step with "Review & Tag" — new title, description about tags and selectors
- Replace the export step description to remove entity references
- Update lucide-react imports: replace `Brain` with `Tags`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/dashboard/CaseCard.tsx src/renderer/components/dashboard/RecentCases.tsx src/renderer/components/dashboard/QuickStartGuide.tsx
git commit -m "Remove entity references from dashboard components"
```

---

### Task 9: Settings UI Cleanup

**Files:**
- Delete: `src/renderer/components/settings/EntityExtractionConfig.tsx`
- Modify: `src/renderer/components/settings/SettingsView.tsx`
- Modify: `src/renderer/components/settings/AIConfig.tsx`

- [ ] **Step 1: Delete EntityExtractionConfig**

```bash
rm src/renderer/components/settings/EntityExtractionConfig.tsx
```

- [ ] **Step 2: Update SettingsView**

In `SettingsView.tsx`:
- Remove `EntityExtractionConfig` import
- Remove `Fingerprint` from lucide-react import
- Remove `'entities'` from `SettingsTab` type (line 11)
- Remove the `{ id: 'entities', label: 'Entity Extraction', icon: Fingerprint }` entry (line 15)
- Remove the `case 'entities':` render case

- [ ] **Step 3: Stub AIConfig**

Replace `AIConfig.tsx` body with:

```typescript
import type { BirdbrainSettings } from '@shared/types'

interface AIConfigProps {
  settings: BirdbrainSettings
  onUpdate: (partial: Partial<BirdbrainSettings>) => Promise<void>
}

export function AIConfig(_props: AIConfigProps) {
  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-slate-200">AI Configuration</h2>
      <p className="text-sm text-slate-400">
        AI features are being redesigned. Stay tuned.
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add -u src/renderer/components/settings/
git commit -m "Remove Entity Extraction settings, stub AIConfig"
```

---

### Task 10: CaseOverview Metrics — Wire IPC + Update UI

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`
- Modify: `src/renderer/components/cases/CaseOverview.tsx`

- [ ] **Step 1: Add IPC channels**

In `src/shared/ipc.ts`, add after `TAGS_GET_FOR_CAPTURE` (line 25):
```typescript
TAGS_COUNT_FOR_CASE: 'tags:countForCase',
```

Add after `SELECTORS_MATCHING_CAPTURES` (line 48):
```typescript
SELECTORS_COVERAGE: 'selectors:coverage',
```

- [ ] **Step 2: Register handlers**

In `src/main/ipcHandlers.ts`, after tag handlers (line 134):
```typescript
ipcMain.handle(IPC_CHANNELS.TAGS_COUNT_FOR_CASE, (_, caseId: string) =>
  db.getTagCountForCase(caseId)
)
```

After selector handlers (line 171):
```typescript
ipcMain.handle(IPC_CHANNELS.SELECTORS_COVERAGE, (_, caseId: string) =>
  db.getSelectorCoverage(caseId)
)
```

- [ ] **Step 3: Expose in preload**

In `src/preload/index.ts`, in `tags` section:
```typescript
countForCase: (caseId: string): Promise<number> =>
  ipcRenderer.invoke(IPC_CHANNELS.TAGS_COUNT_FOR_CASE, caseId),
```

In `selectors` section:
```typescript
coverage: (caseId: string): Promise<{ matched: number; total: number }> =>
  ipcRenderer.invoke(IPC_CHANNELS.SELECTORS_COVERAGE, caseId),
```

- [ ] **Step 4: Update env.d.ts**

In `BirdbrainAPI.tags`:
```typescript
countForCase(caseId: string): Promise<number>
```

In `BirdbrainAPI.selectors`:
```typescript
coverage(caseId: string): Promise<{ matched: number; total: number }>
```

- [ ] **Step 5: Update CaseOverview.tsx**

- Replace `Fingerprint` import with `Tags` from lucide-react
- Add `Crosshair` to imports for the coverage section
- Add state: `const [tagCount, setTagCount] = useState(0)` and `const [selectorCoverage, setSelectorCoverage] = useState({ matched: 0, total: 0 })`
- In the data-loading `useEffect`, add:
  ```typescript
  window.birdbrain.tags.countForCase(activeCaseId).then(setTagCount)
  window.birdbrain.selectors.coverage(activeCaseId).then(setSelectorCoverage)
  ```
- Replace "Entities: 0" stat card (lines 196-206) with Tags stat using `tagCount`
- Replace "Investigation Health" / "AI Extraction Coverage" section (lines 262-280) with "Coverage" / "Selector Coverage" using `selectorCoverage`

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/main/ipcHandlers.ts src/preload/index.ts src/renderer/env.d.ts src/renderer/components/cases/CaseOverview.tsx
git commit -m "Replace entity metrics with tag count and selector coverage"
```

---

### Task 11: CaptureViewer Actions — IPC Infrastructure

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`

- [ ] **Step 1: Add IPC channels**

In `src/shared/ipc.ts`, after `CAPTURES_GET_CONTENT` (line 16):
```typescript
CAPTURES_DOWNLOAD: 'captures:download',
CAPTURES_OPEN_EXTERNAL: 'captures:openExternal',
```

- [ ] **Step 2: Implement handlers**

In `src/main/ipcHandlers.ts`, add `dialog, shell` to the electron import (line 1):
```typescript
import { ipcMain, dialog, shell } from 'electron'
```

After the captures:delete handler (line 81), add:

```typescript
ipcMain.handle(
  IPC_CHANNELS.CAPTURES_DOWNLOAD,
  async (_, captureId: string, caseId: string) => {
    try {
      const capture = db.getCapture(captureId)
      if (!capture) return ipcResult(null)
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${capture.title || 'capture'}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }]
      })
      if (canceled || !filePath) return ipcResult(null)
      const buffer = storage.readCaptureFile(caseId, captureId, 'html')
      if (!buffer) return { ok: false, error: 'HTML file not found' }
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, buffer)
      return ipcResult(filePath)
    } catch (err) {
      return ipcError(err)
    }
  }
)

ipcMain.handle(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL, async (_, url: string) => {
  await shell.openExternal(url)
})
```

- [ ] **Step 3: Enhance captures:delete to clean up files**

Replace the existing `CAPTURES_DELETE` handler (lines 75-81) with:

```typescript
ipcMain.handle(IPC_CHANNELS.CAPTURES_DELETE, (_, id: string) => {
  try {
    const capture = db.getCapture(id)
    if (!capture) return ipcResult(false)
    const deleted = db.deleteCapture(id)
    if (deleted) {
      storage.deleteCaptureFiles(capture.caseId, id)
    }
    return ipcResult(deleted)
  } catch (err) {
    return ipcError(err)
  }
})
```

- [ ] **Step 4: Expose in preload**

In `src/preload/index.ts`, in `captures` section:
```typescript
download: (captureId: string, caseId: string): Promise<unknown> =>
  ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_DOWNLOAD, captureId, caseId),
openExternal: (url: string): Promise<void> =>
  ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL, url),
```

- [ ] **Step 5: Update env.d.ts**

In `BirdbrainAPI.captures`:
```typescript
download(captureId: string, caseId: string): Promise<{ ok: boolean; data?: string; error?: string }>
openExternal(url: string): Promise<void>
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/main/ipcHandlers.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "Add IPC channels for capture download, open external, and file cleanup on delete"
```

---

### Task 12: CaptureViewer Actions — Wire Up Buttons

**Files:**
- Modify: `src/renderer/components/captures/CaptureViewer.tsx`

- [ ] **Step 1: Add state and handlers**

Add `useState` import if not present. Add state:
```typescript
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
```

Add handlers:
```typescript
const handleDownload = async () => {
  if (!selectedCaptureId || !activeCaseId) return
  await window.birdbrain.captures.download(selectedCaptureId, activeCaseId)
}

const handleOpenExternal = async () => {
  if (!capture) return
  await window.birdbrain.captures.openExternal(capture.url)
}

const handleDelete = async () => {
  if (!selectedCaptureId || !activeCaseId) return
  const deletedId = selectedCaptureId
  await window.birdbrain.captures.delete(deletedId)
  setShowDeleteConfirm(false)
  // Navigate away: pick sibling capture or clear selection
  const remaining = captures.filter((c) => c.id !== deletedId)
  if (remaining.length > 0) {
    useAppStore.getState().selectCapture(remaining[0].id)
  } else {
    useAppStore.getState().setSelectedCaptureId(null)
  }
}
```

- [ ] **Step 2: Wire up buttons**

Replace the 3 TODO button blocks (lines 178-189) with `onClick` handlers:
- Download button: `onClick={handleDownload}`
- Open external button: `onClick={handleOpenExternal}`
- Delete button: `onClick={() => setShowDeleteConfirm(true)}`

- [ ] **Step 3: Add inline delete confirmation dialog**

Before the closing tag of the component, add a modal:

```tsx
{showDeleteConfirm && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onClick={() => setShowDeleteConfirm(false)}
  >
    <div className="neu-card w-80 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
      <h3 className="mb-2 text-sm font-semibold text-white">Delete Capture?</h3>
      <p className="mb-4 text-xs text-slate-400">
        This will permanently remove the capture and its files. This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowDeleteConfirm(false)}
          className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/captures/CaptureViewer.tsx
git commit -m "Implement capture viewer download, open external, and delete actions"
```

---

### Task 13: Export Cleanup — Remove PDF Toggle

**Files:**
- Modify: `src/renderer/components/export/ExportDialog.tsx`

- [ ] **Step 1: Remove PDF format state and toggle**

- Replace `const [format, setFormat] = useState<'html' | 'pdf'>('html')` with `const format = 'html' as const`
- Delete the entire "Format" section (the div containing the HTML/PDF toggle buttons, lines 58-74)

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/export/ExportDialog.tsx
git commit -m "Remove PDF format toggle from ExportDialog"
```

---

### Task 14: CSS Cleanup — Remove Entity Graph Styles

**Files:**
- Modify: `src/renderer/styles/globals.css:87-106`

- [ ] **Step 1: Delete dead CSS**

Remove lines 87-106 (the `/* Entity graph node effects */` comment, `@keyframes glowPulse`, `@keyframes nodePulse`, `.graph-node`, `.graph-edge`, `.legend-chip`, `.cluster-card` rules).

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/globals.css
git commit -m "Remove dead entity graph CSS"
```

---

### Task 15: Fix AppStore Tests

**Files:**
- Modify: `tests/renderer/stores/appStore.test.ts`

- [ ] **Step 1: Fix invalid tab references**

- Line 72: Change `setActiveTab('entities')` to `setActiveTab('selectors')`
- Line 73: Change `toBe('entities')` to `toBe('selectors')`
- Line 92: Change `setActiveTab('entities')` to `setActiveTab('selectors')`

- [ ] **Step 2: Run test**

Run: `pnpm test -- tests/renderer/stores/appStore.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/renderer/stores/appStore.test.ts
git commit -m "Fix appStore tests to use valid tab names"
```

---

### Task 16: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update documentation**

- Line 25: Change "AI services" to "settings, export" in process model
- Lines 33-34: Remove `src/main/services/ai/` directory entry, update services description
- Line 36: Change `(Case, Capture, Tag, Entity)` to `(Case, Capture, Tag, Selector)`
- Line 40: Change `analysis` to `selectors` in component listing
- Line 52: Replace `ai:extractEntities` example with `selectors:create`
- Line 56: Update tables list to `cases, captures, tags, capture_tags, selectors, selector_matches, captures_fts`
- Lines 58-60: Replace AI services section with note that AI features are planned, OpenRouter retained

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md to reflect post-cleanup codebase"
```

---

### Task 17: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Run format**

Run: `pnpm format`
If changes: `git add -A && git commit -m "Format codebase with Prettier"`

- [ ] **Step 4: Type check (build)**

Run: `pnpm build`
Expected: No TypeScript errors

---

## Verification Checklist

After all tasks:

- [ ] `pnpm test` — all tests pass
- [ ] `pnpm lint` — no lint errors
- [ ] `pnpm build` — compiles without errors
- [ ] Grep for `Entity` in `src/` (excluding node_modules) returns no hits in active code
- [ ] Grep for `extraction_done` returns no hits
- [ ] Grep for `entityCount` returns no hits
- [ ] Grep for `sidebarWidth` returns no hits in active code
- [ ] CaseOverview shows Tags count and Selector Coverage % (not entities/AI coverage)
- [ ] CaptureViewer buttons work: download saves file, external opens browser, delete removes capture + files
- [ ] Settings panel has no Entity Extraction tab, AI config shows "Coming Soon"
- [ ] Export dialog has no PDF toggle
