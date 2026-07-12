import { useState, useEffect } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { Search } from 'lucide-react'
import { notesQueryOptions, notesSearchQueryOptions } from '@renderer/lib/api/notes'
import { Button } from '@renderer/components/ui'
import { presets } from '@renderer/lib/motion'
import { NoteCard } from '@renderer/components/notes/NoteCard'
import { CreateNoteCard } from '@renderer/components/notes/CreateNoteCard'

export function NotesOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/notes' })
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const {
    data: allNotes = [],
    isLoading,
    isError,
    error,
    refetch
  } = useQuery(notesQueryOptions(caseId))
  const {
    data: searchResults = [],
    isLoading: isSearchLoading,
    isFetching: isSearchFetching,
    isError: isSearchError,
    error: searchError,
    refetch: refetchSearch
  } = useQuery(notesSearchQueryOptions(caseId, debouncedQuery))

  const isSearching = debouncedQuery.length > 0 && (isSearchLoading || isSearchFetching)
  const showSearchError = debouncedQuery.length > 0 && isSearchError
  const notes = debouncedQuery.length > 0 ? searchResults : allNotes

  if (isLoading) {
    return <div className="text-text-muted">Loading notes...</div>
  }

  if (isError) {
    return (
      <div className="space-y-2 px-8 py-6">
        <p className="text-sm text-red-400">
          Failed to load notes: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-8 py-6 pb-16">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          data-testid="notes-search"
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search notes..."
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
        />
      </div>

      <CreateNoteCard
        caseId={caseId}
        isOpen={showCreateForm}
        onToggle={() => setShowCreateForm((v) => !v)}
        onCreated={() => setShowCreateForm(false)}
      />

      {showSearchError ? (
        <div className="space-y-2 py-8 text-center">
          <p className="text-sm text-red-400">
            Failed to search notes:{' '}
            {searchError instanceof Error ? searchError.message : 'Unknown error'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetchSearch()}>
            Retry search
          </Button>
        </div>
      ) : null}

      {showSearchError ? null : isSearching ? (
        <p className="py-8 text-center text-sm text-text-muted">Searching notes...</p>
      ) : notes.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">
          {debouncedQuery.length > 0
            ? `No notes match "${debouncedQuery}"`
            : 'No notes yet. Create one to record observations.'}
        </p>
      ) : (
        <div data-testid="notes-list" className="space-y-3">
          <AnimatePresence mode="popLayout">
            {notes.map((note) => (
              <motion.div
                key={note.id}
                layout
                initial={presets.listItem.initial}
                animate={presets.listItem.animate}
                exit={presets.listItem.exit}
                transition={presets.listItem.transition}
              >
                <NoteCard note={note} caseId={caseId} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
