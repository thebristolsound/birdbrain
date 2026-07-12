import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { BirdbrainSettings } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

export const settingsQueryOptions = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: () => window.birdbrain.settings.get()
})

// Single write path for settings: every update flows through this factory so
// the settings cache is written coherently (no stale reads after a write).
export const settingsUpdateMutationOptions = (queryClient: QueryClient) => ({
  mutationFn: (partial: Partial<BirdbrainSettings>) => window.birdbrain.settings.update(partial),
  onSuccess: (data: BirdbrainSettings, partial: Partial<BirdbrainSettings>) => {
    queryClient.setQueryData(queryKeys.settings, data)
    if ('openRouterApiKey' in partial) {
      queryClient.invalidateQueries({ queryKey: queryKeys.openRouterModels })
    }
  }
})

export function useSettingsMutations() {
  const queryClient = useQueryClient()

  const update = useMutation(settingsUpdateMutationOptions(queryClient))

  return { update }
}

export const testOpenRouterKey = (apiKey: string): Promise<boolean> =>
  window.birdbrain.settings.testOpenRouter(apiKey)

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
