import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { notesSearchQueryOptions } from '@renderer/lib/api/notes'
import { fieldSearchQueryOptions, searchQueryOptions } from '@renderer/lib/api/captures'

export function useSearch(caseId: string) {
  const [query, setQuery] = useState('')
  const { data: results = [], isLoading, isError } = useQuery(searchQueryOptions(caseId, query))
  const {
    data: noteResults = [],
    isLoading: notesLoading,
    isError: notesError
  } = useQuery(notesSearchQueryOptions(caseId, query))
  const {
    data: fieldResults,
    isLoading: fieldsLoading,
    isError: fieldsError
  } = useQuery(fieldSearchQueryOptions(caseId, query))

  const search = useCallback((q: string) => {
    setQuery(q.trim())
  }, [])

  const clear = useCallback(() => {
    setQuery('')
  }, [])

  return {
    results,
    noteResults,
    fieldResults,
    searching: isLoading || notesLoading || fieldsLoading,
    failed: isError || notesError || fieldsError,
    search,
    clear
  }
}
