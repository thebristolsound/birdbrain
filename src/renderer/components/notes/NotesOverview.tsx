import { useState, useEffect } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { notesQueryOptions, notesSearchQueryOptions } from '@renderer/lib/queries'
import { NoteCard } from './NoteCard'
import { CreateNoteCard } from './CreateNoteCard'

export function NotesOverview() {
  const { caseId } = useParams({ from: '/cases/$caseId/notes' })
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data: allNotes = [], isLoading } = useQuery(notesQueryOptions(caseId))
  const { data: searchResults = [] } = useQuery(notesSearchQueryOptions(caseId, debouncedQuery))

  const notes = debouncedQuery.length > 0 ? searchResults : allNotes

  if (isLoading) {
    return <div className="text-text-muted">Loading notes...</div>
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

      {notes.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">
          {debouncedQuery.length > 0
            ? `No notes match "${debouncedQuery}"`
            : 'No notes yet. Create one to record observations.'}
        </p>
      ) : (
        <div data-testid="notes-list" className="space-y-3">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} caseId={caseId} />
          ))}
        </div>
      )}
    </div>
  )
}
