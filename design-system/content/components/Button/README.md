# Button

The app's one button: a 28px control in one of five variants, with a micro-tap spring and an outline focus ring. Hand-written from `src/renderer/components/ui/button.tsx`.

## When to use

- `default` for the one primary action in a view; `outline` for secondary actions beside it; `ghost` for toolbar and inline actions; `destructive` only for deletion the Operator cannot undo; `link` for navigation that reads as text.
- Every size except `lg` aliases to the one control metric (28px / 4px radius / 0 11px / 12px). `lg` (36px, 6px radius, 14px) is reserved for the dashboard hero call to action. `icon` is 28px square, `icon-sm` 24px.

## What the consumer provides

- `children`: a sentence-case label, or a lucide icon for `icon` sizes with an `aria-label`.
- `variant`, `size`, `disabled`, and any native button props; motion props pass through to the underlying `motion.button`.

## Rules

- Focus is `outline: 2px solid color-ring; outline-offset: 2px`, never a box-shadow ring: `shadow-btn` resolves to `none`, which would invalidate a composed ring.
- Disabled is 50% opacity with pointer events off; do not hide a disabled primary action.
- The press scales to 0.97 on the `microTap` spring (600 / 28) and is skipped when disabled.
