import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { BirdbrainSettings } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

// --- Settings ---

export const settingsQueryOptions = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: () => window.birdbrain.settings.get()
})

export function settingsUpdateMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (partial: Partial<BirdbrainSettings>) => window.birdbrain.settings.update(partial),
    onSuccess: (data: BirdbrainSettings, partial: Partial<BirdbrainSettings>) => {
      queryClient.setQueryData(queryKeys.settings, data)
      if ('openRouterApiKey' in partial) {
        queryClient.invalidateQueries({ queryKey: queryKeys.openRouterModels })
      }
    },
    meta: { action: 'save settings' }
  }
}

export function useSettingsMutations() {
  const queryClient = useQueryClient()
  return { update: useMutation(settingsUpdateMutationOptions(queryClient)) }
}

// --- Identity ---

export const identityQueryOptions = queryOptions({
  queryKey: queryKeys.identity,
  queryFn: () => window.birdbrain.settings.getIdentity()
})

// --- App version ---

export const appVersionQueryOptions = queryOptions({
  queryKey: queryKeys.appVersion,
  queryFn: () => window.birdbrain.app.getVersion(),
  staleTime: Infinity
})

// --- OpenRouter Models ---

export const openRouterModelsQueryOptions = (apiKey: string) =>
  queryOptions({
    queryKey: queryKeys.openRouterModels,
    queryFn: () => window.birdbrain.settings.listModels(apiKey),
    enabled: !!apiKey
  })
