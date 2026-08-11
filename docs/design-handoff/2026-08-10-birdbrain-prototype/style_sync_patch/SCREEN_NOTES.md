# Screen notes

**NOTE: These notes are superseded.** The primitive patch described in
`DESIGN_SYSTEM_PATCH.md` was rejected in favor of the later standardization
documented in the bundle's top-level `README.md` and `SESSION_HISTORY.md`.

Per-screen residue after the primitive patch lands. Repo paths are the ones the
prototype was rebuilt from.

## App shell — TopBar / Sidebar
`src/renderer/routes/__root.tsx`, `components/layout/{TopBar,Sidebar}.tsx`

- Wordmark: `font-display`, 12px, weight **800**, `tracking-[-0.025em]`.
- TopBar icon actions (theme toggle, settings): 28px square, `rounded-md`,
  transparent, `text-text-muted`, hover `bg-elevated`.
- Back action: 32px, `px-3`, `rounded-md`, ghost, 14px/500.
- Extension status pill: `<Badge variant="success" size="pill" dot pulse>`. The
  disconnected state is `variant="danger"`, same shape.
- Case search field sits **inside** the bordered row — field itself is
  `border-none bg-transparent`, 12px.
- Sidebar items collapse to icon-only with a hover tooltip; tooltip is
  `bg-elevated`, `shadow-[var(--shadow-overlay)]`, `rounded-md`, 11px.

## Dashboard
`components/dashboard/{Dashboard,HeroSection,RecentCases,CaseCard,QuickStartGuide,ExtensionBanner,DashboardFooter}.tsx`

- Hero title 36px/800/`tracking-[-0.025em]`, brand word in `text-accent`.
- Primary CTA → `<Button variant="hero">`. Secondary CTAs match its geometry
  (`rounded-2xl px-6 py-4`, 14px/600) but stay `variant="outline"`.
- Case cards: `<Card>` at 16px radius, `p-5`, `border-border`, hover to
  `border-border-strong` (no shadow, no lift).
- Card icon tile: 40×40, `rounded-xl`, tinted background with a matching 20%-alpha border.
- New-case card: `rounded-2xl`, `border-2 border-dashed border-border`,
  `min-h-[260px]`, hover → `border-accent` + `bg-accent-subtle`. Its inner icon
  well is 48×48, `rounded-2xl`, `bg-accent-subtle` with a 20%-accent border.
- Quick-start tiles: `<Card>` 16px with `<CardPanel>` illustrations inside (12px,
  `bg-surface`, `border-border-strong`).
- Case count chip: `<Badge variant="outline" size="sm">` — mono, 10px.

## Case Overview
`components/overview/*.tsx`, `overviewModel.ts`

- Page title 24px/800/`tracking-[-0.025em]`, truncating.
- Metric numerals 30px/800/`font-display`/`tracking-[-0.025em]`, `leading-none`;
  their captions are `<SectionLabel>` at `text-[10.5px]` weight 600.
- "Capture activity" and sibling section heads: 13.5px/700/`tracking-[-0.025em]`.
- Jump-to-captures action: 32px, `rounded-lg`, `bg-card` + `border-border-strong`,
  12px/600 `font-display`.
- Quick-note field: compact input on `bg-canvas`, `rounded-lg`.
- `overviewVariant` in the prototype is an exploration toggle (`classic` vs
  `consolidated` nav) — **not** part of this style sync. Ship `classic`, which is
  the current default and matches today's routes.

## Captures
`components/captures/*.tsx`

⚠️ Held. Upstream `1.0.1-beta.17` rewrote Captures (3-pane list/viewer/details,
annotation editor, trusted-timestamp provenance axis) and its treatment —
gradient placeholder thumbnails, accent pill badges — conflicts with this pass.
Apply the primitive patch here, but do **not** port prototype layout to Captures
until the direction is settled.

- Search field: compact, `bg-canvas`, `rounded-lg`, left icon inset 28px.
- Metadata labels (Source, Captured): `<SectionLabel>`.
- Chain-of-custody / hash-chain / identity heads: `<SectionLabel emphasis="strong">`.
- All hashes, timestamps and URLs: `font-mono` 11px.

## Selectors · Notes · Tags
`components/{selectors,notes,tags}/*.tsx`

- Selector entry field: `font-mono` 12px, borderless inside its bordered row.
- Bulk-paste textarea: `font-mono` 11px, `rounded-lg`, `bg-canvas`, `border-border`.
- Tag create field: borderless inside its chip row.
- Tag chips: `rounded-full`, 2px/8px padding, mono 10px.
- Note prose keeps `.note-prose` from `globals.css` unchanged.

## Data explorer
`components/dashboard/cases/DataExplorer.tsx`

- Column heads: `<SectionLabel>`.
- Cell values that are IDs, counts or timestamps: `font-mono` 11px.
- Row hover: `bg-elevated`, no border change.
- Filter menu: `bg-elevated`, `shadow-[var(--shadow-overlay)]`, `rounded-lg`;
  group heads (Format, Date) are `<SectionLabel>` with `px-3 py-1`.

## Settings
`components/settings/*.tsx`, `components/settings/db/*.tsx`

- Section cards: `<Card>` 16px.
- Toggles: 26×14 track, `rounded-full`, 10px knob, `bg-accent` when on,
  `bg-border-strong` when off.
- Test actions (Test Pipeline / Test HTTP): 28px outline buttons, `flex-1`, 12px/500.
- Destructive actions: `variant="destructive"` at `size="sm"`.

## Extension setup guide
`components/extension/{InstallExtensionGuide,InstallExtensionStepper,installSteps}.tsx`

- Step connector stays the 2px `bg-border` rule from `globals.css`.
- Completed step badge: `variant="success"` with check icon.
- Success callout: `bg-success-surface` + `border-success-line`, `rounded-xl`,
  12px/700 `font-display`.

## New case wizard
`components/dashboard/cases/{NewCaseWizard,CreateCaseDialog,ImportCaseDialog}.tsx`

- Dialog panel picks up 16px radius from `rounded-2xl`.
- Wizard fields are the **default** density (14px, `px-3 py-2`), not compact —
  this is the one place the prototype runs the larger field size, because the
  content is user-authored prose. Description textarea is `rounded-xl`,
  `bg-elevated`, `border-border-strong`.
- Footer actions: 32px, primary + ghost.

## Command palette
`components/layout/CommandPalette.tsx`

- Overlay: `bg-elevated`, `rounded-2xl`, `shadow-[var(--shadow-overlay)]`.
- Group heads: `<SectionLabel>`.
- Result rows: `rounded-md`, 32px, hover/selected `bg-elevated`; shortcut hints
  `font-mono` 10px in `text-text-faint`.
