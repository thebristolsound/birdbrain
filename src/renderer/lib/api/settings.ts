import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { BirdbrainSettings } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

export const settingsQueryOptions = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: () => window.birdbrain.settings.get()
})

export function useSettingsMutations() {
  const queryClient = useQueryClient()

  const update = useMutation({
    mutationFn: (partial: Partial<BirdbrainSettings>) => window.birdbrain.settings.update(partial),
    onSuccess: (data, partial) => {
      queryClient.setQueryData(queryKeys.settings, data)
      if ('openRouterApiKey' in partial) {
        queryClient.invalidateQueries({ queryKey: queryKeys.openRouterModels })
      }
    }
  })

  return { update }
}

export const identityQueryOptions = queryOptions({
  queryKey: queryKeys.identity,
  queryFn: () => window.birdbrain.settings.getIdentity()
})

export const appVersionQueryOptions = queryOptions({
  queryKey: queryKeys.appVersion,
  queryFn: () => window.birdbrain.app.getVersion(),
  staleTime: Infinity
})

export const openRouterModelsQueryOptions = (apiKey: string) =>
  queryOptions({
    queryKey: queryKeys.openRouterModels,
    queryFn: () => window.birdbrain.settings.listModels(apiKey),
    enabled: !!apiKey
  })
