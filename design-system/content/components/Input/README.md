# Input

A single-line text field on the control metric: 4px radius, `color-input` border, `color-canvas` fill, 12px text. Hand-written from `src/renderer/components/ui/input.tsx`.

## When to use

Any one-line value: search, a URL, a name, a selector pattern. Pair it with `Label` above. Multi-line text is `Textarea`.

## What the consumer provides

All native `<input>` props: `value`, `onChange`, `placeholder`, `type`, `disabled`. Input has no variants.

## Rules

- Rest border is `color-input`; focus swaps it for `color-accent` with no ring (`outline-none`), so the border is the focus cue.
- Placeholder text is `color-text-faint`; typed text is `color-text-primary`.
- Disabled is 50% opacity.
