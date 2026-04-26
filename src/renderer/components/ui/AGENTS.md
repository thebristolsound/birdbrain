<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-20 | Updated: 2026-04-20 -->

# ui

## Purpose

Headless, styled primitives reused across every feature directory. Built with `class-variance-authority` for variants and `tailwind-merge` (via `lib/utils.ts::cn()`) for class composition. Do not put business logic here.

## Key Files

| File                | Description                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `button.tsx`        | Polymorphic button with variants (default, outline, ghost, destructive) and sizes                                            |
| `card.tsx`          | Card surface + `CardHeader`, `CardContent`, `CardFooter` subcomponents                                                       |
| `dialog.tsx`        | Modal dialog primitive with overlay, focus-trap wiring, and keyboard close                                                   |
| `input.tsx`         | Text input with consistent focus ring                                                                                        |
| `label.tsx`         | Accessible label                                                                                                             |
| `textarea.tsx`      | Multi-line input mirroring the `input` style                                                                                 |
| `loading-state.tsx` | Centered spinner + optional label with `role="status"` for full-panel loading                                                |
| `empty-state.tsx`   | Icon + title + description + optional action slot for full-panel empty states                                                |
| `error-state.tsx`   | Red icon + title + description + retry button with `role="alert"`                                                            |
| `query-state.tsx`   | Declarative wrapper around a TanStack Query result: branches to loading / error / empty / success. See `QUERY_STATE.md`      |

## Subdirectories

_None._

## For AI Agents

### Working In This Directory

- Keep components **headless-leaning**: accept `className`, forward refs, and leave product-specific composition to the feature directory.
- Variants live in `cva(...)` definitions alongside the component. Consumers pass `variant`/`size` props — do not hand-pick Tailwind classes at call sites.
- Accessibility is non-negotiable: labels, focus rings, keyboard behavior, and ARIA wiring must all be present.

### Testing Requirements

- Covered indirectly through feature E2E. Add a unit test if a primitive gains non-trivial logic.

### Common Patterns

- `cn(...)` for every class merge. Never raw template strings of Tailwind classes.
- `forwardRef` for any primitive that expects a DOM ref.

## Dependencies

### Internal

- `../../lib/utils.ts` (`cn`)

### External

- `react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`

<!-- MANUAL: -->
