# Capture Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add screenshot annotation (rect, arrow, highlight, redact-solid, numbered pin) to the `CaptureViewer` Screenshot tab. Annotations are stored as vector JSON and burned into the export PNG by the main process via `sharp` + SVG composite, leaving the original screenshot and hash chain untouched.

**Architecture:** Migration v17 adds `annotations` and `annotation_pins` tables. A new main-process service `annotations.ts` exposes CRUD over IPC. Renderer uses `react-konva` for an in-image-space `<Stage>` shared between view and edit modes. Export integration substitutes the burned PNG into the existing single-file HTML export.

**Tech Stack:** TypeScript, better-sqlite3, Electron IPC, React 19, react-konva + konva + use-image, sharp, vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-04-25-capture-annotation-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/services/database.ts` | Modify | Bump `LATEST_SCHEMA_VERSION` to 17; add v17 migration block |
| `src/main/services/annotations.ts` | Create | CRUD for annotations + pins; pin number allocation in transaction |
| `src/main/services/renderAnnotationsSvg.ts` | Create | Pure function: shapes -> SVG string sized to image dims |
| `src/main/services/burnAnnotations.ts` | Create | sharp composite of SVG over PNG buffer; returns burned PNG buffer |
| `src/main/services/export.ts` | Modify | Read annotations + pins; substitute burned PNG; render pin legend |
| `src/main/ipcHandlers.ts` | Modify | Register `annotations:*` channels |
| `src/preload/index.ts` | Modify | Add `window.birdbrain.annotations` bridge |
| `src/shared/types.ts` | Modify | Add `AnnotationShape`, `CaptureAnnotations`, `AnnotationPin`, extend `ExportOptions.include` |
| `src/shared/ipc.ts` | Modify | Add `ANNOTATIONS_*` channel constants and named param types |
| `src/renderer/lib/queries.ts` | Modify | Add `queryKeys.annotations`, `annotationsQueryOptions`, `useAnnotationsMutations` |
| `src/renderer/components/captures/annotation/AnnotationCanvas.tsx` | Create | Shared Konva Stage; renders shapes in view or edit mode |
| `src/renderer/components/captures/annotation/AnnotationToolbar.tsx` | Create | Tool picker + color/stroke + undo/redo |
| `src/renderer/components/captures/annotation/AnnotationEditor.tsx` | Create | Composes canvas + toolbar + popover + editor hook + shortcuts |
| `src/renderer/components/captures/annotation/PinCommentPopover.tsx` | Create | Body editor for a numbered pin |
| `src/renderer/components/captures/annotation/shapes/RectShape.tsx` | Create | Rect + highlight (translucent) renderer |
| `src/renderer/components/captures/annotation/shapes/ArrowShape.tsx` | Create | Arrow renderer (move-only, no resize) |
| `src/renderer/components/captures/annotation/shapes/RedactShape.tsx` | Create | Solid black rect |
| `src/renderer/components/captures/annotation/shapes/PinShape.tsx` | Create | Numbered circle |
| `src/renderer/components/captures/annotation/useAnnotationEditor.ts` | Create | Tool/draft/undo/redo state + last-used-style persistence |
| `src/renderer/components/captures/annotation/keyboardShortcuts.ts` | Create | Esc/Delete/Ctrl+Z/Ctrl+Shift+Z/V/R/A/H/X/P bindings |
| `src/renderer/components/captures/CaptureViewer.tsx` | Modify | Wire view/edit toggle into Screenshot tab |
| `tests/main/services/annotations.test.ts` | Create | Unit tests for service |
| `tests/main/services/renderAnnotationsSvg.test.ts` | Create | Unit tests for SVG generator |
| `tests/main/services/burnAnnotations.test.ts` | Create | Unit tests for sharp composite (pixel sampling) |
| `tests/main/services/database.test.ts` | Modify | Add migration v17 schema test block |
| `tests/main/services/export.test.ts` | Modify | Add `include.annotations: 'burned'` test |
| `tests/renderer/components/useAnnotationEditor.test.ts` | Create | Editor hook tests |
| `e2e/annotation.spec.ts` | Create | E2E: draw, persist, reload |

---

The remainder of this plan is split into per-task sections appended below.

## Task 1: Migration v17 — `annotations` and `annotation_pins` tables

**Files:**
- Modify: `src/main/services/database.ts:31` and after the v16 block
- Modify: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write the failing migration test**

Append to `tests/main/services/database.test.ts` after the existing `describe('notes schema (migration 10)', ...)` block:

```typescript
describe('annotations schema (migration 17)', () => {
  it('LATEST_SCHEMA_VERSION is 17', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(17)
  })

  it('creates annotations table with expected columns', () => {
    const cols = getDb().prepare("PRAGMA table_info('annotations')").all() as Array<{
      name: string
    }>
    const names = cols.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'capture_id',
        'schema_version',
        'shapes_json',
        'image_width',
        'image_height',
        'updated_at',
        'updated_by'
      ])
    )
  })

  it('creates annotation_pins table with expected columns', () => {
    const cols = getDb().prepare("PRAGMA table_info('annotation_pins')").all() as Array<{
      name: string
    }>
    const names = cols.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining(['id', 'capture_id', 'number', 'body', 'created_at', 'updated_at'])
    )
  })

  it('creates expected indexes on annotation_pins', () => {
    const idx = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='annotation_pins'")
      .all() as Array<{ name: string }>
    const names = idx.map((i) => i.name)
    expect(names).toEqual(
      expect.arrayContaining(['idx_annotation_pins_capture', 'idx_annotation_pins_capture_number'])
    )
  })

  it('cascades delete from captures to annotations and pins', () => {
    const c = createCase({ name: 'C' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'Example',
      hash: 'abc',
      timestamp: new Date().toISOString()
    })
    getDb().prepare(
      "INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width, image_height, updated_at) VALUES (?, 1, '[]', 100, 100, ?)"
    ).run(cap.id, new Date().toISOString())
    getDb().prepare(
      'INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)'
    ).run('pin-1', cap.id, 'pin body', new Date().toISOString(), new Date().toISOString())

    deleteCapture(cap.id)

    const ann = getDb().prepare('SELECT COUNT(*) as n FROM annotations WHERE capture_id = ?').get(cap.id) as { n: number }
    const pins = getDb().prepare('SELECT COUNT(*) as n FROM annotation_pins WHERE capture_id = ?').get(cap.id) as { n: number }
    expect(ann.n).toBe(0)
    expect(pins.n).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/main/services/database.test.ts -t "annotations schema"`

Expected: FAIL with `LATEST_SCHEMA_VERSION` being 16, and `annotations` table missing.

- [ ] **Step 3: Bump `LATEST_SCHEMA_VERSION` to 17**

In `src/main/services/database.ts` line 31, change `export const LATEST_SCHEMA_VERSION = 16` to `export const LATEST_SCHEMA_VERSION = 17`.

- [ ] **Step 4: Add the v17 migration block**

In `src/main/services/database.ts`, immediately after the `if (version < 16) { ... }` block (which ends with `db.pragma('user_version = 16')`), add:

```typescript
if (version < 17) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS annotations (
        capture_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        shapes_json TEXT NOT NULL,
        image_width INTEGER NOT NULL,
        image_height INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS annotation_pins (
        id TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL,
        number INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_annotation_pins_capture ON annotation_pins(capture_id);
      CREATE INDEX IF NOT EXISTS idx_annotation_pins_capture_number ON annotation_pins(capture_id, number);
    `)
    db.pragma('user_version = 17')
  })()
}
```

- [ ] **Step 5: Run the migration tests — they should now pass**

Run: `pnpm test tests/main/services/database.test.ts -t "annotations schema"`

Expected: All 5 tests PASS.

- [ ] **Step 6: Run the full database test file**

Run: `pnpm test tests/main/services/database.test.ts`

Expected: No regressions.

- [ ] **Step 7: Commit**

Run: `git add src/main/services/database.ts tests/main/services/database.test.ts && git commit -m "feat(annotations): add migration v17 for annotations and pins tables"`

---

## Task 2: Shared types and IPC param/result types

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`

- [ ] **Step 1: Add the annotation types to `src/shared/types.ts`**

Append after the existing `Note` interface (around line 147):

```typescript
export type AnnotationShape =
  | { kind: 'rect'; id: string; x: number; y: number; w: number; h: number; stroke: string; strokeWidth: number; fill?: string }
  | { kind: 'arrow'; id: string; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number }
  | { kind: 'highlight'; id: string; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'redact'; id: string; x: number; y: number; w: number; h: number; mode: 'solid' }
  | { kind: 'pin'; id: string; x: number; y: number; number: number; pinId: string }

export interface CaptureAnnotations {
  captureId: string
  schemaVersion: number
  shapes: AnnotationShape[]
  imageWidth: number
  imageHeight: number
  updatedAt: string
  updatedBy: string | null
}

export interface AnnotationPin {
  id: string
  captureId: string
  number: number
  body: string
  createdAt: string
  updatedAt: string
}

export interface AnnotationsBundle {
  annotations: CaptureAnnotations | null
  pins: AnnotationPin[]
}
```

- [ ] **Step 2: Extend `ExportOptions`**

Replace the existing `ExportOptions` interface (around line 79):

```typescript
export interface ExportOptions {
  format: 'html' | 'pdf'
  include: {
    captures: boolean
    screenshots: boolean
    auditTrail: boolean
    annotations: 'none' | 'burned'
  }
  investigatorName: string
  outputPath: string
}
```

- [ ] **Step 3: Add channel constants to `src/shared/ipc.ts`**

Inside `IPC_CHANNELS`, after the `EXTRACTED_DATA_*` block (around line 75), add:

```typescript
// Annotations
ANNOTATIONS_GET: 'annotations:get',
ANNOTATIONS_SAVE: 'annotations:save',
ANNOTATIONS_DELETE: 'annotations:delete',
ANNOTATIONS_UPSERT_PIN: 'annotations:upsertPin',
ANNOTATIONS_DELETE_PIN: 'annotations:deletePin',
```

- [ ] **Step 4: Add named param types**

Append to `src/shared/ipc.ts` after `UpdateNoteParams` (around line 178):

```typescript
export interface SaveAnnotationsParams {
  captureId: string
  shapes: AnnotationShape[]
  imageWidth: number
  imageHeight: number
}

export interface UpsertAnnotationPinParams {
  captureId: string
  id?: string
  body: string
}
```

- [ ] **Step 5: Add `AnnotationShape` to the existing `import type { ... } from './types'` block** at the top of `src/shared/ipc.ts`.

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: Errors only in files that construct `ExportOptions` without the new `annotations` field. Temporarily fix each by adding `annotations: 'none'` to the `include: { ... }` literal. UI exposure of the option is in Task 15.

- [ ] **Step 7: Re-run typecheck**

Run: `pnpm tsc --noEmit`

Expected: Clean.

- [ ] **Step 8: Commit**

Run: `git add src/shared/types.ts src/shared/ipc.ts && git commit -m "feat(annotations): add shared types and IPC channel constants"`

(Stage any export.ts / export dialog files that needed the temporary `annotations: 'none'` field along with this commit.)

---

## Task 3: Main-process annotations service

**Files:**
- Create: `src/main/services/annotations.ts`
- Create: `tests/main/services/annotations.test.ts`

- [ ] **Step 1: Write the failing service tests**

Create `tests/main/services/annotations.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, createCase, insertCapture, deleteCapture } from '@main/services/database'
import { getAnnotations, saveAnnotations, deleteAnnotations, upsertPin, deletePin } from '@main/services/annotations'
import type { AnnotationShape } from '@shared/types'

describe('annotations service', () => {
  beforeEach(() => {
    initDatabase(':memory:')
  })
  afterEach(() => {
    closeDatabase()
  })

  function makeCapture() {
    const c = createCase({ name: 'C' })
    return insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'Example',
      hash: 'abc',
      timestamp: new Date().toISOString()
    })
  }

  it('returns empty bundle for capture with no annotations', () => {
    const cap = makeCapture()
    const bundle = getAnnotations(cap.id)
    expect(bundle.annotations).toBeNull()
    expect(bundle.pins).toEqual([])
  })

  it('saves and retrieves annotations', () => {
    const cap = makeCapture()
    const shapes: AnnotationShape[] = [
      { kind: 'rect', id: 's1', x: 10, y: 20, w: 30, h: 40, stroke: '#f00', strokeWidth: 2 }
    ]
    const saved = saveAnnotations({ captureId: cap.id, shapes, imageWidth: 800, imageHeight: 600 })
    expect(saved.captureId).toBe(cap.id)
    expect(saved.shapes).toEqual(shapes)
    expect(saved.schemaVersion).toBe(1)
    const bundle = getAnnotations(cap.id)
    expect(bundle.annotations?.shapes).toEqual(shapes)
  })

  it('overwrites existing annotations on save', () => {
    const cap = makeCapture()
    saveAnnotations({ captureId: cap.id, shapes: [], imageWidth: 100, imageHeight: 100 })
    const second = saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'rect', id: 's1', x: 0, y: 0, w: 1, h: 1, stroke: '#000', strokeWidth: 1 }],
      imageWidth: 100,
      imageHeight: 100
    })
    expect(second.shapes).toHaveLength(1)
  })

  it('deletes annotations', () => {
    const cap = makeCapture()
    saveAnnotations({ captureId: cap.id, shapes: [], imageWidth: 100, imageHeight: 100 })
    deleteAnnotations(cap.id)
    expect(getAnnotations(cap.id).annotations).toBeNull()
  })

  it('allocates pin numbers ascending starting at 1', () => {
    const cap = makeCapture()
    const p1 = upsertPin({ captureId: cap.id, body: 'first' })
    const p2 = upsertPin({ captureId: cap.id, body: 'second' })
    const p3 = upsertPin({ captureId: cap.id, body: 'third' })
    expect(p1.number).toBe(1)
    expect(p2.number).toBe(2)
    expect(p3.number).toBe(3)
  })

  it('keeps pin numbers stable after delete (gaps allowed)', () => {
    const cap = makeCapture()
    upsertPin({ captureId: cap.id, body: 'a' })
    const p2 = upsertPin({ captureId: cap.id, body: 'b' })
    upsertPin({ captureId: cap.id, body: 'c' })
    deletePin(p2.id)
    const p4 = upsertPin({ captureId: cap.id, body: 'd' })
    expect(p4.number).toBe(4)
    const numbers = getAnnotations(cap.id).pins.map((p) => p.number).sort((a, b) => a - b)
    expect(numbers).toEqual([1, 3, 4])
  })

  it('updates an existing pin body when id is provided', () => {
    const cap = makeCapture()
    const p = upsertPin({ captureId: cap.id, body: 'original' })
    const updated = upsertPin({ captureId: cap.id, id: p.id, body: 'updated' })
    expect(updated.id).toBe(p.id)
    expect(updated.number).toBe(p.number)
    expect(updated.body).toBe('updated')
  })

  it('scopes pin numbering per capture', () => {
    const cap1 = makeCapture()
    const cap2 = makeCapture()
    const a = upsertPin({ captureId: cap1.id, body: 'cap1-a' })
    const b = upsertPin({ captureId: cap2.id, body: 'cap2-a' })
    expect(a.number).toBe(1)
    expect(b.number).toBe(1)
  })

  it('cascades pin deletion when capture is deleted', () => {
    const cap = makeCapture()
    upsertPin({ captureId: cap.id, body: 'x' })
    deleteCapture(cap.id)
    expect(getAnnotations(cap.id).pins).toEqual([])
  })
})
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm test tests/main/services/annotations.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `src/main/services/annotations.ts`:

```typescript
import { randomUUID } from 'crypto'
import { getDb } from './database'
import type { AnnotationsBundle, AnnotationPin, AnnotationShape, CaptureAnnotations } from '@shared/types'
import type { SaveAnnotationsParams, UpsertAnnotationPinParams } from '@shared/ipc'

const SCHEMA_VERSION = 1

interface AnnotationRow {
  capture_id: string
  schema_version: number
  shapes_json: string
  image_width: number
  image_height: number
  updated_at: string
  updated_by: string | null
}

interface PinRow {
  id: string
  capture_id: string
  number: number
  body: string
  created_at: string
  updated_at: string
}

function rowToAnnotations(row: AnnotationRow): CaptureAnnotations {
  return {
    captureId: row.capture_id,
    schemaVersion: row.schema_version,
    shapes: JSON.parse(row.shapes_json) as AnnotationShape[],
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  }
}

function rowToPin(row: PinRow): AnnotationPin {
  return {
    id: row.id,
    captureId: row.capture_id,
    number: row.number,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function getAnnotations(captureId: string): AnnotationsBundle {
  const annRow = getDb().prepare('SELECT * FROM annotations WHERE capture_id = ?').get(captureId) as AnnotationRow | undefined
  const pinRows = getDb().prepare('SELECT * FROM annotation_pins WHERE capture_id = ? ORDER BY number ASC').all(captureId) as PinRow[]
  return {
    annotations: annRow ? rowToAnnotations(annRow) : null,
    pins: pinRows.map(rowToPin)
  }
}

export function saveAnnotations(params: SaveAnnotationsParams, updatedBy: string | null = null): CaptureAnnotations {
  const now = new Date().toISOString()
  getDb().prepare(
    `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width, image_height, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(capture_id) DO UPDATE SET
       schema_version = excluded.schema_version,
       shapes_json = excluded.shapes_json,
       image_width = excluded.image_width,
       image_height = excluded.image_height,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  ).run(params.captureId, SCHEMA_VERSION, JSON.stringify(params.shapes), params.imageWidth, params.imageHeight, now, updatedBy)
  return rowToAnnotations(
    getDb().prepare('SELECT * FROM annotations WHERE capture_id = ?').get(params.captureId) as AnnotationRow
  )
}

export function deleteAnnotations(captureId: string): void {
  getDb().prepare('DELETE FROM annotations WHERE capture_id = ?').run(captureId)
}

export function upsertPin(params: UpsertAnnotationPinParams): AnnotationPin {
  const db = getDb()
  const now = new Date().toISOString()

  return db.transaction(() => {
    if (params.id) {
      const existing = db.prepare('SELECT * FROM annotation_pins WHERE id = ?').get(params.id) as PinRow | undefined
      if (existing) {
        db.prepare('UPDATE annotation_pins SET body = ?, updated_at = ? WHERE id = ?').run(params.body, now, params.id)
        return rowToPin(db.prepare('SELECT * FROM annotation_pins WHERE id = ?').get(params.id) as PinRow)
      }
    }

    const id = params.id ?? randomUUID()
    const row = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM annotation_pins WHERE capture_id = ?').get(params.captureId) as { next: number }
    const number = row.next

    db.prepare(
      'INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, params.captureId, number, params.body, now, now)

    return rowToPin(db.prepare('SELECT * FROM annotation_pins WHERE id = ?').get(id) as PinRow)
  })()
}

export function deletePin(pinId: string): void {
  getDb().prepare('DELETE FROM annotation_pins WHERE id = ?').run(pinId)
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test tests/main/services/annotations.test.ts`

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

Run: `git add src/main/services/annotations.ts tests/main/services/annotations.test.ts && git commit -m "feat(annotations): add main-process annotations service"`

---

## Task 4: IPC handlers + preload bridge

**Files:**
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the imports at the top of `src/main/ipcHandlers.ts`**

Find the existing `import * as db from '@main/services/database'` and add below it:

```typescript
import * as annotations from '@main/services/annotations'
```

Add `SaveAnnotationsParams` and `UpsertAnnotationPinParams` to the existing IPC param type imports from `@shared/ipc`.

- [ ] **Step 2: Register the annotations IPC handlers**

After the existing `// Notes` registrations end (around the `NOTES_SEARCH` registration, ~line 420) and before the next domain block, add:

```typescript
// Annotations
ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_GET, (_, captureId: string) =>
  annotations.getAnnotations(captureId)
)
ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_SAVE, (_, params: SaveAnnotationsParams) => {
  try {
    return ipcResult(annotations.saveAnnotations(params))
  } catch (err) {
    return ipcError(err)
  }
})
ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_DELETE, (_, captureId: string) => {
  try {
    annotations.deleteAnnotations(captureId)
    return ipcResult(undefined)
  } catch (err) {
    return ipcError(err)
  }
})
ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_UPSERT_PIN, (_, params: UpsertAnnotationPinParams) => {
  try {
    return ipcResult(annotations.upsertPin(params))
  } catch (err) {
    return ipcError(err)
  }
})
ipcMain.handle(IPC_CHANNELS.ANNOTATIONS_DELETE_PIN, (_, pinId: string) => {
  try {
    annotations.deletePin(pinId)
    return ipcResult(undefined)
  } catch (err) {
    return ipcError(err)
  }
})
```

- [ ] **Step 3: Add the preload bridge**

In `src/preload/index.ts`, find the existing `notes: { ... }` block (around line 144) and add after its closing `},`:

```typescript
annotations: {
  get: (captureId: string): Promise<AnnotationsBundle> =>
    ipcRenderer.invoke(IPC_CHANNELS.ANNOTATIONS_GET, captureId),
  save: (params: SaveAnnotationsParams): Promise<CaptureAnnotations> =>
    unwrapIpc<CaptureAnnotations>(ipcRenderer.invoke(IPC_CHANNELS.ANNOTATIONS_SAVE, params)),
  delete: (captureId: string): Promise<void> =>
    unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.ANNOTATIONS_DELETE, captureId)),
  upsertPin: (params: UpsertAnnotationPinParams): Promise<AnnotationPin> =>
    unwrapIpc<AnnotationPin>(ipcRenderer.invoke(IPC_CHANNELS.ANNOTATIONS_UPSERT_PIN, params)),
  deletePin: (pinId: string): Promise<void> =>
    unwrapIpc<void>(ipcRenderer.invoke(IPC_CHANNELS.ANNOTATIONS_DELETE_PIN, pinId))
},
```

Add the type imports at the top of `src/preload/index.ts`: `AnnotationsBundle`, `CaptureAnnotations`, `AnnotationPin` from `@shared/types`, and `SaveAnnotationsParams`, `UpsertAnnotationPinParams` from `@shared/ipc`.

- [ ] **Step 4: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Run all main tests**

Run: `pnpm test tests/main`

Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

Run: `git add src/main/ipcHandlers.ts src/preload/index.ts && git commit -m "feat(annotations): wire IPC handlers and preload bridge"`

---

## Task 5: React Query hooks

**Files:**
- Modify: `src/renderer/lib/queries.ts`

- [ ] **Step 1: Add the query key**

In `src/renderer/lib/queries.ts`, inside the `queryKeys` object (around line 13), after the existing `extractedDataCount` entry, add a comma after the previous entry then:

```typescript
annotations: (captureId: string) => ['annotations', captureId] as const
```

- [ ] **Step 2: Add the query options**

After the existing notes block, append:

```typescript
// --- Annotations ---

export const annotationsQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.annotations(captureId),
    queryFn: () => window.birdbrain.annotations.get(captureId)
  })
```

- [ ] **Step 3: Add the mutations hook**

After `annotationsQueryOptions`, append:

```typescript
export function useAnnotationsMutations(captureId: string) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.annotations(captureId) })
  }

  const save = useMutation({
    mutationFn: (params: SaveAnnotationsParams) => window.birdbrain.annotations.save(params),
    onSuccess: invalidate
  })
  const upsertPin = useMutation({
    mutationFn: (params: UpsertAnnotationPinParams) => window.birdbrain.annotations.upsertPin(params),
    onSuccess: invalidate
  })
  const deletePin = useMutation({
    mutationFn: (pinId: string) => window.birdbrain.annotations.deletePin(pinId),
    onSuccess: invalidate
  })
  const deleteAll = useMutation({
    mutationFn: (id: string) => window.birdbrain.annotations.delete(id),
    onSuccess: invalidate
  })

  return { save, upsertPin, deletePin, deleteAll }
}
```

- [ ] **Step 4: Add imports**

Add `SaveAnnotationsParams` and `UpsertAnnotationPinParams` to the existing `import type { ... } from '@shared/ipc'` block at the top of `src/renderer/lib/queries.ts`.

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: No errors.

- [ ] **Step 6: Commit**

Run: `git add src/renderer/lib/queries.ts && git commit -m "feat(annotations): add React Query hooks"`

---

## Task 6: Install Konva dependencies

- [ ] **Step 1: Install**

Run: `pnpm add konva react-konva use-image`

- [ ] **Step 2: Verify build**

Run: `pnpm build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

Run: `git add package.json pnpm-lock.yaml && git commit -m "chore: add konva, react-konva, use-image"`

---

## Task 7: Read-only AnnotationCanvas + shape components

**Files:**
- Create: `src/renderer/components/captures/annotation/shapes/RectShape.tsx`
- Create: `src/renderer/components/captures/annotation/shapes/ArrowShape.tsx`
- Create: `src/renderer/components/captures/annotation/shapes/RedactShape.tsx`
- Create: `src/renderer/components/captures/annotation/shapes/PinShape.tsx`
- Create: `src/renderer/components/captures/annotation/AnnotationCanvas.tsx`

- [ ] **Step 1: Create `RectShape.tsx` (handles `rect` and `highlight` kinds)**

```tsx
import { Rect } from 'react-konva'
import { forwardRef } from 'react'
import type Konva from 'konva'
import type { AnnotationShape } from '@shared/types'

interface Props {
  shape: Extract<AnnotationShape, { kind: 'rect' | 'highlight' }>
  listening?: boolean
  onSelect?: () => void
  draggable?: boolean
  onChange?: (next: AnnotationShape) => void
}

export const RectShape = forwardRef<Konva.Rect, Props>(function RectShape(
  { shape, listening = true, onSelect, draggable = false, onChange },
  ref
) {
  if (shape.kind === 'highlight') {
    return (
      <Rect
        ref={ref}
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        fill={shape.color}
        opacity={0.4}
        listening={listening}
        draggable={draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          if (!onChange) return
          onChange({ ...shape, x: e.target.x(), y: e.target.y() })
        }}
      />
    )
  }
  return (
    <Rect
      ref={ref}
      x={shape.x}
      y={shape.y}
      width={shape.w}
      height={shape.h}
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      fill={shape.fill}
      listening={listening}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        if (!onChange) return
        onChange({ ...shape, x: e.target.x(), y: e.target.y() })
      }}
    />
  )
})
```

- [ ] **Step 2: Create `ArrowShape.tsx`**

```tsx
import { Arrow } from 'react-konva'
import { forwardRef } from 'react'
import type Konva from 'konva'
import type { AnnotationShape } from '@shared/types'

interface Props {
  shape: Extract<AnnotationShape, { kind: 'arrow' }>
  listening?: boolean
  onSelect?: () => void
  draggable?: boolean
  onChange?: (next: AnnotationShape) => void
}

export const ArrowShape = forwardRef<Konva.Arrow, Props>(function ArrowShape(
  { shape, listening = true, onSelect, draggable = false, onChange },
  ref
) {
  return (
    <Arrow
      ref={ref}
      x={0}
      y={0}
      points={[shape.x1, shape.y1, shape.x2, shape.y2]}
      stroke={shape.stroke}
      fill={shape.stroke}
      strokeWidth={shape.strokeWidth}
      pointerLength={Math.max(8, shape.strokeWidth * 4)}
      pointerWidth={Math.max(8, shape.strokeWidth * 4)}
      listening={listening}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        if (!onChange) return
        const dx = e.target.x()
        const dy = e.target.y()
        e.target.position({ x: 0, y: 0 })
        onChange({
          ...shape,
          x1: shape.x1 + dx,
          y1: shape.y1 + dy,
          x2: shape.x2 + dx,
          y2: shape.y2 + dy
        })
      }}
    />
  )
})
```

- [ ] **Step 3: Create `RedactShape.tsx`**

```tsx
import { Rect } from 'react-konva'
import { forwardRef } from 'react'
import type Konva from 'konva'
import type { AnnotationShape } from '@shared/types'

interface Props {
  shape: Extract<AnnotationShape, { kind: 'redact' }>
  listening?: boolean
  onSelect?: () => void
  draggable?: boolean
  onChange?: (next: AnnotationShape) => void
}

export const RedactShape = forwardRef<Konva.Rect, Props>(function RedactShape(
  { shape, listening = true, onSelect, draggable = false, onChange },
  ref
) {
  return (
    <Rect
      ref={ref}
      x={shape.x}
      y={shape.y}
      width={shape.w}
      height={shape.h}
      fill="#000"
      listening={listening}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        if (!onChange) return
        onChange({ ...shape, x: e.target.x(), y: e.target.y() })
      }}
    />
  )
})
```

- [ ] **Step 4: Create `PinShape.tsx`**

```tsx
import { Circle, Group, Text } from 'react-konva'
import type { AnnotationShape } from '@shared/types'

interface Props {
  shape: Extract<AnnotationShape, { kind: 'pin' }>
  listening?: boolean
  onSelect?: () => void
  draggable?: boolean
  onChange?: (next: AnnotationShape) => void
}

const RADIUS = 14

export function PinShape({ shape, listening = true, onSelect, draggable = false, onChange }: Props) {
  const label = shape.number > 0 ? String(shape.number) : '…'
  return (
    <Group
      x={shape.x}
      y={shape.y}
      listening={listening}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        if (!onChange) return
        onChange({ ...shape, x: e.target.x(), y: e.target.y() })
      }}
    >
      <Circle radius={RADIUS} fill="#ef4444" stroke="#fff" strokeWidth={2} />
      <Text
        text={label}
        fontSize={14}
        fontStyle="bold"
        fill="#fff"
        align="center"
        verticalAlign="middle"
        width={RADIUS * 2}
        height={RADIUS * 2}
        offsetX={RADIUS}
        offsetY={RADIUS}
      />
    </Group>
  )
}
```

- [ ] **Step 5: Create `AnnotationCanvas.tsx` (read-only baseline; extended in Task 9)**

```tsx
import { Stage, Layer, Image as KonvaImage } from 'react-konva'
import useImage from 'use-image'
import { useMemo } from 'react'
import type { AnnotationShape } from '@shared/types'
import { RectShape } from './shapes/RectShape'
import { ArrowShape } from './shapes/ArrowShape'
import { RedactShape } from './shapes/RedactShape'
import { PinShape } from './shapes/PinShape'

interface Props {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  shapes: AnnotationShape[]
  containerWidth: number
  containerHeight: number
  onPinClick?: (pinId: string) => void
}

export function AnnotationCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  shapes,
  containerWidth,
  containerHeight,
  onPinClick
}: Props) {
  const [image] = useImage(imageUrl)

  const scale = useMemo(() => {
    if (!imageWidth || !imageHeight) return 1
    return Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
  }, [containerWidth, containerHeight, imageWidth, imageHeight])

  const redacts = shapes.filter((s) => s.kind === 'redact')
  const markup = shapes.filter((s) => s.kind === 'rect' || s.kind === 'highlight' || s.kind === 'arrow')
  const pins = shapes.filter((s) => s.kind === 'pin')

  return (
    <Stage width={imageWidth * scale} height={imageHeight * scale} scaleX={scale} scaleY={scale}>
      <Layer listening={false}>
        {image && <KonvaImage image={image} x={0} y={0} width={imageWidth} height={imageHeight} />}
      </Layer>
      <Layer>
        {redacts.map((s) => (
          <RedactShape key={s.id} shape={s as Extract<AnnotationShape, { kind: 'redact' }>} listening={false} />
        ))}
        {markup.map((s) => {
          if (s.kind === 'arrow') return <ArrowShape key={s.id} shape={s} listening={false} />
          return <RectShape key={s.id} shape={s} listening={false} />
        })}
        {pins.map((s) => (
          <PinShape
            key={s.id}
            shape={s as Extract<AnnotationShape, { kind: 'pin' }>}
            listening={true}
            onSelect={() => {
              if (s.kind === 'pin') onPinClick?.(s.pinId)
            }}
          />
        ))}
      </Layer>
    </Stage>
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: No errors.

- [ ] **Step 7: Commit**

Run: `git add src/renderer/components/captures/annotation/ && git commit -m "feat(annotations): read-only AnnotationCanvas and shape components"`

---

## Task 8: useAnnotationEditor hook

**Files:**
- Create: `src/renderer/components/captures/annotation/useAnnotationEditor.ts`
- Create: `tests/renderer/components/useAnnotationEditor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/components/useAnnotationEditor.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAnnotationEditor } from '@renderer/components/captures/annotation/useAnnotationEditor'

describe('useAnnotationEditor', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initialises with select tool and given shapes', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    expect(result.current.tool).toBe('select')
    expect(result.current.shapes).toEqual([])
    expect(result.current.dirty).toBe(false)
  })

  it('beginDraft + commitDraft adds a shape and pushes to undo stack', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    act(() => result.current.setTool('rect'))
    act(() =>
      result.current.beginDraft({
        kind: 'rect', id: 's1', x: 5, y: 5, w: 0, h: 0, stroke: '#f00', strokeWidth: 2
      })
    )
    act(() => result.current.extendDraft({ w: 20, h: 30 }))
    act(() => result.current.commitDraft())
    expect(result.current.shapes).toHaveLength(1)
    expect(result.current.shapes[0]).toMatchObject({ w: 20, h: 30 })
    expect(result.current.dirty).toBe(true)
  })

  it('undo restores previous shape state, redo re-applies', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    act(() =>
      result.current.beginDraft({
        kind: 'rect', id: 's1', x: 0, y: 0, w: 10, h: 10, stroke: '#000', strokeWidth: 1
      })
    )
    act(() => result.current.commitDraft())
    expect(result.current.shapes).toHaveLength(1)
    act(() => result.current.undo())
    expect(result.current.shapes).toHaveLength(0)
    act(() => result.current.redo())
    expect(result.current.shapes).toHaveLength(1)
  })

  it('persists last-used color and strokeWidth to localStorage', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    act(() => result.current.setColor('#0000ff'))
    act(() => result.current.setStrokeWidth(7))
    expect(localStorage.getItem('birdbrain.annotation.color')).toBe('#0000ff')
    expect(localStorage.getItem('birdbrain.annotation.strokeWidth')).toBe('7')
  })

  it('reads last-used color and strokeWidth from localStorage on mount', () => {
    localStorage.setItem('birdbrain.annotation.color', '#0000ff')
    localStorage.setItem('birdbrain.annotation.strokeWidth', '7')
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    expect(result.current.color).toBe('#0000ff')
    expect(result.current.strokeWidth).toBe(7)
  })

  it('removeShape pushes to undo and clears selection if the shape was selected', () => {
    const { result } = renderHook(() =>
      useAnnotationEditor({
        initialShapes: [
          { kind: 'rect', id: 's1', x: 0, y: 0, w: 1, h: 1, stroke: '#000', strokeWidth: 1 }
        ]
      })
    )
    act(() => result.current.select('s1'))
    act(() => result.current.removeShape('s1'))
    expect(result.current.shapes).toHaveLength(0)
    expect(result.current.selectedId).toBeNull()
    act(() => result.current.undo())
    expect(result.current.shapes).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm test tests/renderer/components/useAnnotationEditor.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/renderer/components/captures/annotation/useAnnotationEditor.ts`:

```typescript
import { useCallback, useState } from 'react'
import type { AnnotationShape } from '@shared/types'

export type AnnotationTool = 'select' | 'rect' | 'arrow' | 'highlight' | 'redact' | 'pin'

const COLOR_KEY = 'birdbrain.annotation.color'
const STROKE_KEY = 'birdbrain.annotation.strokeWidth'
const DEFAULT_COLOR = '#ef4444'
const DEFAULT_STROKE = 3

function readColor(): string {
  return localStorage.getItem(COLOR_KEY) ?? DEFAULT_COLOR
}
function readStroke(): number {
  const raw = localStorage.getItem(STROKE_KEY)
  if (!raw) return DEFAULT_STROKE
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STROKE
}

interface Options {
  initialShapes: AnnotationShape[]
}

export function useAnnotationEditor({ initialShapes }: Options) {
  const [tool, setTool] = useState<AnnotationTool>('select')
  const [color, setColorState] = useState<string>(() => readColor())
  const [strokeWidth, setStrokeWidthState] = useState<number>(() => readStroke())
  const [shapes, setShapes] = useState<AnnotationShape[]>(initialShapes)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AnnotationShape | null>(null)
  const [undoStack, setUndoStack] = useState<AnnotationShape[][]>([])
  const [redoStack, setRedoStack] = useState<AnnotationShape[][]>([])
  const [dirty, setDirty] = useState(false)

  const setColor = useCallback((c: string) => {
    setColorState(c)
    localStorage.setItem(COLOR_KEY, c)
  }, [])
  const setStrokeWidth = useCallback((w: number) => {
    setStrokeWidthState(w)
    localStorage.setItem(STROKE_KEY, String(w))
  }, [])

  const beginDraft = useCallback((shape: AnnotationShape) => setDraft(shape), [])
  const extendDraft = useCallback((patch: Partial<AnnotationShape>) => {
    setDraft((d) => (d ? ({ ...d, ...patch } as AnnotationShape) : d))
  }, [])
  const cancelDraft = useCallback(() => setDraft(null), [])

  const commitDraft = useCallback(() => {
    setDraft((d) => {
      if (!d) return null
      setUndoStack((s) => [...s, shapes])
      setRedoStack([])
      setShapes((arr) => [...arr, d])
      setDirty(true)
      return null
    })
  }, [shapes])

  const updateShape = useCallback((next: AnnotationShape) => {
    setUndoStack((s) => [...s, shapes])
    setRedoStack([])
    setShapes((arr) => arr.map((s) => (s.id === next.id ? next : s)))
    setDirty(true)
  }, [shapes])

  const removeShape = useCallback((id: string) => {
    setUndoStack((s) => [...s, shapes])
    setRedoStack([])
    setShapes((arr) => arr.filter((s) => s.id !== id))
    setSelectedId((prev) => (prev === id ? null : prev))
    setDirty(true)
  }, [shapes])

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack
      const prev = stack[stack.length - 1]
      setRedoStack((r) => [...r, shapes])
      setShapes(prev)
      setDirty(true)
      return stack.slice(0, -1)
    })
  }, [shapes])

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack
      const next = stack[stack.length - 1]
      setUndoStack((u) => [...u, shapes])
      setShapes(next)
      setDirty(true)
      return stack.slice(0, -1)
    })
  }, [shapes])

  const select = useCallback((id: string | null) => setSelectedId(id), [])
  const clearDirty = useCallback(() => setDirty(false), [])

  // Note: there is intentionally no `useEffect` that resets state when
  // `initialShapes` changes. Reset-on-prop-change is a footgun because callers
  // often pass a new array reference on every render. Instead, the parent must
  // remount this hook by giving the owning component a stable `key` (e.g.
  // `key={captureId}`). See Task 12 — `<AnnotationEditor key={captureId} ... />`.

  return {
    tool, setTool,
    color, setColor,
    strokeWidth, setStrokeWidth,
    shapes, setShapes,
    selectedId, select,
    draft, beginDraft, extendDraft, cancelDraft, commitDraft,
    updateShape, removeShape,
    undo, redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    dirty, clearDirty
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test tests/renderer/components/useAnnotationEditor.test.ts`

Expected: All 6 tests PASS. (If `@testing-library/react` is not yet a dev dep, install it: `pnpm add -D @testing-library/react @testing-library/dom`.)

- [ ] **Step 5: Commit**

Run: `git add src/renderer/components/captures/annotation/useAnnotationEditor.ts tests/renderer/components/useAnnotationEditor.test.ts package.json pnpm-lock.yaml && git commit -m "feat(annotations): add useAnnotationEditor hook with undo/redo and style persistence"`

---

## Task 9: AnnotationToolbar + draft pointer flow integration

**Files:**
- Create: `src/renderer/components/captures/annotation/AnnotationToolbar.tsx`
- Modify: `src/renderer/components/captures/annotation/AnnotationCanvas.tsx`

- [ ] **Step 1: Create the toolbar**

```tsx
import type { AnnotationTool } from './useAnnotationEditor'
import { Square, ArrowRight, Highlighter, EyeOff, MapPin, MousePointer2, Undo2, Redo2 } from 'lucide-react'

interface Props {
  tool: AnnotationTool
  setTool: (t: AnnotationTool) => void
  color: string
  setColor: (c: string) => void
  strokeWidth: number
  setStrokeWidth: (w: number) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

const TOOLS: Array<{ key: AnnotationTool; label: string; Icon: typeof Square }> = [
  { key: 'select', label: 'Select', Icon: MousePointer2 },
  { key: 'rect', label: 'Rectangle', Icon: Square },
  { key: 'arrow', label: 'Arrow', Icon: ArrowRight },
  { key: 'highlight', label: 'Highlight', Icon: Highlighter },
  { key: 'redact', label: 'Redact', Icon: EyeOff },
  { key: 'pin', label: 'Pin', Icon: MapPin }
]

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#000000', '#ffffff']

export function AnnotationToolbar({
  tool, setTool, color, setColor, strokeWidth, setStrokeWidth,
  canUndo, canRedo, onUndo, onRedo
}: Props) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-2 py-1">
      {TOOLS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          aria-label={label}
          onClick={() => setTool(key)}
          className={`rounded px-2 py-1 hover:bg-canvas ${tool === key ? 'bg-canvas text-accent' : 'text-text-primary'}`}
        >
          <Icon size={16} />
        </button>
      ))}
      <div className="ml-2 flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            className={`h-5 w-5 rounded border ${c === color ? 'border-accent ring-2 ring-accent' : 'border-border'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <label className="ml-2 flex items-center gap-1 text-xs text-text-muted">
        <span>Stroke</span>
        <input type="range" min={1} max={10} value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))} className="w-20" />
        <span>{strokeWidth}</span>
      </label>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" aria-label="Undo" onClick={onUndo} disabled={!canUndo}
          className="rounded p-1 text-text-primary hover:bg-canvas disabled:opacity-40">
          <Undo2 size={16} />
        </button>
        <button type="button" aria-label="Redo" onClick={onRedo} disabled={!canRedo}
          className="rounded p-1 text-text-primary hover:bg-canvas disabled:opacity-40">
          <Redo2 size={16} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace `AnnotationCanvas.tsx` with the editor-aware version**

Overwrite the file from Task 7 with this version. New props: `tool`, `color`, `strokeWidth`, `draft`, plus draft-flow callbacks.

```tsx
import { Stage, Layer, Image as KonvaImage } from 'react-konva'
import useImage from 'use-image'
import { useMemo } from 'react'
import type Konva from 'konva'
import type { AnnotationShape } from '@shared/types'
import type { AnnotationTool } from './useAnnotationEditor'
import { RectShape } from './shapes/RectShape'
import { ArrowShape } from './shapes/ArrowShape'
import { RedactShape } from './shapes/RedactShape'
import { PinShape } from './shapes/PinShape'

interface Props {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  shapes: AnnotationShape[]
  draft: AnnotationShape | null
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onShapeChange?: (next: AnnotationShape) => void
  editable?: boolean
  tool?: AnnotationTool
  color?: string
  strokeWidth?: number
  onDraftBegin?: (shape: AnnotationShape) => void
  onDraftExtend?: (patch: Partial<AnnotationShape>) => void
  onDraftCommit?: () => void
  onPinDrop?: (x: number, y: number) => void
  onPinClick?: (pinId: string) => void
  containerWidth: number
  containerHeight: number
}

function uid(): string {
  return crypto.randomUUID()
}

export function AnnotationCanvas(props: Props) {
  const {
    imageUrl, imageWidth, imageHeight,
    shapes, draft,
    selectedId = null, onSelect, onShapeChange,
    editable = false, tool = 'select', color = '#ef4444', strokeWidth = 3,
    onDraftBegin, onDraftExtend, onDraftCommit,
    onPinDrop, onPinClick,
    containerWidth, containerHeight
  } = props
  const [image] = useImage(imageUrl)

  const scale = useMemo(() => {
    if (!imageWidth || !imageHeight) return 1
    return Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
  }, [containerWidth, containerHeight, imageWidth, imageHeight])

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    if (e.target !== stage) return
    onSelect?.(null)
    if (!editable) return
    const pos = stage.getPointerPosition()
    if (!pos) return
    const x = pos.x / scale
    const y = pos.y / scale
    if (tool === 'pin') {
      onPinDrop?.(x, y)
      return
    }
    if (tool === 'rect') {
      onDraftBegin?.({ kind: 'rect', id: uid(), x, y, w: 0, h: 0, stroke: color, strokeWidth })
    } else if (tool === 'highlight') {
      onDraftBegin?.({ kind: 'highlight', id: uid(), x, y, w: 0, h: 0, color })
    } else if (tool === 'redact') {
      onDraftBegin?.({ kind: 'redact', id: uid(), x, y, w: 0, h: 0, mode: 'solid' })
    } else if (tool === 'arrow') {
      onDraftBegin?.({ kind: 'arrow', id: uid(), x1: x, y1: y, x2: x, y2: y, stroke: color, strokeWidth })
    }
  }

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!editable || !draft) return
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getPointerPosition()
    if (!pos) return
    const x = pos.x / scale
    const y = pos.y / scale
    if (draft.kind === 'arrow') {
      onDraftExtend?.({ x2: x, y2: y })
    } else if (draft.kind === 'rect' || draft.kind === 'highlight' || draft.kind === 'redact') {
      onDraftExtend?.({ w: x - draft.x, h: y - draft.y })
    }
  }

  const handleMouseUp = () => {
    if (!editable || !draft) return
    onDraftCommit?.()
  }

  const allShapes = draft ? [...shapes, draft] : shapes
  const redacts = allShapes.filter((s) => s.kind === 'redact')
  const markup = allShapes.filter((s) => s.kind === 'rect' || s.kind === 'highlight' || s.kind === 'arrow')
  const pins = allShapes.filter((s) => s.kind === 'pin')

  return (
    <Stage
      width={imageWidth * scale}
      height={imageHeight * scale}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <Layer listening={false}>
        {image && <KonvaImage image={image} x={0} y={0} width={imageWidth} height={imageHeight} />}
      </Layer>
      <Layer>
        {redacts.map((s) => (
          <RedactShape
            key={s.id}
            shape={s as Extract<AnnotationShape, { kind: 'redact' }>}
            listening={editable}
            draggable={editable && selectedId === s.id}
            onSelect={() => onSelect?.(s.id)}
            onChange={onShapeChange}
          />
        ))}
        {markup.map((s) => {
          if (s.kind === 'arrow') {
            return (
              <ArrowShape
                key={s.id}
                shape={s}
                listening={editable}
                draggable={editable && selectedId === s.id}
                onSelect={() => onSelect?.(s.id)}
                onChange={onShapeChange}
              />
            )
          }
          return (
            <RectShape
              key={s.id}
              shape={s}
              listening={editable}
              draggable={editable && selectedId === s.id}
              onSelect={() => onSelect?.(s.id)}
              onChange={onShapeChange}
            />
          )
        })}
        {pins.map((s) => (
          <PinShape
            key={s.id}
            shape={s as Extract<AnnotationShape, { kind: 'pin' }>}
            listening={true}
            draggable={editable && selectedId === s.id}
            onSelect={() => {
              onSelect?.(s.id)
              if (s.kind === 'pin') onPinClick?.(s.pinId)
            }}
            onChange={onShapeChange}
          />
        ))}
      </Layer>
    </Stage>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: No errors.

- [ ] **Step 4: Commit**

Run: `git add src/renderer/components/captures/annotation/AnnotationToolbar.tsx src/renderer/components/captures/annotation/AnnotationCanvas.tsx && git commit -m "feat(annotations): add toolbar and draft pointer flow"`

---

## Task 10: PinCommentPopover

**File:** Create: `src/renderer/components/captures/annotation/PinCommentPopover.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  pinNumber: number | null
  initialBody: string
  saving?: boolean
  onSave: (body: string) => void
  onClose: () => void
}

export function PinCommentPopover({ open, pinNumber, initialBody, saving, onSave, onClose }: Props) {
  const [body, setBody] = useState(initialBody)

  useEffect(() => {
    if (open) setBody(initialBody)
  }, [open, initialBody])

  if (!open) return null

  return (
    <div className="absolute right-2 top-2 z-10 w-72 rounded border border-border bg-surface p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">
          Pin {pinNumber == null ? '(saving…)' : pinNumber}
        </h4>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">×</button>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="w-full rounded border border-border bg-canvas p-2 text-sm text-text-primary"
        placeholder="What did you find?"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="rounded px-3 py-1 text-sm text-text-muted hover:bg-canvas">Cancel</button>
        <button type="button" onClick={() => onSave(body)} disabled={saving}
          className="rounded bg-accent px-3 py-1 text-sm text-white hover:bg-accent/80 disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `pnpm tsc --noEmit`

Run: `git add src/renderer/components/captures/annotation/PinCommentPopover.tsx && git commit -m "feat(annotations): add PinCommentPopover"`

---

## Task 11: Keyboard shortcuts

**File:** Create: `src/renderer/components/captures/annotation/keyboardShortcuts.ts`

- [ ] **Step 1: Implement**

```typescript
import { useEffect } from 'react'
import type { AnnotationTool } from './useAnnotationEditor'

interface Bindings {
  enabled: boolean
  setTool: (t: AnnotationTool) => void
  deselect: () => void
  removeSelected: () => void
  undo: () => void
  redo: () => void
}

const TOOL_KEYS: Record<string, AnnotationTool> = {
  v: 'select', r: 'rect', a: 'arrow', h: 'highlight', x: 'redact', p: 'pin'
}

export function useAnnotationKeyboardShortcuts(b: Bindings): void {
  useEffect(() => {
    if (!b.enabled) return

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }

      if (e.key === 'Escape') { b.deselect(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        b.removeSelected()
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) b.redo(); else b.undo()
        e.preventDefault()
        return
      }
      const lower = e.key.toLowerCase()
      const tool = TOOL_KEYS[lower]
      if (tool && !e.ctrlKey && !e.metaKey && !e.altKey) {
        b.setTool(tool)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [b])
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `pnpm tsc --noEmit`

Run: `git add src/renderer/components/captures/annotation/keyboardShortcuts.ts && git commit -m "feat(annotations): add keyboard shortcuts"`

---

## Task 12: Wire view/edit toggle into CaptureViewer Screenshot tab

**Files:**
- Create: `src/renderer/components/captures/annotation/AnnotationEditor.tsx`
- Modify: `src/renderer/components/captures/CaptureViewer.tsx`

- [ ] **Step 1: Create the composed editor component**

`src/renderer/components/captures/annotation/AnnotationEditor.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Eye } from 'lucide-react'
import type { AnnotationPin, AnnotationShape } from '@shared/types'
import { annotationsQueryOptions, useAnnotationsMutations } from '@renderer/lib/queries'
import { AnnotationCanvas } from './AnnotationCanvas'
import { AnnotationToolbar } from './AnnotationToolbar'
import { PinCommentPopover } from './PinCommentPopover'
import { useAnnotationEditor } from './useAnnotationEditor'
import { useAnnotationKeyboardShortcuts } from './keyboardShortcuts'

interface Props {
  captureId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
  containerWidth: number
  containerHeight: number
}

export function AnnotationEditor(props: Props) {
  const { captureId, imageUrl, imageWidth, imageHeight, containerWidth, containerHeight } = props
  const [editing, setEditing] = useState(false)
  const { data: bundle } = useQuery(annotationsQueryOptions(captureId))
  const mutations = useAnnotationsMutations(captureId)
  const editor = useAnnotationEditor({ initialShapes: bundle?.annotations?.shapes ?? [] })
  const [popoverPinShapeId, setPopoverPinShapeId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useAnnotationKeyboardShortcuts({
    enabled: editing,
    setTool: editor.setTool,
    deselect: () => editor.select(null),
    removeSelected: () => {
      if (!editor.selectedId) return
      const shape = editor.shapes.find((s) => s.id === editor.selectedId)
      editor.removeShape(editor.selectedId)
      if (shape && shape.kind === 'pin') {
        mutations.deletePin.mutate(shape.pinId)
      }
    },
    undo: editor.undo,
    redo: editor.redo
  })

  useEffect(() => {
    if (!editor.dirty) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      mutations.save.mutate(
        { captureId, shapes: editor.shapes, imageWidth, imageHeight },
        { onSuccess: () => editor.clearDirty() }
      )
    }, 800)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [editor.dirty, editor.shapes, captureId, imageWidth, imageHeight, mutations.save, editor])

  // Flush on unmount if dirty. Use a ref so the cleanup reads the latest state,
  // not state captured at mount time.
  const editorRef = useRef(editor)
  editorRef.current = editor
  useEffect(() => {
    return () => {
      const e = editorRef.current
      if (e.dirty) {
        mutations.save.mutate({ captureId, shapes: e.shapes, imageWidth, imageHeight })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPinDrop = (x: number, y: number) => {
    const tempShapeId = crypto.randomUUID()
    const tempPinId = crypto.randomUUID()
    const draft: AnnotationShape = { kind: 'pin', id: tempShapeId, pinId: tempPinId, x, y, number: 0 }
    editor.beginDraft(draft)
    editor.commitDraft()
    setPopoverPinShapeId(tempShapeId)
    mutations.upsertPin.mutate(
      { captureId, id: tempPinId, body: '' },
      {
        onSuccess: (pin: AnnotationPin) => {
          editor.updateShape({ ...draft, number: pin.number })
        }
      }
    )
  }

  const popoverShape = editor.shapes.find(
    (s) => s.id === popoverPinShapeId && s.kind === 'pin'
  ) as Extract<AnnotationShape, { kind: 'pin' }> | undefined
  const popoverPin = popoverShape ? bundle?.pins.find((p) => p.id === popoverShape.pinId) : undefined

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-border bg-surface px-2 py-1">
        <button
          type="button"
          onClick={() => {
            setEditing((v) => !v)
            editor.select(null)
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-text-primary hover:bg-canvas"
        >
          {editing ? <><Eye size={14} /> View mode</> : <><Pencil size={14} /> Edit annotations</>}
        </button>
      </div>
      {editing && (
        <AnnotationToolbar
          tool={editor.tool}
          setTool={editor.setTool}
          color={editor.color}
          setColor={editor.setColor}
          strokeWidth={editor.strokeWidth}
          setStrokeWidth={editor.setStrokeWidth}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          onUndo={editor.undo}
          onRedo={editor.redo}
        />
      )}
      <div className="relative flex-1 overflow-auto bg-canvas">
        <AnnotationCanvas
          imageUrl={imageUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          shapes={editor.shapes}
          draft={editor.draft}
          selectedId={editor.selectedId}
          onSelect={editor.select}
          onShapeChange={editor.updateShape}
          editable={editing}
          tool={editor.tool}
          color={editor.color}
          strokeWidth={editor.strokeWidth}
          onDraftBegin={editor.beginDraft}
          onDraftExtend={editor.extendDraft}
          onDraftCommit={editor.commitDraft}
          onPinDrop={onPinDrop}
          onPinClick={(pinId) => {
            const shape = editor.shapes.find((s) => s.kind === 'pin' && s.pinId === pinId)
            if (shape) setPopoverPinShapeId(shape.id)
          }}
          containerWidth={containerWidth}
          containerHeight={containerHeight}
        />
        <PinCommentPopover
          open={popoverPinShapeId != null}
          pinNumber={popoverShape?.number || null}
          initialBody={popoverPin?.body ?? ''}
          saving={mutations.upsertPin.isPending}
          onSave={(body) => {
            if (!popoverShape) return
            mutations.upsertPin.mutate({ captureId, id: popoverShape.pinId, body })
            setPopoverPinShapeId(null)
          }}
          onClose={() => setPopoverPinShapeId(null)}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace the screenshot rendering branch in `CaptureViewer.tsx`**

Find the existing screenshot tab branch (search for `activeTab === 'screenshot'`). Replace its rendered content with:

```tsx
{activeTab === 'screenshot' && screenshotUrl && (
  <ScreenshotTabPanel captureId={capture.id} imageUrl={screenshotUrl} />
)}
```

Add the `ScreenshotTabPanel` component at the bottom of the file (or as a sibling file):

```tsx
function ScreenshotTabPanel({ captureId, imageUrl }: { captureId: string; imageUrl: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [container, setContainer] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  useEffect(() => {
    const img = new window.Image()
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = imageUrl
  }, [imageUrl])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver(() => {
      setContainer({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setContainer({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="flex h-full w-full">
      {dims && container.w > 0 && (
        <AnnotationEditor
          key={captureId}
          captureId={captureId}
          imageUrl={imageUrl}
          imageWidth={dims.w}
          imageHeight={dims.h}
          containerWidth={container.w}
          containerHeight={container.h}
        />
      )}
    </div>
  )
}
```

Add the import at the top of `CaptureViewer.tsx`:

```tsx
import { AnnotationEditor } from './annotation/AnnotationEditor'
```

(`useRef`, `useState`, `useEffect` are likely already imported; if not, add them to the existing React import.)

- [ ] **Step 3: Manual smoke test**

Run: `pnpm dev`

In the running app: open a capture, switch to the Screenshot tab, click "Edit annotations", draw a rectangle, drop a pin, type a body, save. Toggle back to view mode and verify shapes render. Close and reopen the app; verify shapes persist.

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm tsc --noEmit && pnpm lint`

Expected: No errors.

- [ ] **Step 5: Commit**

Run: `git add src/renderer/components/captures/annotation/AnnotationEditor.tsx src/renderer/components/captures/CaptureViewer.tsx && git commit -m "feat(annotations): wire annotation editor into Screenshot tab"`

---

## Task 13: Add `sharp` and `renderAnnotationsSvg`

**Files:**
- Modify: `package.json`
- Create: `src/main/services/renderAnnotationsSvg.ts`
- Create: `tests/main/services/renderAnnotationsSvg.test.ts`

- [ ] **Step 1: Install `sharp`**

Run: `pnpm add sharp`

- [ ] **Step 2: Write the failing SVG generator tests**

Create `tests/main/services/renderAnnotationsSvg.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderAnnotationsSvg } from '@main/services/renderAnnotationsSvg'
import type { AnnotationShape } from '@shared/types'

describe('renderAnnotationsSvg', () => {
  it('returns empty SVG for empty shapes', () => {
    const svg = renderAnnotationsSvg([], 100, 80)
    expect(svg).toContain('<svg')
    expect(svg).toContain('width="100"')
    expect(svg).toContain('height="80"')
    expect(svg).toContain('viewBox="0 0 100 80"')
  })

  it('renders a rect', () => {
    const shapes: AnnotationShape[] = [
      { kind: 'rect', id: 'a', x: 10, y: 20, w: 30, h: 40, stroke: '#ff0000', strokeWidth: 3 }
    ]
    const svg = renderAnnotationsSvg(shapes, 100, 100)
    expect(svg).toContain('<rect')
    expect(svg).toContain('x="10"')
    expect(svg).toContain('y="20"')
    expect(svg).toContain('width="30"')
    expect(svg).toContain('height="40"')
    expect(svg).toContain('stroke="#ff0000"')
    expect(svg).toContain('fill="none"')
  })

  it('renders a highlight as a translucent rect', () => {
    const svg = renderAnnotationsSvg(
      [{ kind: 'highlight', id: 'h', x: 0, y: 0, w: 10, h: 10, color: '#ffff00' }],
      100, 100
    )
    expect(svg).toContain('fill="#ffff00"')
    expect(svg).toContain('fill-opacity="0.4"')
  })

  it('renders a redact as solid black', () => {
    const svg = renderAnnotationsSvg(
      [{ kind: 'redact', id: 'r', x: 5, y: 5, w: 20, h: 20, mode: 'solid' }],
      100, 100
    )
    expect(svg).toContain('fill="#000000"')
  })

  it('renders an arrow with marker-end', () => {
    const svg = renderAnnotationsSvg(
      [{ kind: 'arrow', id: 'ar', x1: 0, y1: 0, x2: 50, y2: 50, stroke: '#00ff00', strokeWidth: 2 }],
      100, 100
    )
    expect(svg).toContain('<defs>')
    expect(svg).toContain('marker')
    expect(svg).toContain('<line')
    expect(svg).toContain('x1="0"')
    expect(svg).toContain('x2="50"')
    expect(svg).toContain('marker-end="url(#arrow)"')
  })

  it('renders a pin as numbered circle', () => {
    const svg = renderAnnotationsSvg(
      [{ kind: 'pin', id: 'p', x: 25, y: 35, number: 7, pinId: 'pin-7' }],
      100, 100
    )
    expect(svg).toContain('<circle')
    expect(svg).toContain('cx="25"')
    expect(svg).toContain('cy="35"')
    expect(svg).toContain('>7</text>')
  })
})
```

- [ ] **Step 3: Verify the test fails**

Run: `pnpm test tests/main/services/renderAnnotationsSvg.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the SVG generator**

Create `src/main/services/renderAnnotationsSvg.ts`:

```typescript
import type { AnnotationShape } from '@shared/types'

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

const PIN_RADIUS = 14

function shapeToSvg(s: AnnotationShape): string {
  if (s.kind === 'rect') {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" stroke="${escape(s.stroke)}" stroke-width="${s.strokeWidth}" fill="${s.fill ? escape(s.fill) : 'none'}" />`
  }
  if (s.kind === 'highlight') {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${escape(s.color)}" fill-opacity="0.4" stroke="none" />`
  }
  if (s.kind === 'redact') {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="#000000" stroke="none" />`
  }
  if (s.kind === 'arrow') {
    return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${escape(s.stroke)}" stroke-width="${s.strokeWidth}" marker-end="url(#arrow)" />`
  }
  if (s.kind === 'pin') {
    return [
      `<circle cx="${s.x}" cy="${s.y}" r="${PIN_RADIUS}" fill="#ef4444" stroke="#ffffff" stroke-width="2" />`,
      `<text x="${s.x}" y="${s.y + 5}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff">${s.number}</text>`
    ].join('')
  }
  return ''
}

export function renderAnnotationsSvg(
  shapes: AnnotationShape[],
  width: number,
  height: number
): string {
  const body = shapes.map(shapeToSvg).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>`,
    body,
    `</svg>`
  ].join('')
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test tests/main/services/renderAnnotationsSvg.test.ts`

Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

Run: `git add package.json pnpm-lock.yaml src/main/services/renderAnnotationsSvg.ts tests/main/services/renderAnnotationsSvg.test.ts && git commit -m "feat(annotations): add sharp and renderAnnotationsSvg"`

---

## Task 14: Burn pipeline + export integration

**Files:**
- Create: `src/main/services/burnAnnotations.ts`
- Create: `tests/main/services/burnAnnotations.test.ts`
- Modify: `src/main/services/export.ts`
- Modify: `tests/main/services/export.test.ts`

- [ ] **Step 1: Write the failing burn-pipeline test**

Create `tests/main/services/burnAnnotations.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { burnAnnotations } from '@main/services/burnAnnotations'
import type { CaptureAnnotations } from '@shared/types'

async function makeWhitePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  }).png().toBuffer()
}

describe('burnAnnotations', () => {
  it('returns the original PNG unchanged when there are no shapes', async () => {
    const orig = await makeWhitePng(100, 100)
    const annotations: CaptureAnnotations = {
      captureId: 'cap-1', schemaVersion: 1, shapes: [],
      imageWidth: 100, imageHeight: 100,
      updatedAt: new Date().toISOString(), updatedBy: null
    }
    const out = await burnAnnotations(orig, annotations)
    const outRaw = await sharp(out).raw().toBuffer()
    const origRaw = await sharp(orig).raw().toBuffer()
    expect(outRaw.equals(origRaw)).toBe(true)
  })

  it('burns a redact rect as solid black pixels', async () => {
    const orig = await makeWhitePng(100, 100)
    const annotations: CaptureAnnotations = {
      captureId: 'cap-1', schemaVersion: 1,
      shapes: [{ kind: 'redact', id: 'r', x: 20, y: 20, w: 40, h: 40, mode: 'solid' }],
      imageWidth: 100, imageHeight: 100,
      updatedAt: new Date().toISOString(), updatedBy: null
    }
    const out = await burnAnnotations(orig, annotations)
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    const pixelAt = (x: number, y: number): [number, number, number] => {
      const idx = (y * info.width + x) * info.channels
      return [data[idx], data[idx + 1], data[idx + 2]]
    }
    expect(pixelAt(40, 40)).toEqual([0, 0, 0])
    expect(pixelAt(80, 80)).toEqual([255, 255, 255])
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm test tests/main/services/burnAnnotations.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `burnAnnotations`**

Create `src/main/services/burnAnnotations.ts`:

```typescript
import sharp from 'sharp'
import type { CaptureAnnotations } from '@shared/types'
import { renderAnnotationsSvg } from './renderAnnotationsSvg'

export async function burnAnnotations(
  pngBuffer: Buffer,
  annotations: CaptureAnnotations
): Promise<Buffer> {
  if (annotations.shapes.length === 0) return pngBuffer
  const svg = renderAnnotationsSvg(
    annotations.shapes,
    annotations.imageWidth,
    annotations.imageHeight
  )
  return sharp(pngBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
}
```

- [ ] **Step 4: Run the burn tests**

Run: `pnpm test tests/main/services/burnAnnotations.test.ts`

Expected: PASS.

- [ ] **Step 5: Wire into `generateReport`**

In `src/main/services/export.ts`:

(a) Add imports at the top:

```typescript
import { getAnnotations } from './annotations'
import { burnAnnotations } from './burnAnnotations'
import type { AnnotationPin } from '@shared/types'
```

(b) Extend `ExportData` (around line 8):

```typescript
interface ExportData {
  caseName: string
  caseDescription: string
  dateRange: { first: string; last: string } | null
  investigatorName: string
  exportTimestamp: string
  captures: Capture[]
  verifications: HashVerification[]
  screenshots: Map<string, string>
  pins: Map<string, AnnotationPin[]>
}
```

(c) Initialise `pins: new Map()` in the `data` object (around line 52, alongside the existing `screenshots: new Map()`).

(d) Replace the screenshots loop (lines 60-67) with:

```typescript
if (options.include.screenshots) {
  onProgress?.('Loading screenshots...', 60)
  for (const cap of captures) {
    const screenshotBuffer = readCaptureFile(cap.caseId, cap.id, 'png')
    if (!screenshotBuffer) continue

    let finalBuffer: Buffer = screenshotBuffer
    if (options.include.annotations === 'burned') {
      const bundle = getAnnotations(cap.id)
      if (bundle.annotations) {
        finalBuffer = await burnAnnotations(screenshotBuffer, bundle.annotations)
      }
      data.pins.set(cap.id, bundle.pins)
    }
    data.screenshots.set(cap.id, finalBuffer.toString('base64'))
  }
}
```

(e) Render pin legend in the capture detail block. Find the existing `${screenshot ? <img.../> : ''}` line (around line 152). Replace its surrounding content with:

```typescript
${screenshot ? `<img src="data:image/png;base64,${screenshot}" alt="Screenshot" class="screenshot" />` : ''}
${(() => {
  const pins = data.pins.get(c.id) ?? []
  if (pins.length === 0) return ''
  const items = pins
    .sort((a, b) => a.number - b.number)
    .map((p) => `<li><strong>${p.number}.</strong> ${escapeHtml(p.body)}</li>`)
    .join('')
  return `<ol class="pin-legend">${items}</ol>`
})()}
```

(f) Add `escapeHtml` helper near the top of `export.ts` if it isn't already present:

```typescript
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
```

(g) Add legend styling. Find the `.screenshot` CSS rule (around line 217) and append:

```css
.pin-legend { font-size: 0.875rem; line-height: 1.4; padding-left: 1.5rem; }
.pin-legend li { margin: 0.25rem 0; }
```

- [ ] **Step 6: Add an end-to-end export test**

Append to `tests/main/services/export.test.ts`:

```typescript
import sharp from 'sharp'
import { saveAnnotations } from '../../../src/main/services/annotations'
import { getCapturePath } from '../../../src/main/services/storage'

it('burns annotations into the embedded screenshot when include.annotations is burned', async () => {
  // Create a case and a capture.
  const c = createCase({ name: 'Burn' })
  const cap = insertCapture({
    caseId: c.id,
    url: 'https://example.com',
    title: 'X',
    hash: 'h',
    timestamp: new Date().toISOString()
  })
  // Ensure the case directory exists, then write a 100x100 white PNG.
  ensureCaseDir(c.id)
  const pngPath = getCapturePath(c.id, cap.id, 'png')
  const white = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  }).png().toBuffer()
  writeFileSync(pngPath, white)

  // Save a redact at (20,20) sized 40x40.
  saveAnnotations({
    captureId: cap.id,
    shapes: [{ kind: 'redact', id: 'r', x: 20, y: 20, w: 40, h: 40, mode: 'solid' }],
    imageWidth: 100,
    imageHeight: 100
  })

  // Generate the report.
  const outPath = join(tempDir, 'report.html')
  const options: ExportOptions = {
    format: 'html',
    include: {
      captures: true,
      screenshots: true,
      auditTrail: false,
      annotations: 'burned'
    },
    investigatorName: 'Tester',
    outputPath: outPath
  }
  await generateReport(c.id, options)

  // Extract the embedded base64 PNG and verify the burned redact pixels.
  const html = readFileSync(outPath, 'utf-8')
  const match = html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)
  if (!match) throw new Error('No base64 image found in exported HTML')
  const buf = Buffer.from(match[1], 'base64')
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const pixelAt = (x: number, y: number): [number, number, number] => {
    const idx = (y * info.width + x) * info.channels
    return [data[idx], data[idx + 1], data[idx + 2]]
  }
  expect(pixelAt(40, 40)).toEqual([0, 0, 0])
  expect(pixelAt(80, 80)).toEqual([255, 255, 255])
})
```

This test reuses the file's existing `tempDir`, `caseId` setup pattern, `initStorage(...)`, and `initDatabase(...)` from the surrounding `beforeEach`. If your branch's `export.test.ts` does not yet import `ensureCaseDir`, add it to the existing storage import line.

- [ ] **Step 7: Update existing `export.test.ts` callers**

Search `tests/main/services/export.test.ts` for `include: {` and add `annotations: 'none'` to every existing test's options literal so they continue to compile.

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm tsc --noEmit && pnpm test tests/main`

Expected: All tests pass.

- [ ] **Step 9: Commit**

Run: `git add src/main/services/burnAnnotations.ts src/main/services/export.ts tests/main/services/burnAnnotations.test.ts tests/main/services/export.test.ts && git commit -m "feat(annotations): burn annotations into export PNGs"`

---

## Task 15: Expose `include.annotations` in the export dialog UI

**Files:**
- Modify: `src/renderer/components/export/ExportDialog.tsx` (and any other file under `src/renderer/components/export/` that constructs `ExportOptions`)

- [ ] **Step 1: Find every constructor of `ExportOptions.include`**

Run: `pnpm tsc --noEmit`

Expected: TypeScript errors listing every file that constructs an `include: { ... }` literal without the new `annotations` field.

- [ ] **Step 2: Add a UI control for the new option**

In the export dialog component, near the existing screenshot/audit-trail toggles, add:

```tsx
<label className="flex items-center gap-2 text-sm text-text-primary">
  <input
    type="checkbox"
    checked={options.include.annotations === 'burned'}
    onChange={(e) =>
      setOptions({
        ...options,
        include: {
          ...options.include,
          annotations: e.target.checked ? 'burned' : 'none'
        }
      })
    }
  />
  Burn annotations into screenshots
</label>
```

The default value when the dialog opens should be `'burned'` (consistent with the spec).

For any non-UI default `ExportOptions` literal (e.g., a `DEFAULT_EXPORT_OPTIONS` constant), set `annotations: 'burned'` there as well.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm tsc --noEmit && pnpm lint`

Expected: Clean.

- [ ] **Step 4: Commit**

Run: `git add src/renderer/components/export/ && git commit -m "feat(annotations): expose annotations toggle in export dialog"`

---

## Task 16: E2E test

**File:** Create: `e2e/annotation.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `e2e/annotation.spec.ts`:

```typescript
import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'path'

test('draw, persist, and reload annotations', async () => {
  const app = await electron.launch({ args: [join(__dirname, '..', 'out', 'main', 'index.js')] })
  const page = await app.firstWindow()

  // Use this project's existing helpers to create a case and a capture with
  // a screenshot. The remainder of the test assumes such a capture is open
  // and the Screenshot tab is active.
  await page.getByRole('tab', { name: 'screenshot' }).click()
  await page.getByRole('button', { name: 'Edit annotations' }).click()
  await page.getByRole('button', { name: 'Rectangle' }).click()

  const canvas = page.locator('canvas').first()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas has no bounding box')

  await page.mouse.move(box.x + 50, box.y + 50)
  await page.mouse.down()
  await page.mouse.move(box.x + 150, box.y + 100)
  await page.mouse.up()

  // Wait for debounced save (800ms + buffer)
  await page.waitForTimeout(1200)

  // Switch tabs and back to verify persistence.
  await page.getByRole('tab', { name: 'metadata' }).click()
  await page.getByRole('tab', { name: 'screenshot' }).click()

  const shapeCount = await page.evaluate(() => {
    const stages = (window as unknown as { Konva?: { stages: unknown[] } }).Konva?.stages ?? []
    let total = 0
    for (const s of stages as Array<{ find: (q: string) => unknown[] }>) {
      total += s.find('Rect').length
    }
    return total
  })
  expect(shapeCount).toBeGreaterThan(0)

  await app.close()
})
```

If `window.Konva` is not exposed by the React Konva module bundling, replace the assertion with a pixel sample from `await canvas.screenshot()` and assert non-white pixels at the drawn rect.

- [ ] **Step 2: Run the E2E test**

Run: `pnpm test:e2e annotation.spec.ts`

Expected: PASS. (If the project doesn't yet have ergonomic E2E helpers for "create case + drop capture", adapt the test setup to match other e2e specs that already exist.)

- [ ] **Step 3: Commit**

Run: `git add e2e/annotation.spec.ts && git commit -m "test(annotations): e2e annotation persistence"`

---

## Task 17: Forensic-integrity regression test

**File:** Modify: `tests/main/services/manifest.test.ts`

- [ ] **Step 1: Add the regression test**

Append to `tests/main/services/manifest.test.ts`:

```typescript
import { initDatabase, closeDatabase, createCase, insertCapture } from '@main/services/database'
import { saveAnnotations } from '@main/services/annotations'

describe('manifest x annotations forensic invariants', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-forensic-'))
    initManifest(tempDir)
    initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('saving annotations does not modify the manifest file or break the chain', () => {
    const c = createCase({ name: 'Forensic' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      timestamp: '2026-04-25T12:00:00.000Z'
    })
    appendManifestEntry(tempDir, {
      type: 'capture',
      caseId: c.id,
      captureId: cap.id,
      url: 'https://example.com',
      timestamp: '2026-04-25T12:00:00.000Z',
      contentHash: 'a'.repeat(64),
      toolVersion: '0.1.0',
      operatorId: 'op'
    })

    const manifestPath = join(tempDir, 'manifest.jsonl')
    const before = readFileSync(manifestPath, 'utf-8')

    saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'rect', id: 'r', x: 0, y: 0, w: 1, h: 1, stroke: '#000', strokeWidth: 1 }],
      imageWidth: 100,
      imageHeight: 100
    })

    const after = readFileSync(manifestPath, 'utf-8')
    expect(after).toBe(before)
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true })
  })
})
```

If `appendManifestEntry`'s payload shape on your branch differs from the one above, copy the shape used by the existing `appendManifestEntry` calls earlier in the same test file.

- [ ] **Step 2: Run**

Run: `pnpm test tests/main/services/manifest.test.ts`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

Run: `git add tests/main/services/manifest.test.ts && git commit -m "test(annotations): assert manifest chain unaffected by annotations"`

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 2: E2E suite**

Run: `pnpm test:e2e`

Expected: PASS.

- [ ] **Step 3: Typecheck and lint everything**

Run: `pnpm tsc --noEmit && pnpm lint`

Expected: Clean.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`

Manually:
1. Create a case and trigger a capture (extension or fixture).
2. Open the capture, switch to Screenshot tab.
3. Click "Edit annotations". Draw rect, arrow, highlight, redact, drop a pin and type a body.
4. Press `V` for select tool. Click a shape; press `Delete`; press `Ctrl+Z`.
5. Restart the app; verify everything persists.
6. Open Export dialog; confirm "Burn annotations into screenshots" toggle is present and on by default.
7. Export with annotations on; open the resulting HTML; confirm the embedded screenshot has the shapes baked in and the pin legend appears below it.
