# Skeleton

A pulsing placeholder block in `color-accent` with the 4px control radius, sized by the consumer. Hand-written from `src/renderer/components/ui/skeleton.tsx`.

## When to use

While a list, card or metric loads, in the shape of what will arrive: one block per line of text, one per control.

## What the consumer provides

`className` with width and height (`h-3 w-40`); nothing else.

## Rules

- The fill is the accent, not a neutral: a loading state reads as Birdbrain, not as grey noise.
- The pulse is Tailwind's `animate-pulse` (2s); `html.reduce-motion` and `prefers-reduced-motion` stop it.
