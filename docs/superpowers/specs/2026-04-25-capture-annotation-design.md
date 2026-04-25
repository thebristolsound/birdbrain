# Capture Annotation & Markup — Design Spec

**Date:** 2026-04-25
**Status:** Draft

## Context

Birdbrain captures web pages as forensic-grade HTML or MHTML plus a screenshot, with a hash-chained manifest tracking integrity. Today, investigators can attach freeform `Note` records to captures, but they can't visually mark up the screenshot itself: no boxes around suspicious elements, no redactions over PII, no numbered pins for review/handoff. This forces investigators to either reach for an external tool (Skitch, Snagit, etc.), losing provenance, or to write text-only notes that don't show *where* on the page they're talking about.

This spec adds visual annotation directly inside the `CaptureViewer`: drawn shapes and numbered pinned comments overlaid on the screenshot. Annotations are stored as structured vector data so the original screenshot stays untouched (preserving the hash chain), and they are burned into a flat PNG only at export time.

## Goals

- Let investigators draw shapes and drop pinned comments on a capture's screenshot.
- Preserve forensic integrity: original screenshot bytes and the hash-chained manifest are never modified.
- Keep annotations editable forever — vector-first storage, never destructive.
- Provide clean burned-in PNG output at export time for handoff / reports.
- Make pin comments searchable across a case via FTS.

## Non-Goals

- Annotating the live HTML/MHTML page view (sandboxed webview, much harder; revisit later if needed).
- Multi-user collaboration / real-time presence.
- Annotation versioning or revision history (latest state wins).
- Annotation diffing or audit trail beyond `updated_at` / `updated_by`.
- Annotating in-flight; this is post-capture only.

## Design

### Decisions captured during brainstorming

| Decision        | Choice                                                                                |
|-----------------|---------------------------------------------------------------------------------------|
| Annotation kinds| Screenshot markup + numbered pinned comments                                          |
| Surface         | Screenshot only                                                                       |
| Storage model   | Vector JSON (always editable) + burned PNG at export time                             |
| Toolset         | Rectangle, arrow, highlight, text label, redact (solid/blur), pin, crop, free-draw    |
| UI placement    | Edit toggle inside the existing **Screenshot** tab (no new tab)                       |
| Canvas tech     | `react-konva` + `konva` (canvas, with `Transformer` for selection/resize)             |

### Architecture

```
Screenshot tab (CaptureViewer)
├── view mode      → <KonvaStage> renders image + annotation layer (read-only)
└── edit mode      → <KonvaStage> with toolbar; pointer events build/edit shapes
                       │
                       └── debounced save → IPC `annotations:save` → SQLite
                                                                       │
Export pipeline ──── on export, hidden offscreen Konva stage renders ─┘
                     image + shapes → PNG buffer → written next to original
                     screenshot in the export bundle. Original screenshot
                     and its hash-chained manifest entry are NEVER modified.
```

Invariants:

- One annotation set per capture (1:1). No versioning in v1; latest state wins.
- Original `screenshotPath` and the capture's `entryHash` are immutable.
- Annotations are ignored by hash verification — they live in their own tables and are listed in a *separate* `annotations-manifest.json` at export time, hashed independently.
- Pinned comments are first-class shapes: number + position live in the shapes array; body lives normalized in `annotation_pins` and is indexed by an `annotation_pins_fts` virtual table.

### Data model

**Migration v13** adds two tables and one FTS virtual table:

```sql
CREATE TABLE annotations (
  capture_id     TEXT PRIMARY KEY REFERENCES captures(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  shapes_json    TEXT NOT NULL,
  image_width    INTEGER NOT NULL,
  image_height   INTEGER NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT
);

CREATE TABLE annotation_pins (
  id          TEXT PRIMARY KEY,
  capture_id  TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_annotation_pins_capture ON annotation_pins(capture_id);

CREATE VIRTUAL TABLE annotation_pins_fts USING fts5(
  body,
  content='annotation_pins',
  content_rowid='rowid'
);
-- Triggers to keep annotation_pins_fts in sync follow the existing
-- notes_fts pattern (insert/update/delete triggers on annotation_pins).
```

Why two tables: shape geometry is saved atomically as a single JSON blob (one row per capture). Pin *bodies* are normalized so they participate in FTS, can be listed in case-level pin views later, and survive transient shape deletes during editing — pin records are not auto-deleted when a pin shape is removed; they are soft-orphaned and reclaimed on undo. Hard deletion happens only on explicit user action (delete pin) or capture delete (cascade).

**Pin number stability**: numbers do not renumber on delete. If pins 1, 2, 3 exist and 2 is deleted, the remaining pins stay 1 and 3. New pins take `MAX(number) + 1`. This keeps already-exported reports referring to "pin 3" stable.

**ID generation**: shape `id` and pin `id` are UUID v4, generated client-side. `schemaVersion` ships as `1`.

**`updated_by`**: populated from the existing operator configuration in settings (`OperatorConfig`). When no operator is set, it is `NULL`.

**Shared types** (added to `src/shared/types.ts`):

```ts
export type AnnotationShape =
  | { kind: 'rect'      ; id: string; x:number; y:number; w:number; h:number; stroke:string; strokeWidth:number; fill?:string }
  | { kind: 'arrow'     ; id: string; x1:number; y1:number; x2:number; y2:number; stroke:string; strokeWidth:number }
  | { kind: 'highlight' ; id: string; x:number; y:number; w:number; h:number; color:string }
  | { kind: 'text'      ; id: string; x:number; y:number; text:string; color:string; fontSize:number }
  | { kind: 'redact'    ; id: string; x:number; y:number; w:number; h:number; mode:'solid'|'blur' }
  | { kind: 'crop'      ; id: string; x:number; y:number; w:number; h:number }   // singleton
  | { kind: 'freedraw'  ; id: string; points:number[]; stroke:string; strokeWidth:number }
  | { kind: 'pin'       ; id: string; x:number; y:number; number:number; pinId:string }

export interface CaptureAnnotations {
  captureId:      string
  schemaVersion:  number
  shapes:         AnnotationShape[]
  imageWidth:     number
  imageHeight:    number
  updatedAt:      string
  updatedBy?:     string
}

export interface AnnotationPin {
  id:         string
  captureId:  string
  number:     number
  body:       string
  createdAt:  string
  updatedAt:  string
}
```

All coordinates are **image-space pixels**, not viewport pixels — invariant to window size and zoom level. `imageWidth` / `imageHeight` are validated at load time against the actual screenshot dimensions; mismatch is surfaced as a non-fatal warning (annotations still render at original coords).

`crop` is a singleton — at most one per capture. The editor enforces this. At export time, when `crop` is present, the burned image is clipped to the crop rect.

### IPC + main-process service

New file `src/main/services/annotations.ts` wraps SQL access. New `annotations` domain in `src/shared/ipc.ts`:

| Channel                       | Payload                                                            | Returns                                |
|-------------------------------|--------------------------------------------------------------------|----------------------------------------|
| `annotations:get`             | `captureId`                                                        | `{ annotations, pins } \| null`        |
| `annotations:save`            | `{ captureId, shapes, imageWidth, imageHeight }`                   | `CaptureAnnotations`                   |
| `annotations:delete`          | `captureId`                                                        | `void`                                 |
| `annotations:upsertPin`       | `{ captureId, id?, number, body }`                                 | `AnnotationPin`                        |
| `annotations:deletePin`       | `pinId`                                                            | `void`                                 |
| `annotations:searchPins`      | `{ caseId, query }`                                                | `AnnotationPin[]`                      |
| `annotations:burnPng`         | `{ captureId, dataUrl }`                                           | `{ path: string }`                     |

`burnPng` is the export-time hand-off: the renderer mounts a hidden, image-sized Konva `Stage`, calls `toDataURL({ pixelRatio: 1, mimeType: 'image/png' })`, and ships it to main, which writes `<screenshot-base>.annotated.png` next to the original.

Renderer side: a new `useAnnotations(captureId)` hook in `src/renderer/lib/queries.ts` matches the existing `useNotesMutations` shape — query factory + invalidation rules (invalidate on save, on pin upsert/delete).

### Editor component

New directory `src/renderer/components/captures/annotation/`:

```
annotation/
├── AnnotationCanvas.tsx        # Konva Stage; shared by view & edit modes
├── AnnotationToolbar.tsx       # tool picker, color, stroke, undo/redo
├── PinCommentPopover.tsx       # body editor for a numbered pin
├── shapes/
│   ├── RectShape.tsx
│   ├── ArrowShape.tsx
│   ├── TextShape.tsx
│   ├── RedactShape.tsx
│   ├── CropOverlay.tsx
│   ├── FreedrawShape.tsx
│   └── PinShape.tsx
├── useAnnotationEditor.ts      # tool state, draft shape, undo/redo, dirty flag
└── burnAnnotatedPng.ts         # offscreen Stage → PNG dataURL
```

**Tool state** (`useAnnotationEditor`, locally scoped — *not* added to global `appStore`):

```ts
type Tool =
  | 'select' | 'rect' | 'arrow' | 'highlight' | 'text'
  | 'redact-solid' | 'redact-blur' | 'crop' | 'freedraw' | 'pin'

interface EditorState {
  tool: Tool
  color: string
  strokeWidth: number
  shapes: AnnotationShape[]
  selectedId: string | null
  draft: AnnotationShape | null
  undoStack: AnnotationShape[][]
  redoStack: AnnotationShape[][]
  dirty: boolean
}
```

**Stage rendering**:

- Single `<Stage width={imageWidth} height={imageHeight}>` sized in image-space pixels, wrapped in a `<div>` that scales with CSS `transform: scale(fit)`. The Konva coordinate system stays in image-space — no zoom math leaks into shape coordinates.
- Layers, in z-order:
  1. **Background layer** — the screenshot via `<KonvaImage>` from a `useImage` hook, cached once for filter use.
  2. **Redact-blur layer** — for each `redact` shape with `mode:'blur'`, a `<Group clip={...}>` containing a duplicate of the cached background image with `filters={[Konva.Filters.Blur]}` and `blurRadius`. Solid redacts are black `<Rect>`s on this layer.
  3. **Markup layer** — rects, arrows, highlights (translucent `Rect`), free-draw `<Line tension={0.5} lineCap="round">`, text labels.
  4. **Pin layer** — numbered circles, always on top, never affected by crop or redact at view time.
  5. **Crop overlay layer** (edit mode only) — four dimming rectangles around the crop rect.
  6. **Transformer layer** (edit mode only) — single `<Transformer>` whose `nodes()` is set to the selected shape's ref.

**Pointer flow** (edit mode):

- `Stage.onMouseDown` — if active tool isn't `select`, create a `draft` shape from the pointer position.
- `onMouseMove` — extend the draft (resize rect, move arrow endpoint, append free-draw point).
- `onMouseUp` — push prior `shapes` to `undoStack`, commit `draft` to `shapes`, clear `draft`.
- Pin tool is a single click: drop the pin and immediately open `PinCommentPopover` for the body.
- `select` tool selects on click; `Transformer` attaches to the selected shape's ref via `useEffect`.

**View mode**: same component with toolbar / transformer / crop overlay hidden and shapes set `listening={false}`. Pin clicks still open the popover read-only so reviewers can read comments.

**Persistence**: a debounced 800ms `annotations:save` fires on `dirty` flip. On unmount with `dirty === true`, flush synchronously.

### Export integration

`ExportOptions` gains `includeAnnotations: 'none' | 'sidecar' | 'burned' | 'both'` (default `'sidecar'`).

| Mode      | Export bundle contents                                                               |
|-----------|--------------------------------------------------------------------------------------|
| `none`    | Original screenshot + capture manifest only.                                         |
| `sidecar` | Original screenshot + `annotations.json` (typed shape array + pins).                 |
| `burned`  | Original screenshot + `screenshot.annotated.png` (flat PNG with shapes baked in).    |
| `both`    | Both `annotations.json` and `screenshot.annotated.png`.                              |

**Burn-in pipeline** (renderer-side):

1. Append a `display:none` `<div>` to `document.body`, sized to `imageWidth × imageHeight`.
2. Mount a transient Konva `Stage` into it using the same `AnnotationCanvas` rendering, with `pinsAsOverlay: true` (pins burn as numbered solid circles, no popover).
3. If a `crop` shape exists, the Stage is sized to the crop rect and the image is offset accordingly.
4. `stage.toDataURL({ mimeType: 'image/png', pixelRatio: 1 })` → POST to main via `annotations:burnPng`.
5. Main writes `<captureId>/screenshot.annotated.png`. In `burned`-only mode, main also writes a sibling `pins.json` (pin number → body) so the burned image is decodable without DB access. In `sidecar` and `both` modes, pin bodies already live inside `annotations.json`, so no extra `pins.json` is written.
6. Stage is destroyed; div is removed from the DOM.

**Forensic integrity**:

- The hash-chained capture manifest is computed over the *original* screenshot only.
- Burned and sidecar files are listed in a new, separate `annotations-manifest.json` (placed at the export bundle root, alongside the main capture manifest) and hashed independently.
- Verification logic walking `screenshotPath` is unaffected; `annotated.png` files are excluded from any capture-format-based queries.

### Testing

**Unit tests** (`tests/main/services/annotations.test.ts`):

- create / get / update / delete round-trip
- pin upsert maintains ascending `number` per capture (with stability across deletes)
- pin FTS returns hits scoped to a single case
- cascade-delete: deleting a capture removes its annotations + pins
- migration v13 applies cleanly on a v12 DB

**Renderer tests** (`tests/renderer/`):

- `useAnnotationEditor`: undo / redo stack ordering, draft commit, dirty flag transitions
- `burnAnnotatedPng`: deterministic PNG output for a fixed shape set (snapshot a hash of the resulting buffer)

**E2E** (`e2e/`):

- Open a capture, draw rect + arrow + pin, reload, see the same shapes.
- Add a redact-blur, export with `burned` mode, verify exported PNG has bytes inside the redact rect blurred (sample pixels).
- Verify capture hash chain still validates after annotations are added and saved.

## Risks & open questions

1. **Konva.Filters.Blur on huge screenshots** — full-page captures can exceed 8000 px tall. Blur requires `cache()`, which allocates an offscreen canvas of that size per blurred region. Mitigation: cache a single shrunk copy of the source image once and reuse it for all blur groups, upscaling on draw, or fall back to a CSS-style box-blur that doesn't require image caching.
2. **Off-screen Stage during export** — Konva Stages need a real DOM container with non-zero size. The detached-`<div>` approach works only if it is in the document tree (`display:none` is fine; `visibility:hidden` and zero-size are not).
3. **Pin numbering after deletes** — design choice: numbers are stable (no renumbering). Documented above; revisit if users complain about gaps.
4. **Bundle weight** — `konva` is ~250 KB minified, `react-konva` ~10 KB, `use-image` <1 KB. Acceptable for an Electron app; flagged here so a future bundle-size review knows where it came from.
5. **`use-image` maintenance** — small MIT library; if it disappears we can inline the hook in ~20 lines.

## Build sequence

1. Migration v13 + main-process `annotations.ts` service + IPC channels.
2. Shared types + renderer query/mutation hooks.
3. Bare read-only `AnnotationCanvas` rendering shapes from a fixture (no editor).
4. `useAnnotationEditor` + toolbar + draft pointer flow for rect/arrow/highlight/text/freedraw.
5. Selection + `Transformer` for resize/move; undo/redo.
6. Pin tool + `PinCommentPopover` + pin FTS search.
7. Redact (solid then blur) + crop overlay.
8. View mode wiring inside `CaptureViewer` Screenshot tab.
9. `burnAnnotatedPng` + export integration (`includeAnnotations` option).
10. E2E coverage and forensic-integrity tests.

Each step lands behind a working app — no half-states.
