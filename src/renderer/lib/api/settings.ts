import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { BirdbrainSettings } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

export const settingsQueryOptions = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: () => window.birdbrain.settings.get()
})

export function settingsUpdateMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (partial: Partial<BirdbrainSettings>) => window.birdbrain.settings.update(partial),
    onSuccess: (data: BirdbrainSettings) => {
      queryClient.setQueryData(queryKeys.settings, data)
    },
    meta: { action: 'save settings' }
  }
}

export function useSettingsMutations() {
  const queryClient = useQueryClient()
  return { update: useMutation(settingsUpdateMutationOptions(queryClient)) }
}

export const identityQueryOptions = queryOptions({
  queryKey: queryKeys.identity,
  queryFn: () => window.birdbrain.settings.getIdentity()
})
