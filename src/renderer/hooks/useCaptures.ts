import { useState, useEffect, useCallback } from 'react'
import type { Capture } from '@shared/types'

export function useCaptures(caseId: string | null) {
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!caseId) {
      setCaptures([])
      return
    }
    setLoading(true)
    const result = await window.birdbrain.captures.list(caseId)
    setCaptures(result)
    setLoading(false)
  }, [caseId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Listen for new captures from extension
  useEffect(() => {
    const unsubscribe = window.birdbrain.onNewCapture((capture) => {
      if (capture.caseId === caseId) {
        setCaptures((prev) => [capture, ...prev])
      }
    })
    return unsubscribe
  }, [caseId])

  const deleteCapture = useCallback(
    async (id: string) => {
      const result = await window.birdbrain.captures.delete(id)
      await refresh()
      return result
    },
    [refresh]
  )

  const getContent = useCallback(async (captureId: string, type: 'html' | 'png' | 'txt') => {
    return window.birdbrain.captures.getContent(captureId, type)
  }, [])

  return { captures, loading, refresh, deleteCapture, getContent }
}
