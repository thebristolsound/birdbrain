# Palette and contrast build

**Date:** 2026-11-19

**Spec:** [Palette and contrast overhaul](../specs/2026-11-17-palette-contrast-overhaul-design.md),
accepted by the maintainer on 2026-11-19 (pull request 2238, unmerged when this plan was written).
Values come from the spec's token table and, where the table defers to it, the `palette.css` that
every board of the
[2026-11-17 bundle](../design-handoff/2026-11-17-one-row-chrome/Birdbrain-consolidation-bundle.html)
inlines.

**Frame of reference:** `origin/main` at `7fa3061a`. Call-site counts are `grep -o` hits under
`src/renderer` at that commit.

## Ordering

The dark accent can't change before the filled controls move off it. `#9497ff` is a text colour,
and white text on it measures under 3:1, so every `bg-accent` fill would fail the moment the token
changed. Slice 1 adds the fill tokens and moves the shared button onto them. Slice 2 moves the
remaining fills and then changes the accent.

Each slice is one pull request with before and after screenshots in both themes.

## Slices

1. **Tokens.** Every value in the spec's table except the accent text colour, its hover and its
   subtle tint, in both theme blocks of `src/renderer/styles/globals.css`. Adds `--color-accent-fill`,
   `--color-accent-fill-hover`, `--color-control`, `--color-hover`, `--color-scrim`,
   `--color-warning-mark`, `--color-hue-teal-fg`, `--color-hue-violet-fg` and `--shadow-menu`.
   `--color-input` points at `--color-control`. The shared button's `default` variant takes the
   fill tokens. `tests/renderer/themeContrast.test.ts` measures text, control, fill and
   advisory-mark ratios in both themes.
2. **Accent split.** Move every filled `bg-accent` and `hover:bg-accent-hover` call site (142
   `bg-accent` hits in 71 files, the `-subtle` tints included) to the fill tokens where the
   element is a filled control. Then set `--color-accent` to `#9497ff` dark and `#4346d1` light,
   with the bundle's hover and subtle values. Over ten files, so it needs plan approval.
3. **Control boundaries.** Inputs, search fields, checkboxes, radios, the switch track and
   icon-only outline buttons take `border-control`. Hairlines between regions stay on
   `border-border`. Starts from the 101 `border-border-strong` hits in 55 files.
4. **Hover tint.** `hover:bg-elevated` (100 hits in 52 files), the keyboard highlight and the open
   pill take `bg-hover`.
5. **Status tiers.** The nominal dot draws in `--color-control` and the advisory mark is a hollow
   ring in `--color-warning-mark`. Advisory words take secondary text, and problem words take
   `text-danger-fg` with the triangle. Classify each of the 42 `text-warning-fg` hits in 31 files.
   Connected becomes nominal. The Export dialog's demonstration notice moves to advisory.
6. **Categorical hues.** Tag, case-type and link-map glyphs carry the hue; their words stay
   neutral. Link-map Captures take teal and Selectors violet.
7. **Overlays.** Dialog backdrops take `--color-scrim`, menus and popovers `--shadow-menu`.

## Still open

The spec's two open items stay open: the design system artifact needs the same values, and the
nonzero "Missing" integrity count needs its own mark.
