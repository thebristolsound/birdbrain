# Handoff: Birdbrain style sync (prototype → codebase) — v2

## Overview
This bundle carries the stylistic standardization applied to the Birdbrain desktop
app prototype back into `thebristolsound/birdbrain`, and folds the same rules into
the shared `birdbrain-ui` primitives so future screens inherit them.

**v2, regenerated 2026-08-11 against tree `37dbf57`.** The 2026-08-07 v1 patch
(4/6/8/12/16 radii, 32px default controls, `--radius-2xl` → 16px) was rejected in
engineering review as stale: it predated the prototype's standardization and sweep
passes, which settled the opposite system. This version encodes the final one.

Nothing here changes information architecture, copy, or behavior. Styling only:
radius scale, control density, status surfaces, label typography, input recess.

## About the design files
The files in `prototypes/` are **design references created in HTML** — they show
intended look and behavior, not production code to paste. Recreate them in the
existing renderer environment (React 19 + Tailwind v4 + the `ui/` primitives).
The prototypes are inline-styled on purpose (they stream in the design tool); in
the app the same values must come from Tailwind token utilities, never hardcoded hex.

## Fidelity
**High-fidelity.** Every value was measured off the live prototype
(`Birdbrain.dc.html`) after its standardization + sweep passes, and diffed against
the repo files at `37dbf57` — the same tree the engineering feasibility assessment
audited.

## How to apply
1. Apply `DESIGN_SYSTEM_PATCH.md` — `globals.css` and `ui/*`. The radius collapse
   (§1a) does most of the work in one token change.
2. Walk `SCREEN_NOTES.md` for per-screen residue primitives can't cover.
3. Republish `birdbrain-ui` (the DS package is generated from
   `src/renderer/components/ui/` + `globals.css`; step 1 syncs it — there is no
   separate design-system repo).

## The five rules
**1. Radius scale is 2 / 4 / 6 — nothing else.**
| px | token | used for |
|---|---|---|
| 2 | `rounded-sm` | progress/coverage bars, checkboxes, thumbnails |
| 4 | `rounded-md` | buttons, inputs, chips, tabs, menu items, badges |
| 6 | `rounded-lg` (and collapsed `xl`/`2xl`) | cards, nested panels, menus, dialogs, toasts |
Pills (`rounded-full`) are legal **only** for status pills and dots.

**2. One control metric: 28px.**
`h-7`, 4px radius, `0 11px` padding, 12px/500. All Button sizes except `lg`
resolve to it; 32px and 36px are retired. `lg` (36px/6px, flat) exists solely for
the dashboard hero CTA — no glow, no shadow.

**3. Type scale is 10 / 11 / 12 / 14 / 18.**
12px is UI-chrome body, 11px metadata, 10px eyebrows, 14px prose/dialog titles,
18px section display. Numerals take `tabular-nums`. Monospace is reserved for
machine output only: selector patterns, ignore-list globs, file paths, hashes,
chrome:// URLs, the TSA endpoint, installation ID, diagnostics log. Hostnames,
counts, timestamps and labels are **not** mono.

**4. Section labels are an eyebrow, not a heading.**
10px · 600 · uppercase · `tracking-[0.06em]` · `text-text-faint`
(11px `text-text-secondary` for the strong emphasis). Becomes `<SectionLabel>`;
~18 hand-rolled sites across 11 files collapse into it.

**5. Inputs are recessed, not raised.**
`bg-canvas` fill (the darkest surface) + `border-border-strong`, 4px radius,
`6px 10px` padding, 12px text. Upstream has the fill backwards (`bg-elevated`).
Fields inside an already-bordered row drop their own chrome
(`bg-transparent border-none`).

## Two secondary rules
**Status surfaces are a tinted triple**, never a solid fill: background at 10%
opacity, border at 20%, foreground at full (lifted one step in dark mode).

**Elevation is flat.** Separation comes from `border-border` against `bg-card`;
hover raises the border to `border-border-strong`, never a shadow.
`--shadow-overlay` is the only shadow in routine use (menus, dialogs, popovers).
The design has no decorative glow anywhere — v1's hero glow token is gone.

## Design tokens
Colors, fonts and dark-mode overrides in `globals.css` are **unchanged** — the
prototype uses them verbatim. Additions: the radius collapse, six status-surface
colors, two tracking values. Density custom properties (`--d-*`) ride with this
patch (engineering review item 15); spec in the prototype `HANDOFF.md`.

## Assets
`src/renderer/assets/logo.png` and `extension-icon-48.png` are used as-is from the
repo. Iconography stays `lucide-react`; stroke width 2, size 14/16 inside the
28px control.

## Files
- `prototypes/Birdbrain.dc.html` — full app: dashboard, case workspace (overview,
  captures, selectors, notes, tags, data), settings, extension guide, new-case
  wizard, command palette, browser sim
- `prototypes/Case Reviewer.dc.html` — forensics / review direction
- `DESIGN_SYSTEM_PATCH.md` — globals.css + `ui/` primitive diffs (v2)
- `SCREEN_NOTES.md` — per-screen application notes, mapped to repo paths
