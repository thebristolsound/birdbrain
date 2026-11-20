# Palette and contrast build

**Status:** active

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

Slices 1 and 2 ship as one pull request, since the accent change needs both; each later slice is
its own. Every pull request carries before and after screenshots in both themes.

## Slices

1. **Tokens.** Every value in the spec's table except the accent text colour, its hover and its
   subtle tint, in both theme blocks of `src/renderer/styles/globals.css`. Adds `--color-accent-fill`,
   `--color-accent-fill-hover`, `--color-control`, `--color-hover`, `--color-scrim`,
   `--color-warning-mark`, `--color-hue-teal-fg`, `--color-hue-violet-fg` and `--shadow-menu`.
   `--color-input` points at `--color-control`. The shared button's `default` variant takes the
   fill tokens. `tests/renderer/themeContrast.test.ts` measures text, control, fill and
   advisory-mark ratios in both themes.
2. **Accent split.** Move every filled control off the accent onto the fill tokens. At the frame
   of reference, 56 lines carry `bg-accent`, solid or as a tint. Slice 1 moves the shared button,
   and this slice the other 32: buttons, count badges, checked checkboxes and switch tracks. The
   23 that keep the accent are 16 solid dots, bars and progress fills and 7 tints, none with
   white text on it. Then set `--color-accent` to `#9497ff` dark and `#4346d1` light, with the
   bundle's hover and subtle values, and point `--color-primary` at the fill. A test counts the
   solid accent backgrounds in each file against those marks, so a control moved back fails it. The maintainer
   approved this slice on 2026-11-19, in the Claude Code session that built it.
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
