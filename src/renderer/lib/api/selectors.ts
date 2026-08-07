import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  BulkCreateSelectorsParams,
  CreateSelectorParams,
  UpdateSelectorParams
} from '@shared/ipc'
import type { Selector } from '@shared/types'
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

// Plain wrappers alongside the mutation hooks below, deliberately. Their call
// sites (SelectorTable, CreateSelectorCard, NewCaseWizard) drive their own
// pending state and refresh explicitly, so routing them through
// useSelectorsMutations would add invalidation they do not do today —
// a behaviour change the design keeps out of the mechanical move. Converging
// them is a follow-up candidate, not part of #229 PR 4.
export function createSelector(params: CreateSelectorParams): Promise<Selector> {
  return window.birdbrain.selectors.create(params)
}

export function updateSelector(params: UpdateSelectorParams): Promise<Selector | undefined> {
  return window.birdbrain.selectors.update(params)
}

export function deleteSelector(id: string): Promise<boolean> {
  return window.birdbrain.selectors.delete(id)
}

// Writes a CSV outside the database and returns where it went; `exported:
// false` means the operator cancelled the save dialog.
export function exportSelectorMatches(
  caseId: string
): Promise<{ exported: boolean; path?: string }> {
  return window.birdbrain.selectors.exportMatches(caseId)
}

// Read without a cache identity: the capture-filter effect and the foreground
// match preview both want the current answer for an ad-hoc selector set, not a
// cached one keyed by it.
export function listMatchingCaptureIds(caseId: string, selectorIds: string[]): Promise<string[]> {
  return window.birdbrain.selectors.matchingCaptures(caseId, selectorIds)
}

export function useSelectorsMutations(caseId: string) {
  const queryClient = useQueryClient()

  const invalidateSelectorQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.selectors(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorMatchCounts(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.selectorCoverage(caseId) })
  }

  const create = useMutation({
    mutationFn: (params: CreateSelectorParams) => window.birdbrain.selectors.create(params),
    onSuccess: invalidateSelectorQueries,
    meta: { action: 'create selector' }
  })

  const update = useMutation({
    mutationFn: (params: UpdateSelectorParams) => window.birdbrain.selectors.update(params),
    onSuccess: invalidateSelectorQueries,
    meta: { action: 'update selector' }
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.selectors.delete(id),
    onSuccess: invalidateSelectorQueries,
    meta: { action: 'delete selector' }
  })

  const bulkCreate = useMutation({
    mutationFn: (params: BulkCreateSelectorsParams) =>
      window.birdbrain.selectors.bulkCreate(params),
    onSuccess: invalidateSelectorQueries,
    meta: { action: 'create selectors' }
  })

  return { create, update, remove, bulkCreate }
}
