import { useQuery } from '@tanstack/react-query'
import { openRouterModelsQueryOptions } from '@renderer/lib/queries'
import type { OpenRouterModel } from '@shared/types'

export function useOpenRouterModels(apiKey: string | null | undefined): {
  models: OpenRouterModel[]
  loading: boolean
} {
  const { data: models = [], isLoading } = useQuery(
    openRouterModelsQueryOptions(apiKey || '')
  )

  return { models, loading: isLoading }
}
