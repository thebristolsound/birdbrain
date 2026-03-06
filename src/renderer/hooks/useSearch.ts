import { useState, useCallback } from 'react'
import type { Capture } from '@shared/types'

export function useSearch() {
  const [results, setResults] = useState<Capture[]>([])
  const [searching, setSearching] = useState(false)

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const captures = await window.birdbrain.search(query)
      setResults(captures)
    } finally {
      setSearching(false)
    }
  }, [])

  const clear = useCallback(() => {
    setResults([])
  }, [])

  return { results, searching, search, clear }
}
