# Notes per Case Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add free-text investigation notes per case, following the Hunchly-style notes workflow. Investigators can create, edit, delete, and search notes, optionally linking them to a capture.

**Architecture:** New `notes` table (migration 10) with nullable `capture_id` (ON DELETE SET NULL so notes survive capture deletion) + FTS5 external-content virtual table with sync triggers. Exposes full CRUD + search via IPC, TanStack Query, and new `/cases/$caseId/notes` route with a Notes tab in CaseWorkspace. Mirrors the existing Selectors pattern exactly. An inline modal on `CaptureViewer` lets investigators create a note pre-linked to the current capture without leaving the viewer.

**Tech Stack:** better-sqlite3 (WAL + FTS5), Electron IPC, React 19, TanStack Query v5, TanStack Router, Tailwind v4, lucide-react, vitest, Playwright.

**Key UX decisions (from clarification):**
- Screenshot capture deferred — `screenshot_path` column exists for Hunchly import, thumbnails fall back to linked capture's screenshot.
- "Add Note" from CaptureViewer → inline modal on the viewer.
- Edit notes → inline card edit (title/body become editable in-place).
- Search → always-visible debounced search input at top of NotesOverview.

---

## File Structure

### Files to create

- `src/renderer/components/notes/NotesOverview.tsx` — top container with search + list + create
- `src/renderer/components/notes/NoteCard.tsx` — display card, inline edit, delete
- `src/renderer/components/notes/CreateNoteCard.tsx` — collapsible create form
- `src/renderer/components/notes/AddNoteModal.tsx` — modal used by CaptureViewer
- `e2e/notes.spec.ts` — Playwright E2E test

### Files to modify

- `src/main/services/database.ts` — migration 10, CRUD, FTS search, capture-delete side effect update
- `src/shared/types.ts` — add `Note` interface
- `src/shared/ipc.ts` — add `NOTES_*` channels + `CreateNoteParams`/`UpdateNoteParams`
- `src/main/ipcHandlers.ts` — register notes handlers, invalidate notes query on capture delete
- `src/preload/index.ts` — add `notes` namespace
- `src/renderer/env.d.ts` — add `notes` to `BirdbrainAPI` interface
- `src/renderer/lib/queries.ts` — query keys, options, `useNotesMutations`
- `src/renderer/routes/__root.tsx` — register `notesRoute`
- `src/renderer/components/cases/CaseWorkspace.tsx` — add Notes tab with count badge
- `src/renderer/components/captures/CaptureViewer.tsx` — add "Add Note" button + render `AddNoteModal`
- `tests/main/services/database.test.ts` — add notes tests

---

## Task 1: Database — migration 10 schema + FTS

**Files:**
- Modify: `src/main/services/database.ts` — after the `if (version < 9)` block (currently ends at line 205)
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write the failing schema test**

Add a new `describe` block at the end of `tests/main/services/database.test.ts` (inside the top-level `describe('database', ...)`) — append BEFORE the closing `})` of the top-level describe:

```typescript
describe('notes schema (migration 10)', () => {
  it('creates notes table with expected columns', () => {
    const cols = getDb().prepare("PRAGMA table_info('notes')").all() as Array<{ name: string; notnull: number; dflt_value: string | null }>
    const names = cols.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'case_id',
        'capture_id',
        'title',
        'body',
        'source_url',
        'screenshot_path',
        'created_at',
        'updated_at'
      ])
    )
    // title and body have defaults and NOT NULL
    const title = cols.find((c) => c.name === 'title')!
    expect(title.notnull).toBe(1)
    expect(title.dflt_value).toBe("''")
    const body = cols.find((c) => c.name === 'body')!
    expect(body.notnull).toBe(1)
    expect(body.dflt_value).toBe("''")
    // capture_id is nullable
    const captureId = cols.find((c) => c.name === 'capture_id')!
    expect(captureId.notnull).toBe(0)
  })

  it('creates indexes on case_id and capture_id', () => {
    const idx = getDb().prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notes'").all() as Array<{ name: string }>
    const names = idx.map((i) => i.name)
    expect(names).toContain('idx_notes_case_id')
    expect(names).toContain('idx_notes_capture_id')
  })

  it('creates notes_fts virtual table', () => {
    const tbl = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'").get() as { name: string } | undefined
    expect(tbl).toBeDefined()
  })

  it('creates insert/update/delete triggers for notes_fts sync', () => {
    const triggers = getDb().prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='notes'").all() as Array<{ name: string }>
    const names = triggers.map((t) => t.name)
    expect(names).toContain('notes_ai')
    expect(names).toContain('notes_ad')
    expect(names).toContain('notes_au')
  })

  it('sets capture_id to NULL when referenced capture is deleted', () => {
    const c = createCase({ name: 'Case' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'Example',
      hash: 'abc',
      timestamp: new Date().toISOString()
    })
    // Insert a note linked to the capture using raw SQL (createNote doesn't exist yet)
    getDb()
      .prepare(
        "INSERT INTO notes (id, case_id, capture_id, title, body, source_url, screenshot_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run('note1', c.id, cap.id, 'T', 'B', 'https://example.com', null, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    // Delete the capture
    deleteCapture(cap.id)
    const row = getDb().prepare('SELECT capture_id FROM notes WHERE id = ?').get('note1') as { capture_id: string | null }
    expect(row.capture_id).toBeNull()
  })

  it('cascades delete when case is deleted', () => {
    const c = createCase({ name: 'Case' })
    getDb()
      .prepare(
        "INSERT INTO notes (id, case_id, capture_id, title, body, source_url, screenshot_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run('note2', c.id, null, 'T', 'B', null, null, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    deleteCase(c.id)
    const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get('note2')
    expect(row).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/main/services/database.test.ts -t "notes schema"`
Expected: FAIL — "no such table: notes"

- [ ] **Step 3: Add migration 10 to `src/main/services/database.ts`**

After the `if (version < 9)` block (just before the closing `}` of `function migrate`), add:

```typescript
  if (version < 10) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          capture_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          source_url TEXT,
          screenshot_path TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_case_id ON notes(case_id);
        CREATE INDEX IF NOT EXISTS idx_notes_capture_id ON notes(capture_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          title,
          body,
          content=notes,
          content_rowid=rowid
        );

        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
        END;
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
          INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
        END;
      `)
      db.pragma('user_version = 10')
    })()
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/main/services/database.test.ts -t "notes schema"`
Expected: PASS (all 6 schema tests pass)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "feat(db): add notes table schema and FTS index (migration 10)"
```

---

## Task 2: Database — Note type + CRUD functions (create, get, list, delete, count)

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/services/database.ts`
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new describe block after the `notes schema` describe in `tests/main/services/database.test.ts`:

```typescript
describe('notes CRUD', () => {
  it('creates a note with minimal params', () => {
    const c = createCase({ name: 'C' })
    const n = createNote({ caseId: c.id })
    expect(n.id).toBeDefined()
    expect(n.caseId).toBe(c.id)
    expect(n.title).toBe('')
    expect(n.body).toBe('')
    expect(n.captureId).toBeUndefined()
    expect(n.sourceUrl).toBeUndefined()
    expect(n.screenshotPath).toBeUndefined()
    expect(n.createdAt).toBeDefined()
    expect(n.updatedAt).toBe(n.createdAt)
  })

  it('creates a note with all fields', () => {
    const c = createCase({ name: 'C' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'Example',
      hash: 'abc',
      timestamp: new Date().toISOString()
    })
    const n = createNote({
      caseId: c.id,
      captureId: cap.id,
      title: 'My note',
      body: 'Observation body',
      sourceUrl: 'https://example.com',
      screenshotPath: 'path/to/shot.png'
    })
    expect(n.title).toBe('My note')
    expect(n.body).toBe('Observation body')
    expect(n.captureId).toBe(cap.id)
    expect(n.sourceUrl).toBe('https://example.com')
    expect(n.screenshotPath).toBe('path/to/shot.png')
  })

  it('retrieves a note by id', () => {
    const c = createCase({ name: 'C' })
    const created = createNote({ caseId: c.id, title: 'T', body: 'B' })
    const got = getNote(created.id)
    expect(got).toEqual(created)
  })

  it('returns undefined for missing note', () => {
    expect(getNote('nonexistent')).toBeUndefined()
  })

  it('lists notes for a case ordered by created_at DESC', async () => {
    const c = createCase({ name: 'C' })
    const first = createNote({ caseId: c.id, title: 'First' })
    await new Promise((r) => setTimeout(r, 5))
    const second = createNote({ caseId: c.id, title: 'Second' })
    const list = listNotes(c.id)
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe(second.id)
    expect(list[1].id).toBe(first.id)
  })

  it('lists only notes for the given case', () => {
    const a = createCase({ name: 'A' })
    const b = createCase({ name: 'B' })
    createNote({ caseId: a.id, title: 'A-1' })
    createNote({ caseId: b.id, title: 'B-1' })
    expect(listNotes(a.id)).toHaveLength(1)
    expect(listNotes(a.id)[0].title).toBe('A-1')
  })

  it('deletes a note', () => {
    const c = createCase({ name: 'C' })
    const n = createNote({ caseId: c.id })
    expect(deleteNote(n.id)).toBe(true)
    expect(getNote(n.id)).toBeUndefined()
  })

  it('returns false when deleting a missing note', () => {
    expect(deleteNote('nonexistent')).toBe(false)
  })

  it('counts notes for a case', () => {
    const c = createCase({ name: 'C' })
    expect(getNoteCount(c.id)).toBe(0)
    createNote({ caseId: c.id })
    createNote({ caseId: c.id })
    expect(getNoteCount(c.id)).toBe(2)
  })
})
```

At the top of the file, add these imports to the existing import from `@main/services/database`:

```typescript
createNote,
getNote,
listNotes,
deleteNote,
getNoteCount
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/main/services/database.test.ts -t "notes CRUD"`
Expected: FAIL — `createNote is not a function` (import error)

- [ ] **Step 3: Add `Note` type to `src/shared/types.ts`**

Append after the existing `Selector` interface:

```typescript
export interface Note {
  id: string
  caseId: string
  captureId?: string
  title: string
  body: string
  sourceUrl?: string
  screenshotPath?: string
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 4: Add `CreateNoteParams` / `UpdateNoteParams` to `src/shared/ipc.ts`**

Append after `UpdateSelectorParams` (around line 118):

```typescript
export interface CreateNoteParams {
  caseId: string
  captureId?: string
  title?: string
  body?: string
  sourceUrl?: string
  screenshotPath?: string
}

export interface UpdateNoteParams {
  id: string
  title?: string
  body?: string
}
```

- [ ] **Step 5: Add CRUD functions to `src/main/services/database.ts`**

At the top of the file, update the import to include `Note`:

```typescript
import type { Case, Capture, Tag, Selector, ActiveCaseSelectors, Note } from '@shared/types'
```

And add to the ipc import:

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
  UpdateNoteParams
} from '@shared/ipc'
```

Append at the end of the file (after the existing `rowToSelector` function):

```typescript
// --- Notes ---

export function listNotes(caseId: string): Note[] {
  const rows = getDb()
    .prepare('SELECT * FROM notes WHERE case_id = ? ORDER BY created_at DESC')
    .all(caseId) as Array<Record<string, unknown>>
  return rows.map(rowToNote)
}

export function getNote(id: string): Note | undefined {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToNote(row) : undefined
}

export function createNote(params: CreateNoteParams): Note {
  const id = uuid()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO notes (id, case_id, capture_id, title, body, source_url, screenshot_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.caseId,
      params.captureId ?? null,
      params.title ?? '',
      params.body ?? '',
      params.sourceUrl ?? null,
      params.screenshotPath ?? null,
      now,
      now
    )
  return getNote(id)!
}

export function deleteNote(id: string): boolean {
  const result = getDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
  return result.changes > 0
}

export function getNoteCount(caseId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM notes WHERE case_id = ?')
    .get(caseId) as { count: number }
  return row.count
}

function rowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    captureId: (row.capture_id as string) || undefined,
    title: row.title as string,
    body: row.body as string,
    sourceUrl: (row.source_url as string) || undefined,
    screenshotPath: (row.screenshot_path as string) || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/main/services/database.test.ts -t "notes CRUD"`
Expected: PASS (all 9 CRUD tests pass)

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "feat(db): add Note type and CRUD functions"
```

---

## Task 3: Database — updateNote function

**Files:**
- Modify: `src/main/services/database.ts`
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write failing test**

Add inside the existing `notes CRUD` describe block:

```typescript
it('updates a note title and body', async () => {
  const c = createCase({ name: 'C' })
  const n = createNote({ caseId: c.id, title: 'old', body: 'old body' })
  await new Promise((r) => setTimeout(r, 5))
  const updated = updateNote({ id: n.id, title: 'new', body: 'new body' })
  expect(updated?.title).toBe('new')
  expect(updated?.body).toBe('new body')
  expect(updated?.updatedAt).not.toBe(n.updatedAt)
  expect(updated?.createdAt).toBe(n.createdAt)
})

it('preserves unset fields on update', () => {
  const c = createCase({ name: 'C' })
  const n = createNote({ caseId: c.id, title: 'keep', body: 'original' })
  const updated = updateNote({ id: n.id, body: 'new body only' })
  expect(updated?.title).toBe('keep')
  expect(updated?.body).toBe('new body only')
})

it('returns undefined when updating a missing note', () => {
  expect(updateNote({ id: 'nonexistent', title: 'x' })).toBeUndefined()
})
```

Add `updateNote` to the imports at the top of `tests/main/services/database.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/main/services/database.test.ts -t "updates a note"`
Expected: FAIL — `updateNote is not a function`

- [ ] **Step 3: Add `updateNote` to `src/main/services/database.ts`**

First, add `UpdateNoteParams` back to the `@shared/ipc` import (it was deferred from Task 2 because it would have been an unused import):

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
  UpdateNoteParams
} from '@shared/ipc'
```

Then insert after `createNote` in the Notes section:

```typescript
export function updateNote(params: UpdateNoteParams): Note | undefined {
  const existing = getNote(params.id)
  if (!existing) return undefined
  const now = new Date().toISOString()
  getDb()
    .prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(
      params.title !== undefined ? params.title : existing.title,
      params.body !== undefined ? params.body : existing.body,
      now,
      params.id
    )
  return getNote(params.id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/main/services/database.test.ts -t "notes CRUD"`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "feat(db): add updateNote function"
```

---

## Task 4: Database — searchNotes via FTS5

**Files:**
- Modify: `src/main/services/database.ts`
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write failing test**

Add a new describe block after `notes CRUD`:

```typescript
describe('notes search (FTS)', () => {
  it('finds notes matching a query in body', () => {
    const c = createCase({ name: 'C' })
    createNote({ caseId: c.id, title: 'alpha', body: 'mentions something interesting' })
    createNote({ caseId: c.id, title: 'beta', body: 'unrelated content' })
    const results = searchNotes(c.id, 'interesting')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('alpha')
  })

  it('finds notes matching a query in title', () => {
    const c = createCase({ name: 'C' })
    createNote({ caseId: c.id, title: 'zebra report', body: 'body' })
    createNote({ caseId: c.id, title: 'other', body: 'body' })
    const results = searchNotes(c.id, 'zebra')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('zebra report')
  })

  it('scopes search to the given case', () => {
    const a = createCase({ name: 'A' })
    const b = createCase({ name: 'B' })
    createNote({ caseId: a.id, title: 'term', body: 'x' })
    createNote({ caseId: b.id, title: 'term', body: 'x' })
    const results = searchNotes(a.id, 'term')
    expect(results).toHaveLength(1)
    expect(results[0].caseId).toBe(a.id)
  })

  it('returns empty array for empty query', () => {
    const c = createCase({ name: 'C' })
    createNote({ caseId: c.id, title: 'x', body: 'y' })
    expect(searchNotes(c.id, '')).toEqual([])
  })

  it('reflects updates via FTS triggers', () => {
    const c = createCase({ name: 'C' })
    const n = createNote({ caseId: c.id, title: 'original', body: 'body' })
    updateNote({ id: n.id, title: 'changed' })
    expect(searchNotes(c.id, 'original')).toHaveLength(0)
    expect(searchNotes(c.id, 'changed')).toHaveLength(1)
  })

  it('reflects deletes via FTS triggers', () => {
    const c = createCase({ name: 'C' })
    const n = createNote({ caseId: c.id, title: 'temp', body: 'body' })
    expect(searchNotes(c.id, 'temp')).toHaveLength(1)
    deleteNote(n.id)
    expect(searchNotes(c.id, 'temp')).toHaveLength(0)
  })
})
```

Add `searchNotes` to the imports at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/main/services/database.test.ts -t "notes search"`
Expected: FAIL — `searchNotes is not a function`

- [ ] **Step 3: Add `searchNotes` to `src/main/services/database.ts`**

Insert after `getNoteCount` in the Notes section:

```typescript
export function searchNotes(caseId: string, query: string): Note[] {
  if (!query.trim()) return []
  const rows = getDb()
    .prepare(
      `SELECT n.* FROM notes n
       JOIN notes_fts ON notes_fts.rowid = n.rowid
       WHERE notes_fts MATCH ? AND n.case_id = ?
       ORDER BY rank`
    )
    .all(query, caseId) as Array<Record<string, unknown>>
  return rows.map(rowToNote)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/main/services/database.test.ts -t "notes search"`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "feat(db): add FTS-powered searchNotes function"
```

---

## Task 5: IPC — channels, handlers

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipcHandlers.ts`
- Test: (covered by database tests; renderer tests come later)

- [ ] **Step 1: Add NOTES channels to `src/shared/ipc.ts`**

After the `SELECTORS_*` block (line 58, after `SELECTORS_COVERAGE`), add:

```typescript
  // Notes
  NOTES_LIST: 'notes:list',
  NOTES_GET: 'notes:get',
  NOTES_CREATE: 'notes:create',
  NOTES_UPDATE: 'notes:update',
  NOTES_DELETE: 'notes:delete',
  NOTES_COUNT: 'notes:count',
  NOTES_SEARCH: 'notes:search',
```

- [ ] **Step 2: Register handlers in `src/main/ipcHandlers.ts`**

Add `CreateNoteParams` and `UpdateNoteParams` to the import at the top:

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
  UpdateNoteParams
} from '@shared/ipc'
```

After the `SELECTORS_COVERAGE` handler (around line 273), add:

```typescript
  // Notes
  ipcMain.handle(IPC_CHANNELS.NOTES_LIST, (_, caseId: string) => db.listNotes(caseId))
  ipcMain.handle(IPC_CHANNELS.NOTES_GET, (_, id: string) => db.getNote(id))
  ipcMain.handle(IPC_CHANNELS.NOTES_CREATE, (_, params: CreateNoteParams) => {
    try {
      return ipcResult(db.createNote(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOTES_UPDATE, (_, params: UpdateNoteParams) => {
    try {
      return ipcResult(db.updateNote(params))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOTES_DELETE, (_, id: string) => {
    try {
      return ipcResult(db.deleteNote(id))
    } catch (err) {
      return ipcError(err)
    }
  })
  ipcMain.handle(IPC_CHANNELS.NOTES_COUNT, (_, caseId: string) => db.getNoteCount(caseId))
  ipcMain.handle(IPC_CHANNELS.NOTES_SEARCH, (_, caseId: string, query: string) =>
    db.searchNotes(caseId, query)
  )
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc.ts src/main/ipcHandlers.ts
git commit -m "feat(ipc): add notes IPC channels and handlers"
```

---

## Task 6: Preload bridge + window.birdbrain.notes type

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`

- [ ] **Step 1: Add `notes` namespace to `src/preload/index.ts`**

Add `CreateNoteParams` and `UpdateNoteParams` to the ipc imports (around line 4):

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
  UpdateNoteParams
} from '@shared/ipc'
```

Add `Note` to the types import (around line 13):

```typescript
import type {
  Case,
  Capture,
  Tag,
  BirdbrainSettings,
  OpenRouterModel,
  ExportOptions,
  Selector,
  ActiveCaseSelectors,
  CaptureEvent,
  Note
} from '@shared/types'
```

After the `selectors: { ... }` namespace (around line 113, before `search:`), add:

```typescript
  notes: {
    list: (caseId: string): Promise<Note[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_LIST, caseId),
    get: (id: string): Promise<Note | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_GET, id),
    create: (params: CreateNoteParams): Promise<Note> =>
      unwrapIpc<Note>(ipcRenderer.invoke(IPC_CHANNELS.NOTES_CREATE, params)),
    update: (params: UpdateNoteParams): Promise<Note | undefined> =>
      unwrapIpc<Note | undefined>(ipcRenderer.invoke(IPC_CHANNELS.NOTES_UPDATE, params)),
    delete: (id: string): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.NOTES_DELETE, id)),
    count: (caseId: string): Promise<number> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_COUNT, caseId),
    search: (caseId: string, query: string): Promise<Note[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTES_SEARCH, caseId, query)
  },
```

- [ ] **Step 2: Add `notes` to `BirdbrainAPI` in `src/renderer/env.d.ts`**

Add `Note` to the types import (around line 1):

```typescript
import type {
  Case,
  Capture,
  Tag,
  BirdbrainSettings,
  OpenRouterModel,
  ExportOptions,
  Selector,
  ActiveCaseSelectors,
  CaptureEvent,
  Note
} from '@shared/types'
```

Add `CreateNoteParams` / `UpdateNoteParams`:

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
  UpdateNoteParams
} from '@shared/ipc'
```

After the `selectors: { ... }` block in the `BirdbrainAPI` interface (around line 64), add:

```typescript
  notes: {
    list(caseId: string): Promise<Note[]>
    get(id: string): Promise<Note | undefined>
    create(params: CreateNoteParams): Promise<Note>
    update(params: UpdateNoteParams): Promise<Note | undefined>
    delete(id: string): Promise<boolean>
    count(caseId: string): Promise<number>
    search(caseId: string, query: string): Promise<Note[]>
  }
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(preload): expose notes API on window.birdbrain"
```

---

## Task 7: TanStack Query — keys, options, mutations

**Files:**
- Modify: `src/renderer/lib/queries.ts`

- [ ] **Step 1: Add imports and query keys**

Update the import at the top of `src/renderer/lib/queries.ts`:

```typescript
import type {
  CreateCaseParams,
  UpdateCaseParams,
  CreateTagParams,
  UpdateTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams
} from '@shared/ipc'
```

Add entries to the `queryKeys` object after `search`:

```typescript
  notes: (caseId: string) => ['notes', caseId] as const,
  noteCount: (caseId: string) => ['notes', 'count', caseId] as const,
  notesSearch: (caseId: string, query: string) => ['notes', 'search', caseId, query] as const
```

(Add a comma after `search: (query: string) => ['search', query] as const` and remember no trailing comma on the last line per project style.)

- [ ] **Step 2: Add query options and mutations at the end of the file**

Append:

```typescript
// --- Notes ---

export const notesQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.notes(caseId),
    queryFn: () => window.birdbrain.notes.list(caseId),
    enabled: !!caseId
  })

export const noteCountQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.noteCount(caseId),
    queryFn: () => window.birdbrain.notes.count(caseId),
    enabled: !!caseId
  })

export const notesSearchQueryOptions = (caseId: string, query: string) =>
  queryOptions({
    queryKey: queryKeys.notesSearch(caseId, query),
    queryFn: () => window.birdbrain.notes.search(caseId, query),
    enabled: !!caseId && query.trim().length > 0
  })

export function useNotesMutations(caseId: string) {
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: (params: CreateNoteParams) => window.birdbrain.notes.create(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.noteCount(caseId) })
    }
  })

  const update = useMutation({
    mutationFn: (params: UpdateNoteParams) => window.birdbrain.notes.update(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(caseId) })
    }
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.notes.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.noteCount(caseId) })
    }
  })

  return { create, update, remove }
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/lib/queries.ts
git commit -m "feat(queries): add notes TanStack Query keys, options, and mutations"
```

---

## Task 8: NoteCard component (display + inline edit + delete)

**Files:**
- Create: `src/renderer/components/notes/NoteCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useEffect } from 'react'
import { StickyNote, Pencil, Trash2, ExternalLink, X, Check } from 'lucide-react'
import type { Note } from '@shared/types'
import { useNotesMutations } from '@renderer/lib/queries'

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  return new Date(ts).toLocaleString()
}

interface NoteCardProps {
  note: Note
  caseId: string
}

export function NoteCard({ note, caseId }: NoteCardProps) {
  const { update, remove } = useNotesMutations(caseId)
  const [isEditing, setIsEditing] = useState(false)
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setTitle(note.title)
    setBody(note.body)
  }, [note.title, note.body])

  useEffect(() => {
    if (!note.captureId || note.screenshotPath) return
    window.birdbrain.captures
      .getThumbnail(note.captureId)
      .then(setThumbnail)
      .catch(() => setThumbnail(null))
  }, [note.captureId, note.screenshotPath])

  async function handleSave() {
    await update.mutateAsync({ id: note.id, title, body })
    setIsEditing(false)
  }

  function handleCancel() {
    setTitle(note.title)
    setBody(note.body)
    setIsEditing(false)
  }

  async function handleDelete() {
    await remove.mutateAsync(note.id)
  }

  async function handleOpenUrl() {
    if (note.sourceUrl) {
      await window.birdbrain.captures.openExternal(note.sourceUrl)
    }
  }

  const displayTitle = note.title || '(Untitled note)'
  const thumbSrc = thumbnail ? `data:image/png;base64,${thumbnail}` : null

  return (
    <div
      data-testid={`note-card-${note.id}`}
      className="flex gap-3 rounded-2xl border border-border bg-surface p-4"
    >
      <div className="shrink-0">
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt=""
            className="h-20 w-28 rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-border bg-elevated text-text-muted">
            <StickyNote className="h-5 w-5" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="space-y-2">
            <input
              data-testid="note-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm font-semibold text-text-primary"
            />
            <textarea
              data-testid="note-body-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Note body"
              rows={4}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text-secondary"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-muted hover:bg-elevated"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                data-testid="note-save"
                onClick={handleSave}
                disabled={update.isPending}
                className="flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-xs font-medium text-canvas hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <h3 className="flex-1 truncate font-display text-sm font-semibold text-text-primary">
                {displayTitle}
              </h3>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  data-testid="note-edit"
                  onClick={() => setIsEditing(true)}
                  title="Edit note"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {confirmDelete ? (
                  <>
                    <button
                      data-testid="note-confirm-delete"
                      onClick={handleDelete}
                      className="rounded-lg bg-red-500/10 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/20"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-lg px-2 py-1 text-[11px] text-text-muted hover:bg-elevated"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    data-testid="note-delete"
                    onClick={() => setConfirmDelete(true)}
                    title="Delete note"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
              <span>{formatRelative(note.createdAt)}</span>
              {note.sourceUrl && (
                <>
                  <span className="text-text-faint">·</span>
                  <button
                    onClick={handleOpenUrl}
                    className="flex items-center gap-1 truncate hover:text-text-primary"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="truncate">{note.sourceUrl}</span>
                  </button>
                </>
              )}
            </div>

            {note.body && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{note.body}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/notes/NoteCard.tsx
git commit -m "feat(notes): add NoteCard component with inline edit and delete"
```

---

## Task 9: CreateNoteCard component

**Files:**
- Create: `src/renderer/components/notes/CreateNoteCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useNotesMutations } from '@renderer/lib/queries'

interface CreateNoteCardProps {
  caseId: string
  isOpen: boolean
  onToggle: () => void
  onCreated?: () => void
}

export function CreateNoteCard({ caseId, isOpen, onToggle, onCreated }: CreateNoteCardProps) {
  const { create } = useNotesMutations(caseId)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  async function handleSubmit() {
    if (!title.trim() && !body.trim()) return
    await create.mutateAsync({
      caseId,
      title: title.trim(),
      body: body.trim()
    })
    setTitle('')
    setBody('')
    onCreated?.()
  }

  if (!isOpen) {
    return (
      <button
        data-testid="notes-new-button"
        onClick={onToggle}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface px-4 py-3 text-sm font-medium text-text-muted hover:border-accent hover:text-accent"
      >
        <Plus className="h-4 w-4" />
        New note
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-text-primary">New note</h3>
        <button
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        data-testid="create-note-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="mb-2 w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm font-semibold text-text-primary"
      />
      <textarea
        data-testid="create-note-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Note body"
        rows={4}
        className="mb-3 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text-secondary"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onToggle}
          className="rounded-lg px-3 py-1.5 text-xs text-text-muted hover:bg-elevated"
        >
          Cancel
        </button>
        <button
          data-testid="create-note-submit"
          onClick={handleSubmit}
          disabled={(!title.trim() && !body.trim()) || create.isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas hover:opacity-90 disabled:opacity-50"
        >
          {create.isPending ? 'Saving...' : 'Save note'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/notes/CreateNoteCard.tsx
git commit -m "feat(notes): add CreateNoteCard component"
```

---

## Task 10: NotesOverview component with search

**Files:**
- Create: `src/renderer/components/notes/NotesOverview.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useEffect } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { notesQueryOptions, notesSearchQueryOptions } from '@renderer/lib/queries'
import { NoteCard } from './NoteCard'
import { CreateNoteCard } from './CreateNoteCard'

export function NotesOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/notes' })
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data: allNotes = [], isLoading } = useQuery(notesQueryOptions(caseId))
  const { data: searchResults = [] } = useQuery(notesSearchQueryOptions(caseId, debouncedQuery))

  const notes = debouncedQuery.length > 0 ? searchResults : allNotes

  if (isLoading) {
    return <div className="text-text-muted">Loading notes...</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-8 py-6 pb-16">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          data-testid="notes-search"
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search notes..."
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
        />
      </div>

      <CreateNoteCard
        caseId={caseId}
        isOpen={showCreateForm}
        onToggle={() => setShowCreateForm((v) => !v)}
        onCreated={() => setShowCreateForm(false)}
      />

      {notes.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">
          {debouncedQuery.length > 0
            ? `No notes match "${debouncedQuery}"`
            : 'No notes yet. Create one to record observations.'}
        </p>
      ) : (
        <div data-testid="notes-list" className="space-y-3">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} caseId={caseId} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/notes/NotesOverview.tsx
git commit -m "feat(notes): add NotesOverview with search, list, and create"
```

---

## Task 11: Register notes route + Notes tab in CaseWorkspace

**Files:**
- Modify: `src/renderer/routes/__root.tsx`
- Modify: `src/renderer/components/cases/CaseWorkspace.tsx`

- [ ] **Step 1: Register `notesRoute` in `src/renderer/routes/__root.tsx`**

Add import at the top:

```typescript
import { NotesOverview } from '@renderer/components/notes/NotesOverview'
```

After the `selectorsRoute` definition (line 84), add:

```typescript
// Notes tab
const notesRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/notes',
  component: NotesOverview
})
```

Update the route tree (line 91):

```typescript
caseRoute.addChildren([caseIndexRoute, capturesRoute, selectorsRoute, notesRoute])
```

- [ ] **Step 2: Add Notes tab with count badge to `src/renderer/components/cases/CaseWorkspace.tsx`**

Replace the file contents with:

```tsx
import { useEffect } from 'react'
import { useParams, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  casesQueryOptions,
  capturesQueryOptions,
  noteCountQueryOptions
} from '@renderer/lib/queries'
import { useSelectorFilters } from '@renderer/hooks/useSelectorFilters'
import { LayoutDashboard, Layers, Crosshair, StickyNote } from 'lucide-react'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

type CaseTab = 'overview' | 'captures' | 'selectors' | 'notes'

const tabs: { id: CaseTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'captures', label: 'Captures', icon: Layers },
  { id: 'selectors', label: 'Selectors', icon: Crosshair },
  { id: 'notes', label: 'Notes', icon: StickyNote }
]

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
  }
}

export function CaseWorkspace() {
  const { caseId } = useParams({ from: '/cases/$caseId' })
  const matchRoute = useMatchRoute()
  const { data: cases = [], isLoading } = useQuery(casesQueryOptions)
  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
  const { data: noteCount = 0 } = useQuery(noteCountQueryOptions(caseId))

  useSelectorFilters(caseId)

  // Activate case on the capture server when entering workspace
  useEffect(() => {
    if (caseId) {
      fetch(`${CAPTURE_SERVER_BASE_URL}/api/cases/${caseId}/activate`, { method: 'POST' }).catch(
        (err) => console.error('Failed to activate case on server:', err)
      )
    }
  }, [caseId])

  const activeCase = cases.find((c) => c.id === caseId)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">Loading case...</div>
    )
  }

  if (!activeCase) return null

  const isCaptures = matchRoute({ to: '/cases/$caseId/captures', fuzzy: true }) !== false
  const isSelectors = matchRoute({ to: '/cases/$caseId/selectors', fuzzy: true }) !== false
  const isNotes = matchRoute({ to: '/cases/$caseId/notes', fuzzy: true }) !== false

  function isTabActive(tab: CaseTab): boolean {
    if (tab === 'overview') return !isCaptures && !isSelectors && !isNotes
    if (tab === 'captures') return isCaptures
    if (tab === 'selectors') return isSelectors
    return isNotes
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="h-11 shrink-0 flex items-end gap-0.5 border-b px-5 bg-surface border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = isTabActive(tab.id)
          const badgeCount =
            tab.id === 'captures' ? captures.length : tab.id === 'notes' ? noteCount : null
          return (
            <Link
              key={tab.id}
              to={tabPath(tab.id)}
              params={{ caseId: caseId }}
              className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-accent-subtle font-semibold text-accent'
                  : 'text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {badgeCount !== null && (
                <span
                  data-testid={`tab-badge-${tab.id}`}
                  className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    isActive ? 'bg-accent-subtle text-accent' : 'bg-elevated text-text-muted'
                  }`}
                >
                  {badgeCount}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Tab content */}
      {isCaptures ? (
        <Outlet />
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify build & typecheck pass**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/routes/__root.tsx src/renderer/components/cases/CaseWorkspace.tsx
git commit -m "feat(notes): add Notes tab with count badge and route"
```

---

## Task 12: "Add Note" inline modal on CaptureViewer

**Files:**
- Create: `src/renderer/components/notes/AddNoteModal.tsx`
- Modify: `src/renderer/components/captures/CaptureViewer.tsx`

- [ ] **Step 1: Create `AddNoteModal` component**

```tsx
import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useNotesMutations } from '@renderer/lib/queries'

interface AddNoteModalProps {
  open: boolean
  caseId: string
  captureId: string
  captureTitle: string
  captureUrl: string
  onClose: () => void
}

export function AddNoteModal({
  open,
  caseId,
  captureId,
  captureTitle,
  captureUrl,
  onClose
}: AddNoteModalProps) {
  const { create } = useNotesMutations(caseId)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  useEffect(() => {
    if (open) {
      setTitle(captureTitle)
      setBody('')
    }
  }, [open, captureTitle])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  async function handleSave() {
    if (!title.trim() && !body.trim()) return
    await create.mutateAsync({
      caseId,
      captureId,
      title: title.trim(),
      body: body.trim(),
      sourceUrl: captureUrl
    })
    onClose()
  }

  return (
    <div
      data-testid="add-note-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-text-primary">Add note</h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <input
          data-testid="add-note-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mb-2 w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm font-semibold text-text-primary"
        />
        <textarea
          data-testid="add-note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What did you observe?"
          rows={5}
          autoFocus
          className="mb-3 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text-secondary"
        />
        <div className="mb-3 truncate text-[11px] text-text-muted">Linked to: {captureUrl}</div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-text-muted hover:bg-elevated"
          >
            Cancel
          </button>
          <button
            data-testid="add-note-submit"
            onClick={handleSave}
            disabled={(!title.trim() && !body.trim()) || create.isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas hover:opacity-90 disabled:opacity-50"
          >
            {create.isPending ? 'Saving...' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the modal into `CaptureViewer.tsx`**

Add to the lucide-react import (currently includes Plus at line 21):

```typescript
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Download,
  ExternalLink,
  Trash2,
  Image,
  Globe,
  Code,
  FileText,
  Info,
  Tag as TagIcon,
  Plus,
  StickyNote
} from 'lucide-react'
```

Add import at the top:

```typescript
import { AddNoteModal } from '@renderer/components/notes/AddNoteModal'
```

After the existing `useState` declarations (around line 68), add:

```typescript
const [showAddNote, setShowAddNote] = useState(false)
```

In the "Right side actions" div (starting at line 211), add a new button BEFORE the Download button:

```tsx
          <button
            data-testid="add-note-button"
            onClick={() => setShowAddNote(true)}
            title="Add note"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
          >
            <StickyNote className="h-3.5 w-3.5" />
          </button>
```

At the bottom of the component, just before the final closing `</main>` tag, render the modal:

```tsx
      <AddNoteModal
        open={showAddNote}
        caseId={caseId}
        captureId={capture.id}
        captureTitle={capture.title || ''}
        captureUrl={capture.url}
        onClose={() => setShowAddNote(false)}
      />
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/notes/AddNoteModal.tsx src/renderer/components/captures/CaptureViewer.tsx
git commit -m "feat(notes): add 'Add note' modal to CaptureViewer"
```

---

## Task 13: E2E test for notes workflow

**Files:**
- Create: `e2e/notes.spec.ts`

- [ ] **Step 1: Write E2E test**

The project uses a Playwright fixture `./fixtures/electronApp` which provides a `page` that is already connected to the Electron app. See `e2e/cases.spec.ts` for the canonical pattern — create cases via the UI wizard using `data-testid` selectors, then navigate via clicks.

Create `e2e/notes.spec.ts`:

```typescript
import { test, expect } from './fixtures/electronApp'

test.describe('Notes', () => {
  test('create, edit, search, and delete a note', async ({ page }) => {
    // Create a case via the dashboard wizard
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Notes E2E Case')
    await page.click('[data-testid="case-create-btn"]')
    await expect(page.getByRole('heading', { name: 'Notes E2E Case' })).toBeVisible()

    // Click the Notes tab
    await page.getByRole('link', { name: 'Notes' }).click()

    // The tab badge should exist and show 0 initially
    await expect(page.getByTestId('tab-badge-notes')).toHaveText('0')

    // Create a note
    await page.getByTestId('notes-new-button').click()
    await page.getByTestId('create-note-title').fill('Observation one')
    await page.getByTestId('create-note-body').fill('Something interesting about the target')
    await page.getByTestId('create-note-submit').click()

    // Note should appear and badge should update
    await expect(page.getByTestId('notes-list')).toBeVisible()
    await expect(page.getByText('Observation one')).toBeVisible()
    await expect(page.getByText('Something interesting about the target')).toBeVisible()
    await expect(page.getByTestId('tab-badge-notes')).toHaveText('1')

    // Edit the note
    await page.getByTestId('note-edit').first().click()
    await page.getByTestId('note-title-input').fill('Renamed note')
    await page.getByTestId('note-save').click()
    await expect(page.getByText('Renamed note')).toBeVisible()

    // Search for a matching term
    await page.getByTestId('notes-search').fill('interesting')
    await expect(page.getByText('Renamed note')).toBeVisible()

    // Search for a non-matching term — empty state visible
    await page.getByTestId('notes-search').fill('nomatchxyz')
    await expect(page.getByText(/No notes match/)).toBeVisible()

    // Clear search — full list returns
    await page.getByTestId('notes-search').fill('')
    await expect(page.getByText('Renamed note')).toBeVisible()

    // Delete the note (requires confirmation)
    await page.getByTestId('note-delete').first().click()
    await page.getByTestId('note-confirm-delete').click()
    await expect(page.getByText('Renamed note')).not.toBeVisible()
    await expect(page.getByTestId('tab-badge-notes')).toHaveText('0')
  })
})
```

- [ ] **Step 2: Build the app**

Run: `pnpm build`
Expected: successful build

- [ ] **Step 3: Run the E2E test**

Run: `pnpm test:e2e notes.spec.ts`
Expected: PASS

If the test fails due to a debounced search input not updating fast enough, wrap the `expect(...)` calls after `page.getByTestId('notes-search').fill(...)` with a longer timeout, e.g. `{ timeout: 2000 }`.

- [ ] **Step 4: Commit**

```bash
git add e2e/notes.spec.ts
git commit -m "test(notes): add E2E test for notes workflow"
```

---

## Task 14: Final verification (lint, typecheck, full test suite)

**Files:** none (verification step)

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: no errors

Fix any linting issues before proceeding.

- [ ] **Step 2: Format**

Run: `pnpm format`
Expected: files may be reformatted

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Run full unit test suite**

Run: `pnpm test`
Expected: all tests pass, including new notes tests

- [ ] **Step 5: Run full E2E test suite**

Run: `pnpm test:e2e`
Expected: all E2E tests pass

- [ ] **Step 6: Smoke-test the app manually**

Run: `pnpm dev`

Manual checklist:
- Create a new case
- Navigate to its Notes tab — tab count badge shows 0
- Click "New note" → create a note with title and body → appears in list
- Edit the note → title/body update
- Search by a word in the body → list filters
- Clear search → full list returns
- Navigate to Captures, add a capture (via extension or test pipeline), open CaptureViewer
- Click the sticky-note icon in the capture viewer header → modal opens with title pre-filled
- Save → note is created, modal closes
- Navigate back to Notes → count badge updated, new note visible with source URL
- Delete the linked capture → note remains in the list, but without the linked capture thumbnail
- Delete the note → it disappears

- [ ] **Step 7: Final commit (if any format/lint fixes were applied)**

```bash
git status
# if there are changes:
git add -A
git commit -m "chore: format and lint fixes"
```

---

## Acceptance Criteria Checklist

From the GitHub issue:

- [ ] `notes` table created via migration 10 with proper foreign keys, indexes, and `screenshot_path` column ✓ (Task 1)
- [ ] `notes_fts` FTS5 virtual table created with sync triggers for title and body ✓ (Task 1)
- [ ] `Note` type exported from `src/shared/types.ts` (includes `screenshotPath` field) ✓ (Task 2)
- [ ] IPC channels defined: `notes:list`, `notes:get`, `notes:create`, `notes:update`, `notes:delete`, `notes:count`, `notes:search` ✓ (Task 5)
- [ ] IPC handlers registered in `src/main/ipcHandlers.ts` ✓ (Task 5)
- [ ] Preload bridge exposes `window.birdbrain.notes.*` methods ✓ (Task 6)
- [ ] TanStack Query keys, options, and mutations defined in `src/renderer/lib/queries.ts` ✓ (Task 7)
- [ ] Notes tab appears in `CaseWorkspace` with count badge ✓ (Task 11)
- [ ] Route `/cases/$caseId/notes` renders `NotesOverview` ✓ (Task 11)
- [ ] Can create a note (with or without a linked capture) ✓ (Task 9, 12)
- [ ] Can edit a note title and body ✓ (Task 8)
- [ ] Can delete a note with confirmation ✓ (Task 8)
- [ ] Notes display screenshot thumbnail (linked capture screenshot fallback) ✓ (Task 8)
- [ ] Notes persist across app restarts (SQLite storage) ✓ (Task 1, 2)
- [ ] Deleting a capture sets linked notes `capture_id` to NULL (notes survive) ✓ (Task 1)
- [ ] Search within notes uses FTS5 and filters by title and body ✓ (Task 4, 10)
- [ ] "Add Note" action available from capture detail view ✓ (Task 12)
- [ ] Schema supports Hunchly import (`screenshot_path` column, `title DEFAULT ''`) ✓ (Task 1)
- [ ] Existing tests continue to pass ✓ (Task 14)

**Deferred (explicitly chosen during clarification):**
- In-app screenshot capture at note-creation time — column exists for Hunchly import, no capture mechanism built yet.

**Migration version note:** The issue says "Migration 9" but the codebase is already at `user_version = 9` (migration 9 added `capture_favorites`). This plan uses **migration 10**.
