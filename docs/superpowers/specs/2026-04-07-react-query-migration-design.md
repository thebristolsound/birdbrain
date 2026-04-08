# React Query Migration — High-Value Wins

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Migrate 6 hooks/components to React Query + fix 3 consistency gaps

## Problem

Birdbrain has a well-structured React Query setup in `queries.ts` covering CRUD for cases, captures, tags, selectors, and notes. However, ~15 renderer files still call `window.birdbrain.*` directly with manual `useState`/`useEffect` patterns. This causes:

- **No request deduplication** — e.g., 20 `CaptureItem` components each independently fetch `getMatchingSelectors`
- **No shared cache** — `CaptureItem` and `NoteCard` both fetch thumbnails independently
- **Manual cancellation boilerplate** — every hook hand-rolls `let cancelled = false` cleanup
- **Inconsistent mutation patterns** — `SelectorTable` calls IPC directly despite `useSelectorsMutations` existing
- **No stale-while-revalidate** — tab switching in `CaptureViewer` always re-fetches

## Guiding Principle

Use React Query for **data reads** and **stateful mutations** that need cache invalidation. Keep **fire-and-forget side-effects** (download, openExternal, exportMatches) as direct IPC calls.

## Approach

Bottom-up: extend `queries.ts` with new query options and mutation hooks first, then rewire each hook/component to use them.

## Design

### 1. New Query Options in `queries.ts`

#### New query keys

```ts
queryKeys.favorites = (caseId: string) => ['favorites', caseId] as const
queryKeys.thumbnail = (captureId: string) => ['thumbnail', captureId] as const
queryKeys.capture = (captureId: string) => ['capture', captureId] as const
queryKeys.captureContent = (captureId: string, type: string) =>
  ['captureContent', captureId, type] as const
queryKeys.matchingSelectors = (captureId: string) =>
  ['matchingSelectors', captureId] as const
```

#### New query options

| Factory | IPC Call | Cache Strategy |
|---|---|---|
| `favoritesQueryOptions(caseId)` | `captures.listFavorites(caseId)` | Default (30s stale) |
| `thumbnailQueryOptions(captureId)` | `captures.getThumbnail(captureId)` | Default (30s stale) |
| `captureDetailQueryOptions(captureId)` | `captures.get(captureId)` | Default |
| `captureContentQueryOptions(captureId, type)` | `captures.getContent(captureId, type)` | Session-scoped (`gcTime: Infinity`, `staleTime: Infinity`) |
| `matchingSelectorsQueryOptions(captureId)` | `captures.getMatchingSelectors(captureId)` | Default |
| `searchQueryOptions(query)` | `search(query)` | Default, `enabled: query.trim().length > 0` |

#### New mutation hook

```ts
useFavoritesMutation(caseId)
  // mutationFn: (captureId) => captures.toggleFavorite(captureId)
  // onSuccess: invalidate favorites(caseId) + captures(caseId)
```

### 2. Hook Rewiring

#### `useCaptureThumbnail.ts`

Replace `useState(thumbnail)` + `useState(loading)` + `useEffect` with cancellation:

```ts
export function useCaptureThumbnail(captureId: string | null) {
  const { data, isLoading } = useQuery(thumbnailQueryOptions(captureId ?? ''))
  const thumbnail = data ? `data:image/jpeg;base64,${data}` : null
  return { thumbnail, loading: isLoading }
}
```

`NoteCard.tsx` switches from its inline `useEffect` thumbnail fetch to calling `useCaptureThumbnail(note.captureId)`.

#### `useFavorites.ts`

Replace `useState(Set)` + `useEffect` + manual toggle logic:

```ts
export function useFavorites(caseId: string) {
  const { data: favoriteIds = [] } = useQuery(favoritesQueryOptions(caseId))
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const toggle = useFavoritesMutation(caseId)
  const toggleFavorite = (captureId: string) => toggle.mutate(captureId)
  return { favorites, toggleFavorite }
}
```

#### `useSearch.ts`

Replace manual `useState` + `useCallback` with parameterized query:

```ts
export function useSearch() {
  const [query, setQuery] = useState('')
  const { data: results = [], isLoading: searching } = useQuery(searchQueryOptions(query))
  const search = useCallback((q: string) => setQuery(q), [])
  const clear = useCallback(() => setQuery(''), [])
  return { results, searching, search, clear }
}
```

#### `useSelectorFilters.ts`

Replace `useEffect` + Zustand write:

```ts
export function useSelectorFilters(caseId: string | null) {
  const activeSelectorFilters = useAppStore((s) => s.activeSelectorFilters)
  const { data: matchingIds } = useQuery({
    queryKey: queryKeys.selectorMatchingCaptures(caseId!, activeSelectorFilters),
    queryFn: () => window.birdbrain.selectors.matchingCaptures(caseId!, activeSelectorFilters),
    enabled: !!caseId && activeSelectorFilters.length > 0
  })

  useEffect(() => {
    useAppStore.getState().setFilteredCaptureIds(matchingIds ?? null)
  }, [matchingIds])
}
```

#### `CaptureViewer.tsx`

Replace two `useEffect` blocks for capture detail and content:

```ts
// Capture detail
const { data: capture } = useQuery(captureDetailQueryOptions(selectedCaptureId ?? ''))

// Content (session-scoped cache — tab switching is instant)
const contentType = activeTab === 'screenshot' ? 'png' : activeTab === 'text' ? 'txt' : 'html'
const shouldFetchContent = !!selectedCaptureId && !(capture?.format === 'mhtml' && activeTab === 'page')
const { data: content } = useQuery({
  ...captureContentQueryOptions(selectedCaptureId ?? '', contentType),
  enabled: shouldFetchContent
})
```

Fire-and-forget calls (`download`, `openExternal`) stay as direct IPC.

#### `CaptureItem.tsx`

Replace `useState(matchingSelectors)` + `useEffect`:

```ts
const { data: matchingSelectors = [] } = useQuery(
  matchingSelectorsQueryOptions(capture.id)
)
```

### 3. Consistency Fixes

Three components call `window.birdbrain.selectors.*` directly despite `useSelectorsMutations(caseId)` already existing:

#### `SelectorTable.tsx`

- Replace `handleToggleEnabled` (direct `selectors.update()` + `onRefresh()`) with `useSelectorsMutations(caseId).update`
- Replace `handleDelete` (direct `selectors.delete()` + `onRefresh()`) with `useSelectorsMutations(caseId).remove`
- Remove `onRefresh` prop — React Query invalidation replaces it

#### `CreateSelectorCard.tsx`

- Replace `handleCreate` (direct `selectors.create()` + `onCreated()`) with `useSelectorsMutations(caseId).create`
- Remove `onCreated` prop — query invalidation handles refresh

#### `NewCaseWizard.tsx`

- Replace selector creation loop (direct `selectors.create()`) with `useSelectorsMutations(newCase.id).create.mutateAsync()`

#### Parent component impact

`SelectorsOverview.tsx` currently passes `onRefresh` to `SelectorTable` and `onCreated` to `CreateSelectorCard`. These callback props become unnecessary. The `handleRefresh` function in `SelectorsOverview` can be removed.

### 4. Out of Scope

Staying as direct IPC calls (by design):

| File | Calls | Reason |
|---|---|---|
| `CaptureViewer.tsx` | `download`, `openExternal` | Fire-and-forget actions |
| `NoteCard.tsx` | `openExternal` | Fire-and-forget |
| `CaptureHealth.tsx` | `testPipeline`, `testHttp` | Transient diagnostic results |
| `ExportDialog.tsx` | `export.generateReport` | Long-running action with progress UI |
| `useTheme.ts` | `settings.update` | Fire-and-forget theme sync |
| `SettingsView.tsx` | `settings.get/update` | Small isolated domain |
| `OperatorConfig.tsx` | `settings.getIdentity/update` | Small isolated domain |
| `DbStats/Tables/Utilities.tsx` | All `db.*` calls | Admin panel, rarely accessed |
| `ProvenanceBadge.tsx` | `captures.verify` | On-demand verification |
| `SelectorsOverview.tsx` | `selectors.exportMatches` | File export action |
| `SelectorTableRow.tsx` | Preview expansion calls | Transient preview data |
| `CreateSelectorCard.tsx` | Pattern test calls (`captures.list/getContent`) | Transient test results |

## Files Changed

| File | Change |
|---|---|
| `src/renderer/lib/queries.ts` | Add 6 query options, 1 mutation hook, 5 query keys |
| `src/renderer/hooks/useCaptureThumbnail.ts` | Rewrite with `useQuery` |
| `src/renderer/hooks/useFavorites.ts` | Rewrite with `useQuery` + `useMutation` |
| `src/renderer/hooks/useSearch.ts` | Rewrite with `useQuery` |
| `src/renderer/hooks/useSelectorFilters.ts` | Rewrite with `useQuery` |
| `src/renderer/components/captures/CaptureViewer.tsx` | Replace 2 useEffects with `useQuery` |
| `src/renderer/components/captures/CaptureItem.tsx` | Replace useEffect with `useQuery` |
| `src/renderer/components/notes/NoteCard.tsx` | Use `useCaptureThumbnail` hook |
| `src/renderer/components/selectors/SelectorTable.tsx` | Use `useSelectorsMutations`, remove `onRefresh` prop |
| `src/renderer/components/selectors/CreateSelectorCard.tsx` | Use `useSelectorsMutations`, remove `onCreated` prop |
| `src/renderer/components/selectors/SelectorsOverview.tsx` | Remove `onRefresh`/`onCreated` callbacks |
| `src/renderer/components/cases/NewCaseWizard.tsx` | Use `useSelectorsMutations` |

## Testing

- Run `pnpm test` — existing unit tests should continue passing
- Run `pnpm test:e2e` — E2E tests cover capture viewing, selector creation, and case creation workflows
- Manual smoke test: verify tab switching in CaptureViewer is instant (cached), favorites toggle works, search results appear, selector table updates/deletes work without manual refresh
