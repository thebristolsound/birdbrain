# SectionLabel

The eyebrow every panel head uses: 10px, 600, uppercase at `tracking-label`, in `color-text-faint`. Hand-written from `src/renderer/components/ui/section-label.tsx`.

## When to use

At the top of a panel, a sidebar group or a card section. It is an eyebrow, not a heading: a page title is `text-lg`.

## What the consumer provides

- `children`: one to three words, written in sentence case (the component uppercases).
- `emphasis="strong"` for the 11px step in `color-text-secondary`, for heads that carry more weight.

## Rules

- The same treatment is available as `.section-label` (and `.section-label-strong` as a modifier) where only a DOM node is available; `SectionLabel` is the TSX surface.
- In the dark theme `color-text-faint` sits at 4.1:1 on canvas as shipped; keep eyebrows short.
