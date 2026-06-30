# TopBar case consolidation — design

**Date:** 2026-06-28
**Status:** Approved (brainstorm)

## Problem

The active case identity is fragmented and duplicated:

- `CaseHeader` (`src/renderer/components/layout/CaseHeader.tsx`) renders on the
  captures, selectors, notes, and tags tabs. It carries: an inline-editable case
  name, an expandable inline-editable description, three stat badges
  (captures / domains / tags), a date range, and an Export button.
- `CaseSubhead` (`src/renderer/components/overview/CaseSubhead.tsx`) is a second,
  **display-only** name + description block shown on the Overview tab, plus its
  own Export button.
- `TopBar` shows no case name at all — only a bare `ChevronsUpDown` icon button
  next to the logo that opens the `CommandPalette`.

The active case name is therefore duplicated across two components and absent
from the global bar. The command launcher entry point is an unlabelled icon.

## Goal

Centralize case identity and navigation into the global `TopBar`, and make the
launcher entry point self-describing by labelling it with the active case name.

## Approved decisions

1. **TopBar gains the active case name + Export.** Stat badges and inline
   editing do **not** move into the global bar.
2. **`CaseHeader` is deleted entirely.** The captures/selectors/notes/tags tabs
   lose their header row (and reclaim the vertical space).
3. **Editing lives on the Overview tab.** Because the design promises that name
   and description editing "happen only on the Overview tab," and `CaseSubhead`
   is currently display-only, the inline rename + description editing from
   `CaseHeader` is **ported into `CaseSubhead`**. (This is the one departure from
   a pure delete — without it, rename/description editing would be silently lost.)
4. **Launcher button is breadcrumb-style:** `🐦 Birdbrain › Testing ⇅`, where the
   `Testing ⇅` segment opens the `CommandPalette`.

## Design

### TopBar (in-case layout)

```
🐦 Birdbrain  ›  Testing ⇅        [Search] [Session] [REC] [Conn] [Health]   ⬓ Export   ⚙   ☾
└─ home ──┘     └ breadcrumb,                                                 └ global ┘
                  opens launcher
```

- Logo + "Birdbrain" wordmark → Home (unchanged).
- `ChevronRight` separator + breadcrumb button showing the active case name and a
  trailing `ChevronsUpDown`. Click (or Ctrl+K) opens the `CommandPalette`.
  `data-testid="topbar-case-name"`. Long names truncate (`max-w` + `truncate`).
- Export button added to the right-controls cluster, before the settings gear.
  Opens the existing `ExportDialog`.
- Breadcrumb + Export render only when `activeCaseId` is set (same gate as
  `SearchBar` / `SessionControls`). On the dashboard/home the bar is unchanged.
- The settings-route header variant of `TopBar` is untouched.
- TopBar queries `caseQueryOptions(activeCaseId)` (enabled when in a case) for the
  name and for `ExportDialog`'s `caseName`.

### CaseSubhead (Overview) — gains editing

Port `CaseHeader`'s editing behavior:

- Name: click the `<h1>` to swap to an input; Enter/blur saves via
  `useCasesMutations().update`, Escape cancels. `data-testid="case-subhead-name-btn"`
  and `case-subhead-name-input`.
- Description: click to edit (or an "Add a description…" affordance when empty);
  blur saves, Escape cancels.
- The existing Export button and "Opened …" timestamp stay.

### Removals

- Delete `src/renderer/components/layout/CaseHeader.tsx`.
- `CaseWorkspace.tsx`: remove the `CaseHeader` import and the
  `{!isCaptures && !isOverview && <CaseHeader />}` render.
- `captures.tsx` route: remove the `CaseHeader` import and its render at the top
  of the left capture-list column.

## Behavior changes

- Export becomes reachable from **every** in-case tab (previously absent from
  Overview's header row, though `CaseSubhead` already had its own Export — that
  one stays, so Overview has two Export entry points; acceptable and in-scope).
- The captures/selectors/notes/tags stat badges and date range are dropped; the
  equivalents already live on Overview's `MetricRow`.

## Edge cases

- Case still loading → breadcrumb renders nothing (or a thin skeleton) until
  `caseData` resolves; Export is gated on `activeCase`.
- Long case name → truncates in the breadcrumb.
- Active case deleted / navigate home → breadcrumb + Export disappear via the
  `activeCaseId` gate.

## Testing

- E2E specs reference `case-header-name-btn` as a "case loaded" anchor and for the
  rename flow. Update:
  - `cases.spec.ts`: re-point the load anchor to `topbar-case-name`; the rename
    test now edits on the Overview tab via `case-subhead-name-btn` /
    `case-subhead-name-input`.
  - `screenshot-zoom-bar.spec.ts`, `empty-captures-state.spec.ts`: re-point the
    `case-header-name-btn` wait to `topbar-case-name` (present on every in-case
    route, including captures).
- Verify: lint, typecheck, build. E2E run if feasible.

## Out of scope / notes

- A stray unused `src/renderer/components/layout/export/ExportDialog.tsx` exists
  (nothing imports it; the canonical one is `components/export/ExportDialog.tsx`).
  Left untouched.
