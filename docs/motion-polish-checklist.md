# Motion polish — manual test checklist

Test each surface with **Reduce motion off** (default) and **Reduce motion on** (Settings → Appearance).

## Tactile

- [ ] **Button press.** Click any primary button (Dashboard "New Case", any modal "Save"). With reduce-motion off: subtle scale-down (~3%) on press. With reduce-motion on: no animation; native click only.
- [ ] **Disabled buttons.** A disabled button does not animate on click attempt.

## List & content reveals

- [ ] **CaptureList mount.** Open a case with 10+ captures. Items fade-in from left in a staggered cascade (capped at 8 items). Subsequent captures appear individually without re-staggering the whole list.
- [ ] **NotesOverview add/remove.** Add a note — it slides in. Delete a note — it slides out. List re-flows smoothly.
- [ ] **RecentCases mount.** Reload the dashboard with 3 cases — cards fade-up in sequence.

## Loading transitions

- [ ] **CaptureList skeleton.** Reload a case route. Skeleton placeholders fade out as the real list fades in (no snap).
- [ ] **AIConfig model load.** In Settings → AI, trigger a model list refresh. Spinner crossfades to the result list.

## Layout

- [ ] **CaseHeader chevron.** Expand/collapse the case header — chevron rotation uses a spring (slightly bouncy snap), not a linear ease.

## Reduce motion

- [ ] **Toggle persists.** Toggle on, reload the app, toggle is still on.
- [ ] **CSS gate active.** With reduce-motion on, `<html>` has the `reduce-motion` class. Tailwind `transition-colors` hover effects complete instantly.
- [ ] **OS preference respected.** Without the in-app toggle, set OS-level "Reduce motion" preference; all motion is suppressed via `MotionConfig reducedMotion="user"`.
