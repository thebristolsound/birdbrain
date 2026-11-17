# Palette and contrast overhaul

**Date:** 2026-11-17

**Status:** Proposal, drawn on the consolidation design canvas (board P and every other board) and
graded by two model judges over four rounds; awaiting the maintainer's ruling. Nothing in the app
or the Birdbrain design system has changed.

**Frame of reference:** `origin/main` at `1047d3c`. Token values are cited from
`src/renderer/styles/globals.css` at that commit. The canvas draws from the Birdbrain design system
artifact, whose dark faint text is `#82838c`; the app ships `#71717a`.

**Related:** the [consolidation plan](../plans/2026-11-15-chrome-capture-export-consolidation.md)
(decision 2 on status tiers, and slice 1.1, which proposed faint text at `#85858e`); this proposal
supersedes that value.

## Problem

The maintainer reported contrast problems across the mocks and disliked the advisory amber. A
measurement of every text element, status dot and control border on the ten consolidation boards,
in both themes, found:

- The nominal status dot draws in `--color-border-strong`: 1.6 to 1.8:1 in dark and 1.3 to 1.5:1
  in light, against the 3:1 that WCAG 2.2 sets for non-text marks.
- The dark accent `#6467f2` serves as both text and fill and cannot do both. As text it reaches
  3.6 to 4.4:1 on the dark surfaces; white text on it reaches 4.41:1.
- Input, checkbox and switch boundaries draw in `--color-border-strong`, at 1.3 to 1.8:1.
- Dark faint text in the app, `#71717a`, measures 3.5:1 on `--color-elevated`. It carries the
  10px section labels.
- Advisory words in dark take `--color-warning-fg` `#fbbf24`, a near-neon yellow at 11.9:1, which
  reads louder than the problem tier.
- Categorical hues (tags, case types) sit close to the status hues, so a tag dot can read as an
  advisory or problem dot.

## Proposal

### Tokens

Values are measured on the surface each colour sits on. Light values that do not change are
omitted.

| Token | Role | Dark now | Dark proposed | Light now | Light proposed |
| --- | --- | --- | --- | --- | --- |
| `--color-canvas` | Page | `#090a0b` | `#0b0b0d` | | |
| `--color-surface` | Panels, rail | `#0e0e11` | `#111114` | | |
| `--color-card` | Cards, menus | `#131316` | `#17171b` | | |
| `--color-elevated` | Dialogs, hover | `#1c1c20` | `#202025` | | |
| `--color-text-muted` | Descriptions | `#a1a1aa` | `#a8a8b2` (6.9:1) | | |
| `--color-text-faint` | Labels, timestamps | `#71717a` (3.5:1) | `#92939d` (5.3:1) | `#66666f` | `#63636c` (5.4:1) |
| `--color-accent` | Text and strokes | `#6467f2` (3.9:1) | `#9497ff` (6.3:1) | | |
| `--color-accent-fill` (new) | Filled button | | `#5457e6` (white 5.4:1) | | `#4f52e0` (white 5.8:1) |
| `--color-accent-fill-hover` (new) | Its hover | | `#4a4dd6` | | `#4346d1` |
| `--color-border-strong` | Panel borders | `#3d3d42` | `#3a3a41` | | |
| `--color-control` (new) | Control boundaries, nominal dot | | `#7a7a84` (3.8:1) | | `#80808a` (3.6:1) |
| `--color-input` | Input border | `--color-border-strong` | `--color-control` | `#8b8b93` | `--color-control` |
| `--color-success-fg` | Verified | `#34d399` | `#4ec38e` (7.4:1) | | |
| `--color-danger-fg` | Problem words, recording | `#f87171` | `#f47a7a` (6.1:1) | | |
| `--color-warning-fg` | Warning words, if any | `#fbbf24` | `#e5a84b` (7.8:1) | | |
| `--color-warning-mark` (new) | Amber dot, icon, bar | | `#e5a84b` (9.0:1) | | `#b06d00` (3.8:1) |
| `--color-hue-orange-fg` | Categorical | `#f97316` | `#f08a3c` | | |
| `--color-hue-sky-fg` | Categorical | `#0ea5e9` | `#38b6f0` | | |
| `--color-hue-pink-fg` | Categorical | `#ec4899` | `#f06fa8` | | |
| `--color-hue-teal-fg` (new) | Captures in the link map | | `#3cc7b4` | | `#0f766e` |
| `--color-hue-violet-fg` (new) | Selectors in the link map | | `#c084fc` | | `#7e22ce` |

The canvas file `palette.css` holds the full set, with the ratio of each in a comment.

### Rules

1. **The accent splits in two.** `--color-accent` is for text, strokes, focus and selection;
   `--color-accent-fill` is the background of a filled control. One filled control per view.
2. **Three status tiers differ by more than hue.**
   - Nominal: a dot in `--color-control`, words in muted text.
   - Advisory: the dot, icon or bar in `--color-warning-mark`; words in secondary text, one step
     brighter than nominal, never amber.
   - Problem: words in `--color-danger-fg` with the triangle icon.

   `--color-success-fg` marks Verified only; Connected is nominal.
3. **A round dot in a status hue is a status mark.** The red recording dot and the indigo update
   dot are the two round dots that are not status tiers. Tags, case types and link-map nodes carry
   their hue on their own glyph, with neutral words.
4. **A control that needs a boundary gets one at 3:1.** Inputs, the search fields, checkboxes,
   radios, the switch track and icon-only outline buttons use `--color-control`. Hairlines between
   regions stay in `--color-border`.

## What changes in the app

The token table maps onto both theme blocks of `src/renderer/styles/globals.css`. The rules touch,
at least:

- `src/renderer/components/ui/button.tsx`: the `default` variant's `bg-accent` and
  `hover:bg-accent-hover` become the fill tokens.
- `src/renderer/components/ui/badge.tsx` and the status popover (`StatusGroup`): advisory words stop
  taking `text-warning-fg`; problem values take `text-danger-fg` with the triangle.
- The other `text-warning-fg` call sites, including `ExportDialog.tsx`, `RecentCapturesStrip.tsx`
  and the settings panels, each need a tier: advisory (neutral words and a mark) or problem.
- Tag and case-type chips: hue on the glyph, words neutral.

These lists are a starting point, not an audit; the implementing change should grep every
`text-warning-fg`, `bg-accent` and `border-border-strong` call site.

## Tier reclassification

The Export dialog's "Demonstration Case: fixture data, not evidence" notice moves from the problem
tier to advisory, since nothing has failed. That is a tier ruling, listed on the canvas's Rules
board as a proposal.

## How it was measured

A script rendered every board in both themes with Playwright and measured each text element, status
dot and control border against the background it composites onto, using the WCAG 2 relative
luminance formula. On the final round, no element falls under AA except the deliberate "before"
samples on board P. The script does not measure icon glyphs or outline-button borders whose label
identifies the control.

Two model judges graded each round on contrast, legibility, status semantics, coherence and theme
parity, out of 10, with 8.5 as the pass mark. Fable 5.2 scored 7.2, 8.3 and 8.6 (pass); Opus 5.5 at
xhigh effort scored 6.5, 7.5, 8.0 and, on a fourth round that applied its last findings, 8.5 (pass). The judges are a review aid, not a
substitute for the maintainer's ruling or for a check in the running app.

## Open for the maintainer

- **Filled dot or ring for advisory** (decision 2 of the consolidation plan). In light, the filled
  amber dot and the nominal grey dot are 1.07:1 apart in luminance, so the pill separates them by
  hue alone. Both judges said the ring would add about half a point to contrast and status. The
  ruling is unchanged by this proposal.
- **The design system.** If accepted, the Birdbrain design system artifact needs the same values,
  so other mocks pick them up.
- **The "Missing" integrity count.** It shares the nominal grey dot; a nonzero count needs its own
  mark before that state is drawn.
