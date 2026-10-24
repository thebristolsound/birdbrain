# AppToaster

The sonner toaster, unstyled and re-skinned: bottom-centre, 22px up, a `color-card` pill with a status medallion, title, one-line description, an optional action and a close button, gone after six seconds. Hand-written from `src/renderer/components/ui/toaster.tsx`; the preview shows three toasts at rest.

## When to use

Mount `AppToaster` once at the app root; raise toasts with sonner's `toast.success / error / warning / info`. Use a toast for an outcome the Operator did not watch happen (a background recapture, a verification result); a result of their own click rarely needs one.

## What the consumer provides

The title (12px / 600, `color-text-primary`), a description that fits one line (10px `color-text-muted`, truncated) naming what happened and where the data went, and optionally an `action` label.

## Rules

- Geometry: at most 520px wide, 9px 9px 9px 13px padding, 11px gap, `radius` (6px), `color-border-strong` border, `shadow-overlay`.
- Medallion: 17px round, filled with the status `-surface` and inked with its `-fg`; lucide Check, TriangleAlert (error and warning) and Info at 10px / stroke 3; info uses `color-accent-subtle` and `color-accent`.
- Action: 26px, `color-accent-subtle` fill, a 35% accent border, 11px / 600 accent text. Close: 22px, `color-text-faint`, `color-elevated` on hover.
