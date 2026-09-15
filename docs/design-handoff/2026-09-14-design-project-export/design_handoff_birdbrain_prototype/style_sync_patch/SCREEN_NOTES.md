# Screen notes — v2

Per-screen residue after the primitive patch lands. Repo paths are the ones the
prototype was rebuilt from. All values re-measured after the standardization +
sweep passes (radii 2/4/6, one 28px control metric).

## App shell — TopBar / Sidebar
`src/renderer/routes/__root.tsx`, `components/layout/{TopBar,Sidebar}.tsx`

- Wordmark: `font-display`, 12px, weight **800**, `tracking-[-0.025em]`.
- TopBar icon actions (theme toggle, settings): 28px square, `rounded-md` (4px),
  transparent, `text-text-muted`, hover `bg-elevated`.
- Back action: 28px, `rounded-md`, ghost, 12px/500.
- Search field: recessed standard — `bg-canvas`, `border-border-strong`, 4px, 12px.
- Extension status pill: `<Badge variant="success" size="pill" dot pulse>` (28px).
  Disconnected is `variant="danger"`, same shape.
- Export button: the 28px/4px metric, 12px text (was 32px/14px).
- Menus off the TopBar: `rounded-lg` (6px), `bg-elevated`, `shadow-overlay`.
- Sidebar tooltips: `bg-elevated`, `shadow-overlay`, `rounded-md`, 11px.

## Dashboard
`components/dashboard/{Dashboard,HeroSection,RecentCases,CaseCard,QuickStartGuide,ExtensionBanner,DashboardFooter}.tsx`

- Hero title 36px/800/`tracking-[-0.025em]`, brand word in `text-accent`;
  subtitle 14px.
- Primary CTA: `<Button size="lg">` — 36px, 6px radius, **flat** (no glow).
  Secondary CTAs match geometry, `variant="outline"`.
- Case cards / Quick Start cards / extension banners: 6px radius, `p-5`,
  `border-border`, hover to `border-border-strong` (no shadow, no lift).
- Card icon tiles: 40×40, 6px, tinted background + 20%-alpha matching border.
- Step tiles: 6px. Card titles 12px. "Connected" badge is a status pill.
- New-case card: 6px, `border-2 border-dashed`, hover → `border-accent` +
  `bg-accent-subtle`; inner icon well 48×48, 6px.
- Quick-start illustrations: `<CardPanel>` (6px, `bg-surface`, `border-border-strong`).
- Case count chip: `<Badge variant="outline" size="sm">` — mono, 10px.
- Once a case has activity, Quick Start is replaced by the "Recent activity"
  feed (flat chronological, last 10, case chip + provenance dot + relative
  time) — see prototype `firstRun` toggle. Needs the new captures-across-cases
  repo function + IPC channel (engineering review item 14).

## Case Overview
`components/overview/*.tsx`, `overviewModel.ts`

- Page title 24px/800/`tracking-[-0.025em]`, truncating.
- Metric numerals 30px/800/`font-display`/`tracking-[-0.025em]`, `leading-none`,
  `tabular-nums`; captions are `<SectionLabel>`.
- Panel heads ("Capture activity", "Quick notes", …): `<SectionLabel>` — the
  eyebrow treatment, not a 13px heading.
- Jump-to-captures action: 28px/4px, `bg-card` + `border-border-strong`, 12px.
- Quick-note field: recessed standard.
- The **consolidated** variant is now the default (user-saved tweak): "Since
  your last visit" strip in the right column, Quick Notes top-left, backlink
  map below it. The map depends on the references index (items 6–7) and must
  not block the rest of the re-layout.
- Backlink map: 3×8 lattice, **node ceiling with "showing N of M"** — same
  cap treatment as the Signals coverage strip (which caps at 24).

## Captures
`components/captures/*.tsx`

**Decision (2026-08-11, design):** the prototype's tab set wins — viewer tabs
are **Screenshot / Page / Text / Wayback**. Source is removed (Page is the MHTML
file); Wayback is promoted back from the details panel to a tab, opening the
436px slide-out with the side-by-side capture/snapshot viewer. This reverses
upstream's demotion deliberately — the standing "confirm which side wins" note
in `github.md` is settled.

- Search field: recessed standard, left icon inset 28px.
- Sort/filter/download menus 6px; annotation toolbar buttons 28px; toolbar
  shell + style panel 6px; screenshot frame 6px; tab group 6px shell / 4px
  triggers; selection bars 28px; row titles 12px; thumbnails 2px; tag chips
  pills.
- Metadata labels (Source, Captured): `<SectionLabel>`; labels and values share
  one left edge (no hanging icons).
- Chain-of-custody / hash-chain / identity heads: `<SectionLabel emphasis="strong">`.
- Hashes, timestamps-as-evidence and URLs: `font-mono` 11px. List-row relative
  times are body type with `tabular-nums`, full timestamp on hover.
- Multiselect: checkbox fades in on row hover, sticky once anything is checked;
  ⌘-click toggles, shift-click extends, ⌘A selects the filtered set, Escape
  clears. Batch bar slides in as a footer above the count row (export / tag /
  pin / recapture / delete / clear). Needs batch IPC or renderer fan-out —
  engineering review item 11 flags the decision.

## Selectors · Notes · Tags
`components/{selectors,notes,tags}/*.tsx`

- Selector entry field: `font-mono` 12px, borderless inside its bordered row.
- Bulk-paste textarea: `font-mono` 11px, 4px, `bg-canvas`.
- Tag create field: borderless inside its chip row.
- Tag chips: `rounded-full`, 2px/8px padding, mono 10px.
- Note prose keeps `.note-prose` from `globals.css` unchanged.
- Mention popup and selector-confirm popover: 6px, `bg-elevated`, `shadow-overlay`;
  suggestion/link rows 4px.

## Data explorer
`components/dashboard/cases/DataExplorer.tsx`

- Column heads: `<SectionLabel>`.
- IDs, counts, timestamps in cells: `font-mono` 11px.
- Search input: recessed standard. Tree rows and tabs 4px; detail panels 6px;
  badges 4px; checkboxes 2px.
- Row hover: `bg-elevated`, no border change.
- Filter menu: `bg-elevated`, `shadow-overlay`, 6px; group heads `<SectionLabel>`.

## Settings
`components/settings/*.tsx`, `components/settings/db/*.tsx`

- Section cards: 6px.
- Toggles: 26×14 track, `rounded-full`, 10px knob, `bg-accent` on /
  `bg-border-strong` off.
- Test actions: 28px outline buttons, `flex-1`, 12px/500.
- Destructive actions: `variant="destructive"` at the 28px metric.

## Extension setup guide
`components/extension/{InstallExtensionGuide,InstallExtensionStepper,installSteps}.tsx`

- Step connector stays the 2px `bg-border` rule.
- Completed step badge: `variant="success"` with check icon.
- Success callout: `bg-success-surface` + `border-success-line`, 6px,
  12px/700 `font-display`.

## New case wizard
`components/dashboard/cases/{NewCaseWizard,CreateCaseDialog,ImportCaseDialog}.tsx`

- Dialog panel: 6px (via the token collapse). Dialog titles 14px.
- Wizard fields are the one input exception: 14px / `px-3 py-2` via
  `className` — user-authored prose, not UI chrome. Description textarea 6px,
  recessed fill.
- Footer actions: 28px/4px, primary + ghost.

## Command palette
`components/layout/CommandPalette.tsx`

- Overlay: `bg-elevated`, 6px, `shadow-overlay`.
- Group heads: `<SectionLabel>`.
- Result rows: 4px, 28px, hover/selected `bg-elevated`; shortcut hints
  `font-mono` 10px `text-text-faint`.

## Export dialog
`components/export/ExportDialog.tsx` (upstream: flat 4-item checklist)

- Three presets (Full evidence bundle / Working copy / Court exhibit) over the
  eight-item custom list; preset auto-detected from the selection.
- Scope row: "Entire case" vs "Current selection (N captures)". The signed
  export manifest entry records `scope: 'case' | 'selection'` and, for
  selections, the `captureIds` list — required so the audit trail can
  distinguish a full-case export from a partial one (engineering review
  item 13; decided 2026-08-11).
- Chain-of-custody cover sheet: map the prototype's nine fields against the
  existing `certification.html` before inventing a second sheet.
