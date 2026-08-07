# Annotation Editor — Zoom & Pan Design Spec

**Date:** 2026-04-25
**Status:** Draft

## Context

The capture annotation editor (shipped per `2026-04-25-capture-annotation-design.md`) currently sizes the Konva `Stage` to fit the entire image into the visible container by computing `scale = Math.min(containerW / imageW, containerH / imageH)` (`src/renderer/components/captures/annotation/AnnotationCanvas.tsx:62-65`). For full-page screenshots — the most common capture in Birdbrain, often 8,000+ pixels tall — this collapses the image into a thin, unreadable column. The user can neither read the page content nor place annotations on small UI elements with precision.

This spec adds zoom and pan to the annotation canvas, with a fit-to-width default that solves the readability problem and an opt-in zoom path for pixel-precise annotation.

## Goals

- Make full-page screenshots readable in the editor by default.
- Allow pixel-precise annotation placement on small UI elements via zoom.
- Preserve existing annotation behavior: shapes remain stored in image-space coordinates; the export burn-in pipeline is untouched.
- Match interaction conventions investigators will already know (Figma/Photoshop style: Ctrl+wheel zoom, drag to pan, keyboard shortcuts).

## Non-Goals

- Mini-map / overview panel.
- "Zoom to selection" or "zoom to annotation."
- Free-form rotation of the canvas.
- Persisting zoom/pan state across capture switches or app restarts.
- Touch/pinch gesture support beyond what Mac trackpads emit as `wheel { ctrlKey: true }` (handled for free).

## Design

### Decisions captured during brainstorming

| Decision | Choice |
|---|---|
| Default view on capture open | Fit width with vertical scroll |
| Zoom trigger | Ctrl/Cmd + wheel (anchored on cursor) |
| Pan trigger | Hand tool + left-drag, or middle-mouse drag in any tool |
| Wheel without modifier | Vertical scroll (Shift+wheel = horizontal) |
| State persistence | Reset on capture switch; not persisted |
| Modes covered | Both view and edit modes get zoom/pan |
| Implementation | Inline on existing react-konva Stage, no new dep |

### Architecture

One new hook, light edits to two existing files. No new components.

```
src/renderer/components/captures/annotation/
  AnnotationCanvas.tsx     ← edit: replace fit-to-contain scale with zoom/pan from hook;
                              wire wheel + drag handlers; switch pointer math to
                              stage.getRelativePointerPosition()
  AnnotationEditor.tsx     ← edit: add zoom controls to the header bar (visible in both modes)
  AnnotationToolbar.tsx    ← unchanged
  useZoomPan.ts            ← new: ~80 LOC hook owning { scale, panX, panY } + handlers
  keyboardShortcuts.ts     ← edit: add H, +, -, 0, 1, and Space-hold shortcuts
```

### `useZoomPan` hook

State (the canonical source of truth is `userScale`, expressed relative to fit; absolute `scale` is derived):

- `userScale` — multiplier on `fitScale`. `1` means "exactly fit-width." Stored relative-to-fit so resize naturally preserves the user's zoom level.
- `panX`, `panY` — Stage offset in screen pixels (Konva `x`/`y` on Stage)
- `fitScale` — derived from current image and container dimensions: `min(containerW / imageW, 1)`. Recomputed whenever those inputs change.
- `scale` — derived: `userScale * fitScale`. This is what's applied to the Stage as `scaleX`/`scaleY`.

Actions:

- `fitToWidth(imageW, imageH, containerW, containerH)` — initializes/recomputes inputs, sets `userScale = 1`, centers the image: `panX = max(0, (containerW - imageW * scale) / 2)`; `panY = max(0, (containerH - imageH * scale) / 2)`. Called on mount and when `imageUrl` changes.
- `zoomAt(deltaUserScale, cursorX, cursorY)` — multiplies `userScale` by `deltaUserScale`, adjusts pan so the image pixel under `(cursorX, cursorY)` stays under the cursor. Clamps `userScale` to `[0.5, 8 / fitScale]` so absolute `scale` stays in `[fitScale * 0.5, 8]`.
- `setPan(dx, dy)` — applies a relative pan delta from drag, then clamps so the image cannot leave the viewport entirely (at least `MIN_VISIBLE_PX = 64` of image must remain visible on each axis).
- `reset()` — sets `userScale = 1`, recenters via `fitToWidth(...)` with the last-known dimensions.

Resize behavior: when `containerWidth`/`containerHeight` change, `fitScale` is recomputed; `userScale` is unchanged, so absolute `scale = userScale * fitScale` updates automatically — a user at 2× fit stays at 2× fit. Pan is re-clamped to the new viewport.

### Coordinate spaces

One source of truth: **annotations are stored in image-space pixels.** This is unchanged from today.

- **Image space** = pixels of the original screenshot. The only space that hits storage.
- **Stage space** = image-space × `scale` + `(panX, panY)`. Konva applies this transform automatically when we set `scaleX/scaleY/x/y` on the `Stage`.

The current code uses `pos.x / scale` to convert pointer events to image space. With pan added, we switch to `stage.getRelativePointerPosition()`, which returns image-space coordinates regardless of `scale` or `(x, y)` offset. Net diff: ~6 lines in `handleMouseDown` and `handleMouseMove`. Saves us from manually subtracting pan offsets.

### Tool palette change

Extend the `AnnotationTool` union (in `useAnnotationEditor.ts`) with `'hand'`:

```ts
type AnnotationTool = 'select' | 'rect' | 'arrow' | 'highlight' | 'redact' | 'pin' | 'hand'
```

In view mode (`editing === false`), `hand` is the only valid tool. The Hand button lives in the header-bar zoom-control cluster (described below), **not** in the existing `AnnotationToolbar` — so there is exactly one Hand button in the UI, present in both modes. Clicking it sets `tool = 'hand'`, which `AnnotationCanvas` consumes the same way it does any other tool.

### Interaction model

| Input | Behavior |
|---|---|
| Wheel (no modifier) | Vertical scroll: `panY -= deltaY`. Shift+wheel = horizontal. |
| Ctrl/Cmd + wheel | `zoomAt(1.1^(-deltaY/100), cursorX, cursorY)`. |
| Middle-mouse drag | Pan, in any tool. Cursor → `grabbing`. |
| Hand tool + left-drag | Pan. Cursor → `grab` / `grabbing`. |
| Other tool + left-drag on empty canvas | Existing draft-shape behavior, unchanged. |
| Double-click on empty canvas | `reset()` → fit-width. |

Mac trackpad pinch-to-zoom emits `wheel` events with `ctrlKey: true`, so it routes through the Ctrl+wheel path automatically — no extra handling needed.

### Toolbar additions

In the header bar of `AnnotationEditor` (right side, visible in both view and edit modes):

```
[ 🖐 Hand ]   [ − ]  [ 87% ]  [ + ]   [ Fit ]   [ 1:1 ]
```

- `Hand` button toggles the hand tool. Highlighted when active.
- `−` / `+` buttons call `zoomAt(0.8, cx, cy)` / `zoomAt(1.25, cx, cy)` with `cx`/`cy` = viewport center.
- The percentage label shows `Math.round(userScale * 100)%` (relative to fit, so "100%" means "fit-width"). Display-only in v1.
- `Fit` calls `reset()`.
- `1:1` sets `scale = 1` and recenters.

### Keyboard shortcuts

Extend `keyboardShortcuts.ts`. Active when the editor is mounted and focused (matches today's `enabled` flag on `useAnnotationKeyboardShortcuts`). `H` is **not** bound to Hand — it's already bound to Highlight (`keyboardShortcuts.ts:17`). The Hand tool is reachable via the toolbar button and Space-hold.

- `+` / `=` → zoom in (anchor: viewport center)
- `-` → zoom out
- `0` → fit-width
- `1` → 100%
- Hold `Space` → temporary hand tool. On `keyup`, restores the previously active tool. Suppressed when focus is in an `INPUT`/`TEXTAREA` (matches the existing handler's input-focus guard).

### Pin popover and zoom/pan

`PinCommentPopover` is a DOM element positioned in screen space, outside the Konva stage. When the user pans or zooms while the popover is open, its anchor coordinate would drift. **Resolution: close the popover on `pan-start` or `zoom`.** The popover is for entering a comment, not for spatial reference, so closing on viewport change is acceptable and simpler than recomputing screen position on every transform tick.

### Edge cases

| Case | Behavior |
|---|---|
| Image taller than container at fit-width | `panY` range allows scrolling top→bottom; `panX` clamped to 0. |
| Image wider than container at fit-width | `fitToWidth` still fits to width; vertical scroll allowed if needed. |
| Image smaller than container in both axes | `scale` capped at 1; image centered with whitespace around it. |
| User zooms below fit-width | Clamp at `fitScale * 0.5` so user can see margins/context but not nothing. |
| Container resize (window/sidebar) | Recompute `fitScale`; preserve user's scale-relative-to-fit; re-clamp pan. |
| Capture switch (`imageUrl` changes) | `useEffect` calls `reset()`. New capture opens at fit-width, pan at center. |
| Image load failure | Existing "Failed to load image" text rendered by `AnnotationCanvas`. Zoom/pan handlers remain harmless on empty Stage. |
| Pin drag near edge while zoomed in | Existing drag clamping is in image space; works unchanged. |
| Burn-to-PNG export | `burnAnnotations` reads shapes in image space and rasterizes at native resolution, no knowledge of viewport. ✓ Untouched. |

## Testing

### Unit tests — `tests/renderer/components/useZoomPan.test.ts` (new)

- `fitToWidth` with tall image: `scale === containerW / imageW`, `panY === 0`
- `fitToWidth` with image smaller than container: `scale === 1`, image centered
- `zoomAt(1.25, cx, cy)`: image pixel under cursor before zoom is the same image pixel under cursor after zoom (anchor invariant)
- `setPan` past edge: image cannot fully leave viewport (64px minimum visible per axis)
- `MIN_SCALE` (`fitScale * 0.5`) and `MAX_SCALE` (8) clamps respected on wheel zoom and `+`/`−`
- Container resize preserves zoom-relative-to-fit (user at 2× fit stays at 2× fit after resize)
- `reset()` returns to `fitToWidth` initial state

### E2E test — extend `e2e/annotation.spec.ts`

One new spec:

1. Open a tall capture; assert the Konva Stage's effective image-rendered width matches container width (fit-width default).
2. Dispatch a `wheel` event with `ctrlKey: true` over the canvas; assert Stage `scaleX` increased.
3. Drag the canvas with the hand tool active; assert Stage `x` changed.

Per-shortcut coverage stays in unit tests; E2E is for the wiring.

### Manual verification checklist

1. Open a tall full-page screenshot → text is readable at fit-width.
2. Ctrl+wheel zoom over a headline → headline stays under cursor.
3. Two-finger trackpad scroll → page scrolls vertically.
4. Switch to another capture and back → opens at fit-width.
5. Drop a pin while zoomed at 300% → pin appears at click point, popover opens; popover closes on next pan.
6. Toggle View mode → zoom/pan still work; only Hand tool available.
7. Resize the window or toggle sidebar → image rescales but zoom level relative-to-fit stays consistent.
8. Export a PNG with annotations from a zoomed-in editor session → annotations land at correct pixel positions.

## Out of Scope (v1.1 candidates)

- Persisting zoom/pan per-capture in session memory.
- Mini-map.
- "Zoom to selection."
- Editable percentage input in the zoom indicator.
- Configurable `MIN_SCALE` / `MAX_SCALE` per user setting.
