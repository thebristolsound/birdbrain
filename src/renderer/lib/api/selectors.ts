import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  CreateSelectorParams,
  UpdateSelectorParams,
  BulkCreateSelectorsParams
} from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

export const selectorsQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.selectors(caseId),
    queryFn: () => window.birdbrain.selectors.list(caseId),
    enabled: !!caseId
  })

export const selectorMatchCountsQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.selectorMatchCounts(caseId),
    queryFn: () => window.birdbrain.selectors.matchCounts(caseId),
    enabled: !!caseId
  })

export const selectorCoverageQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.selectorCoverage(caseId),
    queryFn: () => window.birdbrain.selectors.coverage(caseId),
    enabled: !!caseId
  })

export const selectorMatchingCapturesQueryOptions = (caseId: string, selectorIds: string[]) =>
  queryOptions({
    queryKey: queryKeys.selectorMatchingCaptures(caseId, selectorIds),
    queryFn: () => window.birdbrain.selectors.matchingCaptures(caseId, selectorIds),
    enabled: !!caseId && selectorIds.length > 0
  })

// One-shot create for flows that mint selectors for a case whose queries are
// not cached yet (e.g. the new-case wizard) — no invalidation needed there.
export const createSelector = (params: CreateSelectorParams) =>
  window.birdbrain.selectors.create(params)

export const exportSelectorMatches = (
  caseId: string
): Promise<{ exported: boolean; path?: string }> => window.birdbrain.selectors.exportMatches(caseId)

export function useSelectorsMutations(caseId: string) {
  const queryClient = useQueryClient()

  const invalidateSelectorQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorCoverage(caseId) })
  }

  const create = useMutation({
    mutationFn: (params: CreateSelectorParams) => window.birdbrain.selectors.create(params),
    onSuccess: invalidateSelectorQueries
  })

  const update = useMutation({
    mutationFn: (params: UpdateSelectorParams) => window.birdbrain.selectors.update(params),
    onSuccess: invalidateSelectorQueries
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.selectors.delete(id),
    onSuccess: invalidateSelectorQueries
  })

  const bulkCreate = useMutation({
    mutationFn: (params: BulkCreateSelectorsParams) =>
      window.birdbrain.selectors.bulkCreate(params),
    onSuccess: invalidateSelectorQueries
  })

  return { create, update, remove, bulkCreate }
}
