import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateCaseParams, UpdateCaseParams } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

export const casesQueryOptions = queryOptions({
  queryKey: queryKeys.cases,
  queryFn: () => window.birdbrain.cases.list()
})

export const caseQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.case(id),
    queryFn: () => window.birdbrain.cases.get(id)
  })

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

  return { create, update, remove, exportArchive, importArchive }
}
