import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchQueryOptions } from '@renderer/lib/queries'

export function useSearch() {
  const [query, setQuery] = useState('')
  const { data: results = [], isLoading } = useQuery(searchQueryOptions(query))

  const search = useCallback((q: string) => {
    setQuery(q.trim())
  }, [])

  const clear = useCallback(() => {
    setQuery('')
  }, [])

  return { results, searching: isLoading, search, clear }
}
