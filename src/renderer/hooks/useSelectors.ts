import { useState, useEffect, useCallback } from 'react'
import type { Selector } from '@shared/types'
import type { CreateSelectorParams, UpdateSelectorParams } from '@shared/ipc'

export function useSelectors(caseId: string | null) {
  const [selectors, setSelectors] = useState<Selector[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!caseId) {
      setSelectors([])
      setLoading(false)
      return
    }
    const result = await window.birdbrain.selectors.list(caseId)
    setSelectors(result)
    setLoading(false)
  }, [caseId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const create = useCallback(
    async (params: CreateSelectorParams) => {
      const newSelector = await window.birdbrain.selectors.create(params)
      await refresh()
      return newSelector
    },
    [refresh]
  )

  const update = useCallback(
    async (params: UpdateSelectorParams) => {
      const updated = await window.birdbrain.selectors.update(params)
      await refresh()
      return updated
    },
    [refresh]
  )

  const deleteSelector = useCallback(
    async (id: string) => {
      const result = await window.birdbrain.selectors.delete(id)
      await refresh()
      return result
    },
    [refresh]
  )

  return { selectors, loading, refresh, create, update, deleteSelector }
}
