# Handoff: Birdbrain style sync (prototype → codebase)

## Overview
This bundle carries the stylistic standardization applied to the Birdbrain desktop
app prototype back into `thebristolsound/birdbrain`, and folds the same rules into
the shared `birdbrain-ui` primitives so future screens inherit them instead of
re-deriving them per component.

Nothing here changes information architecture, copy, or behavior. It is a styling
pass only: radius scale, control density, status surfaces, label typography, and
input recess.

## About the design files
The files in `prototypes/` are **design references created in HTML** — they show
intended look and behavior, not production code to paste. Recreate them in the
existing renderer environment (React 19 + Tailwind v4 + the `ui/` primitives).
The prototypes are inline-styled on purpose (they stream in the design tool); in
the app the same values must come from Tailwind token utilities, never hardcoded hex.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, and states are final. Every value
below was measured off the prototype, not estimated.

## How to apply
1. Apply `DESIGN_SYSTEM_PATCH.md` — `src/renderer/styles/globals.css` and
   `src/renderer/components/ui/*`. This is the bulk of the work and most screens
   pick up the change for free.
2. Walk `SCREEN_NOTES.md` for the per-screen residue that primitives can't cover.
3. Republish `birdbrain-ui` (the design-system package is generated from
   `src/renderer/components/ui/` + `globals.css`, so step 1 syncs the DS too —
   there is no separate design-system repo to edit).

## The five rules
The whole pass reduces to five decisions. Everything downstream is these applied.

**1. Radius scale is 4 / 6 / 8 / 12 / 16 — nothing else.**
| px | token | used for |
|---|---|---|
| 4 | `rounded-sm` | micro chips, dot wells, progress tracks |
| 6 | `rounded-md` | buttons, toolbar rows, menu items |
| 8 | `rounded-lg` | inputs, textareas, icon buttons, small tiles |
| 12 | `rounded-xl` | nested panels inside a card, 40px icon tiles |
| 16 | `rounded-2xl` | top-level cards, hero CTAs, modals |
Pills stay `rounded-full`. `--radius-2xl` moves 12px → 16px; that single token
change is what promotes top-level cards.

**2. Controls are 32px and 28px. 36px is retired.**
- 32px (`size="sm"`) is the default control: `h-8 px-3`, **12px** text, weight 500,
  `rounded-md`. Square variant `h-8 w-8`, `rounded-lg`.
- 28px (`size="xs"`) is the dense control for toolbars and inline actions:
  `h-7 px-2`, 12px text, `rounded-md`. Square `h-7 w-7`.
- `size="default"` (h-9 / 14px) no longer appears in the prototype. Keep it in the
  API for compatibility, stop reaching for it.
- Hero CTA is the one exception: `px-7 py-4`, 14px/700, `rounded-2xl`, accent glow.

**3. Text runs one step denser than upstream defaults.**
12px is the body size for UI chrome (146 uses), 11px for metadata (91), 14px only
for prose and hero copy (82), 10px for eyebrows (58). Numerals, IDs, hashes,
counts, timestamps and selectors are **always** `font-mono` — 96 uses, no exceptions.

**4. Section labels are an eyebrow, not a heading.**
10–12px · weight 600 · `uppercase` · `tracking-[0.05em]` · `text-text-faint`
(`text-text-secondary` when the section is interactive). 27 occurrences, hand-rolled
every time. This becomes a `SectionLabel` primitive.

**5. Display type carries negative tracking.**
Every `font-display` heading gets `tracking-[-0.025em]`: 36px/800 hero, 24px/800
page title, 18px/700 section, 30px/800 metric numerals, 12px/800 wordmark.
Body text keeps default tracking.

## Two secondary rules
**Status surfaces are a tinted triple**, never a solid fill: background at 10%
opacity, border at 20%, foreground at full. Applies to the extension-connected
pill, recording indicator, verification badges, and error states.

**Inputs are recessed, not raised.** `bg-canvas` + `border-border` (the darker
surface, the lighter border) — upstream has this backwards with `bg-elevated` +
`border-border-strong`. Field radius 8px, padding `px-2.5 py-1.5`, 12px text.
Free-standing search fields inside a bordered row drop their own border entirely
(`bg-transparent border-none`) and let the row carry it.

## Elevation
Cards are flat. `--shadow-card` stays `none`; separation comes from
`border-border` against `bg-card`, and hover raises the border to
`border-border-strong` (never a shadow). `--shadow-overlay` is the only shadow in
routine use (15 occurrences: menus, dialogs, popovers). The hero CTA's indigo glow
is the sole decorative shadow and is now a token.

## Design tokens
Colors, fonts and the dark-mode overrides in `globals.css` were already correct and
are **unchanged** — the prototype uses them verbatim. Added tokens are listed in
`DESIGN_SYSTEM_PATCH.md` §1: one radius change, six status-surface colors, two
tracking values, one shadow.

## Assets
`src/renderer/assets/logo.png` and `extension-icon-48.png` are used as-is from the
repo. All iconography in the prototype is inline Lucide paths at 24×24 — in the app
keep using `lucide-react`; stroke width 2, size 14/16 inside 28/32px controls.

## Files
- `prototypes/Birdbrain.dc.html` — full app: dashboard, case workspace (overview,
  captures, selectors, notes, tags, data), settings, extension guide, new-case
  wizard, command palette
- `prototypes/Case Reviewer.dc.html` — forensics / review direction
- `DESIGN_SYSTEM_PATCH.md` — globals.css + `ui/` primitive diffs
- `SCREEN_NOTES.md` — per-screen application notes, mapped to repo paths
