# Dialog

The modal: a `rgba(0,0,0,0.5)` overlay and a centred `color-elevated` panel with `shadow-overlay`, 24px padding, 6px radius, at most 28rem wide. Hand-written from `src/renderer/components/ui/dialog.tsx`; the static preview shows the resting markup without motion.

## When to use

A decision or a short form that must finish before the Operator continues: confirmations, a new case, export options. Longer flows (the command palette, the tour, import and export panels) keep their own markup and run on the same hooks.

## What the consumer provides

- `Dialog` with `open` and `onOpenChange`; it owns Escape, moves focus in on open and hands it back on close, and registers itself so other surfaces can tell a dialog is up.
- `DialogContent` with `onClose`; it traps Tab, carries `role="dialog"` and `aria-modal`, and is labelled by the `DialogTitle` inside it (or an explicit `aria-label`).
- `DialogHeader` (16px below, 6px between rows), `DialogTitle` (14px / 600 `color-text-primary`), `DialogDescription` (14px `color-text-muted`), `DialogFooter` (right-aligned, 12px gap, 24px above).

## Rules

- Enter on the `modal` preset: opacity 0, scale 0.96, y 12 on the `gentle` spring (200 / 24); the overlay fades over 0.2s.
- Say what the action does and where the data goes in the description; the primary button names the verb ("Delete captures"), the secondary is `ghost` "Cancel".
- A modal that cannot take this markup still runs `useModalEscape` and `useModalFocus` rather than a second copy.
