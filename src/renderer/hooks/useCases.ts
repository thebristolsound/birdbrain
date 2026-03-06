import { useState, useEffect, useCallback } from 'react'
import type { Case } from '@shared/types'
import type { CreateCaseParams, UpdateCaseParams } from '@shared/ipc'

export function useCases() {
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const result = await window.birdbrain.cases.list()
    setCases(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createCase = useCallback(
    async (params: CreateCaseParams) => {
      const newCase = await window.birdbrain.cases.create(params)
      await refresh()
      return newCase
    },
    [refresh]
  )

  const updateCase = useCallback(
    async (params: UpdateCaseParams) => {
      const updated = await window.birdbrain.cases.update(params)
      await refresh()
      return updated
    },
    [refresh]
  )

  const deleteCase = useCallback(
    async (id: string) => {
      const result = await window.birdbrain.cases.delete(id)
      await refresh()
      return result
    },
    [refresh]
  )

  return { cases, loading, refresh, createCase, updateCase, deleteCase }
}
