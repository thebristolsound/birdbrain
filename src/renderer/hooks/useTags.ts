import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@shared/types'
import type { CreateTagParams, UpdateTagParams } from '@shared/ipc'

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const result = await window.birdbrain.tags.list()
    setTags(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createTag = useCallback(
    async (params: CreateTagParams) => {
      const tag = await window.birdbrain.tags.create(params)
      await refresh()
      return tag
    },
    [refresh]
  )

  const updateTag = useCallback(
    async (params: UpdateTagParams) => {
      const tag = await window.birdbrain.tags.update(params)
      await refresh()
      return tag
    },
    [refresh]
  )

  const deleteTag = useCallback(
    async (id: string) => {
      const result = await window.birdbrain.tags.delete(id)
      await refresh()
      return result
    },
    [refresh]
  )

  const addToCapture = useCallback(async (captureId: string, tagId: string) => {
    await window.birdbrain.tags.addToCapture({ captureId, tagId })
  }, [])

  const removeFromCapture = useCallback(async (captureId: string, tagId: string) => {
    await window.birdbrain.tags.removeFromCapture({ captureId, tagId })
  }, [])

  const getForCapture = useCallback(async (captureId: string) => {
    return window.birdbrain.tags.getForCapture(captureId)
  }, [])

  return {
    tags,
    loading,
    refresh,
    createTag,
    updateTag,
    deleteTag,
    addToCapture,
    removeFromCapture,
    getForCapture
  }
}
