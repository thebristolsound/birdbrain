# Palette and contrast overhaul

**Date:** 2026-11-17

**Status:** Accepted by the maintainer on 2026-11-19. Drawn on the consolidation design canvas
(board P and every other board) and graded by two model judges: both themes until each judge passed
it (Fable on its third round, Opus on its fourth), then the light theme alone for three rounds. Two
parts are already on main: the hollow advisory ring (#2230) and slice 1.1's lift of dark faint text
to `#85858e`. The rest is not built, and the Birdbrain design system artifact is unchanged.

**Frame of reference:** `origin/main` at `d4dc422`. Token values in the "now" columns are cited
from `src/renderer/styles/globals.css` at that commit. The canvas draws from the Birdbrain design
system artifact, whose dark faint text is `#82838c`; the app ships `#85858e`.

**Creative:** the
[2026-11-17 one-row chrome bundle](../design-handoff/2026-11-17-one-row-chrome/) carries the final
palette in both themes. It ships packed as one HTML file. Every board inlines `palette.css` (the
token overrides, with each ratio in a comment) and `bb.css` (the shell classes that use them), and
board P shows each token before and after.

**Related:** the [consolidation plan](../plans/2026-11-15-chrome-capture-export-consolidation.md)
(decision 2 on status tiers, and slice 1.1, which moved dark faint text to `#85858e`); this proposal
supersedes that value.

## Problem

The maintainer reported contrast problems across the mocks and disliked the advisory amber. A
measurement of every text element, status dot and control border on the ten consolidation boards
(frames A to I and the rules sheet; board P came later), in both themes, found:

- The nominal status dot draws in `--color-border-strong`: 1.6 to 1.8:1 in dark and 1.3 to 1.5:1
  in light, against the 3:1 that WCAG 2.2 sets for non-text marks.
- The dark accent `#6467f2` serves as both text and fill and cannot do both. As text it reaches
  3.6 to 4.4:1 on the dark surfaces; white text on it reaches 4.41:1.
- Input, checkbox and switch boundaries draw in `--color-border-strong`, at 1.3 to 1.8:1.
- Dark faint text, which carries the 10px section labels, shipped as `#71717a` at 3.5:1 on
  `--color-elevated`. Slice 1.1 has since moved it to `#85858e`, which clears 4.5:1 on every dark
  surface but with little margin on `--color-elevated` (4.6:1).
- Advisory words in dark take `--color-warning-fg` `#fbbf24`, a near-neon yellow at 11.9:1 on the
  canvas, which reads louder than the problem tier.
- Categorical hues (tags, case types) sit close to the status hues, so a tag dot can read as an
  advisory or problem dot.

## Proposal

### Tokens

Every token whose value changes is listed. Contrast is given for the text and mark colours,
measured on the surface each sits on: `--color-surface` in light, `--color-elevated` in dark unless
the cell says otherwise. Light values that do not change are omitted.

| Token | Role | Dark now | Dark proposed | Light now | Light proposed |
| --- | --- | --- | --- | --- | --- |
| `--color-canvas` | Content area | `#090a0b` | `#0b0b0d` | `#fafafa` | `#fbfbfc` |
| `--color-surface` | Top bar, rail, list, side panel | `#0e0e11` | `#111114` | `#f4f4f5` | `#f1f1f4` |
| `--color-card` | Cards, menus | `#131316` | `#17171b` | | |
| `--color-elevated` | Dialogs | `#1c1c20` | `#202025` | | |
| `--color-text-secondary` | Body copy, advisory words | | | `#3f3f46` | `#303036` (11.6:1) |
| `--color-text-muted` | Descriptions | `#a1a1aa` | `#a8a8b2` (6.9:1) | | |
| `--color-text-faint` | Labels, timestamps | `#85858e` (4.6:1) | `#92939d` (5.3:1) | `#66666f` | `#63636c` (5.3:1) |
| `--color-accent` | Text and strokes | `#6467f2` (3.9:1) | `#9497ff` (6.3:1) | `#4f52e0` (5.3:1) | `#4346d1` (6.1:1) |
| `--color-accent-hover` | Hovered link and accent text | `#7a7cf5` | `#a7aaff` | `#4346d1` | `#3a3dc0` |
| `--color-accent-subtle` | Selected tint, accent badge | `rgba(100,103,242,0.16)` | `rgba(120,124,255,0.14)` | `rgba(100,103,242,0.10)` | `rgba(79,82,224,0.09)` |
| `--color-accent-fill` (new) | Filled button | | `#5457e6` (white 5.4:1) | | `#4f52e0` (white 5.8:1) |
| `--color-accent-fill-hover` (new) | Its hover | | `#4a4dd6` | | `#4346d1` |
| `--color-border` | Hairlines | `#27272a` | `#2a2a30` | `#e4e4e7` | `#d6d6dc` |
| `--color-border-strong` | Panel, menu and pill edges | `#3d3d42` | `#3a3a41` | `#d4d4d8` | `#bdbdc6` |
| `--color-control` (new) | Control boundaries, nominal dot | | `#7a7a84` (3.8:1) | | `#7a7a84` (3.8:1; 3.4:1 on a hovered row) |
| `--color-hover` (new) | Hover, keyboard highlight, open pill | | 6% white | | 6% ink, `rgba(24,24,40,0.06)` |
| `--color-input` | Input border | `--color-border-strong` | `--color-control` | `#8b8b93` | `--color-control` |
| `--color-success-fg` | Verified | `#34d399` | `#4ec38e` (7.3:1) | | |
| `--color-danger-fg` | Problem words, recording | `#f87171` | `#f47a7a` (6.1:1) | | |
| `--color-warning-fg` | Warning words, if any | `#fbbf24` | `#e5a84b` (7.8:1) | | |
| `--color-warning-mark` (new) | Amber dot, icon, bar | | `#e5a84b` (9.0:1 on surface) | | `#b06d00` (3.7:1; 4.2:1 on white) |
| `--color-hue-orange-fg` | Categorical | `#f97316` | `#f08a3c` | | |
| `--color-hue-sky-fg` | Categorical | `#0ea5e9` | `#38b6f0` | | |
| `--color-hue-pink-fg` | Categorical | `#ec4899` | `#f06fa8` | | |
| `--color-hue-teal-fg` (new) | Captures in the link map | | `#3cc7b4` | | `#0f766e` |
| `--color-hue-violet-fg` (new) | Selectors in the link map | | `#c084fc` | | `#7e22ce` |
| `--color-scrim` (new) | Behind a dialog | | `rgba(0,0,0,0.55)` | | `rgba(24,24,32,0.28)` |
| `--shadow-card` | Cards, cells, frames | `none` | `none` | `0 1px 2px rgba(0,0,0,0.04)` | `0 1px 2px rgba(24,24,40,0.06)` |
| `--shadow-overlay`, `--shadow-menu` (new) | Dialogs, popovers, menus | | unchanged | | cool two-layer shadows; values in the bundle's `palette.css` |

The bundle's `palette.css` holds the same set, with the ratio of each in a comment. A text copy,
extracted from the bundle, sits beside it as
[`palette.css`](../design-handoff/2026-11-17-one-row-chrome/palette.css).

### Rules

1. **The accent splits in two.** `--color-accent` is for text, strokes, focus and selection;
   `--color-accent-fill` is the background of a filled control. One filled control per view.
2. **Three status tiers differ by more than hue.**
   - Nominal: a dot in `--color-control`, words in muted text.
   - Advisory: a hollow ring, an icon or a bar in `--color-warning-mark`; words in secondary text,
     one step brighter than nominal, never amber. The maintainer ruled the ring on 2026-11-17: in
     light the amber and the nominal grey are 1.02:1 apart in luminance, so a filled amber dot
     would differ from nominal by hue alone.
   - Problem: words in `--color-danger-fg` with the triangle icon.

   `--color-success-fg` marks Verified only; Connected is nominal.
3. **A round dot in a status hue is a status mark.** The red recording dot and the indigo update
   dot are the two round dots that are not status tiers. Tags, case types and link-map nodes carry
   their hue on their own glyph, with neutral words.
4. **Hover and highlight are an ink tint, not a lighter surface.** `--color-hover` shows on every
   plane in both themes. Light mode cannot use "raised means lighter": its cards, menus and dialogs
   are already white, so a white hover vanishes.
5. **Light mode has three planes.** The chrome steps down to `#f1f1f4`, the content canvas stays
   near white, and cards are white with a 1px cool shadow.
6. **A control that needs a boundary gets one at 3:1.** Inputs, the search fields, checkboxes,
   radios, the switch track and icon-only outline buttons use `--color-control`. Hairlines between
   regions stay in `--color-border`.

## What changes in the app

The token table maps onto both theme blocks of `src/renderer/styles/globals.css`. The rules touch,
at least:

- `src/renderer/components/ui/button.tsx`: the `default` variant's `bg-accent` and
  `hover:bg-accent-hover` become the fill tokens.
- `src/renderer/components/ui/badge.tsx` (its `warning` variant) and `StatusGroup`'s `FG` map:
  advisory words stop taking `text-warning-fg`. `StatusGroup` already draws the ring and the
  problem words in the bar (#2230); its ring reads `--color-warning-fg` and moves to
  `--color-warning-mark`.
- The other `text-warning-fg` call sites, including `ExportDialog.tsx`, `RecentCapturesStrip.tsx`
  and the settings panels, each need a tier: advisory (neutral words and a mark) or problem.
- Tag and case-type chips: hue on the glyph, words neutral.

These lists are a starting point, not an audit; the implementing change should grep every
`text-warning-fg`, `bg-accent` and `border-border-strong` call site.

## Tier reclassification

The Export dialog's "Demonstration Case: fixture data, not evidence" notice moves from the problem
tier to advisory, since nothing has failed. That tier ruling is listed on the bundle's Rules board
and was accepted with the palette on 2026-11-19.

## How it was measured

A script rendered every board in both themes with Playwright and measured each text element, status
dot and control border against the background it composites onto, using the WCAG 2 relative
luminance formula. On the final round, no element falls under AA except the deliberate "before"
samples on board P. The script does not measure icon glyphs or outline-button borders whose label
identifies the control.

Two model judges graded each round on contrast, legibility, status semantics, coherence and theme
parity, out of 10, with 8.5 as the pass mark. Fable 5.2 scored 7.2, 8.3 and 8.6 (pass); Opus 5.5 at
xhigh effort scored 6.5, 7.5, 8.0 and, on a fourth round that applied its last findings, 8.5 (pass).
The judges are a review aid, not a substitute for the maintainer's ruling or for a check in the
running app.

A second pass graded the light theme on its own, with fresh judges, after the maintainer asked for
the exercise to be repeated for light mode. Fable 5.2 scored 8.0, 8.5 and 8.8; Opus 5.5 at xhigh
effort scored 7.5, 8.0 and 8.5. Both passed on the third round, and both checked that the light
changes left dark mode intact. From this pass on, the measurement also covers hover and highlight
states for what the boards draw inside a hoverable item: text there measures 4.69:1 at least in
light and 5.01:1 in dark, and marks and control borders 3.35:1 and 3.86:1. Two pairs the boards
never draw fall short; see "Still open".

## Still open

- **Two hover pairs under 4.5:1.** Review on #2238 found two text pairs that no board draws but the
  app could: light `--color-success-fg` `#047857` on a hovered row (4.3:1), and dark
  `--color-text-faint` `#92939d` on a hovered item over `--color-elevated` (4.5:1 rounded, 4.49:1
  exact). Raising them would change two accepted values and the bundle, so it waits for the
  maintainer. Candidates that clear both states: light success `#046c4e` (5.1:1 hovered, 5.7:1 on
  surface) and dark faint `#9798a2` (4.8:1 hovered, 5.7:1 on elevated). Until then, keep success
  words and faint text off hovered rows on those surfaces.

- **The design system.** The Birdbrain design system artifact needs the same values, so other
  mocks pick them up.
- **The "Missing" integrity count.** It shares the nominal grey dot; a nonzero count needs its own
  mark before that state is drawn.
