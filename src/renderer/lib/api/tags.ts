import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
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

export function useTagsMutations(caseId?: string) {
  const queryClient = useQueryClient()

  const invalidateTagCounts = () => {
    queryClient.invalidateQueries({ queryKey: ['tags', 'usageCounts'] })
    queryClient.invalidateQueries({ queryKey: ['tags', 'caseCount'] })
    queryClient.invalidateQueries({ queryKey: ['tags', 'captureMatrix'] })
  }

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
      invalidateTagCounts()
    },
    meta: { action: 'delete tag' }
  })

  const addToCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.addToCapture({ captureId, tagId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
      invalidateTagCounts()
    },
    meta: { action: 'add tag to capture' }
  })

  const removeFromCapture = useMutation({
    mutationFn: ({ captureId, tagId }: { captureId: string; tagId: string }) =>
      window.birdbrain.tags.removeFromCapture({ captureId, tagId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tagsForCapture(vars.captureId) })
      invalidateTagCounts()
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
      invalidateTagCounts()
    },
    meta: { action: 'add tag to captures' }
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
      invalidateTagCounts()
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
    applyToNote,
    merge
  }
}
