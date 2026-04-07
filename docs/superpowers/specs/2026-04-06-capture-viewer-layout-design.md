# Capture Viewer Layout Redesign

**Date:** 2026-04-06
**Status:** Approved

## Problem

The CaptureViewer component has a broken layout when the window is resized. The sub-tabs (Screenshot, Page, Source, Text, Metadata) are anchored to a bottom panel, disconnected from the content they control. The bottom panel also holds tags, a position counter, and keyboard hints — all crammed together. On resize, the content area collapses unpredictably while the bottom panel stays fixed.

## Solution

Restructure from a 3-zone layout (header / content / bottom panel) to a 2-zone layout (fixed header area / responsive content area). Move sub-tabs above the content. Move tags inline into the header. Eliminate the bottom panel entirely.

## Layout Structure

### Zone 1 — Fixed Header Area

Two rows, neither scrolls nor resizes:

**Row 1: Header bar**

```
[◀] [▶]  |  Title                              |  🏷 tag tag [+]  |  🛡 📝 ⬇ 🔗 🗑
           URL · 3 / 12 · ← →
```

- Nav arrows (prev/next capture)
- Title block: page title on first line; URL, position counter (`3 / 12`), and keyboard hints (`← →`) on second line, separated by `·` dots
- Tag badges inline with `+ Add tag` button. Tag dropdown opens downward. Tag area has `max-width` and `overflow: hidden` with `flex-shrink` so it yields space to title and actions. If tags are clipped, no overflow indicator is needed — the `+ Add tag` button is always visible as the last element
- Action icons: provenance badge, add note, download, open external, delete

**Row 2: Sub-tabs**

```
Screenshot | Page | Source | Text | Metadata
```

Icon + label buttons with active underline indicator. Same visual style as current, just repositioned.

### Zone 2 — Responsive Content Area

Fills all remaining vertical space via `flex: 1 1 0` with `min-height: 0`. No minimum heights anywhere. Each tab manages its own scrolling:

| Tab | Sizing | Scroll |
|---|---|---|
| Screenshot | Image at natural width (max 100%), wrapped in fake browser chrome | `overflow-y: auto` on container |
| Page (HTML iframe) | `width: 100%; height: 100%` fills flex container | iframe handles internal scroll |
| Page (MHTML webview) | `width: 100%; height: 100%` fills flex container | webview handles internal scroll |
| Source | Pre-wrapped text block | `overflow-y: auto` on container |
| Text | Pre-wrapped text block | `overflow-y: auto` on container |
| Metadata | Stacked key-value rows | `overflow-y: auto` on container |

### Bottom Panel

Removed entirely. No footer, no tag bar, no position indicator at the bottom.

## Responsive Behavior

The flex model flows from the parent route down to the content:

1. `CapturesRoute` — `flex flex-1 overflow-hidden` with viewer in `flex-1`
2. `CaptureViewer <main>` — `flex flex-1 flex-col overflow-hidden`
3. Header area (rows 1+2) — fixed height, no flex-grow/shrink
4. Content area — `flex: 1 1 0`, `min-height: 0`, `overflow: hidden`

No min-heights on any element. If the window is very small, content gets proportionally less space. No layout breakage, no overflow conflicts.

## Files Modified

### `src/renderer/components/captures/CaptureViewer.tsx`

1. Move sub-tabs from bottom panel (section C) to directly below the header (section A) as a second row
2. Move tag badges + add-tag button from bottom panel into header row, between title block and action icons
3. Move position counter and keyboard hints into URL subtitle line
4. Delete entire bottom panel (section C)
5. Change content area from `flex-1 overflow-auto p-4` to `flex-1 overflow-hidden min-h-0`
6. Each tab's content wrapper handles its own overflow
7. Remove `minHeight: '500px'` from iframe
8. Tag dropdown menu direction flips from `bottom-full` to `top-full`

### `src/renderer/components/captures/MhtmlViewer.tsx`

1. Remove `minHeight: '500px'` from webview inline style

## What Does NOT Change

- No changes to `CapturesRoute`, `CaptureList`, `CaptureItem`, or `ProvenanceBadge`
- No changes to IPC, store, query, or type definitions
- All existing functionality preserved: keyboard navigation, tag toggle, delete confirmation, add note modal
- No new dependencies
