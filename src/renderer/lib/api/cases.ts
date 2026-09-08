import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  CreateCaseParams,
  SetAutoCapturePolicyParams,
  UpdateCaseParams
} from '@shared/ipc'
import type { ArchiveInspectReport } from '@shared/types'
import { RECENT_ACTIVITY_LIMIT } from '@shared/constants'
import { queryKeys } from '@renderer/lib/api/keys'

// Opens a file dialog and verifies the chosen archive without importing it;
// null means the operator cancelled. Nothing is written, so there is nothing
// to invalidate.
export function inspectCaseArchive(): Promise<ArchiveInspectReport | null> {
  return window.birdbrain.cases.inspectArchive()
}

export const casesQueryOptions = queryOptions({
  queryKey: queryKeys.cases,
  queryFn: () => window.birdbrain.cases.list()
})

export const caseQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.case(id),
    queryFn: () => window.birdbrain.cases.get(id)
  })

// The dashboard's cross-case activity feed (#403). `refetchOnMount: 'always'`
// overrides the client's 30s staleTime: returning to the dashboard after
// capturing is exactly when the feed is read, and a stale-but-fresh-enough
// cache would show the operator a feed missing the work they just did.
export const recentActivityQueryOptions = (limit: number = RECENT_ACTIVITY_LIMIT) =>
  queryOptions({
    queryKey: queryKeys.recentActivity(limit),
    queryFn: () => window.birdbrain.cases.recentActivity(limit),
    refetchOnMount: 'always'
  })

// The case's auto-capture exclusion policy (#400). Its own key rather than a
// field on the case: the policy is written by one card on one screen, and
// folding it into `cases` would invalidate every dashboard card on each edit.
export const caseAutoCapturePolicyQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.caseAutoCapturePolicy(caseId),
    queryFn: () => window.birdbrain.cases.getAutoCapturePolicy(caseId),
    enabled: !!caseId
  })

export function useCaseAutoCapturePolicyMutation(caseId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: SetAutoCapturePolicyParams) =>
      window.birdbrain.cases.setAutoCapturePolicy(params),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.caseAutoCapturePolicy(caseId) }),
    meta: { action: 'save auto-capture exclusions' }
  })
}

export function useCasesMutations() {
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: (params: CreateCaseParams) => window.birdbrain.cases.create(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cases }),
    meta: { action: 'create case' }
  })

  const update = useMutation({
    mutationFn: (params: UpdateCaseParams) => window.birdbrain.cases.update(params),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cases })
      queryClient.invalidateQueries({ queryKey: queryKeys.case(vars.id) })
    },
    meta: { action: 'update case' }
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.cases.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cases }),
    meta: { action: 'delete case' }
  })

  // The tour's "Delete demo case" ending (#405). Separate from `remove`
  // because it also removes the case's artifacts from disk, which the ordinary
  // delete deliberately does not; main refuses any case that is not flagged as
  // the demonstration case.
  const removeDemo = useMutation({
    // That refusal is a resolved `false`, not a rejection, so left as-is it
    // reaches onSuccess and a refused delete is indistinguishable from a
    // completed one — on a path that also removes artifacts from disk. Raised
    // here it takes the ordinary mutation failure toast instead.
    mutationFn: async (id: string) => {
      const removed = await window.birdbrain.cases.deleteDemo(id)
      if (!removed) throw new Error('Not a demonstration case')
      return removed
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cases }),
    meta: { action: 'delete demo case' }
  })

  const exportArchive = useMutation({
    mutationFn: (caseId: string) => window.birdbrain.cases.exportArchive(caseId),
    meta: { action: 'export case archive' }
  })

  const importArchive = useMutation({
    mutationFn: (params: { archivePath: string; overrideTamper: boolean }) =>
      window.birdbrain.cases.importArchive(params.archivePath, params.overrideTamper),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cases }),
    meta: { action: 'import case archive' }
  })

  return { create, update, remove, removeDemo, exportArchive, importArchive }
}
