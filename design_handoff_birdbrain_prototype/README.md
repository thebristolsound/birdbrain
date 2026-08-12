# Handoff: Birdbrain — desktop app + capture extension prototype

## Overview

A 1:1 interactive prototype of Birdbrain (OSINT web-capture tool for
investigations), rebuilt and extended from the real codebase at
`thebristolsound/birdbrain@main`. It covers the full desktop app (dashboard,
case workspace, settings, dialogs) and every browser-extension surface (popup,
right-click menus, in-page capture feedback, options page) inside a simulated
Chrome window. The prototype both recreates upstream screens and proposes new
functionality; `ENGINEERING_REVIEW.md` in this bundle is the feasibility
checklist separating the two, with a suggested first implementation slice.

## About the Design Files

The files in this bundle are **design references created in HTML** — working
prototypes showing intended look and behavior, not production code to copy.
The task is to **recreate these designs in the Birdbrain codebase's existing
environment** (Electron + React renderer, `src/renderer/components/*`, and the
MV3 extension in `extension/src/*`) using its established patterns and
libraries. `github.md` maps every prototype screen to the upstream files it
was grounded in. Open `Birdbrain.dc.html` in a browser to run it (keep
`support.js` beside it).

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy, and interactions.
Recreate pixel-perfectly using the codebase's existing component library.
Every style in `Birdbrain.dc.html` is inline on the element — the file itself
is the canonical source for any measurement not listed here. Two docs override
memory: `style_sync_patch/` (apply-ready CSS/token patch for `globals.css` +
`components/ui/*`) and the Design Tokens section below.

## Screens / Views

App chrome uses the token system below. The Meridian phishing mock and the
simulated Chrome browser deliberately do NOT follow it — they are simulated
third-party content.

### Dashboard
- **Purpose:** entry point; recent cases, extension status, quick start.
- **Layout:** header (recessed search field, 28px Export button) over a hero
  with flat 6px-radius CTAs; case-card grid; below it either Quick Start
  (first run, `firstRun` prop) or a **Recent activity feed** — flat
  chronological list, last 10, each row: case chip + provenance dot +
  relative time; row click jumps to the capture.
- **Components:** case cards 6px radius; status pills (9999px) reserved for
  states like "Connected"; icon tiles 6px.

### Case Overview (consolidated variant — the default)
- **Purpose:** case at a glance.
- **Layout:** Quick Notes top-left; Tags and Selectors stacked beside it;
  "Since your last visit" strip in the right column.
- **Backlink map** below Quick Notes: Maltego-style graph. Notes down the
  center lane, connected captures/selectors/tags in flanking columns on a
  3×8 lattice (no node overlaps; edges routed around unrelated nodes).
  Dashed edges = references, solid = note↔note backlinks. Hovering a node
  previews its neighborhood (dim others, accent-tinted border); legend is
  four filter chips (note / capture / selector / tag) — toggling ghosts that
  type to 12% opacity, edges to 5%, pointer-events off. Selector nodes use a
  sky dot `#0ea5e9` (map only). Long duplicate names middle-truncate.
  Node ceiling: 20 — notes always survive, busiest entities (by edge degree)
  fill the rest; footer reads "showing N of M nodes" when capped.

### Captures
- **Purpose:** evidence list + viewer + details rail (3 columns).
- **Layout:** list column and details column resizable by drag handle
  (240–560px list, 320–680px details), each collapsible to a 40px rail.
  Viewer tabs: **Screenshot / Page / Text / Wayback** (Source tab removed —
  Page IS the MHTML).
- **Multiselect:** checkbox fades in on row hover, persists once any row is
  checked. Click selects (details follow); ⌘-click toggles; shift-click
  extends from anchor; ⌘A selects the current filter; Escape clears.
  Selection survives filter changes. A **floating action bar** rises
  (`bbrise`) bottom-center of the viewport whenever the multi-set is
  non-empty: select-all checkbox + "N selected", labeled actions Export /
  Tag / Pin / Recapture / Delete, divider, X to clear (Esc). Elevated
  surface on `--shadow-overlay`, 28px buttons. No in-column batch bar, no
  "⌘click to multi-select" hint — the hover checkbox is the affordance.
- **Rows:** compact rows show clock icon + short relative time ("2h"); hover
  reveals the full timestamp. Titles 12px. Thumbnails: Birdbrain-logo
  silhouette masked over a tinted gradient (44×32 in Notes).
- **Wayback:** right-side slide-out panel, 436px — archive.org header,
  snapshot filter, date range, presets, calendar, snapshot list, pagination.
  Viewer splits into your capture vs. archive snapshot (each pane min
  300px) with an "Open at archive.org" button. Pinned snapshots surface in
  export as archive.org references. Copy explicitly states Birdbrain does
  NOT diff the two — keep that framing.

### Export dialog
- Three presets — Full evidence bundle / Working copy / Court exhibit
  (everything except analyst notes) — over an 8-item custom checklist that
  auto-detects the active preset and expands when custom. Scope row: case vs
  current selection; the signed manifest entry records
  `scope: 'case' | 'selection'` plus a `captureIds` list for selections, and
  the dialog states this in a note under the Scope row. Chain-of-custody cover sheet always included: nine
  fields + free-text purpose + signature/date rules.

### Notes
- **Purpose:** analyst notes with entity mentions.
- **Layout:** 308px list column (uniform-height rows, 44×32 capture
  thumbnail, timestamp in the byline, detailed/list toggle) + editor +
  context rail. Sort (Newest / Oldest / Title A–Z), tag + date filters,
  empty states for filtered-to-nothing and first-run with Clear filters.
- **Mention grammar:** `@` (entities: captures, selectors) and `#` (tags),
  stored as `@[capture|…]` / `#[tag|…]` tokens, rendered as chips
  (`mentionStyle` tweak). Autocomplete popup follows the caret, flips above
  it near the bottom edge, Escape suppresses without mutating the note,
  selection index clamps to list length. List snippets mask token syntax.
- **Selection → selector:** selecting editor text raises a Selector / Tag
  action bar → typed confirm popover (kind detection, watch, backfill) →
  toast. Selectors created here carry `origin: 'note'`. No Quote action in
  notes (it is already a note).
- **Rail:** collapsed Context pill 28px; footer legend documents the real
  `@` / `#` sigils.

### Signals
- Auto-capture card with a collapsible **"Never auto-capture"** section:
  case-level exclusion chips (domain or `/regex/`, monospace, removable,
  Enter-to-add inline input) + a "Stack on global / Override global"
  segmented toggle. Collapsed header summarizes: "3 exclusions · + global".
  Footer explains each mode and points at Settings → Privacy (global list).
  Coverage strip caps at the 24 most recent captures.

### Selectors / Tags / Data / Settings / New-case wizard / Command palette
- Recreations of upstream screens normalized to the token system (see
  `SESSION_HISTORY.md` "Standardization pass" for the exact conversions).
  Data screen adds context menus on tree nodes, MHTML part rows, and ledger
  entries. All context menus: 6px radius, light-native styling.
- The standalone **Extension Setup guide screen is removed** — its install
  steps were absorbed into the onboarding walkthrough (below). Old entry
  points (dashboard "Setup Guide") now replay just the tour's extension
  chapter.

### Onboarding walkthrough (net-new)
- **Mechanic:** spotlight coach marks over the real UI — 38% dim (50% for
  the welcome card), accent ring + numbered badge on the target element,
  296px anchored tooltip with arrow (flips above near the bottom edge).
  Tooltip: bold title + one sentence, optional kbd hint row, "N of M ·
  skip" + accent Next. Targets stay clickable but never auto-advance.
- **Phase 1 — intro, first launch** (`tourOnLaunch`, default on): centered
  welcome card (logo, Ctrl K replay note, skip / Start tour) → mark 1 on
  "Start New Investigation" (Ctrl N hint) → mark 2 on the Browser button,
  with an expandable **"Install walkthrough"** (3 numbered steps:
  chrome://extensions + Developer mode, Load unpacked, pick the
  manifest.json folder + pin). Ends on the dashboard; copy points at the
  seeded demo case.
- **Phase 2 — case tour**, fires on first case open (any case): 5 marks —
  viewer tabs (Captures) → auto-capture/selectors card (Signals) → note
  editor (@/# hint, Notes) → link map header (Overview) → Export button.
  Final tooltip swaps Next for **Delete demo case / Keep exploring**;
  Delete hides the seeded case from dashboard grid + palette.
- **Navigation:** mixed — Next auto-navigates routes; if the user clicks a
  nav item themselves the tour jumps ahead to the matching step (never
  backwards). Skip ends the tour for the session.
- **Replay:** ⌘K palette "Replay walkthrough" (full intro) and Settings →
  About "Replay the welcome walkthrough". The dashboard Setup Guide entry
  replays only the extension chapter (install steps pre-expanded).
- **State:** `tour {phase: 'intro'|'case'|'ext', step, installOpen}` +
  measured target rect; targets are `data-tour` attributes (newcase,
  browser, viewertabs, selectors, noteeditor, linkmap, export). Persist
  "tour done" per user in production (prototype keeps it in-memory).

### Browser sim (extension surfaces)
Simulated Chrome with three tabs.
- **Popup:** minimal — header "Logging to" with the case name as a dropdown
  (menu titled "Set active case"). Case binding is **pure global**: one
  active case app-wide; switching in the popup switches the app too (a
  footnote in the menu says so). Per-tab binding was explicitly withdrawn —
  do not build it. The **"No case selected" state uses a single-row select**
  ("Select a case…" + chevron) opening the same case list in place — no
  link-out to the app. Bare status dot with tooltip, one quiet match-summary line, neutral page-status
  icon, faint right-click hint, gear in the footer opens the options tab.
- **Context menus (native):** page context — Birdbrain ▸ Capture Full Page /
  Capture Full Page (Scrolling); selection context — top-level Create
  Selector from Selection. Items disabled unless connected + active case.
- **In-page feedback (matches `toast.ts`/`content.ts` exactly):** dark
  `#131316` bottom-right toast, `#6467f2` spinner, "Capturing page..."
  (scroll mode first shows "Scrolling to load content..."). Success = corner
  card: case name, page title, provenance meta, quick-add tag chips, View in
  Birdbrain / Recapture. Selector highlights: `rgba(251,191,36,.35)` mark +
  2px `#f59e0b` bottom border, text color inherited.
- **Options page (net-new; upstream has none):** read-only. Connection card
  (`http://127.0.0.1:19845`, Connected dot, 30s-refresh note; masked access
  token row — auto-provisioned via `/api/status`, stored locally). Screenshots
  section: On pill mirroring the app's setting, note that full-page/scrolling
  captures scroll the page and Birdbrain hides its own UI from the shot.
  Footer note: cases/selectors/ignore list/dedupe live in the app.
- **Critical behavior:** during full-page and scrolling captures, ALL
  extension-injected UI (toast, selection bar, popover, highlights) must
  hide before frames are taken and restore after — no Birdbrain chrome in
  evidence images. Not yet demoed in the sim; treat as a requirement.

## Interactions & Behavior

- Overlays (menus, popovers, palette) animate in ~120ms ease-out with a
  slight rise (`bbrise`: translateY 4px→0 + fade). Toasts slide from the
  bottom-right corner.
- Hover states throughout: rows tint to the hover surface token; buttons
  darken one step. No glow shadows anywhere.
- Column drag handles show a col-resize cursor; collapse toggles animate
  width.
- Keyboard: ⌘A select-all in filtered list, Escape clears selection /
  dismisses popups, Enter confirms in mention autocomplete and exclusion
  input, arrow keys in autocomplete.
- Empty states always offer the recovery action (Clear filters).
- Density (compact / default / comfortable) scales padding, row heights and
  gaps via `--d-*` custom properties on the root; radius does not scale.

## State Management

State the prototype maintains (names are suggestions, semantics are the spec):
- `extCase` — the single global active case; the extension popup reads and
  sets the same value the app uses.
- `tour {phase, step, installOpen}` + "tour done" flag — onboarding
  walkthrough; persist completion per user.
- `multiIds` + anchor — capture multiselect; survives filter/navigation.
- `mapHover`, `mapFocus`, `mapTypesOff` — backlink-map preview/focus/filters.
- Mention editor: query, caret position, `mAbove` (flip), `mSquelch`
  (Escape suppression).
- `acExclMode: 'stack' | 'override'` + per-case exclusion list.
- Persisted user prefs: `density`, `mentionStyle`, `overviewVariant`.
- Data dependency: a **references index** extracted from note tokens
  (note↔note, note→capture/selector/tag) powers the backlink map and the
  notes rail. See ENGINEERING_REVIEW.md item 6 — it gates the graph work.

## Design Tokens

Full machine-readable set in `style_sync_patch/`. Summary:
- **Type scale:** 10 / 11 / 12 / 14 / 18px; 12px base. Section labels:
  10px / 600 / uppercase / .06em / `--color-text-faint`.
- **Radii:** 2 / 4 / 6px only. 9999px pills strictly for status pills/dots.
  Bars (progress/coverage) 2px.
- **Controls:** buttons 28px tall / 4px radius / 0 11px padding / 12px 500.
  Inputs recessed: `--color-canvas` fill, `--color-border-strong` border,
  4px radius, 6px 10px padding.
- **Color:** accent `#6467f2`; capture-toast surface `#131316`; selector
  highlight amber `rgba(251,191,36,.35)` + `#f59e0b`; map selector-node sky
  `#0ea5e9`; success `#10b981`. All other surfaces/borders/text from the
  `--color-*` tokens in `style_sync_patch/`.
- **Monospace:** machine output only — selector patterns, globs, file paths,
  URLs/hashes, TSA endpoint, installation ID, diagnostics log. Numerics
  elsewhere use `tabular-nums`.
- **Density:** `--d-pad --d-gap --d-card --d-cardsm --d-metric --d-row
  --d-rowpad --d-head --d-itemy --d-itemx --d-tree --d-listgap` (three
  steps); `--d-r` pinned at 6px.

## Assets

- `src/renderer/assets/logo.png`, `extension-icon-48.png` — copied from the
  upstream repo; use the originals in the codebase.
- Capture thumbnails are generated (logo silhouette over tinted gradient),
  not image assets.

## Screenshots

`screenshots/` — one per major screen, captured from the running prototype
(named 01–12: dashboard, case overview, captures, Wayback compare, notes,
signals exclusions, data, settings, extension popup, options page, tour
welcome, case-tour mark). Reference only — the running HTML is the source of
truth; a fallback font was used in capture, so trust the prototype for type
rendering.

## Files

- `Birdbrain.dc.html` — the full prototype (run in a browser with
  `support.js` alongside). Inline styles are the canonical pixel values.
- `Case Reviewer.dc.html` — design-authority reference for the visual system.
- `ENGINEERING_REVIEW.md` — feasibility checklist + suggested first slice.
- `IMPLEMENTATION_GUIDE.md` — recommended build/rollout order for Claude
  Code. **Start here.**
- `SESSION_HISTORY.md` — decision log, session by session (includes the
  full standardization-pass conversion tables).
- `github.md` — screen → upstream-file map and sync history.
- `style_sync_patch/` — apply-ready patch for `globals.css` +
  `components/ui/*`.
