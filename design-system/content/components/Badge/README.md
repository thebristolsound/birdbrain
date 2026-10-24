# Badge

A small pill for a status, a method, a count or a type: seven variants, three sizes, an optional leading dot. Hand-written from `src/renderer/components/ui/badge.tsx`.

## When to use

- `secondary` (the default) for neutral metadata such as a capture method; `outline` for quiet labels; `accent` for the Active Case and selected states; `success`, `danger`, `warning` for integrity and health, each a tinted triple (10% surface, 20% line, foreground).
- `sm` (the default) sets the label in `mono` for hashes, counts and method names; `default` is the same pill in `body`; `pill` is the 28px case-type pill with a 6px gap for its dot.

## What the consumer provides

- `children`: one or two words in sentence case, or an uppercase code such as `MHTML`.
- `dot` adds a 6px `currentColor` disc; `pulse` animates it for a live state. Pass the entity hue through `className` or an inline colour on the dot, as the case-type pills do.

## Rules

- Status is never a solid fill: use the `-surface` / `-line` / `-fg` triple, never an ad-hoc `rgba()`.
- `rounded-full` is legal here because a Badge is a status pill; nowhere else in the UI.
