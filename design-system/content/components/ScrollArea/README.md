# ScrollArea

A flex-collapsing vertical scroll container with a thin native scrollbar; radix-free on purpose. Hand-written from `src/renderer/components/ui/scroll-area.tsx`.

## When to use

The scrolling region inside a panel, list or dialog body, where the parent flex layout must be allowed to shrink it (`min-h-0`).

## What the consumer provides

`children` and a height or flex constraint from the parent; all native div props pass through.

## Rules

- Vertical only (`overflow-x-hidden`); the thumb is `color-border` on a transparent track, 6px, as the global scrollbar rules draw it.
- Rows inside follow the density tokens: `d-row` tall, `d-rowpad` inset.
