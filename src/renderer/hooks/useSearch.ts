import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchQueryOptions, notesSearchQueryOptions } from '@renderer/lib/queries'

export function useSearch(caseId: string) {
  const [query, setQuery] = useState('')
  const { data: results = [], isLoading, isError } = useQuery(searchQueryOptions(caseId, query))
  const {
    data: noteResults = [],
    isLoading: notesLoading,
    isError: notesError
  } = useQuery(notesSearchQueryOptions(caseId, query))

  const search = useCallback((q: string) => {
    setQuery(q.trim())
  }, [])

  const clear = useCallback(() => {
    setQuery('')
  }, [])

  return {
    results,
    noteResults,
    searching: isLoading || notesLoading,
    failed: isError || notesError,
    search,
    clear
  }
}
