import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreatePersonaParams, UpdatePersonaParams } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

export const personasQueryOptions = queryOptions({
  queryKey: queryKeys.personas,
  queryFn: () => window.birdbrain.persona.list()
})

// Whether the OS key protects the partitions' cookie stores (#414). A
// property of the install, not of a persona, so it is read once and never
// invalidated by a write.
export const personaStorageStateQueryOptions = queryOptions({
  queryKey: queryKeys.personaStorageState,
  queryFn: () => window.birdbrain.persona.storageState(),
  staleTime: Infinity
})

export function usePersonasMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.personas })

  const create = useMutation({
    mutationFn: (params: CreatePersonaParams) => window.birdbrain.persona.create(params),
    onSuccess: invalidate,
    meta: { action: 'create persona' }
  })

  const update = useMutation({
    mutationFn: (params: UpdatePersonaParams) => window.birdbrain.persona.update(params),
    onSuccess: invalidate,
    meta: { action: 'rename persona' }
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.persona.delete(id),
    onSuccess: invalidate,
    meta: { action: 'delete persona' }
  })

  // The result carries the counts the row summary shows; the list is
  // refetched because the import time and count live on the row.
  const importCookies = useMutation({
    mutationFn: (personaId: string) => window.birdbrain.persona.import(personaId),
    onSuccess: invalidate,
    meta: { action: 'import cookies' }
  })

  return { create, update, remove, importCookies }
}
