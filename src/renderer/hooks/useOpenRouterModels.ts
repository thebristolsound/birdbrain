import { useEffect, useState } from 'react'
import type { OpenRouterModel } from '@shared/types'

export function useOpenRouterModels(apiKey: string | null | undefined): {
  models: OpenRouterModel[]
  loading: boolean
} {
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!apiKey) {
      setModels([])
      setLoading(false)
      return
    }

    let cancelled = false
    setModels([])
    setLoading(true)
    window.birdbrain.settings
      .listModels(apiKey)
      .then((m) => {
        if (!cancelled) setModels(m)
      })
      .catch(() => {
        if (!cancelled) setModels([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [apiKey])

  return { models, loading }
}
