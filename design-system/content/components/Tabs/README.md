# Tabs

Radix tabs in two variants: a 36px `color-muted` track with a raised active trigger, or a `line` list with a 2px underline. Hand-written from `src/renderer/components/ui/tabs.tsx`; the static preview shows both lists at rest.

## When to use

Switching between views of one thing (a case's captures, notes and signals). Not for navigation between pages; that is the router.

## What the consumer provides

- `Tabs` with `value` / `onValueChange` (or `defaultValue`) and `orientation` (`horizontal` default, `vertical` stacks the list and left-aligns triggers).
- `TabsList` with `variant="default"` or `"line"`; `TabsTrigger` with a `value` and a short label, optionally a 16px lucide icon; `TabsContent` per value.

## Rules

- Triggers are 14px / 500 at 60% `color-foreground`, full on hover and when active; the default variant's active trigger sits on `color-background` with a small shadow, the line variant's draws `color-foreground` 2px under it.
- Focus: a 1px `color-ring` outline with a 3px 50% ring; disabled triggers drop to 50% opacity.
