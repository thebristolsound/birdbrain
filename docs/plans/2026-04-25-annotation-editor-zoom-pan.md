# Annotation Editor Zoom & Pan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make full-page screenshots readable in the annotation editor by defaulting to fit-width view and adding cursor-anchored zoom plus drag-pan; preserve all existing annotation behavior including the export burn-in path.

**Architecture:** Add a `useZoomPan` hook that owns `{ userScale, panX, panY }` with `fitScale` derived from current image and container dimensions. `AnnotationCanvas` becomes a fixed-size Stage (container-sized) that consumes the hook's transform; pointer math switches to `stage.getRelativePointerPosition()` so existing draft-shape code works unchanged under zoom and pan. `AnnotationEditor` gains a header-bar zoom-control cluster (Hand, −, %, +, Fit, 1:1) visible in both view and edit modes. The Konva `Stage` already remounts on capture switch via `key={captureId}` (`CaptureViewer.tsx:608`), so reset-on-capture-switch is automatic.

**Tech Stack:** React 19, react-konva 19, konva 10, TypeScript, Vitest (happy-dom), @testing-library/react, Playwright + Electron.

**Spec:** `docs/superpowers/specs/2026-04-25-annotation-editor-zoom-pan-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/components/captures/annotation/useZoomPan.ts` | Create | Zoom/pan state hook: `{ userScale, panX, panY }` + `fitToWidth`, `zoomAt`, `setPan`, `setUserScale`, `reset` |
| `src/renderer/components/captures/annotation/useAnnotationEditor.ts` | Modify | Extend `AnnotationTool` union with `'hand'` |
| `src/renderer/components/captures/annotation/AnnotationCanvas.tsx` | Modify | Replace fit-to-contain scale; Stage fills container; consume `useZoomPan`; add wheel/drag handlers; switch to `getRelativePointerPosition` |
| `src/renderer/components/captures/annotation/AnnotationEditor.tsx` | Modify | Lift `useZoomPan` to editor; pass transform + handlers to canvas; render header-bar zoom controls; close popover on pan/zoom |
| `src/renderer/components/captures/annotation/AnnotationToolbar.tsx` | Unchanged | (Hand tool button lives in the header zoom cluster, not here, to avoid duplication) |
| `src/renderer/components/captures/annotation/keyboardShortcuts.ts` | Modify | Add `+`/`=`, `-`, `0`, `1`, and Space-hold shortcuts |
| `tests/renderer/components/useZoomPan.test.ts` | Create | Unit tests for the hook |
| `tests/renderer/components/useAnnotationEditor.test.ts` | Modify | Add a `'hand'` tool round-trip case |
| `e2e/annotation.spec.ts` | Modify | Add a zoom/pan smoke test on a tall image |

---

## Task 1: Add `'hand'` to the `AnnotationTool` union

**Files:**
- Modify: `src/renderer/components/captures/annotation/useAnnotationEditor.ts:4`
- Modify: `tests/renderer/components/useAnnotationEditor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/components/useAnnotationEditor.test.ts` inside the `describe('useAnnotationEditor', ...)` block:

```typescript
it('accepts the hand tool', () => {
  const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
  act(() => result.current.setTool('hand'))
  expect(result.current.tool).toBe('hand')
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test -- useAnnotationEditor`
Expected: TS error — `Argument of type '"hand"' is not assignable to parameter of type 'AnnotationTool'.`

- [ ] **Step 3: Add `'hand'` to the union**

In `src/renderer/components/captures/annotation/useAnnotationEditor.ts:4`, change:

```typescript
export type AnnotationTool = 'select' | 'rect' | 'arrow' | 'highlight' | 'redact' | 'pin'
```

to:

```typescript
export type AnnotationTool = 'select' | 'rect' | 'arrow' | 'highlight' | 'redact' | 'pin' | 'hand'
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm test -- useAnnotationEditor`
Expected: PASS, all existing tests in the file still pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/annotation/useAnnotationEditor.ts tests/renderer/components/useAnnotationEditor.test.ts
git commit -m "feat(annotations): add 'hand' tool to AnnotationTool union"
```

---

## Task 2: Create `useZoomPan` hook — initial state and `fitToWidth`

**Files:**
- Create: `src/renderer/components/captures/annotation/useZoomPan.ts`
- Create: `tests/renderer/components/useZoomPan.test.ts`

- [ ] **Step 1: Write the failing tests for `fitToWidth`**

Create `tests/renderer/components/useZoomPan.test.ts`:

```typescript
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useZoomPan } from '@renderer/components/captures/annotation/useZoomPan'

describe('useZoomPan — fitToWidth', () => {
  it('initializes at fit-width for a tall image', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 1000, imageHeight: 8000, containerWidth: 500, containerHeight: 800 })
    )
    expect(result.current.userScale).toBe(1)
    expect(result.current.fitScale).toBeCloseTo(0.5, 5)
    expect(result.current.scale).toBeCloseTo(0.5, 5)
    expect(result.current.panX).toBe(0)
    expect(result.current.panY).toBe(0)
  })

  it('caps fitScale at 1 for an image smaller than the container', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 200, imageHeight: 200, containerWidth: 800, containerHeight: 800 })
    )
    expect(result.current.fitScale).toBe(1)
    expect(result.current.scale).toBe(1)
    expect(result.current.panX).toBe(300)
    expect(result.current.panY).toBe(300)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm test -- useZoomPan`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the minimal hook implementation**

Create `src/renderer/components/captures/annotation/useZoomPan.ts`:

```typescript
import { useCallback, useMemo, useRef, useState } from 'react'

export const MIN_USER_SCALE = 0.5
export const MAX_ABS_SCALE = 8
export const MIN_VISIBLE_PX = 64

interface Options {
  imageWidth: number
  imageHeight: number
  containerWidth: number
  containerHeight: number
}

export function useZoomPan(opts: Options) {
  const { imageWidth, imageHeight, containerWidth, containerHeight } = opts

  const fitScale = useMemo(() => {
    if (!imageWidth || !containerWidth) return 1
    return Math.min(containerWidth / imageWidth, 1)
  }, [imageWidth, containerWidth])

  const initialPan = useMemo(() => {
    const w = imageWidth * fitScale
    const h = imageHeight * fitScale
    return {
      x: Math.max(0, (containerWidth - w) / 2),
      y: Math.max(0, (containerHeight - h) / 2)
    }
  }, [imageWidth, imageHeight, containerWidth, containerHeight, fitScale])

  const [userScale, setUserScaleState] = useState(1)
  const [panX, setPanX] = useState(initialPan.x)
  const [panY, setPanY] = useState(initialPan.y)

  const scale = userScale * fitScale

  return {
    fitScale,
    userScale,
    scale,
    panX,
    panY,
    setUserScaleState,
    setPanX,
    setPanY
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm test -- useZoomPan`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/annotation/useZoomPan.ts tests/renderer/components/useZoomPan.test.ts
git commit -m "feat(annotations): add useZoomPan hook with fitToWidth initial state"
```

---

## Task 3: `useZoomPan` — `zoomAt` with cursor anchoring

**Files:**
- Modify: `src/renderer/components/captures/annotation/useZoomPan.ts`
- Modify: `tests/renderer/components/useZoomPan.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/components/useZoomPan.test.ts`:

```typescript
describe('useZoomPan — zoomAt', () => {
  it('keeps the image pixel under the cursor stationary', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 1000, imageHeight: 8000, containerWidth: 500, containerHeight: 800 })
    )
    // fitScale = 0.5; scale = 0.5; pan = (0, 0)
    // Image pixel under cursor (250, 400) is at imagePx = (500, 800).
    const cursorX = 250
    const cursorY = 400
    const imagePxX = (cursorX - result.current.panX) / result.current.scale
    const imagePxY = (cursorY - result.current.panY) / result.current.scale

    act(() => result.current.zoomAt(2, cursorX, cursorY))

    // After zoom, the image pixel under the cursor must still be (imagePxX, imagePxY).
    const imagePxXAfter = (cursorX - result.current.panX) / result.current.scale
    const imagePxYAfter = (cursorY - result.current.panY) / result.current.scale
    expect(imagePxXAfter).toBeCloseTo(imagePxX, 5)
    expect(imagePxYAfter).toBeCloseTo(imagePxY, 5)
    expect(result.current.userScale).toBe(2)
  })

  it('clamps userScale to [MIN_USER_SCALE, MAX_ABS_SCALE / fitScale]', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 1000, imageHeight: 8000, containerWidth: 500, containerHeight: 800 })
    )
    // fitScale = 0.5; max userScale = 8 / 0.5 = 16
    act(() => result.current.zoomAt(1000, 250, 400))
    expect(result.current.userScale).toBe(16)
    expect(result.current.scale).toBe(8)

    act(() => result.current.zoomAt(0.0001, 250, 400))
    expect(result.current.userScale).toBe(0.5)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm test -- useZoomPan`
Expected: FAIL — `result.current.zoomAt is not a function`.

- [ ] **Step 3: Implement `zoomAt`**

Replace the contents of `src/renderer/components/captures/annotation/useZoomPan.ts` with:

```typescript
import { useCallback, useMemo, useState } from 'react'

export const MIN_USER_SCALE = 0.5
export const MAX_ABS_SCALE = 8
export const MIN_VISIBLE_PX = 64

interface Options {
  imageWidth: number
  imageHeight: number
  containerWidth: number
  containerHeight: number
}

export function useZoomPan(opts: Options) {
  const { imageWidth, imageHeight, containerWidth, containerHeight } = opts

  const fitScale = useMemo(() => {
    if (!imageWidth || !containerWidth) return 1
    return Math.min(containerWidth / imageWidth, 1)
  }, [imageWidth, containerWidth])

  const initialPan = useMemo(() => {
    const w = imageWidth * fitScale
    const h = imageHeight * fitScale
    return {
      x: Math.max(0, (containerWidth - w) / 2),
      y: Math.max(0, (containerHeight - h) / 2)
    }
  }, [imageWidth, imageHeight, containerWidth, containerHeight, fitScale])

  const [userScale, setUserScale] = useState(1)
  const [panX, setPanX] = useState(initialPan.x)
  const [panY, setPanY] = useState(initialPan.y)

  const scale = userScale * fitScale

  const zoomAt = useCallback(
    (deltaUserScale: number, cursorX: number, cursorY: number) => {
      const maxUserScale = MAX_ABS_SCALE / fitScale
      const nextUserScale = Math.max(
        MIN_USER_SCALE,
        Math.min(maxUserScale, userScale * deltaUserScale)
      )
      const nextScale = nextUserScale * fitScale
      // Solve for pan so the image-space pixel under the cursor is unchanged.
      // image_x = (cursor_x - panX) / scale must equal (cursor_x - nextPanX) / nextScale
      const imagePxX = (cursorX - panX) / scale
      const imagePxY = (cursorY - panY) / scale
      setUserScale(nextUserScale)
      setPanX(cursorX - imagePxX * nextScale)
      setPanY(cursorY - imagePxY * nextScale)
    },
    [fitScale, userScale, panX, panY, scale]
  )

  return {
    fitScale,
    userScale,
    scale,
    panX,
    panY,
    setUserScale,
    setPanX,
    setPanY,
    zoomAt
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm test -- useZoomPan`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/annotation/useZoomPan.ts tests/renderer/components/useZoomPan.test.ts
git commit -m "feat(annotations): zoomAt anchors zoom on cursor and clamps scale"
```

---

## Task 4: `useZoomPan` — `setPan` with viewport-edge clamping

**Files:**
- Modify: `src/renderer/components/captures/annotation/useZoomPan.ts`
- Modify: `tests/renderer/components/useZoomPan.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/components/useZoomPan.test.ts`:

```typescript
describe('useZoomPan — setPan', () => {
  it('clamps so at least MIN_VISIBLE_PX of the image stays in view', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 1000, imageHeight: 8000, containerWidth: 500, containerHeight: 800 })
    )
    // fitScale = 0.5; scale = 0.5; image rendered: 500 x 4000
    // Pan dragging far up (negative dy) should leave at least 64px visible at top.
    act(() => result.current.setPan(0, -100000))
    // Image bottom edge at panY + imageHeight*scale must be >= 64
    const renderedHeight = 8000 * result.current.scale
    expect(result.current.panY + renderedHeight).toBeGreaterThanOrEqual(64)

    act(() => result.current.setPan(100000, 0))
    const renderedWidth = 1000 * result.current.scale
    // panX must be at most containerWidth - 64 = 436
    expect(result.current.panX).toBeLessThanOrEqual(500 - 64)
    // and panX + renderedWidth must be >= 64
    expect(result.current.panX + renderedWidth).toBeGreaterThanOrEqual(64)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm test -- useZoomPan`
Expected: FAIL — `result.current.setPan is not a function`.

- [ ] **Step 3: Implement `setPan` with clamping**

In `src/renderer/components/captures/annotation/useZoomPan.ts`, add the following inside the hook before the `return`:

```typescript
const setPan = useCallback(
  (dx: number, dy: number) => {
    const renderedW = imageWidth * scale
    const renderedH = imageHeight * scale
    setPanX((prev) => {
      const next = prev + dx
      const minPanX = MIN_VISIBLE_PX - renderedW
      const maxPanX = containerWidth - MIN_VISIBLE_PX
      return Math.max(minPanX, Math.min(maxPanX, next))
    })
    setPanY((prev) => {
      const next = prev + dy
      const minPanY = MIN_VISIBLE_PX - renderedH
      const maxPanY = containerHeight - MIN_VISIBLE_PX
      return Math.max(minPanY, Math.min(maxPanY, next))
    })
  },
  [imageWidth, imageHeight, containerWidth, containerHeight, scale]
)
```

And add `setPan` to the returned object:

```typescript
return {
  fitScale,
  userScale,
  scale,
  panX,
  panY,
  setUserScale,
  setPanX,
  setPanY,
  setPan,
  zoomAt
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm test -- useZoomPan`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/annotation/useZoomPan.ts tests/renderer/components/useZoomPan.test.ts
git commit -m "feat(annotations): setPan clamps to keep image visible in viewport"
```

---

## Task 5: `useZoomPan` — `reset` and resize behavior

**Files:**
- Modify: `src/renderer/components/captures/annotation/useZoomPan.ts`
- Modify: `tests/renderer/components/useZoomPan.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/renderer/components/useZoomPan.test.ts`:

```typescript
describe('useZoomPan — reset and resize', () => {
  it('reset returns to userScale 1 and centers pan', () => {
    const { result } = renderHook(() =>
      useZoomPan({ imageWidth: 1000, imageHeight: 8000, containerWidth: 500, containerHeight: 800 })
    )
    act(() => result.current.zoomAt(3, 250, 400))
    act(() => result.current.setPan(50, -200))
    act(() => result.current.reset())
    expect(result.current.userScale).toBe(1)
    expect(result.current.panX).toBe(0)
    expect(result.current.panY).toBe(0)
  })

  it('preserves userScale when container width changes', () => {
    const { result, rerender } = renderHook(
      (props: {
        imageWidth: number
        imageHeight: number
        containerWidth: number
        containerHeight: number
      }) => useZoomPan(props),
      {
        initialProps: {
          imageWidth: 1000,
          imageHeight: 8000,
          containerWidth: 500,
          containerHeight: 800
        }
      }
    )
    act(() => result.current.zoomAt(2, 250, 400))
    expect(result.current.userScale).toBe(2)
    expect(result.current.scale).toBeCloseTo(1, 5) // 2 * 0.5

    rerender({ imageWidth: 1000, imageHeight: 8000, containerWidth: 1000, containerHeight: 800 })
    // fitScale becomes 1; userScale is preserved at 2; absolute scale becomes 2.
    expect(result.current.fitScale).toBe(1)
    expect(result.current.userScale).toBe(2)
    expect(result.current.scale).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm test -- useZoomPan`
Expected: FAIL — `result.current.reset is not a function`.

- [ ] **Step 3: Implement `reset`**

In `src/renderer/components/captures/annotation/useZoomPan.ts`, add the following inside the hook before the `return`:

```typescript
const reset = useCallback(() => {
  setUserScale(1)
  setPanX(initialPan.x)
  setPanY(initialPan.y)
}, [initialPan.x, initialPan.y])
```

Add `reset` to the returned object:

```typescript
return {
  fitScale,
  userScale,
  scale,
  panX,
  panY,
  setUserScale,
  setPanX,
  setPanY,
  setPan,
  zoomAt,
  reset
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm test -- useZoomPan`
Expected: all tests PASS. The "preserves userScale when container width changes" test passes automatically because `userScale` is independent state and `scale` is derived from `userScale * fitScale`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/annotation/useZoomPan.ts tests/renderer/components/useZoomPan.test.ts
git commit -m "feat(annotations): add reset action and preserve userScale on resize"
```

---

## Task 6: Wire `useZoomPan` into `AnnotationCanvas` (no interactions yet)

**Files:**
- Modify: `src/renderer/components/captures/annotation/AnnotationCanvas.tsx`
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx`

This task replaces the fit-to-contain math with the hook's transform. After this task the bug becomes the new default behavior (fit-width with vertical scroll only via pan API), but no user interaction is wired yet — that's the next task. Visually verify by toggling a tall capture.

- [ ] **Step 1: Lift `useZoomPan` into `AnnotationEditor`**

In `src/renderer/components/captures/annotation/AnnotationEditor.tsx`, near the other hooks at the top of the function (after `const editor = useAnnotationEditor(...)` on line 26), add:

```typescript
import { useZoomPan } from './useZoomPan'
```

And inside the function body:

```typescript
const zoomPan = useZoomPan({ imageWidth, imageHeight, containerWidth, containerHeight })
```

- [ ] **Step 2: Pass the transform into `AnnotationCanvas`**

Still in `AnnotationEditor.tsx`, replace the `<AnnotationCanvas>` element (lines ~135-158) with:

```tsx
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
  scale={zoomPan.scale}
  panX={zoomPan.panX}
  panY={zoomPan.panY}
/>
```

Also change the wrapper div's overflow class on the same `AnnotationEditor.tsx` line that currently reads:

```tsx
<div className="relative flex-1 overflow-auto bg-canvas">
```

to:

```tsx
<div className="relative flex-1 overflow-hidden bg-canvas">
```

- [ ] **Step 3: Update `AnnotationCanvas` props and Stage transform**

In `src/renderer/components/captures/annotation/AnnotationCanvas.tsx`, replace the `Props` interface (lines 12-32) with:

```typescript
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
  onDraftExtend?: (patch: Partial<Omit<AnnotationShape, 'kind' | 'id'>>) => void
  onDraftCommit?: () => void
  onPinDrop?: (x: number, y: number) => void
  onPinClick?: (pinId: string) => void
  containerWidth: number
  containerHeight: number
  scale: number
  panX: number
  panY: number
}
```

In the function body, destructure the new props and **delete** the old `scale` `useMemo` (lines 62-65). Replace pointer-position math in `handleMouseDown` (lines 74-77) and `handleMouseMove` (lines 118-121). Where the code currently reads:

```typescript
const pos = stage.getPointerPosition()
if (!pos) return
const x = pos.x / scale
const y = pos.y / scale
```

change both call sites to:

```typescript
const pos = stage.getRelativePointerPosition()
if (!pos) return
const x = pos.x
const y = pos.y
```

Drop `scale` from both `useCallback` dependency arrays (it's no longer referenced inside).

Replace the `<Stage>` opening element (lines 144-152) with:

```tsx
<Stage
  width={containerWidth}
  height={containerHeight}
  scaleX={scale}
  scaleY={scale}
  x={panX}
  y={panY}
  onMouseDown={handleMouseDown}
  onMouseMove={handleMouseMove}
  onMouseUp={handleMouseUp}
>
```

- [ ] **Step 4: Run unit tests**

Run: `pnpm test`
Expected: all tests PASS. (No new tests added; this is an integration change covered by the existing `useAnnotationEditor` tests, the new `useZoomPan` tests, and downstream E2E.)

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Manual smoke test**

Start: `pnpm dev`
Open a capture with a tall full-page screenshot. Confirm:
- Image now fills the container width and you can see the top portion (rest is below the fold but not yet scrollable — wheel wiring comes next).
- Annotations placed previously still render at correct positions (draw a quick rect to verify pointer math still works).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/captures/annotation/AnnotationCanvas.tsx src/renderer/components/captures/annotation/AnnotationEditor.tsx
git commit -m "refactor(annotations): drive Stage transform from useZoomPan; switch to relative pointer math"
```

---

## Task 7: Wheel handler — vertical scroll + Ctrl/Cmd+wheel zoom

**Files:**
- Modify: `src/renderer/components/captures/annotation/AnnotationCanvas.tsx`

- [ ] **Step 1: Add `onZoomAt` and `onPan` callback props**

In `src/renderer/components/captures/annotation/AnnotationCanvas.tsx`, add two new optional props to the `Props` interface:

```typescript
onZoomAt?: (deltaUserScale: number, cursorX: number, cursorY: number) => void
onPan?: (dx: number, dy: number) => void
```

Destructure them in the function body alongside the other props.

- [ ] **Step 2: Add the wheel handler**

In `src/renderer/components/captures/annotation/AnnotationCanvas.tsx`, add inside the function body (above the existing `handleMouseDown`):

```typescript
const handleWheel = useCallback(
  (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getPointerPosition()
    if (!pos) return
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const delta = Math.pow(1.1, -e.evt.deltaY / 100)
      onZoomAt?.(delta, pos.x, pos.y)
    } else if (e.evt.shiftKey) {
      onPan?.(-e.evt.deltaY, 0)
    } else {
      onPan?.(-e.evt.deltaX, -e.evt.deltaY)
    }
  },
  [onZoomAt, onPan]
)
```

Add `onWheel={handleWheel}` to the `<Stage>` element.

- [ ] **Step 3: Wire the handlers in `AnnotationEditor`**

In `src/renderer/components/captures/annotation/AnnotationEditor.tsx`, on the `<AnnotationCanvas>` element add:

```tsx
onZoomAt={zoomPan.zoomAt}
onPan={zoomPan.setPan}
```

- [ ] **Step 4: Manual verification**

Run: `pnpm dev`
Open a tall capture. Verify:
- Two-finger scroll (or scroll wheel) pans the image vertically; you can scroll all the way to the bottom of the screenshot.
- Shift+wheel scrolls horizontally (no-op if image fits in width).
- Ctrl+wheel (Cmd+wheel on Mac) zooms in/out toward the cursor; the pixel under the cursor stays under the cursor.
- On a Mac trackpad, pinch-to-zoom routes through the Ctrl+wheel path automatically and behaves identically.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/annotation/AnnotationCanvas.tsx src/renderer/components/captures/annotation/AnnotationEditor.tsx
git commit -m "feat(annotations): wheel scrolls; Ctrl+wheel zooms toward cursor"
```

---

## Task 8: Drag-to-pan and middle-mouse pan

**Files:**
- Modify: `src/renderer/components/captures/annotation/AnnotationCanvas.tsx`

- [ ] **Step 1: Add panning state and handlers**

In `src/renderer/components/captures/annotation/AnnotationCanvas.tsx`, replace the existing `handleMouseDown`, `handleMouseMove`, and `handleMouseUp` with the following (the new logic gates on the active tool and middle button):

```typescript
const panStateRef = useRef<{ x: number; y: number } | null>(null)

const handleMouseDown = useCallback(
  (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    const isMiddle = e.evt.button === 1
    const isHand = tool === 'hand'
    if (isMiddle || (isHand && e.evt.button === 0)) {
      e.evt.preventDefault()
      panStateRef.current = { x: e.evt.clientX, y: e.evt.clientY }
      return
    }
    if (e.target !== stage) return
    onSelect?.(null)
    if (!editable) return
    const pos = stage.getRelativePointerPosition()
    if (!pos) return
    const x = pos.x
    const y = pos.y
    if (tool === 'pin') {
      onPinDrop?.(x, y)
      return
    }
    if (tool === 'rect') {
      onDraftBegin?.({
        kind: 'rect',
        id: uid(),
        x,
        y,
        w: 0,
        h: 0,
        stroke: color,
        strokeWidth
      })
    } else if (tool === 'highlight') {
      onDraftBegin?.({ kind: 'highlight', id: uid(), x, y, w: 0, h: 0, color })
    } else if (tool === 'redact') {
      onDraftBegin?.({ kind: 'redact', id: uid(), x, y, w: 0, h: 0, mode: 'solid' })
    } else if (tool === 'arrow') {
      onDraftBegin?.({
        kind: 'arrow',
        id: uid(),
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        stroke: color,
        strokeWidth
      })
    }
  },
  [editable, tool, color, strokeWidth, onSelect, onDraftBegin, onPinDrop]
)

const handleMouseMove = useCallback(
  (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (panStateRef.current) {
      const dx = e.evt.clientX - panStateRef.current.x
      const dy = e.evt.clientY - panStateRef.current.y
      panStateRef.current = { x: e.evt.clientX, y: e.evt.clientY }
      onPan?.(dx, dy)
      return
    }
    if (!editable || !draft) return
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getRelativePointerPosition()
    if (!pos) return
    const x = pos.x
    const y = pos.y
    if (draft.kind === 'arrow') {
      onDraftExtend?.({ x2: x, y2: y })
    } else if (draft.kind === 'rect' || draft.kind === 'highlight' || draft.kind === 'redact') {
      onDraftExtend?.({ w: x - draft.x, h: y - draft.y })
    }
  },
  [editable, draft, onDraftExtend, onPan]
)

const handleMouseUp = useCallback(() => {
  if (panStateRef.current) {
    panStateRef.current = null
    return
  }
  if (!editable || !draft) return
  onDraftCommit?.()
}, [editable, draft, onDraftCommit])
```

Make sure `useRef` is imported (it already is via `useCallback`/`useMemo`; add `useRef` to the import if missing).

- [ ] **Step 2: Add a double-click handler for fit-reset**

Add a new prop `onResetView?: () => void` to the `Props` interface and destructure it. Add the handler near the others:

```typescript
const handleDblClick = useCallback(
  (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    if (e.target !== stage) return
    onResetView?.()
  },
  [onResetView]
)
```

Add `onDblClick={handleDblClick}` to the `<Stage>` element.

- [ ] **Step 3: Wire `onResetView` in `AnnotationEditor`**

In `src/renderer/components/captures/annotation/AnnotationEditor.tsx`, on the `<AnnotationCanvas>` element add:

```tsx
onResetView={zoomPan.reset}
```

- [ ] **Step 4: Manual verification**

Run: `pnpm dev`
Open a tall capture. Verify:
- Switching to a hand-tool (toggle via toolbar in the next task; for now temporarily set `tool='hand'` in devtools or skip this until task 9) and click-dragging pans the image.
- Middle-mouse drag pans in any tool (test with the default `select` tool).
- Double-clicking on empty canvas resets to fit-width.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/annotation/AnnotationCanvas.tsx src/renderer/components/captures/annotation/AnnotationEditor.tsx
git commit -m "feat(annotations): hand-tool drag and middle-mouse drag pan; dblclick resets view"
```

---

## Task 9: Header-bar zoom controls in `AnnotationEditor`

**Files:**
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx`

- [ ] **Step 1: Add the zoom-control cluster**

In `src/renderer/components/captures/annotation/AnnotationEditor.tsx`, replace the existing header bar `<div className="flex items-center justify-end ...">` (lines ~100-119) with:

```tsx
<div className="flex items-center justify-between border-b border-border bg-surface px-2 py-1">
  <div className="flex items-center gap-1">
    <button
      type="button"
      aria-label="Hand tool"
      onClick={() => editor.setTool(editor.tool === 'hand' ? 'select' : 'hand')}
      className={[
        'rounded px-2 py-1 hover:bg-canvas',
        editor.tool === 'hand' ? 'bg-canvas text-accent' : 'text-text-primary'
      ].join(' ')}
    >
      <Hand size={14} />
    </button>
    <button
      type="button"
      aria-label="Zoom out"
      onClick={() => zoomPan.zoomAt(0.8, containerWidth / 2, containerHeight / 2)}
      className="rounded px-2 py-1 text-text-primary hover:bg-canvas"
    >
      <Minus size={14} />
    </button>
    <span className="min-w-[3.5rem] text-center text-xs text-text-muted tabular-nums">
      {Math.round(zoomPan.userScale * 100)}%
    </span>
    <button
      type="button"
      aria-label="Zoom in"
      onClick={() => zoomPan.zoomAt(1.25, containerWidth / 2, containerHeight / 2)}
      className="rounded px-2 py-1 text-text-primary hover:bg-canvas"
    >
      <Plus size={14} />
    </button>
    <button
      type="button"
      onClick={() => zoomPan.reset()}
      className="rounded px-2 py-1 text-xs text-text-primary hover:bg-canvas"
    >
      Fit
    </button>
    <button
      type="button"
      onClick={() => {
        // 1:1 absolute scale: userScale = 1 / fitScale.
        const target = 1 / zoomPan.fitScale
        // zoomAt's first arg is a delta multiplier on the current userScale.
        zoomPan.zoomAt(target / zoomPan.userScale, containerWidth / 2, containerHeight / 2)
      }}
      className="rounded px-2 py-1 text-xs text-text-primary hover:bg-canvas"
    >
      1:1
    </button>
  </div>
  <button
    type="button"
    onClick={() => {
      setEditing((v) => !v)
      editor.select(null)
    }}
    className="flex items-center gap-1 rounded px-2 py-1 text-sm text-text-primary hover:bg-canvas"
  >
    {editing ? (
      <>
        <Eye size={14} /> View mode
      </>
    ) : (
      <>
        <Pencil size={14} /> Edit annotations
      </>
    )}
  </button>
</div>
```

Update the import at the top of the file from:

```typescript
import { Pencil, Eye } from 'lucide-react'
```

to:

```typescript
import { Pencil, Eye, Hand, Minus, Plus } from 'lucide-react'
```

- [ ] **Step 2: Manual verification**

Run: `pnpm dev`
Open a tall capture. Verify:
- The header bar shows: `[Hand] [−] [100%] [+] [Fit] [1:1]` on the left, the existing View/Edit toggle on the right.
- Hand button highlights when active; toggling to it changes the cursor behavior on canvas drag (test by dragging — image should pan).
- − and + step zoom in/out from viewport center; the % indicator updates.
- Fit returns to fit-width (% returns to 100%).
- 1:1 zooms to native pixels; for a 1000×8000 image in a 500×800 container, userScale becomes 2, % shows 200%.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/captures/annotation/AnnotationEditor.tsx
git commit -m "feat(annotations): header-bar zoom controls (Hand, -/+, %, Fit, 1:1)"
```

---

## Task 10: Keyboard shortcuts — `+`, `-`, `0`, `1`, Space-hold

**Files:**
- Modify: `src/renderer/components/captures/annotation/keyboardShortcuts.ts`
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx`

- [ ] **Step 1: Extend the bindings interface and handler**

Replace the contents of `src/renderer/components/captures/annotation/keyboardShortcuts.ts` with:

```typescript
import { useEffect, useRef } from 'react'
import type { AnnotationTool } from './useAnnotationEditor'

interface Bindings {
  enabled: boolean
  setTool: (t: AnnotationTool) => void
  getTool: () => AnnotationTool
  deselect: () => void
  removeSelected: () => void
  undo: () => void
  redo: () => void
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  oneToOne: () => void
}

const TOOL_KEYS: Record<string, AnnotationTool> = {
  v: 'select',
  r: 'rect',
  a: 'arrow',
  h: 'highlight',
  x: 'redact',
  p: 'pin'
}

export function useAnnotationKeyboardShortcuts(b: Bindings): void {
  const ref = useRef(b)
  ref.current = b

  useEffect(() => {
    if (!b.enabled) return

    let toolBeforeSpace: AnnotationTool | null = null

    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const c = ref.current

      if (e.key === 'Escape') {
        c.deselect()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        c.removeSelected()
        e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) c.redo()
        else c.undo()
        e.preventDefault()
        return
      }
      if (e.key === ' ' && !e.repeat) {
        if (toolBeforeSpace === null) {
          toolBeforeSpace = c.getTool()
          c.setTool('hand')
        }
        e.preventDefault()
        return
      }
      if (e.key === '+' || e.key === '=') {
        c.zoomIn()
        e.preventDefault()
        return
      }
      if (e.key === '-') {
        c.zoomOut()
        e.preventDefault()
        return
      }
      if (e.key === '0') {
        c.resetView()
        e.preventDefault()
        return
      }
      if (e.key === '1') {
        c.oneToOne()
        e.preventDefault()
        return
      }
      const lower = e.key.toLowerCase()
      const tool = TOOL_KEYS[lower]
      if (tool && !e.ctrlKey && !e.metaKey && !e.altKey) {
        c.setTool(tool)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && toolBeforeSpace !== null) {
        ref.current.setTool(toolBeforeSpace)
        toolBeforeSpace = null
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [b.enabled])
}
```

- [ ] **Step 2: Update the `useAnnotationKeyboardShortcuts` call site**

In `src/renderer/components/captures/annotation/AnnotationEditor.tsx`, change the `enabled: editing` argument: shortcuts should be active in **both** modes (zoom shortcuts apply in view mode too). Replace the existing call (lines ~30-44) with:

```typescript
useAnnotationKeyboardShortcuts({
  enabled: true,
  setTool: editor.setTool,
  getTool: () => editor.tool,
  deselect: () => editor.select(null),
  removeSelected: () => {
    if (!editing || !editor.selectedId) return
    const shape = editor.shapes.find((s) => s.id === editor.selectedId)
    editor.removeShape(editor.selectedId)
    if (shape && shape.kind === 'pin') {
      mutations.deletePin.mutate(shape.pinId)
    }
  },
  undo: editor.undo,
  redo: editor.redo,
  zoomIn: () => zoomPan.zoomAt(1.25, containerWidth / 2, containerHeight / 2),
  zoomOut: () => zoomPan.zoomAt(0.8, containerWidth / 2, containerHeight / 2),
  resetView: () => zoomPan.reset(),
  oneToOne: () =>
    zoomPan.zoomAt(1 / zoomPan.fitScale / zoomPan.userScale, containerWidth / 2, containerHeight / 2)
})
```

(Note: `removeSelected` now guards on `editing` so view-mode users can't accidentally delete shapes via Delete/Backspace.)

- [ ] **Step 3: Run unit tests**

Run: `pnpm test`
Expected: existing `useAnnotationEditor` tests PASS. (No new unit tests for the shortcut handler — its behavior is wiring; covered by manual verification and existing E2E.)

- [ ] **Step 4: Manual verification**

Run: `pnpm dev`
Open a tall capture. Verify:
- `+` zooms in, `-` zooms out, `0` returns to fit, `1` jumps to 1:1.
- Holding Space switches the cursor to grab; while held, drag pans the image; releasing Space restores the previous tool. Tool indicator in the toolbar reflects this.
- Typing in the pin popover textarea does NOT trigger any of these shortcuts.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/annotation/keyboardShortcuts.ts src/renderer/components/captures/annotation/AnnotationEditor.tsx
git commit -m "feat(annotations): keyboard shortcuts for zoom (+/-/0/1) and Space-hold pan"
```

---

## Task 11: Close pin popover on pan/zoom

**Files:**
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx`

- [ ] **Step 1: Wrap zoom/pan handlers to close popover**

In `src/renderer/components/captures/annotation/AnnotationEditor.tsx`, instead of passing `zoomPan.zoomAt` and `zoomPan.setPan` directly, wrap them. Above the `return` statement add:

```typescript
const closePopover = () => setPopoverPinShapeId(null)
const handleZoomAt = (delta: number, cx: number, cy: number) => {
  closePopover()
  zoomPan.zoomAt(delta, cx, cy)
}
const handlePan = (dx: number, dy: number) => {
  closePopover()
  zoomPan.setPan(dx, dy)
}
const handleResetView = () => {
  closePopover()
  zoomPan.reset()
}
```

Update the `<AnnotationCanvas>` props:

```tsx
onZoomAt={handleZoomAt}
onPan={handlePan}
onResetView={handleResetView}
```

Update the `useAnnotationKeyboardShortcuts` `zoomIn`/`zoomOut`/`resetView`/`oneToOne` callbacks to call the wrapped versions: `zoomIn: () => handleZoomAt(1.25, ...)`, etc.

Update the header-bar buttons to call the wrapped versions too, for consistency.

- [ ] **Step 2: Manual verification**

Run: `pnpm dev`
Open a tall capture in edit mode. Drop a pin; the popover opens. Then:
- Scroll the wheel → popover closes.
- Click −/+/Fit/1:1 → popover closes.
- Drag-pan with middle-mouse → popover closes.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/captures/annotation/AnnotationEditor.tsx
git commit -m "feat(annotations): close pin popover on pan/zoom/reset"
```

---

## Task 12: E2E smoke test

**Files:**
- Modify: `e2e/annotation.spec.ts`

- [ ] **Step 1: Add the test**

The strategy: setting up a capture is identical to the existing E2E (we re-use the same helper-shaped block). Then the new check is **behavioral, not introspective** — we verify that after a Ctrl+wheel event the canvas still accepts pointer interactions and a drawn rectangle persists at correct image-space coordinates. This proves the wiring (wheel handler doesn't break drawing; coordinate transform still works) without reaching into Konva internals.

Append a new test to the existing `test.describe('Annotations', ...)` block in `e2e/annotation.spec.ts`:

```typescript
test('canvas mounts, accepts Ctrl+wheel zoom, and remains interactive', async ({ page }) => {
  // --- Setup: create case + post capture (same shape as the existing test) ---
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', 'Zoom-Pan E2E')
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForSelector('[data-testid="case-header-name-btn"]', { timeout: 10000 })

  const url = page.url()
  const caseIdMatch = url.match(/cases\/([^/]+)/)
  expect(caseIdMatch).toBeTruthy()
  const caseId = caseIdMatch![1]

  const captureId = await page.evaluate(
    async ({ caseId, screenshotBase64 }) => {
      const status = await fetch('http://127.0.0.1:19845/api/status').then((r) => r.json())
      const token: string = status.serverToken ?? ''
      const screenshotBytes = Uint8Array.from(atob(screenshotBase64), (c) => c.charCodeAt(0))
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', 'https://example.com/zoom-pan-e2e')
      form.append('title', 'Zoom Pan E2E Page')
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', 'Zoom Pan E2E')
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob(['<html><body>Zoom Pan E2E</body></html>'], {
          type: 'multipart/related'
        }),
        'capture.mhtml'
      )
      form.append('screenshot', new Blob([screenshotBytes], { type: 'image/png' }), 'shot.png')
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      const body = await r.json()
      if (body.status !== 'ok') throw new Error('Upload failed: ' + JSON.stringify(body))
      return body.captureId as string
    },
    { caseId, screenshotBase64: SCREENSHOT_PNG_BASE64 }
  )

  await page.evaluate(
    ({ caseId }) => {
      window.location.hash = `/cases/${caseId}/captures`
    },
    { caseId }
  )

  await page.locator('[role="button"]', { hasText: 'Zoom Pan E2E Page' }).first().click()
  const editToggle = page.getByRole('button', { name: 'Edit annotations' })
  await expect(editToggle).toBeVisible({ timeout: 10000 })
  // --- /Setup ---

  // The Konva stage container should be present.
  const stageContainer = page.locator('.konvajs-content').first()
  await expect(stageContainer).toBeVisible()
  const box = await stageContainer.boundingBox()
  if (!box) throw new Error('Konva stage has no bounding box')

  // Dispatch a Ctrl+wheel event over the canvas. Should not throw and should not navigate.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -300)
  await page.keyboard.up('Control')

  // Verify that the canvas remains interactive after zooming: enter edit mode,
  // draw a rectangle, and confirm it persists. This proves the coordinate
  // transform still works under the new transform pipeline.
  await editToggle.click()
  await page.getByRole('button', { name: 'Rectangle' }).click()

  // Re-read box in case layout shifted from entering edit mode.
  const stageContainerEdit = page.locator('.konvajs-content').first()
  const box2 = await stageContainerEdit.boundingBox()
  if (!box2) throw new Error('Konva stage has no bounding box after edit-mode toggle')
  await page.mouse.move(box2.x + 20, box2.y + 20)
  await page.mouse.down()
  await page.mouse.move(box2.x + 60, box2.y + 50, { steps: 10 })
  await page.mouse.up()

  await page.waitForTimeout(1200) // past 800ms debounce

  const persisted = await page.evaluate(async (id: string) => {
    const w = window as unknown as {
      birdbrain: {
        annotations: {
          get: (
            captureId: string
          ) => Promise<{ annotations: { shapes: Array<{ kind: string }> } | null }>
        }
      }
    }
    const bundle = await w.birdbrain.annotations.get(id)
    return bundle.annotations?.shapes.length ?? 0
  }, captureId)
  expect(persisted).toBeGreaterThanOrEqual(1)
})
```

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm test:e2e`
Expected: existing tests still pass; new test passes.

- [ ] **Step 3: Commit**

```bash
git add e2e/annotation.spec.ts
git commit -m "test(annotations): e2e zoom/pan smoke test"
```

---

## Task 13: Final manual verification

- [ ] Open a tall full-page screenshot (e.g., a CNN article capture). Text is readable at fit-width on first open.
- [ ] Ctrl+wheel over a headline → headline stays under cursor through several zoom-in/out steps.
- [ ] Two-finger trackpad scroll → page scrolls vertically smoothly.
- [ ] Switch to a different capture and back → opens at fit-width with userScale = 100%.
- [ ] Drop a pin while zoomed at ~300% → pin appears at the click point in image coordinates; popover opens; popover closes on next pan/zoom.
- [ ] Toggle to View mode → Hand tool still available in header; zoom/pan still work; Edit-only tools (rect, arrow, etc.) hidden.
- [ ] Resize the window or toggle the captures sidebar → image rescales but the user's zoom level relative to fit is preserved.
- [ ] Export a PNG from a session where you were zoomed in → annotations land at correct image-pixel positions in the burned PNG (confirms the export pipeline is unaffected by viewport state).
- [ ] Press `0` from any zoom state → returns to fit-width.
- [ ] Press `1` → jumps to native (1:1) pixels; for a 1000×8000 image in a 500-wide viewport, % indicator reads 200%.
- [ ] Hold Space → cursor changes; drag pans; release Space → previous tool restored.
- [ ] Type into the pin popover textarea while it's open → spacebar inserts a space, does NOT trigger Hand-tool toggle.

---

## Self-review notes

- Spec coverage check: every requirement in `2026-04-25-annotation-editor-zoom-pan-design.md` maps to a task above (fit-width default → Task 6; Ctrl+wheel zoom → Task 7; drag-pan → Task 8; toolbar → Task 9; keyboard → Task 10; popover handling → Task 11; reset on capture switch → automatic via existing `key={captureId}` in `CaptureViewer.tsx:608`, called out in the architecture section; export untouched → Task 13 manual check).
- The `H` key conflict noted in the spec is honored: Task 10's keyboard handler does not bind `H` to Hand (Highlight retains it). Hand is reachable via header button and Space-hold.
- The `useZoomPan` hook is built incrementally via TDD across Tasks 2-5, each task adding one capability with its own test.
- No new dependencies added.
