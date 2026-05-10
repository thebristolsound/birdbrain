# Capture Detail Polish Round 2 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three smoke nits surfaced after PR2 #100 merge — duplicate breadcrumb arrows, capture-list typography hierarchy, and lack of click-to-delete shape UX on the annotation canvas.

**Architecture:** Three small targeted fixes plus a final smoke/gates pass. No new components, no refactors. Each task touches 1–3 files.

**Tech Stack:** React 19, Tailwind v4, Konva (react-konva), TanStack Router/Query, Vitest, Playwright.

**Branch:** `feat/capture-detail-polish-r2` (cut from master at 0ef58e0).

---

## Pre-flight Notes

- Manual smoke for PR2 panel-collapse chevron (Task 9 of PR2) is a known-good carryover — verify in final smoke pass, no code work expected.
- All file paths absolute from repo root.
- Per CLAUDE.md: no `pnpm format` / `pnpm lint --fix` runs. PostToolUse hook handles per-file formatting.
- Use `pnpm exec tsc --noEmit -p tsconfig.web.json` and `tsconfig.node.json` for typecheck (no `pnpm typecheck` script).

---

### Task 1: Remove duplicate breadcrumb arrow hint

**Problem:** `CaptureViewer.tsx` breadcrumb row renders ChevronLeft + counter + ChevronRight, then a redundant `← →` keyboard-hint span. Visual clutter — keyboard arrows are already discoverable via tooltip and the chevron buttons are self-explanatory.

**Fix:** Remove the `← →` hint span. Add `title` attrs with keyboard hint on the prev/next chevron buttons.

**Files:**

- Modify: `src/renderer/components/captures/CaptureViewer.tsx` (around lines 137–151)

**Steps:**

- [ ] **Step 1: Edit chevron buttons + delete hint span**

In `CaptureViewer.tsx`, find the breadcrumb prev/next block:

```tsx
<Button variant="ghost" size="icon-sm" onClick={goPrev} disabled={currentIndex <= 0}>
  <ChevronLeft className="h-3.5 w-3.5" />
</Button>
<span className="shrink-0 text-[11px] text-text-faint">
  {currentIndex + 1} / {captures.length}
</span>
<Button
  variant="ghost"
  size="icon-sm"
  onClick={goNext}
  disabled={currentIndex >= captures.length - 1}
>
  <ChevronRight className="h-3.5 w-3.5" />
</Button>
<span className="shrink-0 text-[11px] text-text-faint">← →</span>
```

Replace with:

```tsx
<Button
  variant="ghost"
  size="icon-sm"
  onClick={goPrev}
  disabled={currentIndex <= 0}
  title="Previous capture (←)"
>
  <ChevronLeft className="h-3.5 w-3.5" />
</Button>
<span className="shrink-0 text-[11px] text-text-faint">
  {currentIndex + 1} / {captures.length}
</span>
<Button
  variant="ghost"
  size="icon-sm"
  onClick={goNext}
  disabled={currentIndex >= captures.length - 1}
  title="Next capture (→)"
>
  <ChevronRight className="h-3.5 w-3.5" />
</Button>
```

- [ ] **Step 2: Typecheck**

```powershell
pnpm exec tsc --noEmit -p tsconfig.web.json
```

Expected: clean.

- [ ] **Step 3: Lint**

```powershell
pnpm lint
```

Expected: clean (no new warnings).

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/components/captures/CaptureViewer.tsx
git commit -m "fix(captures): remove redundant arrow-key hint from breadcrumb"
```

---

### Task 2: Restore CaptureItem typography hierarchy

**Problem:** `CaptureItem.tsx` collapses the title and hostname into the same visual weight (`text-text-secondary` for both effective levels). Selector badges at `text-[9px]` are below readable threshold. Hierarchy reads flat.

**Fix:**

- Title: `text-sm font-medium text-text-secondary` → `text-sm font-semibold text-text-primary`
- Hostname: keep `text-[11px] font-mono text-text-muted` (already correct secondary tier)
- Timestamp: keep `text-[11px] text-text-faint` (already correct tertiary tier)
- Selector badge labels: `text-[9px]` → `text-[10px]`

**Files:**

- Modify: `src/renderer/components/captures/CaptureItem.tsx` (lines ~141, ~165, ~173)

**Steps:**

- [ ] **Step 1: Bump title weight + color**

Find:

```tsx
<div className="min-w-0 flex-1 truncate text-sm font-medium text-text-secondary">
  {capture.title || hostname}
</div>
```

Replace with:

```tsx
<div className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
  {capture.title || hostname}
</div>
```

- [ ] **Step 2: Bump selector badge size**

Two badges currently use `text-[9px]`. Update both to `text-[10px]`. Find:

```tsx
className = 'rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-medium text-accent'
```

Replace with:

```tsx
className = 'rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent'
```

And:

```tsx
className = 'rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-text-faint'
```

Replace with:

```tsx
className = 'rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-text-faint'
```

- [ ] **Step 3: Typecheck**

```powershell
pnpm exec tsc --noEmit -p tsconfig.web.json
```

- [ ] **Step 4: Run existing capture-item tests if any**

```powershell
pnpm test --run -- CaptureItem
```

Expected: pass (or "no tests found" — fine).

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/components/captures/CaptureItem.tsx
git commit -m "fix(captures): restore typography hierarchy in capture list"
```

---

### Task 3: Click-to-delete shape UX

**Problem:** Clicking a shape selects it (sets `selectedId`), and Delete/Backspace removes it via `keyboardShortcuts.ts`. But:

1. No visual feedback on selected shape — user can't see the selection happened
2. No toolbar Delete button — keyboard-only delete is undiscoverable

**Fix:**

1. Add a "selected" visual treatment to RectShape, ArrowShape, RedactShape, PinShape — accent-color dashed stroke overlay when `selectedId === shape.id`.
2. Add a Delete button to AnnotationToolbar between the stroke-width control and the undo/redo group. Disabled when `selectedId == null`. Tooltip "Delete selected (Del)".

**Files:**

- Modify: `src/renderer/components/captures/annotation/AnnotationToolbar.tsx`
- Modify: `src/renderer/components/captures/annotation/AnnotationCanvas.tsx` (pass `selectedId` already done — verify shape components receive it)
- Modify: `src/renderer/components/captures/annotation/shapes/RectShape.tsx`
- Modify: `src/renderer/components/captures/annotation/shapes/ArrowShape.tsx`
- Modify: `src/renderer/components/captures/annotation/shapes/RedactShape.tsx`
- Modify: `src/renderer/components/captures/annotation/shapes/PinShape.tsx`
- Modify: `src/renderer/components/captures/annotation/AnnotationEditor.tsx` (wire `selectedId` + `removeShape` props through to toolbar)
- Modify: `src/renderer/components/captures/CaptureViewer.tsx` (`ScreenshotTabPanel` passes `editor.selectedId` and `editor.removeShape` to AnnotationToolbar)

**Steps:**

- [ ] **Step 1: Read current AnnotationToolbar to identify insertion point**

Read `src/renderer/components/captures/annotation/AnnotationToolbar.tsx` symbol body via Serena. Identify the structure around the undo/redo button group.

- [ ] **Step 2: Extend AnnotationToolbar Props with selectedId + onDelete**

Add to `AnnotationToolbarProps` (or whatever the props interface is named):

```ts
selectedId: string | null
onDeleteSelected: () => void
```

Insert a new toolbar button before the undo/redo group:

```tsx
<button
  type="button"
  title="Delete selected (Del)"
  aria-label="Delete selected shape"
  onClick={onDeleteSelected}
  disabled={!selectedId}
  className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
>
  <Trash2 className="h-4 w-4" />
</button>
<Separator />
```

(Import `Trash2` from `lucide-react` at the top of the file.)

- [ ] **Step 3: Wire through ScreenshotTabPanel**

In `src/renderer/components/captures/CaptureViewer.tsx` `ScreenshotTabPanel`, add to the `<AnnotationToolbar />` invocation:

```tsx
selectedId={editor.selectedId}
onDeleteSelected={() => {
  if (!editor.selectedId) return
  editor.removeShape(editor.selectedId)
}}
```

- [ ] **Step 4: Add selection visual to RectShape**

In `src/renderer/components/captures/annotation/shapes/RectShape.tsx`, extend Props with `selected?: boolean`. When `selected`, render a second `<Rect>` overlaid (or set the existing rect's `dash`/`shadowColor`) with an accent color dashed outline:

For non-highlight branch:

```tsx
return (
  <>
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
    {selected && (
      <Rect
        x={shape.x - 2}
        y={shape.y - 2}
        width={shape.w + 4}
        height={shape.h + 4}
        stroke="#3b82f6"
        strokeWidth={1.5}
        dash={[4, 4]}
        listening={false}
      />
    )}
  </>
)
```

For highlight branch: same pattern — wrap existing fill in fragment + add dashed outline overlay.

- [ ] **Step 5: Repeat selection visual for ArrowShape, RedactShape, PinShape**

Same pattern: extend Props with `selected?: boolean`, render an overlaid accent-blue dashed indicator when `selected`. For ArrowShape, the indicator can be a thicker translucent stroke. For PinShape, a ring around the pin. For RedactShape, dashed outline like RectShape.

- [ ] **Step 6: Pass selected prop from AnnotationCanvas**

In `AnnotationCanvas.tsx`, the shape map already has `selectedId`. Add `selected={selectedId === s.id}` to each shape invocation alongside the existing props.

- [ ] **Step 7: Typecheck**

```powershell
pnpm exec tsc --noEmit -p tsconfig.web.json
pnpm exec tsc --noEmit -p tsconfig.node.json
```

Expected: clean.

- [ ] **Step 8: Lint**

```powershell
pnpm lint
```

- [ ] **Step 9: Run annotation tests**

```powershell
pnpm test --run -- annotation
```

Expected: all pass.

- [ ] **Step 10: Run e2e annotation spec**

```powershell
pnpm test:e2e -- annotation
```

Expected: 2/2 pass.

- [ ] **Step 11: Commit**

```powershell
git add src/renderer/components/captures/annotation/AnnotationToolbar.tsx src/renderer/components/captures/annotation/AnnotationCanvas.tsx src/renderer/components/captures/annotation/shapes/ src/renderer/components/captures/annotation/AnnotationEditor.tsx src/renderer/components/captures/CaptureViewer.tsx
git commit -m "feat(annotations): add toolbar delete button and selection outline"
```

---

### Task 4: Final gates + manual smoke + push + PR

**Goal:** Verify all gates green, smoke the three nits + carryover panel-collapse chevron, push, open PR.

**Steps:**

- [ ] **Step 1: Run full unit suite**

```powershell
pnpm test --run
```

Expected: all pass (PR2 baseline 579 pass / 2 skip).

- [ ] **Step 2: Run full e2e suite**

```powershell
pnpm test:e2e
```

Expected: all pass (PR2 baseline 19/19).

- [ ] **Step 3: Manual smoke**

Start dev: `pnpm dev`.

Verify:

- [ ] Capture viewer breadcrumb: prev/next chevrons + counter only — no `← →` hint span
- [ ] Hover prev chevron → tooltip "Previous capture (←)". Hover next → "Next capture (→)"
- [ ] Capture-list item: title is bold + primary text color. Hostname dimmer. Timestamp dimmer still. Selector badges legible at 10px
- [ ] Click a shape on canvas → selection outline appears. Click another shape → outline moves. Click empty area → outline gone
- [ ] Toolbar shows Delete (trash) icon. Disabled when nothing selected. Click to delete selected shape. Delete key still works
- [ ] PR2 carryover: right-panel chevron collapses Capture Details column. Re-open via case-header or other entry point

- [ ] **Step 4: Push branch**

```powershell
git push -u origin feat/capture-detail-polish-r2
```

- [ ] **Step 5: Open PR**

```powershell
gh pr create --title "fix(captures): polish round 2 — breadcrumb, list typography, shape delete UX" --body "$(cat <<'EOF'
## Summary
- Remove redundant `← →` keyboard hint span from capture-viewer breadcrumb; add keyboard hints to chevron tooltips
- Bump capture-list title to `font-semibold text-text-primary` so title/hostname/timestamp form a clear three-tier hierarchy; lift selector badges from 9px to 10px
- Add visual selection outline to all annotation shapes; add toolbar Delete button (disabled when no shape selected) for discoverable click-to-delete

## Test plan
- [x] `pnpm exec tsc --noEmit -p tsconfig.web.json` clean
- [x] `pnpm exec tsc --noEmit -p tsconfig.node.json` clean
- [x] `pnpm lint` clean
- [x] `pnpm test --run` — all pass
- [x] `pnpm test:e2e` — all pass
- [x] Manual smoke: breadcrumb, list typography, shape select+delete, panel collapse

Matt Donovan - mattddonovan@proton.me
EOF
)"
```

---

## Self-Review Checklist

- [x] Spec coverage: all three smoke nits + carryover smoke covered
- [x] No placeholders ("TBD", "fill in")
- [x] Type consistency: `selectedId: string | null`, `onDeleteSelected: () => void` — no name drift between tasks
- [x] Each task ends with typecheck + commit
