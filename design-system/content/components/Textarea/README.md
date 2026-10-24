# Textarea

The multi-line sibling of `Input`, with the same border, fill, padding and text size. Hand-written from `src/renderer/components/ui/textarea.tsx`.

## When to use

Free text that may run past one line: a note draft, an export description, a selector's rationale. Rich notes use the `.note-prose` editor instead.

## What the consumer provides

All native `<textarea>` props, including `rows`; the width comes from the container (`w-full`).

## Rules

Rest border `color-input`, focus border `color-accent`, no ring; placeholder `color-text-faint`; disabled at 50% opacity. Same as `Input`.
