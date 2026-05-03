# Capture Detail Redesign — Implementation Plan

**Source design**: SuperDesign draft `22ebd108-4b65-4ebe-8295-0e4dfd0291fe` ("Birdbrain — Capture Detail").
HTML cached at `.superdesign/drafts/capture-detail.html`.

**Project ID**: `f192ebe3-9c9f-4679-b340-1ba3e0c45a73`

This plan reflects decisions resolved during two `/grill-me` sessions. See §11 for the decision log.

> **Scope note (grill-2):** AI Analysis surfacing is hidden for this redesign. Analysis tab is omitted
> from the viewer tab list, the panel does not render an AI section, and the parser/structured-card
> work is deferred. `AnalysisTab.tsx`, OpenRouter services, settings AI config, and stored analyses
> are left untouched on disk. Re-enable later by re-adding the tab.

## 1. Goal

Replace the current `CapturesRoute` layout (CaptureList + CaptureViewer split) with a three-pane
capture detail layout that exposes metadata, tags, and notes in a persistent right-hand panel,
while keeping the existing screenshot/annotation/MHTML stack.

## 2. Mapping — design → Birdbrain stack

| Design element                                               | Existing Birdbrain construct                         | Action                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Top header bar                                               | `layout/TopBar.tsx`                                  | Reuse as-is.                                                                                                 |
| Left icon sidebar                                            | `layout/Sidebar.tsx`                                 | Reuse as-is (do not collapse to design's 2-item rail).                                                       |
| Per-case secondary bar                                       | `layout/CaseHeader.tsx`                              | Reuse — already sits above viewer.                                                                           |
| Breadcrumb (Back / Title + Prev/Next)                        | `CaptureViewer` header row                           | Restyle into slim h-9 breadcrumb. Drop case-name segment (CaseHeader covers it).                             |
| Content tabs (Screenshot / Page / Source / Text / Forensics) | `CaptureViewer` tabs                                 | Already present. Rename "Metadata" → "Forensics". Analysis tab omitted (AI hidden).                          |
| Zoom / view-mode toolbar                                     | `annotation/AnnotationEditor` zoom HUD               | Promote to dedicated `ScreenshotZoomBar`, Screenshot-tab only. (PR2)                                         |
| Drawing toolbar (tools + colors + stroke)                    | `annotation/AnnotationToolbar.tsx`                   | Restyle, always visible on Screenshot tab, no edit-gate. (PR2)                                               |
| Screenshot card with simulated browser chrome                | `ScreenshotTabPanel`                                 | Wrap screenshot in browser-chrome card (decorative). (PR2)                                                   |
| Right Details panel (400 px)                                 | NEW                                                  | Build `CaptureDetailsPanel`. (PR1a)                                                                          |
| Star / External / Download / Delete actions in panel header  | Currently in viewer header overflow                  | Move into panel header (4-cluster).                                                                          |
| Metadata grid (Source / Captured / Case / Type)              | Currently inside Metadata tab                        | Surface 4 fields in panel; full forensic dump in Forensics tab.                                              |
| Provenance badge                                             | `captures/ProvenanceBadge.tsx` (in viewer header)    | Mirror in BOTH breadcrumb (14px shield, glanceable) AND panel metadata grid (full row + Re-verify).          |
| Tags row                                                     | Tag popover in viewer header + `TagBadge`            | Move to panel; reuse `TagBadge`; extract popover into `useCaptureTagEditor` hook + `TagEditorPopover` shell. |
| Inline Notes textarea                                        | Notes feature (`notes/AddNoteModal`, full Notes tab) | Edit latest-by-updatedAt note inline; "+" opens `AddNoteModal`; "N notes" chip if >1.                        |

## 3. Layout

### 3.1 `routes/cases/$caseId/captures.tsx`

Three columns when a capture is selected:

```tsx
<div className="flex h-full flex-1 overflow-hidden">
  <div className="w-[280px] shrink-0 overflow-y-auto border-r border-border">
    <CaptureList caseId={caseId} />
  </div>
  <div className="flex flex-1 min-w-0 overflow-hidden">
    <CaptureViewer />
  </div>
  {selectedCaptureId && (
    <aside
      className={cn(
        'shrink-0 border-l border-border bg-surface overflow-hidden',
        reduceMotion ? '' : 'transition-[width] duration-150',
        panelDisplayedCollapsed ? 'w-10' : 'w-[400px] min-w-[400px]'
      )}
    >
      {panelDisplayedCollapsed ? <CaptureDetailsRail /> : <CaptureDetailsPanel />}
    </aside>
  )}
</div>
```

Aside only mounts when `selectedCaptureId !== null`. Empty viewer state = no panel, no rail.

### 3.2 Responsive collapse

Electron `minWidth: 900`. Sidebar 48 + List 280 + Panel 400 = 728 chrome → viewer = 172 (unusable).

State model:

- **Settings**: `detailsPanelCollapsed: boolean` (user preference, default `false`).
- **Store**: `panelCollapsedForced: boolean` (ephemeral, viewport-driven).
- **Displayed**: `panelDisplayedCollapsed = panelCollapsedForced || detailsPanelCollapsed`.

Viewport rules:

- `viewport < 1100px` → `panelCollapsedForced = true`.
- `viewport ≥ 1100px` → `panelCollapsedForced = false` (user pref controls).

User toggle in expanded zone writes `detailsPanelCollapsed`. Forced flag never writes settings.

Forced-state UX:

- Expand chevron hidden (user cannot expand at narrow viewport).
- Rail icons rendered visually-disabled with hover tooltip "Resize window to expand details".
- Count badges (tag count, note count) still informative.

Implementation: `useViewportWidth()` hook with lazy init `() => window.innerWidth`, rAF-throttled
`addEventListener('resize')`. Effect in `CapturesRoute` syncs forced flag into store.

Collapsed rail (40px) shows: chevron-expand button at top (hidden when forced), icon stack
(Star / External / Tag-count badge / Note-count badge). Click any icon expands the panel and
scrolls to that section (only when not forced).

### 3.3 `BirdbrainSettings` additions

```ts
detailsPanelCollapsed: boolean // default: false
tooltipsSeen: Record<string, boolean> // default: {}
```

**Schema migration (Zod):** strict schema → adding required key would invalidate existing settings
files and fall back to defaults, losing other settings. Use `.default()` so Zod fills missing values
during parse:

```ts
detailsPanelCollapsed: z.boolean().default(false),
tooltipsSeen: z.record(z.string(), z.boolean()).default({}),
```

`tooltipsSeen` keys are stable identifiers (e.g. `'annotation-tools-always-live'`). Replaces ad-hoc
`localStorage` keys.

### 3.4 `CaptureViewer.tsx`

Strip from current header: tag popover, `ProvenanceBadge` inline, Download/External/MoreHorizontal cluster.

Replace with **slim breadcrumb row (h-9)**:

- Left: `ArrowLeft` icon-button (clears `selectedCaptureId` → returns to empty viewer state).
- Center: capture title (truncate, `text-sm font-medium text-text-primary`).
- Right: 14px `Shield` provenance icon (color from `getProvenanceColor(capture.lastVerifiedStatus)`),
  Prev / `n of total` / Next, ← → kbd hint.

Tab list: `screenshot | page | source | text | forensics` (Analysis omitted).

Below breadcrumb: existing sub-tabs row → `ScreenshotZoomBar` (PR2; Screenshot tab only) →
existing `AnnotationToolbar` (Screenshot tab only, always visible after PR2) → content area.

### 3.5 `CaptureDetailsPanel.tsx`

Sections, top to bottom. All `border-b border-border` except last (`:last-child:border-b-0`).
Single `presets.fadeUp` on panel mount; no per-section stagger.

1. **Header** (`px-5 py-4`): "Capture Details" h2 (semibold, tracking-tight) + 4-icon actions cluster:
   - Star toggle → `useFavorites(caseId).toggleFavorite(captureId)`. Filled amber when favorited.
   - External-link → `captures.openExternal(capture.url)`.
   - Download → `handleDownload` (existing).
   - Trash → opens existing `<Dialog>` delete confirm (mounted at viewer/route level, opened by panel).
2. **Metadata grid** (`px-5 py-4`, `space-y-3.5`): icon-prefixed rows:
   - Source — Globe icon — hostname/full URL clickable → `openExternal`.
   - Captured — Calendar icon — `formatRelativeTime(capture.timestamp)` + absolute on hover.
   - Case — Folder icon — case name link → `/cases/$caseId`.
   - Type — FileType icon — `capture.format === 'mhtml' ? 'MHTML Archive' : 'HTML Page'`.
   - **Provenance** — Shield icon — verification status text + colored dot (shared
     `getProvenanceColor(status)`) + `Re-verify` button. Button drives `useVerifyMutation`;
     `isPending` pulses both panel shield and breadcrumb shield.
3. **Tags** (`px-5 py-4`): label row ("TAGS" uppercase tracking-wider) + "+ Add" text button (opens
   `TagEditorPopover`) + flex-wrap of `<TagBadge>`. Hook `useCaptureTagEditor(captureId, caseId)`
   owns state + mutations; component owns popover UI. Popover closes on `selectedCaptureId` change.
   Pending toggle mutation keyed by `captureId` (lands on the right capture even after switch).
4. **Notes** (`px-5 py-4`): label row ("NOTES" + N-notes chip if `>1` linking to Notes tab + "+"
   button opening `AddNoteModal`) + inline `<textarea>` bound to latest-by-updatedAt note's body.

   Inline note behavior:
   - Zero notes: textarea empty + placeholder. First non-empty save creates note with
     `title = capture.title`, `body = textarea`. Blank blur = no-op.
   - Existing note: textarea bound to note.body. Save = `update({ id, body })` even if empty
     (cleared body persists; no silent delete).
   - Save triggers: 1.5s debounce after typing-pause, blur, `Cmd+Enter`. No `beforeunload`.
   - `Esc`: revert to last saved + blur.
   - Pre-save guard before `+ AddNoteModal`: if inline diff vs `note.body`, await save first.
     Modal opens on clean state. Same logic on `selectedCaptureId` change.
   - Server→local sync: only when `note.id` changes OR `note.updatedAt` increases AND local body
     equals last-known server body (no unsaved diff). Prevents stomp on external invalidation.
   - Saved-at line: `Saved 2m ago` (relative) — uses `formatRelativeTime` + `useTimeTick(60_000)`.

Panel scrolls vertically inside its own column. Scroll position **preserved** across capture-switch
(don't reset to top when `selectedCaptureId` changes). Animations respect `reduceMotion`.

## 4. AI Analysis (deferred)

Hidden for this redesign. See scope note at top. Re-enable plan moves to a separate ADR.

## 5. Toolbars (PR2)

### 5.1 `ScreenshotZoomBar.tsx` (new)

Mounted by `ScreenshotTabPanel` between sub-tabs and canvas. Lifts state out of `AnnotationEditor`.
Layout left → right:

- **Left group**: Hand/Pan tool button. Persistent toggle — click engages pan, click again or pick
  another tool to disengage. Coexists with existing momentary space-hold pan
  (`keyboardShortcuts.ts:98`).
- **Center group**: zoom-out / `100%` label / zoom-in / `|` divider / `Fit` button / `1:1` button.
- **Right group**: `View mode` eye toggle — toggles annotation overlay visibility.

**View-mode + draw-tool interaction:** picking any draw tool (rect/arrow/highlight/redact/pin)
auto-shows overlay. Eye toggle becomes a pure visibility gate when active tool is `select`.
Drawing-while-overlay-off is impossible by construction.

Refactor `useZoomPan` consumption — `ScreenshotZoomBar` consumes
`{ scale, zoomIn, zoomOut, fit, oneToOne, panMode, setPanMode, overlayVisible, setOverlayVisible }`.

### 5.2 `AnnotationToolbar` restyle (no edit-gate)

Always rendered on Screenshot tab. Drop `editing` state from `AnnotationEditor` entirely. Default
tool = `select` (no-draw). Drawing only fires when user picks a draw tool.
`useAnnotationEditor.ts:26` already initializes to `select`; gate drop is mechanical.

- Tool buttons: 32×32 (`h-8 w-8 rounded-lg`), active = `bg-accent-subtle text-accent`,
  inactive = `text-text-muted hover:bg-elevated`.
- Vertical separators: `w-px h-5 bg-border`.
- Color swatches: 20×20 (`h-5 w-5 rounded-full`), selected = `ring-2 ring-{color}-300`.
- Stroke: range input + numeric label (existing).

One-time tooltip on first post-update mount: `"Drawing tools are now always live — pick the cursor
to navigate, pick a shape to draw."` Persisted via
`BirdbrainSettings.tooltipsSeen['annotation-tools-always-live']`.

## 6. Files touched

### PR1a — Layout + panel + breadcrumb

**Edit**

- `src/renderer/routes/cases/$caseId/captures.tsx` — three-column layout, responsive collapse.
- `src/renderer/components/captures/CaptureViewer.tsx` — strip header, slim breadcrumb,
  drop Analysis tab from `TABS`/`TAB_ICONS`.
- `src/renderer/stores/appStore.ts` — `panelCollapsedForced: boolean` (viewport-driven, ephemeral).
- `src/main/services/settings.ts` + `src/shared/types.ts` + `src/shared/schemas.ts` — add
  `detailsPanelCollapsed: boolean` and `tooltipsSeen: Record<string, boolean>` (Zod `.default()`).

**New**

- `src/renderer/components/captures/CaptureDetailsPanel.tsx`
- `src/renderer/components/captures/CaptureDetailsRail.tsx` (40px collapsed view)
- `src/renderer/components/captures/TagEditorPopover.tsx`
- `src/renderer/components/captures/useCaptureTagEditor.ts`
- `src/renderer/components/captures/useVerifyMutation.ts`
- `src/renderer/components/captures/getProvenanceColor.ts`
- `src/renderer/hooks/useViewportWidth.ts`
- `src/renderer/hooks/useTimeTick.ts`
- `src/renderer/lib/formatRelativeTime.ts`

**Tests**

- `tests/components/useCaptureTagEditor.test.ts` — unit (toggle / create / remove paths).
- `tests/lib/formatRelativeTime.test.ts` — unit (boundary windows: <1m, m, h, d).
- `e2e/capture-detail-panel.spec.ts` — Playwright: select capture → panel renders metadata →
  toggle favorite → add tag → save inline note (debounce + blur) → narrow viewport renders rail
  with hidden expand chevron → resize wide → restores user preference.

### PR1b — Forensics rebuild

**Edit**

- `src/renderer/components/captures/CaptureViewer.tsx` — Forensics tab body (see §8).

**Tests**

- `e2e/forensics-tab.spec.ts` — Playwright: switch to renamed tab → legacy `format='html'` capture
  shows banner → mhtml capture renders full chain → Re-verify reflects status across surfaces.

### PR2 — Screenshot polish

**Edit**

- `src/renderer/components/captures/CaptureViewer.tsx` — mount `ScreenshotZoomBar`, browser-chrome
  wrapper.
- `src/renderer/components/captures/annotation/AnnotationEditor.tsx` — drop `editing` state, lift
  zoom controls, accept overlay-visibility prop, auto-show overlay on draw-tool pick.
- `src/renderer/components/captures/annotation/AnnotationToolbar.tsx` — restyle, always visible.

**New**

- `src/renderer/components/captures/ScreenshotZoomBar.tsx`

**Tests**

- `e2e/screenshot-zoom-bar.spec.ts` — zoom in/out, Fit, 1:1, hand-tool persistent toggle, view-mode
  eye toggle, drawing tool auto-shows overlay, one-time tooltip dismiss + persistence.

## 7. Token substitutions (design → Birdbrain)

| Design class                                | Birdbrain class                          |
| ------------------------------------------- | ---------------------------------------- |
| `text-brand-500`                            | `text-accent`                            |
| `bg-brand-50` / `bg-brand-100`              | `bg-accent-subtle`                       |
| `border-brand-500`                          | `border-accent`                          |
| `bg-gray-50` (neutral cards)                | `bg-elevated`                            |
| `border-gray-100` / `border-gray-200`       | `border-border` / `border-border-strong` |
| `text-gray-900` / `text-gray-800`           | `text-text-primary`                      |
| `text-gray-700` / `text-gray-600`           | `text-text-secondary`                    |
| `text-gray-500`                             | `text-text-muted`                        |
| `text-gray-400`                             | `text-text-faint`                        |
| `bg-amber-100 text-amber-700` (status pill) | keep — status palette is theme-stable    |

Browser-chrome dots (red/amber/emerald-400) stay raw — status palette doesn't theme-swap per
`theme.md`. Cards `rounded-2xl` (panel sections), screenshot frame `rounded-xl` per radius rules.

## 8. Forensics tab content (PR1b)

Rename: `Metadata` → `Forensics`. Update `TAB_ICONS[forensics] = ShieldCheck`.

Render order:

1. **Legacy banner** (only if `capture.format === 'html'`):
   `"Legacy HTML capture — captured before forensic chain (v2). Hash present, chain metadata unavailable."`
   Style: `bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-500`.
2. **Hash chain section** (mhtml only): hash, prevHash, entryHash, manifestIndex, chainValid (from
   `lastVerifiedStatus`), Re-verify button (shares `useVerifyMutation` with panel).
3. **Identity section**: URL, Title, Captured at, Created at.
4. **Capture environment** (mhtml only): toolVersion, extensionVersion, browserVersion, userAgent,
   httpStatus.
5. **Operator** (mhtml only): operatorName, operatorId.
6. **Headers** (if present): collapsible `<pre>` block.

Hide rows whose values are `undefined` / empty. Each section header = `text-xs font-semibold
text-text-faint uppercase tracking-wider`.

## 9. Behavior preservation

- Keyboard nav `← →` between captures → keep handler in `CaptureViewer`.
- Annotation `useAnnotationKeyboardShortcuts` → unchanged.
- `AddNoteModal` → mounted at viewer/route level so panel "+" can prefill (auto-title = capture title).
- Delete confirm `<Dialog>` → mounted at viewer/route level, opened by panel header trash button.
- Multi-select selection state in store stays dormant. Panel renders single-capture only.
- `selectedCaptureId` already cleared on case switch (`CaseWorkspace.tsx:22`).

## 10. Phasing

**PR 1a — Layout + panel + breadcrumb**

- Three-column layout + responsive collapse + forced rail UX.
- `BirdbrainSettings.detailsPanelCollapsed` + `tooltipsSeen`.
- `CaptureDetailsPanel` (header w/ 4-cluster, metadata grid w/ provenance row + Re-verify, tags w/
  hook + popover, inline notes w/ debounce + blur + Cmd+Enter + Esc revert).
- `CaptureDetailsRail` (collapsed 40px view).
- Slim breadcrumb in `CaptureViewer` (provenance icon + Prev/Next).
- Strip viewer header overflow menu (actions moved to panel).
- Drop Analysis tab from list (AI hidden).
- Helpers: `getProvenanceColor`, `useVerifyMutation`, `formatRelativeTime`, `useTimeTick`,
  `useViewportWidth`.
- Tests: `useCaptureTagEditor.test.ts`, `formatRelativeTime.test.ts`, `capture-detail-panel.spec.ts`.

**PR 1b — Forensics rebuild**

- Rename Metadata → Forensics + icon swap.
- Legacy banner for `format='html'`.
- Six sections (hash chain, identity, environment, operator, headers).
- Re-verify shares `useVerifyMutation` with panel.
- Tests: `forensics-tab.spec.ts`.

**PR 2 — Screenshot polish**

- `ScreenshotZoomBar` lift (Hand persistent + zoom + view-mode in zoom row).
- Browser-chrome wrapper around screenshot.
- `AnnotationToolbar` restyle.
- Drop `editing` gate, default tool = select.
- Draw-tool pick auto-shows overlay; eye toggle = pure visibility gate when tool=select.
- One-time tooltip via `tooltipsSeen` settings key.
- Tests: `screenshot-zoom-bar.spec.ts`.

## 11. Decision log

### Grill round 1

1. **Three-pane layout**: panel collapses to 40px rail below 1100px viewport.
2. **Panel collapse persistence**: settings (`detailsPanelCollapsed`).
3. **ProvenanceBadge**: BOTH breadcrumb (14px shield) AND panel metadata grid (full row +
   Re-verify).
4. **Re-analyze button**: superseded — AI hidden.
5. **Inline note**: latest-by-updatedAt in textarea; "+" opens AddNoteModal; "N notes" chip if >1.
6. **Analysis parsing**: superseded — AI hidden.
7. **Metadata tab**: renamed `Forensics`; full forensic dump with legacy banner + hidden empty rows.
8. **Edit-mode gate**: dropped. Tools always live, default = Select tool. View-mode toggles overlay.
9. **Browser chrome URL pill**: full URL truncated end, title=full URL, no-op click.
10. **Type field**: `"HTML Page"` / `"MHTML Archive"` (format-derived).
11. **Capture URL routing**: deferred. Stay Zustand `selectedCaptureId`.
12. **Hand/Pan tool**: in zoom row.
13. **Inline note save**: blur + Cmd+Enter; saved-at timestamp.
14. **Phasing**: 2 PRs (superseded — now 3, see grill-2).
15. **AnalysisTab body**: superseded — AI hidden.
16. **Forensics legacy mode**: hide undefined rows + amber banner.
17. **Vertical chrome density**: slim breadcrumb h-9, drop case-name segment.
18. **Test scope**: parser unit (dropped) + tag-editor unit + capture-detail-panel e2e + forensics-tab e2e.

### Grill round 2

19. **AI hidden (mode A)**: tab + panel section omitted; `AnalysisTab.tsx`, OpenRouter services,
    settings AI config, stored analyses left untouched. Re-enable later by re-adding tab.
20. **Inline note title for new notes**: auto = `capture.title` (matches `AddNoteModal` default).
21. **Inline note empty-body on existing**: persist empty (`update({ id, body: '' })`); no silent delete.
22. **Inline note autosave**: debounce 1.5s + blur + Cmd+Enter. No `beforeunload`.
23. **Inline note Esc**: revert to last saved + blur.
24. **Latest-note swap**: pre-save inline diff before opening AddNoteModal or switching capture.
25. **Server→local sync**: only when `note.id` changes or `updatedAt` increases AND no local diff.
26. **Saved-at refresh**: `Intl.RelativeTimeFormat` + `useTimeTick(60_000)`.
27. **Collapse model**: `displayed = forced || userPref`. Forced never writes settings.
28. **Forced-state UX**: expand chevron hidden, rail icons disabled-but-visible with "Resize to
    expand" tooltip.
29. **Auto-expand-once rule**: dropped. Default `false` → ≥1100 shows expanded on first launch.
30. **`useViewportWidth`**: lazy init + rAF-throttled resize.
31. **`transition-[width]`**: gated on `!reduceMotion`.
32. **PR split**: 1a (layout+panel+breadcrumb) / 1b (Forensics) / 2 (screenshot polish).
33. **Tag hook scope**: `useCaptureTagEditor` returns state/mutations; `<TagEditorPopover>` UI shell.
34. **Trailing border**: `:last-child:border-b-0` on panel sections.
35. **Download button**: panel header 4-cluster (Star/External/Download/Trash).
36. **AddNoteModal "+"**: accept default (auto-title = capture title).
37. **Stagger**: dropped. Single `presets.fadeUp` on panel mount.
38. **Multi-select**: deferred. Panel = single-capture only.
39. **One-time tooltip storage**: `BirdbrainSettings.tooltipsSeen`.
40. **Notes count per capture**: client filter on `notes(caseId)` query.
41. **Re-verify flow**: shared `getProvenanceColor` + `useVerifyMutation`; `isPending` pulses both
    shield surfaces; invalidate `captures(caseId)` on success.
42. **Empty state**: aside only mounts when `selectedCaptureId !== null`.
43. **Time-ago helper**: `formatRelativeTime` + `useTimeTick(60_000)`.
44. **Tag popover capture-switch**: close on `selectedCaptureId` change. Pending mutation keyed by
    `captureId`.
45. **Zod schema**: `.default(false)` / `.default({})` for new keys to avoid invalidating existing
    settings files.
46. **Tag trigger style**: "+ Add" text button.
47. **View-mode + draw-tool**: picking draw tool auto-shows overlay; eye toggle pure when tool=select.
48. **Hand tool**: persistent toggle. Coexists with momentary space-hold pan.
49. **Panel scroll**: preserved across capture-switch.
50. **PR2 tests**: `screenshot-zoom-bar.spec.ts` added.

## 12. Out of scope / deferred

- AI Analysis surfacing entirely (Phase A parser + panel cards + Phase B JSON envelope).
- Per-capture URL routing (`/cases/$caseId/captures/$captureId`).
- Visual regression tests.
- "Type" field via real MIME / hostname-pattern inference.
- Multi-select panel state (multi-select feature dormant in app).
- Notes "primary" schema flag.
- `beforeunload` guard for unsaved inline notes.
