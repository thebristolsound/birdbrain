import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreatePersonaParams, UpdatePersonaParams } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'
import { birdbrain } from '@renderer/lib/birdbrain'

export const personasQueryOptions = queryOptions({
  queryKey: queryKeys.personas,
  queryFn: () => birdbrain.persona.list()
})

// Whether safeStorage reports an OS key, which decides whether import asks for
// the #414 acknowledgement; the cookie stores are unencrypted either way. A
// property of the install, not of a persona, so it is read once and never
// invalidated by a write.
export const personaStorageStateQueryOptions = queryOptions({
  queryKey: queryKeys.personaStorageState,
  queryFn: () => birdbrain.persona.storageState(),
  staleTime: Infinity
})

export function usePersonasMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.personas })

  const create = useMutation({
    mutationFn: (params: CreatePersonaParams) => birdbrain.persona.create(params),
    onSuccess: invalidate,
    meta: { action: 'create persona' }
  })

  const update = useMutation({
    mutationFn: (params: UpdatePersonaParams) => birdbrain.persona.update(params),
    onSuccess: invalidate,
    meta: { action: 'rename persona' }
  })

  const remove = useMutation({
    mutationFn: (id: string) => birdbrain.persona.delete(id),
    onSuccess: invalidate,
    meta: { action: 'delete persona' }
  })

  // The result carries the counts the row summary shows; the list is
  // refetched because the import time and count live on the row. A refusal
  // rejects with an Error that keeps main's code, which the row reads.
  const importCookies = useMutation({
    mutationFn: (personaId: string) => birdbrain.persona.import(personaId),
    onSuccess: invalidate,
    meta: { action: 'import cookies' }
  })

  return { create, update, remove, importCookies }
}
