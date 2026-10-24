# Card

The bordered content surface: `color-card` with a 1px `color-border`, 6px radius, no shadow, with header, title, description, content, footer and a recessed panel. Hand-written from `src/renderer/components/ui/card.tsx`.

## When to use

Any block of related content on the canvas: a metric, a list, a settings group. A floating surface is `Dialog`, not a Card.

## What the consumer provides

- `Card` with `hover` (border turns `color-border-strong` on hover) or `interactive` (a 2px lift on the `hover` spring) when the whole card is a target.
- `CardHeader` (20px padding, no bottom), `CardTitle` (`card-title`: 12px / 600 / `tracking-display` in `color-text-primary`), `CardDescription` (14px `color-text-muted`), `CardContent` (20px), `CardFooter` (20px, no top).
- `CardPanel` for the recessed inner surface: the inversion of the card, a stronger `color-border-strong` on the dimmer `color-surface`, 12px padding, 6px radius.

## Rules

- `rounded-2xl` resolves to the 6px ceiling; do not add a larger radius.
- `.neu-card` sets `box-shadow: none`; elevation is the border, never a shadow.
