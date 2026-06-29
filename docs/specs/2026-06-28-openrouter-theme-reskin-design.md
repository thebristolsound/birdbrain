# OpenRouter theme reskin — design

**Date:** 2026-06-28
**Status:** Draft (awaiting review)
**Author:** extracted live from openrouter.ai (light + dark) via browser inspection;
decisions sharpened via a grill-with-docs interview.

## Goal

Reskin birdbrain to adopt OpenRouter's visual language as closely as possible in both light
and dark modes: its color scheme, flat chrome, typography, and the accent palette it uses for
bar charts. Birdbrain keeps its own screens and layouts; this changes the *look*, not the
information architecture.

### Non-goals

- **No structural layout cloning.** We do not rebuild birdbrain's screens to mirror
  OpenRouter's chat/settings page layouts. "Pixel-perfect" means the design *primitives*
  (colors, radii, borders, button/control styling, font, chart palette) match exactly, applied
  to birdbrain's existing structure.
- **No new charts.** We reuse the existing chart-like elements (see §4); we don't add a
  charting library.
- No new dependencies beyond the Inter font package.

## What OpenRouter is (extracted)

Radix Colors + shadcn/ui. Semantic tokens are HSL triples consumed as `hsl(var(--token))`;
sidebar tokens are raw hex. Theme switch = `.dark` class on `<html>` (next-themes). The system
reduces to **zinc neutrals + one indigo accent (`#6467f2`)**, flat (surfaces are border-defined,
not elevated), `0.5rem` radius, **Inter** for all text, **6px** buttons (solid accent, no
gradient/glow). Bar charts use a Recharts-default-plus-X11 categorical palette; overlays/menus
keep a soft (non-glow) shadow.

## Key decisions (from the grill)

1. **Elevation = minimal ladder, not pure-flat.** OpenRouter collapses cards to ~page color;
   birdbrain nests surfaces deeper (CaseOverview, capture split-view, modals). We keep a
   *just-perceptible* page→card step plus borders, and a *clearly raised* step for overlays.
   Light page becomes zinc-50 (`#fafafa`) so white cards still read (avoids white-on-white).
2. **Overlays stay raised.** `dialog.tsx` + `CommandPalette.tsx` use `bg-elevated` + border +
   a dedicated soft `--shadow-overlay` (shadcn-style, *not* the indigo glow). "Flat" means no
   decorative glow/neumorphism, not "no elevation cue on floating surfaces."
3. **Chart palette has a real consumer.** OpenRouter's bar palette feeds `SOURCE_TONES`
   (the categorical color array behind `SourcesBlock` on Case Details). `ActivityTimeline`
   and `SelectorCoverageBlock` are single-series and stay accent-colored.
4. **Radius via central tokens.** `--radius: 0.5rem`; add `--radius-2xl: 0.75rem` so the 26
   `rounded-2xl` cards/dialogs tighten 16px→12px with no per-file edits; `button.tsx`
   `rounded-lg`→`rounded-md` for exact 6px buttons. Keep the button `whileTap` micro-animation.
5. **Strip effects by CSS neutralization**, not component rewrites (confirmed earlier).
6. **Fonts:** add Inter, drop Plus Jakarta + DM Sans, keep JetBrains Mono (confirmed earlier).

## Design

### 1. Color tokens & elevation (`src/renderer/styles/globals.css`)

Rewrite `@theme` light defaults + `html.dark` overrides, keeping birdbrain's token *names* (so
all 82 consuming files reskin automatically). Minimal-ladder values:

| birdbrain token          | Light                      | Dark                       | role |
|--------------------------|----------------------------|----------------------------|------|
| `--color-canvas`         | `#fafafa`                  | `#090a0b`                  | page |
| `--color-surface`        | `#f4f4f5`                  | `#0e0e11`                  | sub-region/sidebar |
| `--color-card`           | `#ffffff`                  | `#131316`                  | cards (just above page) |
| `--color-elevated`       | `#ffffff`                  | `#1c1c20`                  | overlays/raised |
| `--color-text-primary`   | `#09090b`                  | `#fafafa`                  | |
| `--color-text-secondary` | `#3f3f46`                  | `#d4d4d8`                  | |
| `--color-text-muted`     | `#71717a`                  | `#a1a1aa`                  | = OR `--muted-foreground` |
| `--color-text-faint`     | `#a1a1aa`                  | `#71717a`                  | |
| `--color-accent`         | `#6467f2`                  | `#6467f2`                  | = OR `--primary` |
| `--color-accent-hover`   | `#4f52e0`                  | `#7a7cf5`                  | |
| `--color-accent-subtle`  | `rgba(100,103,242,.10)`    | `rgba(100,103,242,.16)`    | |
| `--color-border`         | `#e4e4e7`                  | `#27272a`                  | zinc-200 / zinc-800 |
| `--color-border-strong`  | `#d4d4d8`                  | `#3d3d42`                  | zinc-300 / OR `--input` |

The shadcn bridge tokens (`--color-background`, `--color-primary`, …) already reference these
via `var()` — no change. The raw status palette (`amber/emerald/red/teal/slate`, used for
severity/entity colors — an allowed exception) stays as-is. The `REC` badge, connection/health
status colors, and scrollbar styling stay (neutral/status).

**Radius:** `--radius: 0.5rem`; add `--radius-2xl: 0.75rem` to `@theme`.

**Shadows:** flatten cards, keep overlays:
- `--shadow-card`: `none` (dark) / `0 1px 2px rgba(0,0,0,.04)` (light)
- `--shadow-card-hover`: replaced by `border-color` shift (no transform/shadow)
- `--shadow-overlay` *(new)*: `0 10px 30px rgba(0,0,0,.5)` (dark) / `0 10px 30px rgba(0,0,0,.12)` (light)
- `--shadow-glow`, `--shadow-btn`: `none`

### 2. Typography (`globals.css` + `package.json`)

- Add `@fontsource-variable/inter`; remove `@fontsource-variable/plus-jakarta-sans` and
  `@fontsource-variable/dm-sans` (deps + the two `@import`s).
- Set both `--font-display` and `--font-body` to `"Inter Variable", ui-sans-serif, system-ui,
  sans-serif` (both names kept — `font-display` is used in 21 places; headings differ by weight).
- **Keep** `--font-mono` = JetBrains Mono Variable.

### 3. Flatten bespoke effects (CSS-only, `globals.css`)

Neutralize in place; do not touch the ~15 consuming components.

- `body::after` (noise overlay) — remove the rule.
- `.grid-bg` — drop the radial-glow + grid `background-image`s; plain canvas.
- `.neu-card` — `background: var(--color-card); border: 1px solid var(--color-border);
  box-shadow: none;`
- `.neu-card-hover:hover` — `border-color: var(--color-border-strong);` no transform/shadow.
- `.glow-indigo`, `.glow-indigo-btn` — `box-shadow: none;`
- `.shimmer-text` (+ dark override) — solid `color: var(--color-accent)`; no gradient/clip/anim.
- `.logo-pulse` (+ `::after`) — static; drop pulse/float/ring animation + glow.
- `.new-case-card` (+ hover/dark) — flat: `border: 1px solid var(--color-border)`; hover
  `border-color: var(--color-accent)`; drop tinted bg.
- `.step-connector` — solid `background: var(--color-border)`.
- Now-unused `@keyframes` (float/shimmer/pulse-ring/pulse) left in place (harmless).

### 4. Bar-chart accent palette (real consumer)

`src/renderer/components/overview/SourcesBlock.tsx` is a categorical horizontal bar chart
(per-source dot + bar + count), colored by `s.tone` from `SOURCE_TONES` in `overviewModel.ts`
(a 10-color array cycled by source rank). This is where OpenRouter's bar palette lives.

- New `src/renderer/lib/chartColors.ts` exports:
  - `CHART_SERIES` — the ordered 20-color palette below.
  - `CHART_AXIS = '#a1a1aa'`, `CHART_GRID` (zinc, low alpha).
  - A comment documenting the legend/tooltip style (dark popover, swatch + label + value rows,
    separated `Total`) for whenever a real chart is built.
- `overviewModel.ts`: replace the inline `SOURCE_TONES` with an import of `CHART_SERIES`
  (cycled by `i % length` as today) → `SourcesBlock` renders OpenRouter's exact bar colors.
- `ActivityTimeline` (count-per-day intensity) and `SelectorCoverageBlock` (coverage %) are
  single-series and remain `bg-accent`; they reskin via the new accent token. No CSS `--chart-*`
  vars (no consumer → no dead utilities).

Palette (Recharts default 4 + X11 extension, verbatim from the rankings stacked bar chart;
mode-independent):

```
#0088FE #00C49F #FFBB28 #FF8042 #FF69B4 #9ACD32 #4682B4 #FF4500 #FF6347 #DA70D6
#3CB371 #F08080 #BDB76B #800080 #DAA520 #2E8B57 #40E0D0 #6B8E23 #7B68EE #DB7093
```

### 5. Chrome polish (overlays + buttons)

Most chrome follows from tokens + flattening. Targeted edits:

- **Overlays** — every floating panel over the `bg-black/50` backdrop becomes
  `bg-elevated border border-border shadow-[var(--shadow-overlay)]` (raised, flat, no glow).
  Cleanest is a shared `.neu-overlay` class in `globals.css` that the panels point at:
  - `dialog.tsx` `DialogContent` (`neu-card` → `.neu-overlay`).
  - `CommandPalette.tsx` panel (currently `bg-card shadow-2xl` → `.neu-overlay`).
  - Modals that hand-roll a `neu-card` panel instead of using the `Dialog` primitive:
    `BulkAddSelectorsModal`, `export/ExportDialog`, `ExportDialog`, `TagManager`,
    `OnboardingWizard` — switch their panel `neu-card` → `.neu-overlay`. (Static `neu-card`
    cards — `card.tsx`, `MetricRow`, `CaseOverview`, `SinceLastVisitBanner` — keep the flat
    `.neu-card`.) Exact per-file panel lines enumerated in the plan.
- **Primary button** (`button.tsx`) — `rounded-lg` → `rounded-md` (6px). The `--shadow-btn:
  none` change already removes its glow; `bg-accent`/`hover:bg-accent-hover` unchanged.
- Top bar / sidebar already use `bg-surface` + `border-b/r border-border`; they inherit the
  flat tokens. No structural change.

## Implementation order & risk

1. Tokens + radius + shadows + Inter (`globals.css`, `package.json`) — instant broad reskin.
2. Neutralize effects (`globals.css`) — flat look, no component edits.
3. Chart palette (`chartColors.ts`, `overviewModel.ts`).
4. Overlays + button (`dialog.tsx`, `CommandPalette.tsx`, `button.tsx`).

**Risks:** (a) collapsed dark ladder muddying nested views — mitigated by the minimal step +
overlay shadow; verify on CaseOverview/captures. (b) light zinc-50 page vs white cards contrast
— verify. (c) `text-faint` legibility on flat surfaces — check WCAG AA for body text.
(d) any e2e visual-snapshot baselines will shift — update baselines if present.

## Verification

- `pnpm lint`, `pnpm test`, `pnpm build` must pass.
- Drive the built app with a Playwright+Electron script to screenshot Dashboard, CaseWorkspace
  overview (incl. `SourcesBlock`), and a dialog, in **both** light & dark; review against the
  OpenRouter reference screenshots. Fall back to user `pnpm dev` verification if the WSLg
  screenshot harness misbehaves.
- User does final visual sign-off.

## Delivery

- Fast-forward `master`, branch `feat/openrouter-theme`.
- **Spec PR** (separate — repo rule: tracked docs never bundle with `src`): this file.
- **Reskin PR** (`feat/openrouter-theme`), 4 commits:
  1. `feat(theme): adopt OpenRouter color tokens, 8px radius, flat shadows, Inter`
  2. `refactor(theme): flatten neumorphic/glow/shimmer/noise/grid effects`
  3. `feat(overview): use OpenRouter bar-chart palette for source breakdown`
  4. `feat(chrome): raised flat overlays + 6px buttons`

## Acceptance

- Light & dark match OpenRouter's zinc neutrals + `#6467f2` accent, 8px radius / 6px buttons,
  flat surfaces with raised overlays.
- All text is Inter; code/hashes remain JetBrains Mono.
- No glow/shimmer/noise/grid/neumorphic shadow remains visible.
- `SourcesBlock` renders the OpenRouter 20-color bar palette via `chartColors.ts`.
- App builds, lints, tests pass; both themes verified via screenshots.
