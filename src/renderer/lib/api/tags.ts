import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Capture } from '@shared/types'
import type {
  BatchCountResult,
  CreateTagParams,
  MergeTagsParams,
  UpdateTagParams
} from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'
import { SIGNAL_COVERAGE_CAPTURES } from '@shared/constants'

export const tagsQueryOptions = queryOptions({
  queryKey: queryKeys.tags,
  queryFn: () => window.birdbrain.tags.list()
})

export const tagsForCaptureQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.tagsForCapture(captureId),
    queryFn: () => window.birdbrain.tags.getForCapture(captureId),
    enabled: !!captureId
  })

export const tagCountForCaseQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.tagCountForCase(caseId),
    queryFn: () => window.birdbrain.tags.countForCase(caseId),
    enabled: !!caseId
  })

export const tagUsageCountsForCaseQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.tagUsageCounts(caseId),
    queryFn: () => window.birdbrain.tags.usageCountsForCase(caseId),
    enabled: !!caseId
  })

// Which of the most recent captures carry each tag (#400). The tag half of the
// Signals coverage strip.
export const tagCaptureMatrixQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.tagCaptureMatrix(caseId),
    queryFn: () => window.birdbrain.tags.captureMatrix(caseId, SIGNAL_COVERAGE_CAPTURES),
    enabled: !!caseId
  })

// The ids of every capture in the case carrying any of these tags (#918),
// backing the capture list's tag filter. A query rather than a one-shot read
// so a membership write refreshes it through `invalidateTagCounts` below;
// `useTagFilters` publishes the result into the app store.
export const tagCapturesWithAnyQueryOptions = (caseId: string, tagIds: string[]) =>
  queryOptions({
    queryKey: queryKeys.tagCapturesWithAny(caseId, tagIds),
    queryFn: () => window.birdbrain.tags.capturesWithAnyTag(caseId, tagIds),
    enabled: !!caseId && tagIds.length > 0
  })

// How many of a selection carry each tag (#665), backing the batch picker's
// none/partial/all indicator. One read for the whole selection rather than a
// `tagsForCapture` per row, which is 500 invokes at the batch bound.
export const tagSelectionCountsQueryOptions = (caseId: string, captureIds: string[]) =>
  queryOptions({
    queryKey: queryKeys.tagSelectionCounts(caseId, captureIds),
    queryFn: () => window.birdbrain.tags.countsForCaptures({ caseId, captureIds }),
    enabled: !!caseId && captureIds.length > 0
  })

// Every read derived from tag membership: the Signals coverage strip, both
// count badges, the capture list's tag filter and the batch picker's
// indicator. Module-level so the extension-attach listener invalidates the
// same list the mutations do rather than a copy of it (#852).
export function invalidateTagCounts(client: QueryClient): void {
  client.invalidateQueries({ queryKey: ['tags', 'usageCounts'] })
  client.invalidateQueries({ queryKey: ['tags', 'caseCount'] })
  client.invalidateQueries({ queryKey: ['tags', 'captureMatrix'] })
  client.invalidateQueries({ queryKey: queryKeys.tagCapturesWithAnyAll })
  client.invalidateQueries({ queryKey: queryKeys.tagSelectionCountsAll })
}

// What an extension `POST /api/tags/apply` stales in an open case (#852). The
// route is find-or-create then attach, so it is the `create` and `addToCapture`
// mutations' key sets together — those are the writes it performs, and this
// mirrors them deliberately. Note that under React Query's prefix matching the
// `queryKeys.tags` line already subsumes the other two; that is #876's finding
// about the tag key shape, open and repo-wide, so this states the intent the
// mutations state and changes with them when #876 restructures the keys.
export function invalidateAfterTagApply(client: QueryClient, captureId: string): void {
  client.invalidateQueries({ queryKey: queryKeys.tags })
  client.invalidateQueries({ queryKey: queryKeys.tagsForCapture(captureId) })
  invalidateTagCounts(client)
}

export function useTagsMutations(caseId?: string) {
  const queryClient = useQueryClient()

  const invalidateCounts = () => invalidateTagCounts(queryClient)

  const create = useMutation({
    mutationFn: (params: CreateTagParams) => window.birdbrain.tags.create(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags }),
    meta: { action: 'create tag' }
  })

  const update = useMutation({
    mutationFn: (params: UpdateTagParams) => window.birdbrain.tags.update(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags }),
    meta: { action: 'update tag' }
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.tags.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tags })
      invalidateCounts()
    },
    meta: { action: 'delete tag' }
  })

  const addToCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.addToCapture({ captureId, tagId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
      invalidateCounts()
    },
    meta: { action: 'add tag to capture' }
  })

  const removeFromCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.removeFromCapture({ captureId, tagId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
      invalidateCounts()
    },
    meta: { action: 'remove tag from capture' }
  })

  // Batch tag-apply (#394). Needs the hook's caseId for the same-case guard;
  // calling it without one is a programming error, surfaced as a rejection.
  const addToCaptures = useMutation<
    BatchCountResult,
    unknown,
    { captureIds: string[]; tagId: string }
  >({
    mutationFn: ({ captureIds, tagId }) => {
      if (!caseId) return Promise.reject(new Error('useTagsMutations(caseId) required'))
      return window.birdbrain.tags.addToCaptures({ caseId, captureIds, tagId })
    },
    onSuccess: (_data, vars) => {
      for (const id of vars.captureIds) {
        queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(id) })
      }
      invalidateCounts()
    },
    meta: { action: 'add tag to captures' }
  })

  // Batch untag (#665), the counterpart of addToCaptures above and with the
  // same caseId requirement, since it runs the same same-case guard.
  const removeFromCaptures = useMutation<
    BatchCountResult,
    unknown,
    { captureIds: string[]; tagId: string }
  >({
    mutationFn: ({ captureIds, tagId }) => {
      if (!caseId) return Promise.reject(new Error('useTagsMutations(caseId) required'))
      return window.birdbrain.tags.removeFromCaptures({ caseId, captureIds, tagId })
    },
    onSuccess: (_data, vars) => {
      for (const id of vars.captureIds) {
        queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(id) })
      }
      invalidateCounts()
    },
    meta: { action: 'remove tag from captures' }
  })

  // Create-or-reuse by name (#665). Separate from `create` rather than
  // replacing it: `create` is the Signals screen's explicit new-tag action,
  // where naming an existing tag is an error worth showing, while a picker
  // that also filters by the typed name wants the existing tag back.
  const findOrCreate = useMutation({
    mutationFn: (params: CreateTagParams) => window.birdbrain.tags.findOrCreate(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags }),
    meta: { action: 'create tag' }
  })

  // Note-level tag apply (#391). Named by string, not by id: main resolves
  // create-or-reuse, so the renderer never has to decide whether the tag it is
  // about to name already exists. The capture invalidation is conditional on
  // what main reports it actually did — an unanchored note touches no capture.
  const applyToNote = useMutation({
    mutationFn: ({ noteId, name }: { noteId: string; name: string }) =>
      window.birdbrain.tags.applyToNote({ noteId, name }),
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForNote(vars.noteId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.tags })
      if (data.captureId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(data.captureId) })
      }
      invalidateCounts()
    },
    meta: { action: 'apply tag to note' }
  })

  // Merge source into target (#828). One prefix invalidation: every tag query
  // key starts with 'tags' (list, per-capture, per-note, counts, matrix), and
  // a merge is app-global — it can touch any capture or note in any case — so
  // scoping tighter would mean enumerating rows only main knows it rewrote.
  const merge = useMutation({
    mutationFn: (params: MergeTagsParams) => window.birdbrain.tags.merge(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags }),
    meta: { action: 'merge tags' }
  })

  return {
    create,
    update,
    remove,
    addToCapture,
    removeFromCapture,
    addToCaptures,
    removeFromCaptures,
    findOrCreate,
    applyToNote,
    merge
  }
}

// Read at action time; the coverage strip is intentionally capped and cannot
// define an export's scope. The case's full capture list also excludes stale IDs.
export async function getCapturesForTag(caseId: string, tagId: string): Promise<Capture[]> {
  const [ids, captures] = await Promise.all([
    window.birdbrain.tags.capturesWithAnyTag(caseId, [tagId]),
    window.birdbrain.captures.list(caseId)
  ])
  const included = new Set(ids)
  return captures.filter((capture) => included.has(capture.id))
}
