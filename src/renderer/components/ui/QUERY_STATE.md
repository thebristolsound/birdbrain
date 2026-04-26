<!-- Generated: 2026-04-20 -->

# QueryState, LoadingState, EmptyState, ErrorState

Reusable primitives that render a consistent loading / empty / error / success
UI around a TanStack Query result. Use `QueryState` for full-panel async data;
use the individual pieces for one-off cases.

## When to use

- **`QueryState`** is a **full-panel** pattern. Wrap a whole screen or
  prominent pane that corresponds to a single async fetch. It renders
  `<LoadingState />` while pending, `<ErrorState>` with a retry on failure, a
  caller-supplied empty slot when `isEmpty(data)` is true, and calls
  `children(data)` otherwise.
- For compact inline placeholders inside a denser layout (e.g. per-cell text
  like "Select a category"), keep whatever local helper that screen already has
  — `QueryState`'s `title` / `description` / `icon` shape will overwhelm those
  spots.
- For screens with _augmentation_ queries (e.g. usage counts sitting next to a
  primary list), only wrap the primary query in `QueryState`; auxiliary queries
  can keep their own inline treatment.

## Example

```tsx
import { useQuery } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { QueryState, EmptyState } from '@renderer/components/ui'
import { capturesQueryOptions } from '@renderer/lib/queries'

function CapturesPanel({ caseId }: { caseId: string }) {
  const query = useQuery(capturesQueryOptions(caseId))
  return (
    <QueryState
      query={query}
      isEmpty={(captures) => captures.length === 0}
      empty={
        <EmptyState
          icon={<Camera width={22} height={22} />}
          title="No captures yet"
          description="Connect the Birdbrain browser extension, then turn on Auto-Capture in the top bar. Pages you visit will appear here."
        />
      }
    >
      {(captures) => <CaptureGrid captures={captures} />}
    </QueryState>
  )
}
```

## Inline branching with `useQueryState`

When a wrapper is awkward (e.g. you need each branch to share surrounding
chrome), call the hook directly:

```tsx
const state = useQueryState(query, { isEmpty: (rows) => rows.length === 0 })
if (state.status === 'loading') return <LoadingState />
if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.retry} />
if (state.status === 'empty') return <EmptyState title="No results" />
return <Table rows={state.data} />
```

## Accessibility

- `LoadingState` renders `role="status"` + `aria-live="polite"` and includes a
  visually-hidden fallback label for screen readers when no label is passed.
- `EmptyState` renders `role="status"` so assistive tech announces the absence
  of content after a transition from loading.
- `ErrorState` renders `role="alert"` so failures are announced immediately.

## Props cheatsheet

`QueryState<TData>`:

| prop       | purpose                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------- |
| `query`    | Any object with `{ isPending, isError, error, data, refetch }` (TanStack Query result).  |
| `isEmpty`  | Predicate against `data` to route into the `empty` slot. Defaults to never-empty.        |
| `loading`  | Override the default `<LoadingState />`.                                                 |
| `error`    | ReactNode or `(error, retry) => ReactNode` to override the default `<ErrorState />`.     |
| `empty`    | ReactNode rendered when `isEmpty(data)` is true.                                         |
| `children` | `(data) => ReactNode` called on success (non-empty). `data` is narrowed to `TData` here. |
