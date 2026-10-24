# Label

A form label: 14px `color-text-muted`, block, 4px above its control. Hand-written from `src/renderer/components/ui/label.tsx`.

## When to use

Above every `Input` and `Textarea` in a form or settings panel. Panel heads are not labels; use `SectionLabel`.

## What the consumer provides

`htmlFor` pointing at the control's id, and the label text in sentence case without end punctuation.
