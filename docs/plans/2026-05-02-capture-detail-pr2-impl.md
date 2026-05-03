# Capture Detail PR2 — Screenshot Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Promote the screenshot/annotation surface from "edit-gated HUD" to a polished always-live workspace: lift zoom/pan into a dedicated `ScreenshotZoomBar`, restyle `AnnotationToolbar`, drop the `editing` mode, wrap the screenshot in a decorative browser-chrome card, and gate the post-update behavior change behind a one-time tooltip persisted to settings.

**Architecture:** Lift state out of `AnnotationEditor` so screenshot UI components share it. `ScreenshotTabPanel` (in `CaptureViewer.tsx`) becomes the state owner — it instantiates `useAnnotationEditor` and `useZoomPan`, plus a local `overlayVisible` state, and wires three children: `ScreenshotZoomBar` (top), `AnnotationToolbar` (below it, always rendered), `AnnotationEditor` (canvas wrapper). `AnnotationEditor` becomes a presentation/glue component that takes the lifted state via props and renders the canvas + pin popover. The Konva canvas's `editable` gate is replaced by `overlayVisible`. Default tool stays `select` so no draw fires until the user picks one. Picking any draw tool auto-shows the overlay. The eye toggle is a pure visibility gate; it is disabled while a draw tool is active.

**Tech Stack:** React 19, TanStack Query, react-konva, lucide-react icons, Tailwind v4 semantic tokens, Vitest (unit), Playwright + Electron (e2e).

**Source design:** `docs/plans/capture-detail-redesign.md` §5 (Toolbars), §6/PR2 (files touched), §10/PR2 (phasing), §11 decisions 8/12/22/47/48/50.

**Branch:** `feat/capture-detail-pr2` (cut from `master` at 19d8f19, post-PR1b merge).

---

## Constraints / context

- PR1a shipped `BirdbrainSettings.tooltipsSeen: Record<string, boolean>` with Zod `.default({})`. Reuse the key `'annotation-tools-always-live'`. No schema migration in this PR.
- Status-palette dots in browser-chrome (red/amber/emerald) stay raw per `theme.md` — they don't theme-swap.
- Screenshot frame uses `rounded-xl`; panel sections use `rounded-2xl` (per design §7 radius rules).
- Existing momentary space-hold pan in `keyboardShortcuts.ts:62-69,97-103` must coexist with the new persistent Hand toggle. The keyboard handler reads/writes `tool` directly; persistent toggle from the zoom bar also writes `tool`. They share the same source of truth and don't fight.
- Existing `editable` Konva gate is the source of truth for "can the user draw / select / drag shapes." After PR2, that becomes `overlayVisible` directly. Tool default `select` is what prevents accidental shapes from being drawn — no draw event handler fires for `select`.
- Drawing-while-overlay-off is impossible by construction: any draw-tool selection auto-flips `overlayVisible` to `true`. Eye toggle is disabled (visually + `aria-disabled`) while a draw tool is active.
- Browser-chrome is decorative: shows three traffic-light dots, a static URL pill (`capture.url`, truncated end, `title=capture.url`), no clicks, no real navigation.
- Tooltip uses an existing pattern if any; otherwise a small inline popover anchored to `AnnotationToolbar` is fine. No new dependency.
- `tests/components/useCaptureTagEditor.test.ts` is the only PR1a unit test pattern in the suite — no Vitest test for the zoom-bar lift is needed; the e2e covers it. Do not add a unit test for `ScreenshotZoomBar` rendering.
- No extension/server changes. No DB migration. Settings change uses an existing key.

---

## File Structure

**Edit**

- `src/renderer/components/captures/CaptureViewer.tsx` — refactor `ScreenshotTabPanel` to own zoom/editor state, mount `ScreenshotZoomBar`, wrap canvas in browser-chrome card.
- `src/renderer/components/captures/annotation/AnnotationEditor.tsx` — drop `editing` state, drop inline zoom HUD, accept lifted state via props, drop the Edit/View toggle button. Adjust `editable` to read `overlayVisible`.
- `src/renderer/components/captures/annotation/AnnotationToolbar.tsx` — restyle to 32×32 buttons, vertical separators, 20×20 color swatches with `ring-2`.

**New**

- `src/renderer/components/captures/ScreenshotZoomBar.tsx` — props `{ scale, zoomIn, zoomOut, fit, oneToOne, panMode, setPanMode, overlayVisible, setOverlayVisible, drawing }`. Renders Hand toggle / zoom-out / `NN%` label / zoom-in / `|` / Fit / 1:1 / Eye toggle.
- `src/renderer/components/captures/BrowserChromeFrame.tsx` — props `{ url: string; children: ReactNode }`. Decorative card.
- `src/renderer/components/captures/AnnotationToolsTooltip.tsx` — one-time tooltip; reads/writes `BirdbrainSettings.tooltipsSeen['annotation-tools-always-live']` via existing settings IPC.

**Tests**

- `e2e/screenshot-zoom-bar.spec.ts` — Playwright: zoom-in/out via bar, Fit, 1:1, Hand persistent toggle, Eye toggle hides overlay, drawing tool pick auto-shows overlay + disables eye, one-time tooltip dismiss + persistence.

**Cross-spec impact (verify, do not assume)**

- `e2e/annotation.spec.ts` clicks `Edit annotations` to enter edit mode (line 79-83, 211, 230). After this PR that button is gone. Update those tests to drop the click and pick the Rectangle tool directly.

---

### Task 1: Drop `editing` gate + drop Edit/View toggle button

**Files:**
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx:26` — remove `const [editing, setEditing] = useState(false)`.
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx:65-71` — remove `editing` guard from `removeSelected`.
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx:191-208` — delete the `Edit annotations` / `View mode` button block.
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx:210-223` — render `<AnnotationToolbar>` unconditionally (drop `{editing && ...}`).
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx:234` — change `editable={editing}` → `editable={true}`. (We tighten this to `overlayVisible` in Task 4 once the prop arrives — for now the gate is "always editable, default tool is select".)
- Modify: `e2e/annotation.spec.ts:79-83, 211, 230` — drop the `editToggle` click; pick the Rectangle tool directly.

- [ ] **Step 1: Remove `editing` state and the toggle button.**

In `AnnotationEditor.tsx`, delete `const [editing, setEditing] = useState(false)` from line 26. Delete the JSX block lines 191-208 (the `<button>` containing the Pencil/Eye icon). Drop the `Eye, Pencil` imports from line 3.

```tsx
// Top-of-file imports — drop Eye, Pencil
import { Hand, Minus, Plus } from 'lucide-react'
```

- [ ] **Step 2: Always render the toolbar.**

Replace lines 210-223:

```tsx
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
```

- [ ] **Step 3: Always allow canvas interaction.**

Change `editable={editing}` (line 234) to `editable={true}`. The default tool is `select`, so no draw fires until the user picks a tool.

- [ ] **Step 4: Drop the `editing` guard on `removeSelected`.**

Replace lines 65-71 in the `useAnnotationKeyboardShortcuts` call:

```ts
removeSelected: () => {
  if (!editor.selectedId) return
  const shape = editor.shapes.find((s) => s.id === editor.selectedId)
  editor.removeShape(editor.selectedId)
  if (shape && shape.kind === 'pin') {
    mutations.deletePin.mutate(shape.pinId)
  }
},
```

- [ ] **Step 5: Update `e2e/annotation.spec.ts`.**

Replace the two occurrences of the edit-mode click. At lines 79-83:

```ts
// Screenshot tab is active by default. Wait for the AnnotationToolbar to appear,
// then pick the Rectangle tool — there is no longer an explicit edit toggle.
const rectangleTool = page.getByRole('button', { name: 'Rectangle' })
await expect(rectangleTool).toBeVisible({ timeout: 10000 })
await rectangleTool.click()
```

At lines 211-231 (the second test), drop `await editToggle.click()` entirely and the `editToggle` declaration above it. Click the Rectangle tool button as the entry to drawing.

- [ ] **Step 6: Run targeted gates.**

```powershell
pnpm lint
pnpm exec tsc --noEmit -p tsconfig.web.json
pnpm test:e2e --grep "Annotations"
```

Expected: lint clean, tsc clean, 2/2 annotation e2e tests green.

- [ ] **Step 7: Commit.**

```powershell
git add src/renderer/components/captures/annotation/AnnotationEditor.tsx e2e/annotation.spec.ts
git commit -m "refactor(captures): drop annotation edit gate, default to always-live toolbar"
```

---

### Task 2: Restyle `AnnotationToolbar`

**Files:**
- Modify: `src/renderer/components/captures/annotation/AnnotationToolbar.tsx` — full rewrite of the JSX body.

- [ ] **Step 1: Replace the toolbar body.**

```tsx
import type { AnnotationTool } from './useAnnotationEditor'
import {
  Square,
  ArrowRight,
  Highlighter,
  EyeOff,
  MapPin,
  MousePointer2,
  Undo2,
  Redo2
} from 'lucide-react'

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

function Separator() {
  return <span aria-hidden className="w-px h-5 bg-border" />
}

export function AnnotationToolbar({
  tool,
  setTool,
  color,
  setColor,
  strokeWidth,
  setStrokeWidth,
  canUndo,
  canRedo,
  onUndo,
  onRedo
}: Props) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
      {TOOLS.map(({ key, label, Icon }) => {
        const active = tool === key
        return (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => setTool(key)}
            className={[
              'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
              active
                ? 'bg-accent-subtle text-accent'
                : 'text-text-muted hover:bg-elevated hover:text-text-primary'
            ].join(' ')}
          >
            <Icon size={16} />
          </button>
        )
      })}

      <Separator />

      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => {
          const selected = c === color
          return (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={selected}
              onClick={() => setColor(c)}
              className={[
                'h-5 w-5 rounded-full border border-border transition-shadow',
                selected ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''
              ].join(' ')}
              style={{ backgroundColor: c }}
            />
          )
        })}
      </div>

      <Separator />

      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Stroke</span>
        <input
          type="range"
          min={1}
          max={10}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="w-20"
        />
        <span className="tabular-nums w-4 text-right">{strokeWidth}</span>
      </label>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="Undo"
          onClick={onUndo}
          disabled={!canUndo}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          onClick={onRedo}
          disabled={!canRedo}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Redo2 size={16} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run targeted gates.**

```powershell
pnpm lint
pnpm exec tsc --noEmit -p tsconfig.web.json
pnpm test:e2e --grep "Annotations"
```

Expected: lint clean, tsc clean, 2/2 annotation e2e tests still green (the existing tests query tools by `name: 'Rectangle'` which still resolves via `aria-label`).

- [ ] **Step 3: Commit.**

```powershell
git add src/renderer/components/captures/annotation/AnnotationToolbar.tsx
git commit -m "refactor(annotations): restyle AnnotationToolbar with 32px buttons + separators"
```

---

### Task 3: Build `ScreenshotZoomBar`

**Files:**
- Create: `src/renderer/components/captures/ScreenshotZoomBar.tsx`.

- [ ] **Step 1: Write the component.**

```tsx
import { Hand, Minus, Plus, Eye, EyeOff } from 'lucide-react'

interface Props {
  scale: number
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
  oneToOne: () => void
  panMode: boolean
  setPanMode: (next: boolean) => void
  overlayVisible: boolean
  setOverlayVisible: (next: boolean) => void
  /** True when active tool is a draw tool (not 'select' and not 'hand'). */
  drawing: boolean
}

function Separator() {
  return <span aria-hidden className="mx-1 w-px h-5 bg-border" />
}

export function ScreenshotZoomBar({
  scale,
  zoomIn,
  zoomOut,
  fit,
  oneToOne,
  panMode,
  setPanMode,
  overlayVisible,
  setOverlayVisible,
  drawing
}: Props) {
  const eyeDisabled = drawing
  const EyeIcon = overlayVisible ? Eye : EyeOff
  return (
    <div className="flex items-center gap-1 border-b border-border bg-surface px-3 py-1.5">
      <button
        type="button"
        aria-label="Hand tool"
        aria-pressed={panMode}
        onClick={() => setPanMode(!panMode)}
        className={[
          'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
          panMode
            ? 'bg-accent-subtle text-accent'
            : 'text-text-muted hover:bg-elevated hover:text-text-primary'
        ].join(' ')}
      >
        <Hand size={16} />
      </button>

      <Separator />

      <button
        type="button"
        aria-label="Zoom out"
        onClick={zoomOut}
        className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary"
      >
        <Minus size={16} />
      </button>
      <span className="min-w-[3.5rem] text-center text-xs text-text-muted tabular-nums">
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={zoomIn}
        className="h-8 w-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-elevated hover:text-text-primary"
      >
        <Plus size={16} />
      </button>

      <Separator />

      <button
        type="button"
        onClick={fit}
        className="h-8 px-2 rounded-lg text-xs text-text-muted hover:bg-elevated hover:text-text-primary"
      >
        Fit
      </button>
      <button
        type="button"
        onClick={oneToOne}
        className="h-8 px-2 rounded-lg text-xs text-text-muted hover:bg-elevated hover:text-text-primary"
      >
        1:1
      </button>

      <div className="ml-auto">
        <button
          type="button"
          aria-label={overlayVisible ? 'Hide annotations' : 'Show annotations'}
          aria-pressed={!overlayVisible}
          aria-disabled={eyeDisabled}
          onClick={() => {
            if (eyeDisabled) return
            setOverlayVisible(!overlayVisible)
          }}
          title={
            eyeDisabled
              ? 'Switch to the cursor tool to hide annotations'
              : overlayVisible
                ? 'Hide annotations'
                : 'Show annotations'
          }
          className={[
            'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
            eyeDisabled
              ? 'text-text-faint opacity-50 cursor-not-allowed'
              : 'text-text-muted hover:bg-elevated hover:text-text-primary'
          ].join(' ')}
        >
          <EyeIcon size={16} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles in isolation.**

```powershell
pnpm exec tsc --noEmit -p tsconfig.web.json
```

Expected: clean. The component is unused at this point — that's fine, tsc doesn't flag unused exports.

- [ ] **Step 3: Commit.**

```powershell
git add src/renderer/components/captures/ScreenshotZoomBar.tsx
git commit -m "feat(captures): add ScreenshotZoomBar component (unused — wired up next)"
```

---

### Task 4: Build `BrowserChromeFrame`

**Files:**
- Create: `src/renderer/components/captures/BrowserChromeFrame.tsx`.

- [ ] **Step 1: Write the component.**

```tsx
import type { ReactNode } from 'react'

interface Props {
  url: string
  children: ReactNode
}

export function BrowserChromeFrame({ url, children }: Props) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div
          className="ml-2 flex-1 truncate rounded-md bg-elevated px-2 py-1 text-[11px] text-text-muted"
          title={url}
        >
          {url}
        </div>
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Compile check.**

```powershell
pnpm exec tsc --noEmit -p tsconfig.web.json
```

Expected: clean.

- [ ] **Step 3: Commit.**

```powershell
git add src/renderer/components/captures/BrowserChromeFrame.tsx
git commit -m "feat(captures): add decorative BrowserChromeFrame wrapper"
```

---

### Task 5: Build `AnnotationToolsTooltip`

**Files:**
- Create: `src/renderer/components/captures/AnnotationToolsTooltip.tsx`.

- [ ] **Step 1: Verify the existing settings IPC pattern.**

Open `src/renderer/lib/queries.ts` and locate the settings query/mutation factories. The plan assumes `settingsQueryOptions()` returns `BirdbrainSettings` and a `useSettingsMutations()` hook exposes `update` for partial settings patches. If the actual API names differ, swap them in below — the shape is the same.

- [ ] **Step 2: Write the component.**

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { settingsQueryOptions, useSettingsMutations } from '@renderer/lib/queries'

const KEY = 'annotation-tools-always-live'

export function AnnotationToolsTooltip() {
  const { data: settings } = useQuery(settingsQueryOptions)
  const { update } = useSettingsMutations()
  const [dismissed, setDismissed] = useState(false)

  const seen = settings?.tooltipsSeen?.[KEY] ?? false
  if (!settings || seen || dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    update.mutate({
      tooltipsSeen: { ...settings.tooltipsSeen, [KEY]: true }
    })
  }

  return (
    <div
      role="status"
      className="pointer-events-auto absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary shadow-md"
    >
      <div className="flex items-center gap-3">
        <span>
          Drawing tools are now always live — pick the cursor to navigate, pick a shape to draw.
        </span>
        <button
          type="button"
          aria-label="Dismiss tip"
          onClick={handleDismiss}
          className="rounded p-0.5 text-text-muted hover:bg-elevated hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Compile check.**

```powershell
pnpm exec tsc --noEmit -p tsconfig.web.json
```

Expected: clean. If `settingsQueryOptions` / `useSettingsMutations` resolve differently, fix the imports inline.

- [ ] **Step 4: Commit.**

```powershell
git add src/renderer/components/captures/AnnotationToolsTooltip.tsx
git commit -m "feat(captures): add one-time annotation-tools-always-live tooltip"
```

---

### Task 6: Lift state into `ScreenshotTabPanel`, mount new components

**Files:**
- Modify: `src/renderer/components/captures/CaptureViewer.tsx` — refactor `ScreenshotTabPanel` (lines 241-278).
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx` — accept lifted state via props, drop inline zoom HUD entirely.

This is the integration task. Order: refactor `AnnotationEditor` to a presentation component first, then change `ScreenshotTabPanel` to own the state and render the new layout.

- [ ] **Step 1: Make `AnnotationEditor` a presentation component.**

New file body for `AnnotationEditor.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AnnotationShape } from '@shared/types'
import { annotationsQueryOptions, useAnnotationsMutations } from '@renderer/lib/queries'
import { AnnotationCanvas } from './AnnotationCanvas'
import { PinCommentPopover } from './PinCommentPopover'
import { useAnnotationKeyboardShortcuts } from './keyboardShortcuts'
import type { useAnnotationEditor } from './useAnnotationEditor'
import type { useZoomPan } from './useZoomPan'

type EditorApi = ReturnType<typeof useAnnotationEditor>
type ZoomPanApi = ReturnType<typeof useZoomPan>

interface Props {
  captureId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
  containerWidth: number
  containerHeight: number
  editor: EditorApi
  zoomPan: ZoomPanApi
  overlayVisible: boolean
}

const EMPTY_ANNOTATIONS_VERSION_MARKER = '__empty__'

export function AnnotationEditor(props: Props) {
  const {
    captureId,
    imageUrl,
    imageWidth,
    imageHeight,
    containerWidth,
    containerHeight,
    editor,
    zoomPan,
    overlayVisible
  } = props

  const { data: bundle, isSuccess } = useQuery(annotationsQueryOptions(captureId))
  const mutations = useAnnotationsMutations(captureId)
  const { setShapes, select, dirty } = editor

  const [popoverPinShapeId, setPopoverPinShapeId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncedAnnotationsVersionRef = useRef<string | null>(null)
  const annotationsVersion = bundle?.annotations?.updatedAt ?? EMPTY_ANNOTATIONS_VERSION_MARKER

  useEffect(() => {
    if (!isSuccess || dirty) return
    if (syncedAnnotationsVersionRef.current === annotationsVersion) return
    setShapes(bundle?.annotations?.shapes ?? [])
    select(null)
    syncedAnnotationsVersionRef.current = annotationsVersion
  }, [isSuccess, dirty, setShapes, select, bundle?.annotations?.shapes, annotationsVersion])

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

  useAnnotationKeyboardShortcuts({
    enabled: true,
    setTool: editor.setTool,
    getTool: () => editor.tool,
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
    redo: editor.redo,
    zoomIn: () => handleZoomAt(1.25, containerWidth / 2, containerHeight / 2),
    zoomOut: () => handleZoomAt(0.8, containerWidth / 2, containerHeight / 2),
    resetView: handleResetView,
    oneToOne: () =>
      handleZoomAt(
        1 / zoomPan.fitScale / zoomPan.userScale,
        containerWidth / 2,
        containerHeight / 2
      )
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
  }, [editor.dirty, editor.shapes, captureId, imageWidth, imageHeight, mutations.save])

  // Flush on unmount if dirty.
  const editorRef = useRef(editor)
  editorRef.current = editor
  useEffect(() => {
    return () => {
      const e = editorRef.current
      if (e.dirty) {
        mutations.save.mutate({ captureId, shapes: e.shapes, imageWidth, imageHeight })
      }
    }
  }, [])

  const onPinDrop = async (x: number, y: number) => {
    const tempPinId = crypto.randomUUID()
    const pin = await mutations.upsertPin.mutateAsync({ captureId, id: tempPinId, body: '' })
    const draft: AnnotationShape = {
      kind: 'pin',
      id: crypto.randomUUID(),
      pinId: pin.id,
      x,
      y,
      number: pin.number
    }
    editor.beginDraft(draft)
    editor.commitDraft()
    setPopoverPinShapeId(draft.id)
  }

  const popoverShape = editor.shapes.find((s) => s.id === popoverPinShapeId && s.kind === 'pin') as
    | Extract<AnnotationShape, { kind: 'pin' }>
    | undefined
  const popoverPin = popoverShape
    ? bundle?.pins.find((p) => p.id === popoverShape.pinId)
    : undefined

  return (
    <div className="relative h-full w-full">
      <AnnotationCanvas
        imageUrl={imageUrl}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        shapes={overlayVisible ? editor.shapes : []}
        draft={overlayVisible ? editor.draft : null}
        selectedId={editor.selectedId}
        onSelect={editor.select}
        onShapeChange={editor.updateShape}
        editable={overlayVisible}
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
        onZoomAt={handleZoomAt}
        onPan={handlePan}
        onResetView={handleResetView}
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
  )
}
```

The component now:
- Receives `editor` and `zoomPan` (no longer instantiates them).
- No longer renders `AnnotationToolbar` or any zoom HUD — its parent renders those.
- `editable` and the visible shape list are gated by `overlayVisible` (drawing-while-overlay-off impossible).

- [ ] **Step 2: Refactor `ScreenshotTabPanel` in `CaptureViewer.tsx`.**

Replace lines 241-278:

```tsx
function ScreenshotTabPanel({
  captureId,
  imageUrl,
  url
}: {
  captureId: string
  imageUrl: string
  url: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [container, setContainer] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [overlayVisible, setOverlayVisible] = useState(true)

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

  const editor = useAnnotationEditor({ initialShapes: [] })
  const zoomPan = useZoomPan({
    imageWidth: dims?.w ?? 0,
    imageHeight: dims?.h ?? 0,
    containerWidth: container.w,
    containerHeight: container.h
  })

  const drawing = editor.tool !== 'select' && editor.tool !== 'hand'
  const panMode = editor.tool === 'hand'

  const setPanMode = (next: boolean) => {
    editor.setTool(next ? 'hand' : 'select')
  }
  const requestOverlayVisible = (next: boolean) => {
    if (drawing && !next) return // disabled while drawing
    setOverlayVisible(next)
  }

  // Auto-show overlay when a draw tool is picked.
  useEffect(() => {
    if (drawing && !overlayVisible) setOverlayVisible(true)
  }, [drawing, overlayVisible])

  const cw = container.w
  const ch = container.h

  const zoomIn = () => zoomPan.zoomAt(1.25, cw / 2, ch / 2)
  const zoomOut = () => zoomPan.zoomAt(0.8, cw / 2, ch / 2)
  const fit = () => zoomPan.reset()
  const oneToOne = () =>
    zoomPan.zoomAt(1 / zoomPan.fitScale / zoomPan.userScale, cw / 2, ch / 2)

  return (
    <div className="flex h-full w-full flex-col">
      <ScreenshotZoomBar
        scale={zoomPan.userScale}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fit={fit}
        oneToOne={oneToOne}
        panMode={panMode}
        setPanMode={setPanMode}
        overlayVisible={overlayVisible}
        setOverlayVisible={requestOverlayVisible}
        drawing={drawing}
      />
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
      <div className="flex-1 min-h-0 p-3">
        <BrowserChromeFrame url={url}>
          <div ref={containerRef} className="relative h-full w-full bg-canvas">
            <AnnotationToolsTooltip />
            {dims && container.w > 0 && (
              <AnnotationEditor
                key={captureId}
                captureId={captureId}
                imageUrl={imageUrl}
                imageWidth={dims.w}
                imageHeight={dims.h}
                containerWidth={container.w}
                containerHeight={container.h}
                editor={editor}
                zoomPan={zoomPan}
                overlayVisible={overlayVisible}
              />
            )}
          </div>
        </BrowserChromeFrame>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add the new imports + pass `url` to the panel.**

At the top of `CaptureViewer.tsx`, add:

```tsx
import { ScreenshotZoomBar } from './ScreenshotZoomBar'
import { BrowserChromeFrame } from './BrowserChromeFrame'
import { AnnotationToolsTooltip } from './AnnotationToolsTooltip'
import { AnnotationToolbar } from './annotation/AnnotationToolbar'
import { useAnnotationEditor } from './annotation/useAnnotationEditor'
import { useZoomPan } from './annotation/useZoomPan'
```

In the `activeTab === 'screenshot'` branch (lines 187-200), update the `<ScreenshotTabPanel>` call site to pass the URL:

```tsx
<ScreenshotTabPanel
  captureId={capture.id}
  imageUrl={`data:image/png;base64,${content}`}
  url={capture.url}
/>
```

- [ ] **Step 4: Run all gates.**

```powershell
pnpm lint
pnpm exec tsc --noEmit -p tsconfig.web.json
pnpm exec tsc --noEmit -p tsconfig.node.json
pnpm test
pnpm test:e2e --grep "Annotations"
```

Expected: lint clean, both tsc clean, all unit tests green, both annotation e2e tests green. The annotation e2e was updated in Task 1 — confirm Konva stage still mounts and rectangles still persist.

- [ ] **Step 5: Manual smoke (developer responsibility).**

In `pnpm dev`:
- Open a capture with a screenshot. Confirm zoom bar + toolbar both render above the screenshot.
- Click Hand tool → cursor mode toggles, click again → returns to select.
- Zoom in/out via bar. `NN%` updates. Fit / 1:1 work.
- Toggle eye → annotations hide. Toggle again → reappear. While Rectangle tool is active, eye is disabled (cursor not-allowed) and tooltip shows "Switch to the cursor tool to hide annotations."
- Pick Rectangle while overlay hidden → overlay auto-shows.
- One-time tooltip appears once per fresh settings; dismiss persists across `pnpm dev` restart.

- [ ] **Step 6: Commit.**

```powershell
git add src/renderer/components/captures/annotation/AnnotationEditor.tsx src/renderer/components/captures/CaptureViewer.tsx
git commit -m "feat(captures): lift screenshot toolbars and add browser-chrome frame"
```

---

### Task 7: e2e — `screenshot-zoom-bar.spec.ts`

**Files:**
- Create: `e2e/screenshot-zoom-bar.spec.ts`.

- [ ] **Step 1: Write the spec.**

Use the same setup pattern as `e2e/annotation.spec.ts` (case via hash router → POST capture with PNG via Hono server). Reuse the inline `SCREENSHOT_PNG_BASE64` constant — copy it into the new spec, do not extract it (no shared fixture file exists yet, and PR2 should not introduce one as a "while I'm here" cleanup).

```ts
import { test, expect } from './fixtures/electronApp'

const SCREENSHOT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA4klEQVR4nO3QoQEA' +
  'AAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCs' +
  'wKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKz9zzotw8GdFsEYhAAAAABJRU5ErkJggg=='

async function seedCaseAndCapture(page: import('@playwright/test').Page, caseName: string) {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', caseName)
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForSelector('[data-testid="case-header-name-btn"]', { timeout: 10000 })

  const caseIdMatch = page.url().match(/cases\/([^/]+)/)
  if (!caseIdMatch) throw new Error('case id not in url')
  const caseId = caseIdMatch[1]

  const captureId = await page.evaluate(
    async ({ caseId, screenshotBase64 }) => {
      const status = await fetch('http://127.0.0.1:19845/api/status').then((r) => r.json())
      const token: string = status.serverToken ?? ''
      const screenshotBytes = Uint8Array.from(atob(screenshotBase64), (c) => c.charCodeAt(0))
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', 'https://example.com/zoom-bar-e2e')
      form.append('title', 'Zoom Bar E2E Page')
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', 'Zoom bar e2e')
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob(['<html><body>Zoom bar e2e</body></html>'], { type: 'multipart/related' }),
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

  await page.locator('[role="button"]', { hasText: 'Zoom Bar E2E Page' }).first().click()

  return { caseId, captureId }
}

test.describe('ScreenshotZoomBar', () => {
  test('zoom in/out, fit, 1:1, hand toggle, and eye visibility', async ({ page }) => {
    await seedCaseAndCapture(page, 'Zoom Bar Basics')

    const zoomLabel = page.locator('text=/^\\d+%$/').first()
    await expect(zoomLabel).toBeVisible({ timeout: 10000 })
    const initial = await zoomLabel.textContent()
    expect(initial).toBe('100%')

    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect(zoomLabel).not.toHaveText('100%')

    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.getByRole('button', { name: 'Zoom out' }).click()
    // After two zoom-outs from a single zoom-in we should be below 100%.
    const afterOut = await zoomLabel.textContent()
    expect(afterOut).not.toBe('100%')

    await page.getByRole('button', { name: 'Fit' }).click()
    await expect(zoomLabel).toHaveText('100%')

    await page.getByRole('button', { name: '1:1' }).click()
    // 1:1 may equal 100% if image fits — accept any digit string here, just confirm no crash.
    await expect(zoomLabel).toHaveText(/^\d+%$/)

    // Hand tool persistent toggle
    const hand = page.getByRole('button', { name: 'Hand tool' })
    await expect(hand).toHaveAttribute('aria-pressed', 'false')
    await hand.click()
    await expect(hand).toHaveAttribute('aria-pressed', 'true')
    await hand.click()
    await expect(hand).toHaveAttribute('aria-pressed', 'false')

    // Eye toggle hides annotations (overlay state) — pressed=true means hidden.
    const hide = page.getByRole('button', { name: 'Hide annotations' })
    await expect(hide).toBeVisible()
    await hide.click()
    await expect(page.getByRole('button', { name: 'Show annotations' })).toBeVisible()
  })

  test('picking a draw tool auto-shows overlay and disables eye', async ({ page }) => {
    await seedCaseAndCapture(page, 'Zoom Bar Draw Auto')

    // Hide overlay first.
    await page.getByRole('button', { name: 'Hide annotations' }).click()
    await expect(page.getByRole('button', { name: 'Show annotations' })).toBeVisible()

    // Pick Rectangle — overlay should auto-show, and the eye should now be disabled.
    await page.getByRole('button', { name: 'Rectangle' }).click()
    const eye = page.getByRole('button', { name: 'Hide annotations' })
    await expect(eye).toBeVisible()
    await expect(eye).toHaveAttribute('aria-disabled', 'true')

    // Switching back to the cursor tool re-enables the eye.
    await page.getByRole('button', { name: 'Select' }).click()
    await expect(eye).toHaveAttribute('aria-disabled', 'false')
  })

  test('one-time tooltip dismisses and persists', async ({ page, electronApp }) => {
    await seedCaseAndCapture(page, 'Tooltip E2E')

    const tip = page.getByText('Drawing tools are now always live', { exact: false })
    await expect(tip).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Dismiss tip' }).click()
    await expect(tip).toHaveCount(0)

    // Reload renderer; tooltip must stay dismissed.
    const win = electronApp.windows()[0]
    await win.reload()
    await page.waitForSelector('[data-testid="case-header-name-btn"]', { timeout: 10000 })
    await page.locator('[role="button"]', { hasText: 'Tooltip E2E' }).first().click()
    await expect(page.getByText('Drawing tools are now always live', { exact: false })).toHaveCount(0)
  })
})
```

- [ ] **Step 2: Run the new spec.**

```powershell
pnpm test:e2e --grep "ScreenshotZoomBar"
```

Expected: 3/3 green. If the tooltip-persistence test flakes because settings write hadn't flushed before reload, add a 250ms wait after Dismiss before reload (do this only if the run fails, not preemptively).

- [ ] **Step 3: Commit.**

```powershell
git add e2e/screenshot-zoom-bar.spec.ts
git commit -m "test(captures): e2e for ScreenshotZoomBar interactions"
```

---

### Task 8: Final gates

- [ ] **Step 1: Full test sweep.**

```powershell
pnpm lint
pnpm exec tsc --noEmit -p tsconfig.web.json
pnpm exec tsc --noEmit -p tsconfig.node.json
pnpm test
pnpm test:e2e
```

Expected: lint clean, both tsc clean, all unit tests green, all e2e specs green (existing 16 + 3 new = 19).

- [ ] **Step 2: Manual smoke checklist (developer responsibility).**

Run `pnpm dev` and confirm:
- Opening a capture with a screenshot renders the zoom bar above the toolbar above the browser-chrome card.
- Browser-chrome shows three colored dots and a truncated URL with a tooltip showing the full URL.
- Zoom bar Hand toggle reflects in the canvas cursor.
- Eye toggle hides/shows shapes; while a draw tool is active, eye is greyed.
- Picking Rectangle while overlay hidden auto-shows overlay.
- One-time tooltip appears on first launch, dismiss persists.
- `← →` capture nav still works.
- Space-hold pan still works (existing keyboard shortcut, momentary).

- [ ] **Step 3: Push and open PR.**

After user authorization (do not push without it):

```powershell
git push -u origin feat/capture-detail-pr2
gh pr create --title "feat(captures): screenshot polish (PR2)" --body "..."
```

PR body should mirror PR1a/PR1b style: scope summary, files touched, test plan, manual smoke checklist, screenshots if available. Reference the design doc and decisions 8/12/22/47/48/50.

---

## Out of scope / deferred

- Visual regression tests (entire redesign — tracked in `capture-detail-redesign.md` §12).
- Per-capture URL routing (still Zustand `selectedCaptureId`).
- Browser-chrome URL pill clickability (decoration only — confirmed in decision 9).
- Real MIME / hostname-pattern type inference.
- Multi-select panel state.
- AI Analysis surfacing (whole feature still hidden — see scope note in design doc).
- Refactoring `SCREENSHOT_PNG_BASE64` into a shared fixture (resist the urge — out of scope).
