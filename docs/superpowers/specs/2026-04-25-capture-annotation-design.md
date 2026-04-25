# Capture Annotation & Markup — Design Spec

**Date:** 2026-04-25
**Status:** Draft (revised after independent review)

## Context

Birdbrain captures web pages as forensic-grade HTML or MHTML plus a screenshot, with a hash-chained manifest tracking integrity. Today, investigators can attach freeform `Note` records to captures, but they can't visually mark up the screenshot itself: no boxes around suspicious elements, no redactions over PII, no numbered pins for review/handoff. This forces investigators to either reach for an external tool (Skitch, Snagit, etc.), losing provenance, or to write text-only notes that don't show *where* on the page they're talking about.

This spec adds visual annotation directly inside the `CaptureViewer`: drawn shapes and numbered pinned comments overlaid on the screenshot. Annotations are stored as structured vector data so the original screenshot stays untouched (preserving the hash chain), and they are burned into a flat PNG only at export time, by the main process.

## Goals

- Let investigators draw shapes and drop pinned comments on a capture's screenshot.
- Preserve forensic integrity: original screenshot bytes and the hash-chained manifest are never modified.
- Keep annotations editable forever — vector-first storage, never destructive.
- Provide clean burned-in PNG output at export time, generated server-side.

## Non-Goals (deferred to v1.1)

- Free-draw / pen tool, text labels, crop, and `redact-blur` mode. Cut from v1 to control scope; rationale below.
- Annotating the live HTML/MHTML page view (sandboxed webview, much harder).
- Multi-user collaboration / real-time presence.
- Annotation versioning or revision history (latest state wins).
- Case-level pin search UI / FTS over pin bodies (no UI calls for it in v1).

## Design

### Decisions captured during brainstorming and review

| Decision        | Choice                                                                                |
|-----------------|---------------------------------------------------------------------------------------|
| Annotation kinds| Screenshot markup + numbered pinned comments                                          |
| Surface         | Screenshot only                                                                       |
| Storage model   | Vector JSON (always editable) + burned PNG at export time                             |
| v1 toolset      | Rectangle, arrow, highlight, pin, redact-solid                                        |
| UI placement    | Edit toggle inside the existing **Screenshot** tab (no new tab)                       |
| Editor canvas   | `react-konva` + `konva` in the renderer (with `Transformer` for selection/resize)     |
| Burn pipeline   | **Main process**, using `sharp` to composite a generated SVG over the screenshot      |

### Why these v1 cuts

- **`redact-blur` cut, only `redact-solid` ships.** Investigators trust redaction to hide PII. Konva's `Filters.Blur` requires `cache()` which allocates an offscreen canvas the size of the source for each blurred region; on full-page captures (often 8000+ px tall) that's expensive *and* mitigations (shrunk source, upscale) make the blur visibly weaker than expected. A pixel-leaky blur is worse than no blur because it gives false confidence. Solid-fill redaction is unambiguous and fast.
- **Crop cut.** Crop interacts with everything else (pin coordinate translation at burn time, blur clipping, sidecar manifests). Adding it after the rest works is safer.
- **Free-draw and text cut.** Both add edge cases to selection / `Transformer` (Lines have no clean bounding box; Text needs an inline editor and font handling). Out of scope for v1; the v1 toolset already covers ~80% of investigative markup.
- **`annotation_pins_fts` cut.** No v1 UI consumes it. Add when (and if) a case-level pin search is built.

### Architecture

```
Screenshot tab (CaptureViewer)
├── view mode      → <KonvaStage> renders image + annotation layer (read-only)
└── edit mode      → <KonvaStage> with toolbar; pointer events build/edit shapes
                       │
                       └── debounced save → IPC `annotations:save` → SQLite
                                                                       │
Export pipeline (main process) ────────────────────────────────────────┘
   reads annotations + pins from DB → generates SVG sized to screenshot
   → sharp.composite(SVG) over original PNG → writes screenshot.annotated.png
   into the export bundle. Original screenshot file is never read in
   write mode and the capture's hash-chain manifest entry is unchanged.
```

Invariants:

- One annotation set per capture (1:1). No versioning in v1; latest state wins.
- Original `screenshotPath` and the capture's `entryHash` are immutable.
- Annotations are ignored by hash verification — they live in their own tables and are listed in a *separate* `annotations-manifest.json` at the export bundle root, hashed independently.
- Pinned comments are first-class shapes: number + position live in the shapes array; body lives normalized in `annotation_pins`.

### Data model

**Migration v17** adds two tables:

```sql
CREATE TABLE annotations (
  capture_id     TEXT PRIMARY KEY REFERENCES captures(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  shapes_json    TEXT NOT NULL,
  image_width    INTEGER NOT NULL,
  image_height   INTEGER NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT                -- operator name (denormalized, like captures.operator_name)
);

CREATE TABLE annotation_pins (
  id          TEXT PRIMARY KEY,           -- UUID v4
  capture_id  TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_annotation_pins_capture ON annotation_pins(capture_id);
CREATE INDEX idx_annotation_pins_capture_number ON annotation_pins(capture_id, number);
```

`updated_by` stores the operator name (denormalized, matching `captures.operator_name`). `NULL` when no operator is configured. `schemaVersion` ships as `1`. All `id` fields are UUID v4, generated client-side; `pin.id` is the row PK and is also the value referenced from `shapes_json` so undo can re-insert a deleted pin row deterministically.

**Pin number stability**: numbers are allocated server-side in `annotations:upsertPin` inside a transaction (`SELECT MAX(number) FROM annotation_pins WHERE capture_id = ?`, then insert at `MAX + 1`). The renderer drops a pin shape with `number: undefined`, then receives the assigned number from the IPC response and back-fills it on the shape. While the number is pending, the popover header shows "Pin (saving…)". Numbers do not renumber on delete — gaps are stable so already-exported reports referring to "pin 3" remain valid.

**Pin lifecycle**:

- **Add**: renderer creates a `pin` shape with a fresh UUID for `pinId`, posts `annotations:upsertPin`, gets back the assigned `number`, opens `PinCommentPopover`.
- **Delete (selected pin + Delete key)**: renderer removes the shape from `shapes_json` *and* posts `annotations:deletePin`. Both happen as part of one save round-trip. The pin's body is kept in the undo stack in renderer memory. Undo re-posts an `upsertPin` with the same UUID (gets the same row back) and re-adds the shape.
- **Cascade**: deleting a capture removes its `annotations` row and all its `annotation_pins` rows automatically via `ON DELETE CASCADE`.

**Shared types** (added to `src/shared/types.ts`):

```ts
export type AnnotationShape =
  | { kind: 'rect'      ; id: string; x:number; y:number; w:number; h:number; stroke:string; strokeWidth:number; fill?:string }
  | { kind: 'arrow'     ; id: string; x1:number; y1:number; x2:number; y2:number; stroke:string; strokeWidth:number }
  | { kind: 'highlight' ; id: string; x:number; y:number; w:number; h:number; color:string }     // translucent
  | { kind: 'redact'    ; id: string; x:number; y:number; w:number; h:number; mode:'solid' }     // 'blur' deferred
  | { kind: 'pin'       ; id: string; x:number; y:number; number:number; pinId:string }

export interface CaptureAnnotations {
  captureId:      string
  schemaVersion:  number
  shapes:         AnnotationShape[]
  imageWidth:     number
  imageHeight:    number
  updatedAt:      string
  updatedBy:      string | null
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

All coordinates are **image-space pixels**, not viewport pixels — invariant to window size and editor zoom level. `imageWidth` / `imageHeight` are validated at load time against the actual screenshot dimensions; mismatch is surfaced as a non-fatal warning (annotations still render at original coords).

**Forward compatibility**: when the renderer reads a shape with an unknown `kind`, it is rendered as a labelled placeholder rectangle (using the bounding box if present, otherwise a small marker at `x,y`) with a tooltip indicating the unknown kind. This means the canvas never crashes on shapes added by a future version.

### IPC + main-process service

New file `src/main/services/annotations.ts` wraps SQL access. New `annotations` domain in `src/shared/ipc.ts`. All payload and result types are named, matching the existing `notes` / `selectors` style:

```ts
export interface SaveAnnotationsParams {
  captureId: string
  shapes: AnnotationShape[]
  imageWidth: number
  imageHeight: number
}
export interface UpsertAnnotationPinParams {
  captureId: string
  id?: string                  // present on update or undo-replay; absent for new pin
  body: string
}
export interface AnnotationsBundle {
  annotations: CaptureAnnotations | null
  pins: AnnotationPin[]
}
```

| Channel                       | Params                          | Returns               |
|-------------------------------|---------------------------------|-----------------------|
| `annotations:get`             | `captureId: string`             | `AnnotationsBundle`   |
| `annotations:save`            | `SaveAnnotationsParams`         | `CaptureAnnotations`  |
| `annotations:delete`          | `captureId: string`             | `void`                |
| `annotations:upsertPin`       | `UpsertAnnotationPinParams`     | `AnnotationPin`       |
| `annotations:deletePin`       | `pinId: string`                 | `void`                |

`annotations:get` always returns `AnnotationsBundle` (never `null` at top level) so the renderer hook can render `bundle.pins` without an extra null guard. When no annotations exist, `annotations` is `null` and `pins` is `[]`.

### Renderer query/mutation hooks

Match the existing factory style in `src/renderer/lib/queries.ts`:

```ts
// queryKeys additions
queryKeys.annotations = (captureId: string) => ['annotations', captureId] as const

// reads
export const annotationsQueryOptions = (captureId: string) => queryOptions({
  queryKey: queryKeys.annotations(captureId),
  queryFn: () => window.birdbrain.annotations.get(captureId),
})

// writes
export function useAnnotationsMutations(captureId: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.annotations(captureId) })
  return {
    save:        useMutation({ mutationFn: window.birdbrain.annotations.save,        onSuccess: invalidate }),
    upsertPin:   useMutation({ mutationFn: window.birdbrain.annotations.upsertPin,   onSuccess: invalidate }),
    deletePin:   useMutation({ mutationFn: window.birdbrain.annotations.deletePin,   onSuccess: invalidate }),
    deleteAll:   useMutation({ mutationFn: window.birdbrain.annotations.delete,      onSuccess: invalidate }),
  }
}
```

### Editor component

New directory `src/renderer/components/captures/annotation/`:

```
annotation/
├── AnnotationCanvas.tsx        # Konva Stage; shared by view & edit modes
├── AnnotationToolbar.tsx       # tool picker, color, stroke, undo/redo
├── PinCommentPopover.tsx       # body editor for a numbered pin
├── shapes/
│   ├── RectShape.tsx           # rect + highlight (translucent fill variant)
│   ├── ArrowShape.tsx
│   ├── RedactShape.tsx         # solid black rect only in v1
│   └── PinShape.tsx
├── useAnnotationEditor.ts      # tool state, draft shape, undo/redo, dirty flag
└── annotationKeyboardShortcuts.ts  # Esc / Delete / Ctrl+Z / Ctrl+Shift+Z bindings
```

**Tool state** (`useAnnotationEditor`, locally scoped — *not* added to global `appStore`):

```ts
type Tool = 'select' | 'rect' | 'arrow' | 'highlight' | 'redact' | 'pin'

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

**Last-used style persistence**: `color` and `strokeWidth` are written to `localStorage` under keys `birdbrain.annotation.color` and `birdbrain.annotation.strokeWidth` whenever they change, and re-loaded on editor mount. This survives across captures and sessions without polluting `appStore`.

**Keyboard shortcuts** (active only when the editor is focused):

| Key                 | Action                                          |
|---------------------|-------------------------------------------------|
| `Esc`               | Deselect / cancel current draft                 |
| `Delete` / `Backspace` | Delete selected shape (and pin row if `kind=pin`) |
| `Ctrl/Cmd + Z`      | Undo                                            |
| `Ctrl/Cmd + Shift + Z` | Redo                                         |
| `V`                 | Switch to select tool                            |
| `R` / `A` / `H` / `X` / `P` | Rect / Arrow / Highlight / Redact / Pin |

**Stage rendering**:

- Single `<Stage width={imageWidth} height={imageHeight}>` sized in image-space pixels, wrapped in a `<div>` that scales with CSS `transform: scale(fit)`. The Konva coordinate system stays in image-space — no zoom math leaks into shape coordinates.
- Layers, in z-order:
  1. **Background layer** — the screenshot via `<KonvaImage>` from a `useImage` hook.
  2. **Redact layer** — solid black `<Rect>`s for each `redact` shape.
  3. **Markup layer** — rects, arrows, highlights (translucent `Rect`).
  4. **Pin layer** — numbered circles, always on top.
  5. **Transformer layer** (edit mode only) — single `<Transformer>` whose `nodes()` is set to the selected shape's ref.

**Pointer flow** (edit mode):

- `Stage.onMouseDown` — if active tool isn't `select`, create a `draft` shape from the pointer position.
- `onMouseMove` — extend the draft (resize rect, move arrow endpoint).
- `onMouseUp` — push prior `shapes` to `undoStack`, commit `draft` to `shapes`, clear `draft`.
- Pin tool is a single click: drop the pin and immediately open `PinCommentPopover` for the body.

**View mode**: same component with toolbar / transformer hidden and shapes set `listening={false}`. Pin clicks still open the popover read-only so reviewers can read comments.

**Persistence**: a debounced 800 ms `annotations:save` fires on `dirty` flip. On unmount with `dirty === true`, flush synchronously.

### Export integration — main-process burn

`ExportOptions.include` gains one new field:

```ts
export interface ExportOptions {
  format: 'html' | 'pdf'
  include: {
    captures: boolean
    screenshots: boolean
    auditTrail: boolean
    annotations: 'none' | 'sidecar' | 'burned' | 'both'   // NEW; default 'sidecar'
  }
  investigatorName: string
  outputPath: string
}
```

| Mode      | Export bundle contents                                                               |
|-----------|--------------------------------------------------------------------------------------|
| `none`    | Original screenshot + capture manifest only.                                         |
| `sidecar` | Original screenshot + `annotations.json` (typed shape array + pin records).          |
| `burned`  | Original screenshot + `screenshot.annotated.png` (flat PNG with shapes baked in).    |
| `both`    | Both `annotations.json` and `screenshot.annotated.png`.                              |

**Burn pipeline (main process)**:

1. Read the capture's annotations + pins from SQLite.
2. Generate an SVG document sized exactly to `imageWidth × imageHeight` containing: `<rect>` for rects and redacts, `<line>` (with marker-end) for arrows, `<rect fill-opacity="0.4">` for highlights, `<circle>` + `<text>` for pins. The SVG generator is a small pure function (`renderAnnotationsSvg(annotations: CaptureAnnotations): string`) and is the same code path that produces the legend block in the export report.
3. Use `sharp` to composite the SVG over the original screenshot:
   ```ts
   await sharp(screenshotPath)
     .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
     .png()
     .toFile(annotatedPath)
   ```
4. Write a sibling `pins.json` (pin number → body) only in `burned`-only mode; in `sidecar` and `both` modes the bodies already live inside `annotations.json`.

`sharp` is added as a new main-process dependency. It is widely used in Electron apps and ships prebuilt binaries for win32 / darwin / linux. If install reliability ever becomes a problem on a specific platform, `pureimage` is a pure-JS fallback that supports the small drawing API we use.

The renderer is **not involved** in burn-in. This means export works headless (e.g., from a future CLI) and avoids multi-megabyte dataURLs over IPC.

**Forensic integrity**:

- The hash-chained capture manifest is computed over the *original* screenshot only; this design adds no new code path that touches it.
- Burned and sidecar files are listed in a separate `annotations-manifest.json` placed at the export bundle root, alongside the main capture manifest, and hashed independently using the same canonical-JSON + SHA-256 pattern.
- `readCaptureFile` is exact-match by enum (`'html' | 'png' | 'txt' | 'mhtml'`) so the new `screenshot.annotated.png` filename cannot be accidentally read in place of the original.

### Testing

**Unit tests** (`tests/main/services/annotations.test.ts`):

- create / get / update / delete round-trip
- pin upsert allocates ascending numbers per capture, with stability across deletes
- cascade-delete: deleting a capture removes its annotations + pins
- `renderAnnotationsSvg` is deterministic for a fixed shape set (string snapshot)
- `sharp` composite produces expected pixel values for a 4-shape fixture (sample three pixels)
- migration v17 applies cleanly on a v16 DB

**Renderer tests** (`tests/renderer/`):

- `useAnnotationEditor`: undo / redo stack ordering, draft commit, dirty flag transitions, last-used color persistence to/from `localStorage`
- keyboard shortcut bindings ignore key events when focus is in `PinCommentPopover` textarea

**E2E** (`e2e/`):

- Open a capture, draw rect + arrow + pin, type pin body, reload, see the same shapes and body.
- Add a redact, export with `burned` mode, verify exported PNG has black pixels inside the redact rect.
- Verify capture hash chain still validates after annotations are added and saved.
- Pin-number stability: add three pins, delete pin 2, add another pin, confirm new pin is numbered 4.

## Risks & open questions

1. **`sharp` install on Windows.** Native dep; ships prebuilt binaries for x64 / arm64. Worst case we fall back to `pureimage` (pure JS, slower but no compile). Build infrastructure already handles `better-sqlite3` so the platform story is understood.
2. **Pin number race under fast click.** Server-side allocation in a transaction is the source of truth, but a user double-clicking the pin tool will issue two near-simultaneous `upsertPin` calls. Both will succeed and get distinct numbers; the renderer must reconcile both responses with their respective shape UUIDs (already supported by passing the shape `pinId` through the request).
3. **Konva `Transformer` resize on highlights vs arrows.** Rects and highlights resize cleanly; arrows have two endpoints, so the transformer attaches to the arrow's bounding box and scaling distorts the head/tail proportions. v1 ships transformer enabled for rect/highlight/redact only; arrow editing is move-only (drag the arrow line; endpoints are not individually resizable in v1). Document the limitation; revisit in v1.1 with two-handle endpoint editing.
4. **Bundle weight.** `konva` is ~250 KB minified, `react-konva` ~10 KB, `use-image` <1 KB. Acceptable for an Electron app; flagged here so a future bundle-size review knows where it came from.
5. **Forward compatibility of `shapes_json`.** Unknown shape kinds render as labelled placeholders, so a v2 spec adding (say) `text` doesn't break v1 readers. Documented above; verify with a unit test that exercises a synthetic unknown kind.

## Build sequence

1. Migration v17 + main-process `annotations.ts` service + IPC channels + named param/result types.
2. Shared types + renderer query/mutation hooks (`annotationsQueryOptions`, `useAnnotationsMutations`).
3. Bare read-only `AnnotationCanvas` rendering shapes from a fixture (no editor).
4. `useAnnotationEditor` + toolbar + draft pointer flow for rect / arrow / highlight / redact.
5. Selection + `Transformer` for resize/move (rect / highlight / redact); arrow drag-only.
6. Pin tool + `PinCommentPopover` + server-side number allocation flow.
7. Keyboard shortcuts + last-used style persistence.
8. View mode wiring inside `CaptureViewer` Screenshot tab.
9. `sharp` dep added; `renderAnnotationsSvg` + main-process burn; export `include.annotations` option.
10. E2E coverage and forensic-integrity tests.

Each step lands behind a working app — no half-states.
